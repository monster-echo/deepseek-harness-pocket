import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, RotateCw } from "lucide-react";
import { Button } from "../../components/ui";
import { bridgeInstall, type BootstrapProgress, type BootstrapStatus } from "../../lib/worker";
import { formatElapsed } from "../model";

/**
 * Worker 核心（bridge/dshc）：进入本步自动安装（唯一自动执行的一步——
 * 它没有可选参数，装就完了）；npm 逐行进度 + 计时，失败给出原因和重试。
 */
export function BridgeStep({
  status,
  progress,
  onDone,
}: {
  status: BootstrapStatus | null;
  progress?: BootstrapProgress;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startedRef = useRef(false);
  const done = Boolean(status?.bridge.installed && status?.bridge.satisfies);

  const run = async () => {
    setBusy(true);
    setError(null);
    setElapsed(0);
    try {
      await bridgeInstall();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // 进入本步自动开始（每会话一次；重试走按钮）
  useEffect(() => {
    if (!startedRef.current && !done && !busy && !error) {
      startedRef.current = true;
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  // 计时（busy 期间每秒 +1）
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  if (done) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <CheckCircle2 className="size-8 text-hue-green" />
        <p className="text-sm font-medium">Worker 核心 {status?.bridge.version} 已就绪</p>
        <p className="max-w-[38ch] text-xs text-muted-foreground">
          dshc 已从 npm 安装完成，负责启动与守护 Harness。
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 rounded-md bg-muted/60 px-3.5 py-3">
        {error ? (
          <RotateCw className="size-4 shrink-0 text-hue-red" />
        ) : (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium leading-tight">
            {busy ? "正在从 npm 安装 Worker 核心…" : error ? "安装失败" : "准备安装…"}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {busy ? `已进行 ${formatElapsed(elapsed)}` : error ? "可点击下方重试" : "连接 npm 镜像中…"}
          </p>
        </div>
        {busy && progress?.line ? (
          <span className="max-w-[180px] truncate font-mono text-[11px] text-muted-foreground" title={progress.line}>
            {progress.line}
          </span>
        ) : null}
      </div>

      {error ? (
        <>
          <p className="rounded-md bg-destructive-soft px-3 py-2 text-xs leading-relaxed text-hue-red">
            {error}
          </p>
          <Button onClick={() => void run()} disabled={busy}>
            <RotateCw />
            重试
          </Button>
        </>
      ) : null}
    </div>
  );
}
