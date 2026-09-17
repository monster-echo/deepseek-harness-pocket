import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, RotateCw, ScanLine } from "lucide-react";
import { Button } from "../components/ui";
import { workerStart } from "../lib/worker";
import { useDeviceLinkLogin } from "../lib/useDeviceLinkLogin";

/**
 * 登录步骤：仅支持手机扫码授权（已禁用网页登录）。
 *
 * 两个细节：
 * - 全新机器上二维码依赖本机服务标识（bridge-state.json，Worker 首次启动时生成），
 *   所以拿到「服务标识不可用」类错误时：自动启动 Worker → 数秒后自动重试出码；
 * - 登录是可选步骤：`onSkip`（稍后登录）由向导传入，跳过后可在控制台「账号」页补登。
 */
export function AccountStep({ onDone, onSkip }: { onDone: () => void; onSkip?: () => void }) {
  const { qr, qrBusy, qrError, qrNotice, remaining, startQr } = useDeviceLinkLogin({
    enabled: true,
    onApproved: () => onDone(),
  });
  const [serviceStarting, setServiceStarting] = useState(false);
  const startedWorker = useRef(false);

  // 服务未启动导致的出码失败：自动拉起 Worker 并重试（最多 ~36 秒）
  useEffect(() => {
    if (!qrError || serviceStarting) return;
    const needService = qrError.includes("服务标识") || qrError.includes("bridge-state");
    if (!needService) return;
    setServiceStarting(true);
    void (async () => {
      if (!startedWorker.current) {
        startedWorker.current = true;
        void workerStart().catch(() => {});
      }
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          await startQr();
          setServiceStarting(false);
          return;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (!(msg.includes("服务标识") || msg.includes("bridge-state"))) {
            setServiceStarting(false);
            return;
          }
        }
      }
      setServiceStarting(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrError]);

  return (
    <div className="flex flex-col gap-3">
      <ol className="space-y-0.5 text-[12px] leading-relaxed text-muted-foreground">
        <li>1. 在手机上打开 DSH Pocket，进入「扫码」</li>
        <li>2. 对准下方二维码，在手机上点「授权登录」</li>
      </ol>

      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-4">
        {qrBusy && qr === null ? (
          <div className="flex h-[132px] items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : qr ? (
          <>
            {/* 白底黑码：深浅色主题下都可扫 */}
            <div className="rounded-xl bg-white p-2.5">
              <QRCodeSVG value={qr.qr} size={136} level="M" />
            </div>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ScanLine className="size-3.5 animate-pulse" />
              {remaining > 0 ? `等待手机确认…${remaining} 秒后自动刷新` : "正在刷新二维码…"}
            </p>
          </>
        ) : serviceStarting ? (
          <div className="flex h-[132px] flex-col items-center justify-center gap-2">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
            <p className="text-xs text-muted-foreground">正在启动核心服务，随后自动出码…</p>
          </div>
        ) : null}

        {qrNotice ? (
          <p className="rounded-md bg-info-soft px-3 py-1.5 text-xs text-accent-soft-foreground">
            {qrNotice}
          </p>
        ) : null}
        {qrError && !serviceStarting ? (
          <div className="w-full">
            <p className="rounded-md bg-destructive-soft px-3 py-2 text-xs leading-relaxed text-hue-red">
              {qrError}
            </p>
            <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => void startQr()}>
              <RotateCw />
              重新生成二维码
            </Button>
          </div>
        ) : null}
      </div>

      {onSkip ? (
        <div className="flex justify-center">
          <Button variant="ghost" size="sm" onClick={onSkip}>
            稍后登录（可在控制台「账号」页补登）
          </Button>
        </div>
      ) : null}
    </div>
  );
}
