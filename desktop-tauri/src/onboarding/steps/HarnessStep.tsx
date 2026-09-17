import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "../../components/ui";
import { installVersion, versionsAvailable, type BootstrapProgress, type BootstrapStatus } from "../../lib/worker";
import { formatElapsed } from "../model";

/**
 * DeepSeek Harness（dsh 运行时）：推荐最新版本一键安装；
 * 「高级选项」可自选版本。依赖树较大（10–30 分钟）——逐行进度 + 计时，
 * 让用户确切知道它在干活而不是死机。
 */
export function HarnessStep({
  status,
  progress,
  onDone,
}: {
  status: BootstrapStatus | null;
  progress?: BootstrapProgress;
  onDone: () => void;
}) {
  const installed = Boolean(status?.dshInstalled);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [versions, setVersions] = useState<string[] | null>(null);
  const [picker, setPicker] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (versions !== null || picker || installed) return;
    void versionsAvailable()
      .then((list) => {
        setVersions(list);
        setSelected((cur) => cur ?? list[0] ?? null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [versions, picker, installed]);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const install = async (version: string) => {
    setBusy(true);
    setError(null);
    setElapsed(0);
    try {
      await installVersion(version);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (installed) {
    const versions = status?.dshVersions ?? [];
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <CheckCircle2 className="size-8 text-hue-green" />
        <p className="text-sm font-medium">Harness {versions.join(" / ") || ""} 已就绪</p>
        <p className="max-w-[38ch] text-xs text-muted-foreground">
          之后可在控制台「版本」页随时安装或切换其他版本。
        </p>
      </div>
    );
  }

  const recommended = versions?.[0];

  return (
    <div className="flex flex-col gap-3">
      <Button disabled={busy || !recommended} onClick={() => recommended && void install(recommended)}>
        {busy ? <Loader2 className="animate-spin" /> : null}
        {busy
          ? `正在安装 Harness ${selected ?? ""}…（${formatElapsed(elapsed)}）`
          : recommended
            ? `安装推荐版本 ${recommended}`
            : "获取版本列表…"}
      </Button>

      <button
        type="button"
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setPicker((v) => !v)}
      >
        {picker ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        高级选项：自选版本
      </button>
      {picker ? (
        <div className="flex flex-wrap gap-1.5">
          {versions === null ? (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          ) : (
            versions.slice(0, 8).map((v) => (
              <Button
                key={v}
                variant={v === selected ? "default" : "outline"}
                size="sm"
                className="font-mono text-xs"
                disabled={busy}
                onClick={() => setSelected(v)}
              >
                {v}
              </Button>
            ))
          )}
        </div>
      ) : null}

      {busy ? (
        <div className="rounded-md bg-muted/60 px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            <span>依赖树较大（约 450 个包），通常 5–15 分钟{elapsed > 0 ? ` · 已进行 ${formatElapsed(elapsed)}` : ""}</span>
          </div>
          {progress?.line ? (
            <p className="mt-1.5 truncate font-mono text-[11px] text-muted-foreground" title={progress.line}>
              {progress.line}
            </p>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="rounded-md bg-destructive-soft px-3 py-2 text-xs leading-relaxed text-hue-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}
