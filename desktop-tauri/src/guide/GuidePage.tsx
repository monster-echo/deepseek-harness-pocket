import { useEffect, useState } from "react";
import { Loader2, Play, RefreshCw, Settings2, ExternalLink } from "lucide-react";
import { Button, Card } from "../components/ui";
import {
  workerStart,
  workerStatus,
  openExternal,
  showConsole,
  type WorkerStatus,
} from "../lib/worker";

/**
 * 主窗口引导面 —— Worker 未就绪时接管整个窗口。
 *
 * 职责单一：告诉人现在是什么状态、下一步点什么。
 * 焦点是「状态 + 主操作」，其余一律降级为次级文字。
 */
export function GuidePage() {
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setStatus(await workerStatus());
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, []);

  const running = status?.running ?? false;
  const webUrl = status?.run?.webUrl ?? "";
  const bootError = error ?? status?.error ?? status?.parseError ?? null;

  const onStart = async () => {
    setBusy(true);
    setError(null);
    try {
      await workerStart();
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-background p-8">
      <Card className="w-full max-w-[420px] p-7">
        <div className="flex flex-col items-center text-center">
          <img
            src="/logo.png"
            alt="DSH Pocket"
            className="mb-3 size-14 rounded-xl"
            draggable={false}
          />

          <h1 className="text-lg font-semibold tracking-tight">
            {running ? "Harness 正在启动" : "服务未运行"}
            {running ? (
              <Loader2 className="ml-1.5 inline size-4 animate-spin align-[-2px] text-muted-foreground" />
            ) : null}
          </h1>
          <p className="mt-1.5 max-w-[34ch] text-[13px] leading-relaxed text-muted-foreground">
            {running
              ? "控制台就绪后本窗口会自动载入，通常需要约 10 秒。"
              : "启动后即可在本窗口直接使用 DeepSeek Harness。"}
          </p>

          {!running && bootError ? (
            <p className="mt-3 w-full rounded-md bg-destructive-soft px-3 py-2 text-left text-xs leading-relaxed text-hue-red">
              启动失败：{bootError}
            </p>
          ) : null}

          <div className="mt-6 flex w-full flex-col gap-2">
            {running ? (
              <Button variant="outline" onClick={() => void refresh()}>
                <RefreshCw />
                重新检查
              </Button>
            ) : (
              <Button onClick={() => void onStart()} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Play />}
                {busy ? "正在启动…" : "启动 Harness"}
              </Button>
            )}

            <div className="flex gap-2">
              <Button
                variant="ghost"
                className="flex-1"
                onClick={() => void showConsole("status")}
              >
                <Settings2 />
                打开控制台
              </Button>
              {webUrl ? (
                <Button
                  variant="ghost"
                  className="flex-1"
                  onClick={() => void openExternal(webUrl)}
                >
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
