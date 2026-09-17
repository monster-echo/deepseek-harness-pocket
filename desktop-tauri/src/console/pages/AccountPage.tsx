import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Loader2, LogOut, ShieldCheck, ShieldAlert, RefreshCw, RotateCw,
  Smartphone, ScanLine,
} from "lucide-react";
import {
  Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dot, Field,
} from "../../components/ui";
import {
  accountRefresh, accountSignOut, deviceLinkRevoke,
  jwtExpiry, readAccountSession, readDeviceLink,
  type AccountSessionInfo, type DeviceLinkInfo,
} from "../../lib/worker";
import { useDeviceLinkLogin } from "../../lib/useDeviceLinkLogin";
import { formatTime } from "../useWorker";
import { Page, PageHeader } from "./PageHeader";

/**
 * 账号页：掌鲸账号登录态（与手机 App 同一账号体系）。
 *
 * 登录路径只有**手机扫码授权**（Telegram 同款）：未登录时显示二维码，手机
 * DSH Pocket 扫码并确认后，gateway 把这台电脑绑定到手机账号，并给桌面端
 * 签发独立设备凭据（device-link.json）——手机会话不会被复制到电脑。
 */
export function AccountPage() {
  const [info, setInfo] = useState<AccountSessionInfo | null>(null);
  const [link, setLink] = useState<DeviceLinkInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [autoTried, setAutoTried] = useState(false);

  const load = useCallback(async () => {
    try {
      setInfo(await readAccountSession());
      setLink(await readDeviceLink());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 扫码登录状态机（出码/轮询/过期换码在 hook 里，引导页共用）
  const {
    qr, qrBusy, qrError, qrNotice, remaining, startQr,
  } = useDeviceLinkLogin({
    enabled: info !== null && !info.signedIn && link === null,
    onApproved: (l) => setLink(l),
  });

  const onRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await accountRefresh();
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const onSignOut = async () => {
    setBusy(true);
    setError(null);
    try {
      await accountSignOut();
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  /** 退出扫码登录：解绑 + 吊销设备凭据（服务端失败也让本地登出） */
  const onRevoke = async () => {
    setBusy(true);
    setError(null);
    try {
      await deviceLinkRevoke();
      setLink(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const signedIn = info?.signedIn ?? false;
  const exp = jwtExpiry(info?.token as string | undefined);
  const expired = exp !== null && Date.now() >= exp;
  const hasRefresh = Boolean(info?.refreshToken);

  // 打开页面时若会话已过期但还有 refreshToken，静默续一次（只试一次，避免死循环）
  useEffect(() => {
    if (signedIn && expired && hasRefresh && !autoTried && !refreshing) {
      setAutoTried(true);
      void onRefresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, expired, hasRefresh, autoTried]);
  const display = info?.email || info?.userId || "已登录";
  const viaPhone = Boolean(link);
  const phoneDisplay =
    link?.email || (link?.userId ? `账号 ${String(link.userId).slice(0, 8)}` : "已登录");

  if (info === null) {
    return (
      <Page>
        <PageHeader title="账号" />
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          正在读取登录态…
        </div>
      </Page>
    );
  }

  // ── 未登录：手机扫码（主）+ 浏览器登录（备）──────────────────
  if (!signedIn && !viaPhone) {
    return (
      <Page>
        <PageHeader
          title="账号"
          description="用手机 DSH Pocket 扫码授权登录——像 Telegram 那样扫一下就好。"
          actions={
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={busy}>
              <RefreshCw />
              刷新
            </Button>
          }
        />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="size-4" />
              手机扫码登录
            </CardTitle>
            <CardDescription>
              在手机 DSH Pocket 里打开「扫码」，对准下方二维码并确认授权。
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {/* 步骤（Telegram Desktop 同款三步指引） */}
            <ol className="mb-4 space-y-1 text-[12px] leading-relaxed text-muted-foreground">
              <li>1. 在手机上打开 DSH Pocket</li>
              <li>2. 进入「扫码」</li>
              <li>3. 对准这个二维码，在手机上点「授权登录」</li>
            </ol>

            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-5">
              {qrBusy && qr === null ? (
                <div className="flex h-[172px] items-center justify-center">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : qr ? (
                <>
                  {/* 白底黑码：深浅色主题下都可扫 */}
                  <div className="rounded-xl bg-white p-3">
                    <QRCodeSVG value={qr.qr} size={148} level="M" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {remaining > 0 ? (
                      <>
                        链接码 <span className="font-mono tracking-widest">{qr.code}</span>
                        <span className="mx-1.5">·</span>
                        {remaining} 秒后自动刷新
                      </>
                    ) : (
                      "正在刷新二维码…"
                    )}
                  </p>
                </>
              ) : null}

              {qr ? (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ScanLine className="size-3.5 animate-pulse" />
                  等待手机确认…
                </p>
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
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 w-full"
                    onClick={() => void startQr()}
                  >
                    <RotateCw />
                    重新生成二维码
                  </Button>
                </div>
              ) : null}
            </div>

            {error ? (
              <p className="mt-3 rounded-md bg-destructive-soft px-3 py-2 text-xs leading-relaxed text-hue-red">
                {error}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <div className="mt-4 rounded-lg border border-dashed border-border px-4 py-3">
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            二维码只含一次性链接码（5 分钟内有效），账号密码不经过这台电脑；授权后电脑拿到的是
            独立设备凭据，可单独退出。手机上没有 DSH Pocket？先在手机注册并登录。
          </p>
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="账号"
        description={
          viaPhone
            ? "这台电脑已通过手机扫码授权绑定到你的账号。"
            : "登录掌鲸账号后，同一账号的手机 App 会自动看到这台电脑，无需扫码。"
        }
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={busy}>
            <RefreshCw />
            刷新
          </Button>
        }
      />

      {/* 焦点：登录态 + 主操作 */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Dot tone={signedIn ? (expired ? "warning" : "success") : "success"} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-tight">
                  {viaPhone ? phoneDisplay : signedIn ? display : "未登录"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {viaPhone
                    ? "手机扫码授权生效中，手机端可直接看到这台电脑"
                    : signedIn
                      ? "本机 Worker 会以该账号注册到网关"
                      : "登录后即可用手机远程使唤这台电脑"}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {viaPhone ? (
                <Badge tone="success">
                  <Smartphone className="size-3" />
                  手机授权
                </Badge>
              ) : null}
              {signedIn && hasRefresh ? (
                <Button
                  variant={expired ? "default" : "ghost"}
                  size="sm"
                  disabled={refreshing || busy}
                  title="用 refresh token 换一个新的会话"
                  onClick={() => void onRefresh()}
                >
                  {refreshing ? <Loader2 className="animate-spin" /> : <RotateCw />}
                  续期
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void (viaPhone ? onRevoke() : onSignOut())}
                disabled={busy}
              >
                {busy ? <Loader2 className="animate-spin" /> : <LogOut />}
                退出登录
              </Button>
            </div>
          </div>

          {error ? (
            <p className="mt-3 rounded-md bg-destructive-soft px-3 py-2 text-xs leading-relaxed text-hue-red">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {viaPhone && !signedIn ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>扫码授权</CardTitle>
            <CardDescription>手机会话不复制到电脑；退出登录会同时解绑这台电脑</CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border pt-0">
            <Field label="邮箱">{link?.email || "—"}</Field>
            <Field label="用户 ID" mono>{link?.userId || "—"}</Field>
            <Field label="授权时间">
              <span className="tabular">
                {link?.linkedAt ? formatTime(Math.floor(link.linkedAt / 1000)) : "—"}
              </span>
            </Field>
            <Field label="授权方式">
              <Badge tone="success">
                <ShieldCheck className="size-3" />
                手机扫码
              </Badge>
            </Field>
            <Field label="凭据文件" mono>~/.deepseek-harness-pocket/device-link.json</Field>
          </CardContent>
        </Card>
      ) : null}

      {signedIn ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>会话</CardTitle>
            <CardDescription>凭据只保存在本机，不上传会话内容</CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border pt-0">
            <Field label="用户 ID" mono>{info.userId || "—"}</Field>
            <Field label="邮箱">{info.email || "—"}</Field>
            <Field label="Token 状态">
              {exp === null ? (
                <Badge tone="neutral">无法解析 exp</Badge>
              ) : expired ? (
                <Badge tone="warning">
                  <ShieldAlert className="size-3" />
                  已过期
                </Badge>
              ) : (
                <Badge tone="success">
                  <ShieldCheck className="size-3" />
                  有效
                </Badge>
              )}
            </Field>
            {exp !== null ? (
              <Field label="到期时间">
                <span className="tabular">{formatTime(Math.floor(exp / 1000))}</span>
              </Field>
            ) : null}
            <Field label="写入时间">
              <span className="tabular">
                {info.updatedAt ? formatTime(Math.floor(info.updatedAt / 1000)) : "—"}
              </span>
            </Field>
            <Field label="会话文件" mono>{info.sessionFile || "—"}</Field>
          </CardContent>
        </Card>
      ) : null}
    </Page>
  );
}