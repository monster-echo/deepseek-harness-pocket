import { useState } from "react";
import { Eraser, RotateCw } from "lucide-react";
import { Button } from "../components/ui";
import { portCleanup, showConsole } from "../lib/worker";

/**
 * 「端口被占用」修复卡：一键结束占用 Worker 口 / dsh web 口的残留进程
 * （最常见的旧 DSH 孤儿进程）。supervisor 每次 spawn 前也会自动清场，这里是显式入口。
 */
export function PortStep({ onRetry }: { onRetry: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const cleanup = () => {
    setBusy(true);
    setResult(null);
    void portCleanup()
      .then((cleaned) => {
        const hit = cleaned.filter((c) => c.killed.length > 0);
        setResult(
          hit.length === 0
            ? "端口已空闲，无需清理"
            : `已结束占用进程：${hit
                .map((c) => `${c.port} 端口 → pid ${c.killed.join(", ")}`)
                .join("；")}`,
        );
      })
      .catch((e) => setResult(`清理失败：${String(e)}`))
      .finally(() => {
        setBusy(false);
        onRetry();
      });
  };

  return (
    <div className="mt-2 rounded-md bg-muted/60 px-3 py-3">
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        最常见的原因是残留了一个旧的 DSH 进程占着端口，可一键结束占用者；
        Worker 启动时也会自动做同样的清场。想先确认占用者是谁，可在「日志」页查看。
      </p>
      <div className="mt-2.5 flex gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={cleanup}>
          {busy ? <RotateCw className="animate-spin" /> : <Eraser />}
          {busy ? "正在清理…" : "清理端口"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void showConsole("logs")}>
          打开控制台·日志
        </Button>
        <Button variant="ghost" size="sm" onClick={onRetry}>
          <RotateCw />
          重试
        </Button>
      </div>
      {result ? <p className="mt-2 text-[12px] text-muted-foreground">{result}</p> : null}
    </div>
  );
}
