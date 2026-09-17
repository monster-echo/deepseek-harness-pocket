import { useEffect, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ExternalLink, Loader2, Play, RefreshCw, Settings2, XCircle,
} from "lucide-react";
import { Badge, Button, Card } from "../components/ui";
import {
  giveUpText, onWorkerStartError, openExternal, showConsole, workerResume, workerStart,
  type PreflightItem, type PreflightItemId, type WorkerStatus,
} from "../lib/worker";
import { useWorkerStatus } from "../lib/useWorkerStatus";
import { usePreflight } from "./usePreflight";
import { AccountStep } from "./AccountStep";
import { PortStep } from "./PortStep";
import { RuntimeStep } from "./RuntimeStep";

/**
 * 主窗口引导面 —— Worker 未就绪时接管整个窗口。
 *
 * 结构：环境预检清单（应用组件 / dsh 运行时 / 账号 / 端口 / 网关），
 * 失败项内联给出修复动作（装运行时 / 扫码登录 / 端口冲突说明），
 * 全部就绪后给「启动 Harness」。supervisor 待机（放弃自动重启）时以待机卡为一等状态。
 * 状态一律来自 useWorkerStatus（Rust 侧推送），本页面不自建轮询。
 */

const ITEM_LABEL: Record<PreflightItemId, string> = {
  sidecar: "应用组件",
  runtime: "dsh 运行时",
  account: "掌鲸账号",
  port: "网络端口",
  gateway: "网关连接",
};

function ItemIcon({ state, checking }: { state: PreflightItem["state"]; checking: boolean }) {
  if (checking) return <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />;
  const cls = "size-4 shrink-0";
  switch (state) {
    case "pass":
      return <CheckCircle2 className={`${cls} text-hue-green`} />;
    case "warn":
      return <AlertTriangle className={`${cls} text-hue-orange`} />;
    case "fail":
      return <XCircle className={`${cls} text-hue-red`} />;
  }
}

export function GuidePage() {
  const status: WorkerStatus | null = useWorkerStatus();
  const { report, loading, error: preflightError, refresh } = usePreflight();
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // boot 线程自动启动失败时立即把错误亮在引导面（不再吞错）
  useEffect(() => {
    const unlisten = onWorkerStartError((msg) => setStartError(msg));
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  const running = status?.running ?? false;
  const standby = status?.standby ?? status?.run?.supervisor === "standby";
  const webUrl = status?.run?.webUrl ?? "";
  const bootError = startError ?? status?.error ?? status?.parseError ?? null;

  const onStart = async () => {
    setBusy(true);
    setStartError(null);
    try {
      await workerStart();
    } catch (e) {
      setStartError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const onResume = async () => {
    setBusy(true);
    try {
      await workerResume();
    } finally {
      setBusy(false);
    }
  };

  const fixDone = () => {
    void refresh();
  };

  const fixFor = (item: PreflightItem) => {
    switch (item.fix) {
      case "install_runtime":
        return <RuntimeStep onDone={fixDone} />;
      case "login":
        return <AccountStep onDone={fixDone} />;
      case "free_port":
        return <PortStep onRetry={() => void refresh()} />;
      default:
        return null;
    }
  };

  const items = report?.items ?? [];
  const allReady = report?.overall === "ready";
  const checking = report === null && preflightError === null;

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-background p-6">
      <Card className="w-full max-w-[440px] p-6">
        <div className="flex flex-col items-center text-center">
          <img
            src="/logo.png"
            alt="DSH Pocket"
            className="mb-3 size-14 rounded-xl"
            draggable={false}
          />

          <h1 className="text-lg font-semibold tracking-tight">
            {standby
              ? "Worker 已待机"
              : running
                ? "Harness 正在启动"
                : allReady
                  ? "环境就绪"
                  : "先完成初始设置"}
            {standby || running || checking ? (
              <Loader2 className="ml-1.5 inline size-4 animate-spin align-[-2px] text-muted-foreground" />
            ) : null}
          </h1>
          <p className="mt-1.5 max-w-[36ch] text-[13px] leading-relaxed text-muted-foreground">
            {standby
              ? giveUpText(status?.run?.giveUp)
              : running
                ? "控制台就绪后本窗口会自动载入，通常需要约 10 秒。"
                : allReady
                  ? "环境检查全部通过，启动后即可在本窗口直接使用 DeepSeek Harness。"
                  : "按下方清单补齐环境——每完成一项会自动重新检查。"}
          </p>

          {/* 待机：supervisor 已放弃自动重启，给手动出口而不是无限转圈 */}
          {standby ? (
            <div className="mt-4 w-full rounded-md bg-warning-soft px-3 py-2.5 text-left">
              <p className="text-xs leading-relaxed text-hue-orange">{giveUpText(status?.run?.giveUp)}</p>
              <Button size="sm" className="mt-2 w-full" onClick={() => void onResume()} disabled={busy}>
                <RefreshCw />
                重试启动
              </Button>
            </div>
          ) : null}

          {/* 预检清单 */}
          {!running && !standby ? (
            <div className="mt-4 w-full space-y-1 text-left">
              {checking ? (
                <p className="flex items-center gap-2 px-1 py-1.5 text-[13px] text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  正在检查环境…
                </p>
              ) : (
                items.map((item) => (
                  <div key={item.id} className="rounded-md px-1 py-1">
                    <div className="flex w-full items-center gap-2.5 text-left">
                      <ItemIcon state={item.state} checking={false} />
                      <span className="w-[68px] shrink-0 text-[13px] font-medium">{ITEM_LABEL[item.id]}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {item.detail}
                      </span>
                      {item.state === "fail" && item.fix ? (
                        <Badge tone="danger">待处理</Badge>
                      ) : item.state === "warn" ? (
                        <Badge tone="warning">注意</Badge>
                      ) : null}
                    </div>
                    {item.state === "fail" && item.fix ? (
                      <div className="pl-6">{fixFor(item)}</div>
                    ) : null}
                  </div>
                ))
              )}

              {preflightError ? (
                <p className="mt-1 rounded-md bg-destructive-soft px-3 py-2 text-xs leading-relaxed text-hue-red">
                  环境检查失败：{preflightError}
                </p>
              ) : null}
              {bootError && !running ? (
                <p className="mt-1 rounded-md bg-destructive-soft px-3 py-2 text-xs leading-relaxed text-hue-red">
                  启动失败：{bootError}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-5 flex w-full flex-col gap-2">
            {!running && !standby && allReady ? (
              <Button onClick={() => void onStart()} disabled={busy || loading}>
                {busy ? <Loader2 className="animate-spin" /> : <Play />}
                {busy ? "正在启动…" : "启动 Harness"}
              </Button>
            ) : null}
            {!running && !standby && !allReady ? (
              <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
                <RefreshCw />
                重新检查
              </Button>
            ) : null}
            {running ? (
              <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
                <RefreshCw />
                重新检查
              </Button>
            ) : null}

            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => void showConsole("status")}>
                <Settings2 />
                打开控制台
              </Button>
              {webUrl ? (
                <Button variant="ghost" className="flex-1" onClick={() => void openExternal(webUrl)}>
                  <ExternalLink />
                  用浏览器打开
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
