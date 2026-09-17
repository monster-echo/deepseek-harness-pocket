import { RotateCw } from "lucide-react";
import { Button } from "../components/ui";
import { showConsole } from "../lib/worker";

/**
 * 「端口被占用」修复卡：引导页不擅自杀进程，给出解释与出口——
 * 看日志定位占用者 → 用户自行处理 → 重试。
 */
export function PortStep({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mt-2 rounded-md bg-muted/60 px-3 py-3">
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        最常见的原因是残留了一个旧的 DSH 进程。可以在「日志」页确认，
        或直接重启电脑后重试；确认旧进程不再需要后，也可在终端执行
        <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-[11px]">dshc stop</code>
        清理。
      </p>
      <div className="mt-2.5 flex gap-2">
        <Button variant="outline" size="sm" onClick={() => void showConsole("logs")}>
          打开控制台·日志
        </Button>
        <Button variant="ghost" size="sm" onClick={onRetry}>
          <RotateCw />
          重试
        </Button>
      </div>
    </div>
  );
}
