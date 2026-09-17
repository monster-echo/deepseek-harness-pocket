import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Globe, Loader2, LogIn, RotateCw, ScanLine } from "lucide-react";
import { Button } from "../components/ui";
import { accountLogin } from "../lib/worker";
import { useDeviceLinkLogin } from "../lib/useDeviceLinkLogin";

/**
 * 「登录掌鲸账号」修复卡：手机扫码（主，与账号页同一状态机）+ 浏览器登录（备）。
 * 授权成功即回调 onDone（引导页据此刷新预检）。
 */
export function AccountStep({ onDone }: { onDone: () => void }) {
  const [browserBusy, setBrowserBusy] = useState(false);
  const [browserWaiting, setBrowserWaiting] = useState(false);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const { qr, qrBusy, qrError, qrNotice, remaining, startQr } = useDeviceLinkLogin({
    enabled: true,
    onApproved: () => onDone(),
  });

  const onBrowserLogin = async () => {
    setBrowserBusy(true);
    setBrowserError(null);
    setBrowserWaiting(true);
    try {
      await accountLogin();
      onDone();
    } catch (e) {
      setBrowserError(e instanceof Error ? e.message : String(e));
    } finally {
      setBrowserBusy(false);
      setBrowserWaiting(false);
    }
  };

  return (
    <div className="mt-2 rounded-md bg-muted/60 px-3 py-3">
      <ol className="mb-2.5 space-y-0.5 text-[12px] leading-relaxed text-muted-foreground">
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
              <QRCodeSVG value={qr.qr} size={120} level="M" />
            </div>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ScanLine className="size-3.5 animate-pulse" />
              {remaining > 0 ? `等待手机确认…${remaining} 秒后自动刷新` : "正在刷新二维码…"}
            </p>
          </>
        ) : null}

        {qrNotice ? (
          <p className="rounded-md bg-info-soft px-3 py-1.5 text-xs text-accent-soft-foreground">
            {qrNotice}
          </p>
        ) : null}
        {qrError ? (
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

      <div className="mt-2.5 flex justify-center">
        <Button variant="ghost" size="sm" onClick={() => void onBrowserLogin()} disabled={browserBusy}>
          {browserBusy ? <Loader2 className="animate-spin" /> : <LogIn />}
          在浏览器中登录
        </Button>
      </div>

      {browserWaiting ? (
        <p className="mt-1.5 flex items-start gap-1.5 rounded-md bg-info-soft px-3 py-2 text-xs leading-relaxed text-accent-soft-foreground">
          <Globe className="mt-0.5 size-3 shrink-0" />
          已打开系统浏览器，请在其中完成登录（最长 180 秒）。
        </p>
      ) : null}
      {browserError ? (
        <p className="mt-1.5 rounded-md bg-destructive-soft px-3 py-2 text-xs leading-relaxed text-hue-red">
          {browserError}
        </p>
      ) : null}
    </div>
  );
}
