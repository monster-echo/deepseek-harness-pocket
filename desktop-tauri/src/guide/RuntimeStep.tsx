import { useState } from "react";
import { ChevronDown, ChevronRight, Download, Loader2 } from "lucide-react";
import { Button } from "../components/ui";
import { installVersion, versionsAvailable } from "../lib/worker";

/**
 * 「装 dsh 运行时」修复卡：一键安装推荐版本（registry 最新）；
 * 「高级选项」里可自选版本（与「版本」页同一份可安装列表）。
 */
export function RuntimeStep({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [versions, setVersions] = useState<string[] | null>(null);

  const install = async (version: string) => {
    setBusy(true);
    setError(null);
    setProgress(`正在安装 dsh ${version}…依赖树较大，请耐心等待（最长 30 分钟）。`);
    try {
      await installVersion(version);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
    } finally {
      setBusy(false);
    }
  };

  const recommend = async () => {
    setBusy(true);
    setError(null);
    try {
      const list = await versionsAvailable();
      const latest = list[0];
      if (!latest) throw new Error("registry 上没有可用版本");
      setProgress(`正在安装 dsh ${latest}…依赖树较大，请耐心等待（最长 30 分钟）。`);
      await installVersion(latest);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
    } finally {
      setBusy(false);
    }
  };

  const openPicker = async () => {
    setPickerOpen((v) => !v);
    if (versions === null) {
      try {
        setVersions(await versionsAvailable());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  };

  return (
    <div className="mt-2 rounded-md bg-muted/60 px-3 py-3">
      <Button size="sm" onClick={() => void recommend()} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <Download />}
        安装推荐版本
      </Button>

      <button
        type="button"
        className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => void openPicker()}
      >
        {pickerOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        高级选项：自选版本
      </button>
      {pickerOpen ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {versions === null ? (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          ) : (
            versions.slice(0, 8).map((v) => (
              <Button
                key={v}
                variant="outline"
                size="sm"
                className="font-mono text-xs"
                disabled={busy}
                onClick={() => void install(v)}
              >
                {v}
              </Button>
            ))
          )}
        </div>
      ) : null}

      {progress ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-info-soft px-3 py-2 text-xs leading-relaxed text-accent-soft-foreground">
          <Loader2 className="mt-0.5 size-3 shrink-0 animate-spin" />
          {progress}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 rounded-md bg-destructive-soft px-3 py-2 text-xs leading-relaxed text-hue-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}
