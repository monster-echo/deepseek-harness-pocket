import { useCallback, useEffect, useRef, useState } from "react";
import {
  deviceLinkPoll,
  deviceLinkStart,
  type DeviceLinkInfo,
  type DeviceLinkPending,
} from "./worker";

/**
 * 扫码登录状态机（手机授权，Telegram 同款）——从 AccountPage 纯提取，引导页登录步骤共用。
 *
 * 出码 → 轮询手机确认 → approved 时回调 onApproved；过期自动换新码（不让人对着一张死码），
 * 网络抖动不打断等待（下一拍继续）。`enabled=false` 时不申请二维码（已登录时）。
 */
export function useDeviceLinkLogin(options: {
  enabled: boolean;
  onApproved?: (link: DeviceLinkInfo) => void;
}) {
  const { enabled, onApproved } = options;
  const [qr, setQr] = useState<DeviceLinkPending | null>(null);
  const [qrBusy, setQrBusy] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const [qrNotice, setQrNotice] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const pollRef = useRef<{ stop: () => void } | null>(null);
  const approvedRef = useRef(onApproved);
  approvedRef.current = onApproved;

  /** 申请二维码（过期/手动刷新共用）；旧的轮询与倒计时一并作废 */
  const startQr = useCallback(async () => {
    pollRef.current?.stop();
    pollRef.current = null;
    setQrBusy(true);
    setQrError(null);
    try {
      const pending = await deviceLinkStart();
      setQr(pending);
      setRemaining(Math.max(0, Math.round((pending.expiresAt - Date.now()) / 1000)));
    } catch (e) {
      setQr(null);
      setQrError(e instanceof Error ? e.message : String(e));
    } finally {
      setQrBusy(false);
    }
  }, []);

  // 未登录时进页面即出码（Telegram 同款：打开就是活的二维码）
  useEffect(() => {
    if (enabled && qr === null && !qrBusy && qrError === null) {
      void startQr();
    }
  }, [enabled, qr, qrBusy, qrError, startQr]);

  // 轮询手机确认 + 每秒倒计时；过期自动换新码
  useEffect(() => {
    if (!qr) return;
    let stopped = false;
    const stop = () => {
      stopped = true;
    };
    pollRef.current = { stop };
    const tick = setInterval(() => {
      setRemaining(Math.max(0, Math.round((qr.expiresAt - Date.now()) / 1000)));
    }, 1000);
    const poll = setInterval(() => {
      if (stopped) return;
      void (async () => {
        try {
          const r = await deviceLinkPoll(qr.code, qr.secret);
          if (stopped) return;
          if (r.status === "approved") {
            pollRef.current?.stop();
            setQr(null);
            setQrNotice(null);
            approvedRef.current?.(r.link);
          } else if (r.status === "expired") {
            pollRef.current?.stop();
            setQrNotice("二维码已过期，已自动刷新，请重新扫描");
            void startQr();
          }
        } catch {
          // 网络抖动：下一拍继续，不打断等待
        }
      })();
    }, Math.max(800, qr.intervalMs));
    return () => {
      stopped = true;
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [qr, startQr]);

  /** 停止等待并清掉二维码（登录完成后调用） */
  const reset = useCallback(() => {
    pollRef.current?.stop();
    pollRef.current = null;
    setQr(null);
    setQrError(null);
    setQrNotice(null);
  }, []);

  return { qr, qrBusy, qrError, qrNotice, remaining, startQr, reset };
}
