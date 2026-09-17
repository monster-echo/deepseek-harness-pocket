import { useEffect, useState } from "react";
import { CheckCircle2, Download, HardDrive, Loader2 } from "lucide-react";
import { Button } from "../../components/ui";
import {
  nodeInstall, systemNodeProbe,
  type BootstrapProgress, type BootstrapStatus,
} from "../../lib/worker";
import { formatBytes } from "../model";

/**
 * Node 运行时：优先复用系统 Node（零下载）；也可选受管 24/22（镜像下载+校验）。
 * 安装进度为真实字节进度——让用户确切看到发生了什么，而不是一个转圈。
 */
export function NodeStep({
  status,
  adoptedSystem,
  onAdopted,
  onDone,
  progress,
}: {
  status: BootstrapStatus | null;
  /** 用户已采用系统 Node（本会话内） */
  adoptedSystem: boolean;
  onAdopted: () => void;
  onDone: () => void;
  progress?: BootstrapProgress;
}) {
  const system = status?.systemNode;
  const systemUsable = Boolean(system?.usable);
  // 默认选中：系统可用 → 系统；否则选 Node 24
  const [choice, setChoice] = useState<"system" | 24 | 22 | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (choice === null && status !== null) {
      setChoice(systemUsable ? "system" : (status.nodeChoices[0]?.major as 24 | 22 | undefined ?? 24));
    }
  }, [status, systemUsable, choice]);

  const managedDone = Boolean(status?.node.installed);
  const satisfied = adoptedSystem || managedDone;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      if (choice === "system") {
        await systemNodeProbe();
        onAdopted();
      } else if (typeof choice === "number") {
        await nodeInstall(choice);
        onDone();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const pct =
    progress?.phase === "download" && progress.total
      ? Math.min(100, Math.round(((progress.received ?? 0) / progress.total) * 100))
      : null;

  const choiceCard = (key: "system" | 24 | 22, title: string, desc: string, enabled: boolean) => (
    <button
      type="button"
      disabled={!enabled || busy}
      onClick={() => setChoice(key)}
      className={`flex w-full items-start gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors ${
        choice === key
          ? "border-primary bg-accent-soft/50"
          : "border-border hover:bg-accent/40"
      } ${!enabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      {key === "system" ? (
        <HardDrive className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      ) : (
        <Download className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium leading-tight">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
      </div>
      {choice === key ? <CheckCircle2 className="size-4 shrink-0 text-hue-green" /> : null}
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      {choiceCard(
        "system",
        systemUsable ? `复用系统 Node ${system?.version ?? ""}（推荐）` : "复用系统 Node",
        systemUsable ? "检测到本机已有可用的 Node.js，零下载直接使用" : system?.reason ?? "未检测到可用的 Node.js",
        systemUsable,
      )}
      {(status?.nodeChoices ?? []).map(({ major, version }) =>
        choiceCard(
          major as 24 | 22,
          `下载 Node ${major} LTS`,
          `v ${version.replace(/^v/, "")} · 约 30MB · npmmirror 镜像 + 官方校验`,
          true,
        ),
      )}

      {busy && progress?.phase === "download" ? (
        <div className="rounded-md bg-muted/60 px-3 py-2.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>正在下载…</span>
            <span className="tabular">
              {formatBytes(progress.received)}
              {progress.total ? ` / ${formatBytes(progress.total)}` : ""}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${pct ?? 0}%` }}
            />
          </div>
          {!pct ? <Loader2 className="mt-1.5 size-3 animate-spin text-muted-foreground" /> : null}
        </div>
      ) : null}
      {busy && progress && progress.phase !== "download" ? (
        <p className="flex items-center gap-2 rounded-md bg-info-soft px-3 py-2 text-xs text-accent-soft-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {progress.phase === "verify"
            ? "正在校验官方签名（sha256）…"
            : progress.phase === "extract"
              ? "正在解压就位…"
              : "正在准备…"}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-md bg-destructive-soft px-3 py-2 text-xs leading-relaxed text-hue-red">
          {error}
        </p>
      ) : null}

      {satisfied ? (
        <p className="flex items-center gap-1.5 text-xs text-hue-green">
          <CheckCircle2 className="size-3.5" />
          Node 运行时已就绪
        </p>
      ) : (
        <Button
          disabled={choice === null || busy || (choice === "system" && !systemUsable)}
          onClick={() => void run()}
        >
          {busy ? <Loader2 className="animate-spin" /> : null}
          {choice === "system"
            ? "使用系统 Node 并继续"
            : typeof choice === "number" && status?.nodeChoices.find((c) => c.major === choice)?.version
              ? `下载 Node ${choice} 并安装`
              : "安装"}
        </Button>
      )}
    </div>
  );
}
