import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Globe, Loader2, RotateCw } from "lucide-react";
import { Button } from "../../components/ui";
import { installVersion, versionsAvailable, type BootstrapProgress, type BootstrapStatus } from "../../lib/worker";
import { formatBytes, formatElapsed } from "../model";

/**
 * DeepSeek Harness（dsh 运行时）：
 * - 本机已有（受管 runtimes/dsh 或全局 npm i -g）→ 直接展示，零下载；
 * - 否则推荐最新版本一键安装，「高级选项」可自选；
 * - 版本列表拉取失败不卡死：给出原因 + 重试（依赖树 10–30 分钟，全程行级进度）。
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
  const managedVersions = status?.dshVersions ?? [];
  const installed = Boolean(status?.dshInstalled);
  const globalDsh = status?.dshGlobal?.found ? status.dshGlobal.version : null;

  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [versions, setVersions] = useState<string[] | null>(null);
  const [picker, setPicker] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const fetchVersions = () => {
    setError(null);
    void versionsAvailable()
      .then((list) => {
        setVersions(list);
        setSelected((cur) => cur ?? list[0] ?? null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  useEffect(() => {
    if (versions === null && !picker && !installed && error === null) {
      fetchVersions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versions, picker, installed, error]);

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

  // 真实写入进度：轮询器报过字节才显示（>0），否则一律不画条
  const received = progress?.received ?? 0;
  const pct =
    busy && received > 0 && progress?.total ? Math.min(99, Math.round((received / progress.total) * 100)) : null;

  // 已有即可用：受管或全局 dsh 都算（worker 启动时受管优先、全局兜底）
  if (installed || globalDsh) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <CheckCircle2 className="size-8 text-hue-green" />
        <p className="text-sm font-medium">
          Harness 已就绪{managedVersions.length > 0 ? `：${managedVersions.join(" / ")}` : globalDsh ? `：全局 ${globalDsh}` : ""}
        </p>
        <p className="max-w-[38ch] text-xs text-muted-foreground">
          {managedVersions.length > 0
            ? "之后可在控制台「版本」页随时安装或切换其他版本。"
            : "检测到本机已有全局安装的 dsh，直接复用；控制台「版本」页可另装受管版本。"}
        </p>
      </div>
    );
  }

  // 推荐版本必须是稳定版（过滤 -alpha/-rc/-beta 等预发布）；高级选项里仍可自选
  const stable = versions?.filter((v) => !/-/.test(v)) ?? [];
  const recommended = stable[0] ?? versions?.[0];

  return (
    <div className="flex flex-col gap-3">
      {globalDsh ? (
        <p className="flex items-center gap-2 rounded-md bg-info-soft px-3 py-2 text-xs text-accent-soft-foreground">
          <Globe className="size-3.5 shrink-0" />
          检测到全局 dsh {globalDsh}——不安装直接下一步也能用；受管版本便于以后升级管理。
        </p>
      ) : null}

      <Button disabled={busy || !recommended} onClick={() => recommended && void install(recommended)}>
        {busy ? <Loader2 className="animate-spin" /> : null}
        {busy
          ? `正在安装 Harness ${selected ?? ""}…（${formatElapsed(elapsed)}）`
          : recommended
            ? `安装推荐版本 ${recommended}`
            : "获取版本列表…"}
      </Button>
      {recommended !== undefined && versions !== null && recommended !== versions[0] ? (
        <p className="text-[11px] text-muted-foreground">最新发布为预发布版（{versions[0]}），推荐安装稳定版。</p>
      ) : null}

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
          {/* 只在拿到真实写入量时才画进度条（npm 非交互模式没有原生百分比，
              目录写入体积是唯一可信信号；拿不到就不显示，宁缺毋滥） */}
          {pct !== null ? (
            <div className="mt-2">
              <div className="flex items-center justify-between text-[11px] tabular text-muted-foreground">
                <span>已写入</span>
                <span>
                  {formatBytes(progress?.received)} / 约 {formatBytes(progress?.total)}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          ) : null}
          {progress?.line ? (
            <p className="mt-1.5 truncate font-mono text-[11px] text-muted-foreground" title={progress.line}>
              {progress.line}
            </p>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <>
          <p className="rounded-md bg-destructive-soft px-3 py-2 text-xs leading-relaxed text-hue-red">
            {busy ? `安装 ${selected ?? ""} 失败：${error}` : `版本列表获取失败：${error}`}
          </p>
          {!busy ? (
            <Button variant="outline" onClick={fetchVersions}>
              <RotateCw />
              重试
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
