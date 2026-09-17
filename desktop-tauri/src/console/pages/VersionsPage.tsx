import { useCallback, useEffect, useState } from "react";
import {
  Loader2, Layers, Check, HardDrive, Download, Trash2, RefreshCw, AlertTriangle, X, Play,
} from "lucide-react";
import {
  Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState,
} from "../../components/ui";
import {
  installVersion, listVersions, removeVersion, switchVersion, versionsAvailable,
  type VersionsInfo,
} from "../../lib/worker";
import { formatBytes, formatTime } from "../useWorker";
import { Page, PageHeader } from "./PageHeader";

/**
 * 版本页：托管在本机的 dsh 运行时。
 * 目录约定 ~/.deepseek-harness-pocket/runtimes/dsh/<版本>/（不动全局 npm）。
 * 安装走内置 node 自带的 npm，可能十几分钟（dsh 依赖树约 450 个包）。
 */
export function VersionsPage({ activeVersion }: { activeVersion?: string }) {
  const [data, setData] = useState<VersionsInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remote, setRemote] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await listVersions());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onBrowse = async () => {
    setBusy("__browse__");
    setError(null);
    try {
      setRemote(await versionsAvailable());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const onInstall = async (version: string) => {
    setBusy(version);
    setError(null);
    setNotice(`正在安装 dsh ${version}…依赖树较大，请耐心等待（最长 30 分钟）`);
    try {
      const msg = await installVersion(version);
      setNotice(msg);
      await load();
    } catch (e) {
      setError(String(e));
      setNotice(null);
    } finally {
      setBusy(null);
    }
  };

  const onRemove = async (version: string) => {
    setBusy(version);
    setError(null);
    try {
      await removeVersion(version);
      setConfirmRemove(null);
      setNotice(`已删除 dsh ${version}`);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const onSwitch = async (version: string) => {
    setBusy(version);
    setError(null);
    setNotice(`正在切到 dsh ${version}：停止当前 Worker 并以该版本重启…`);
    try {
      const msg = await switchVersion(version);
      setNotice(msg);
      await load();
    } catch (e) {
      setError(String(e));
      setNotice(null);
    } finally {
      setBusy(null);
    }
  };

  const active = data?.activeVersion ?? activeVersion;
  const installed = new Set(data?.versions.map((v) => v.version) ?? []);

  return (
    <Page>
      <PageHeader
        title="版本"
        description="托管在本机的 DeepSeek Harness 运行时，Worker 启动时选用其中一个。"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={busy !== null}>
              <RefreshCw />
              刷新
            </Button>
            <Button size="sm" onClick={() => void onBrowse()} disabled={busy !== null}>
              {busy === "__browse__" ? <Loader2 className="animate-spin" /> : <Download />}
              浏览可用版本
            </Button>
          </>
        }
      />

      {error ? (
        <p className="mb-4 rounded-md bg-destructive-soft px-3 py-2 text-xs leading-relaxed text-hue-red">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mb-4 flex items-start gap-2 rounded-md bg-info-soft px-3 py-2 text-xs leading-relaxed text-accent-soft-foreground">
          {busy ? <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" /> : null}
          {notice}
        </p>
      ) : null}

      {data === null ? (
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          正在扫描…
        </div>
      ) : data.versions.length === 0 ? (
        <EmptyState
          icon={<Layers />}
          title="还没有安装任何版本"
          description={`运行时目录还是空的：${data.root}。点右上角「浏览可用版本」开始安装。`}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>已安装</CardTitle>
            <CardDescription>
              共 {data.versions.length} 个 · <code className="font-mono text-[11px]">{data.root}</code>
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="divide-y divide-border">
              {data.versions.map((v) => {
                const isActive = active === v.version;
                const isBusy = busy === v.version;
                return (
                  <li key={v.version} className="flex items-center justify-between gap-4 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className={
                          "flex size-8 shrink-0 items-center justify-center rounded-lg " +
                          (isActive ? "bg-tint-green text-hue-green" : "bg-muted text-muted-foreground")
                        }
                      >
                        <Layers className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[13px] font-semibold">{v.version}</span>
                          {isActive ? (
                            <Badge tone="success">
                              <Check className="size-3" />
                              当前使用
                            </Badge>
                          ) : null}
                          {!v.hasBin ? (
                            <Badge tone="warning">
                              <AlertTriangle className="size-3" />
                              产物不完整
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-0.5 flex items-center gap-3 text-[11px] tabular text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <HardDrive className="size-3" />
                            {formatBytes(v.sizeBytes)}
                          </span>
                          <span>{formatTime(v.installedAt)}</span>
                        </p>
                      </div>
                    </div>

                    {confirmRemove === v.version ? (
                      <div className="flex shrink-0 items-center gap-1.5">
                        <span className="text-[11px] text-muted-foreground">确认删除？</span>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={isBusy}
                          onClick={() => void onRemove(v.version)}
                        >
                          {isBusy ? <Loader2 className="animate-spin" /> : <Trash2 />}
                          删除
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setConfirmRemove(null)} aria-label="取消">
                          <X />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex shrink-0 items-center gap-1">
                        {!isActive && v.hasBin ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy !== null}
                            title="停止 Worker 并以该版本重新启动"
                            onClick={() => void onSwitch(v.version)}
                          >
                            {isBusy ? <Loader2 className="animate-spin" /> : <Play />}
                            切换
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isActive || isBusy}
                          title={isActive ? "当前正在使用，先切换后再删除" : "删除这个版本"}
                          onClick={() => setConfirmRemove(v.version)}
                        >
                          <Trash2 />
                          删除
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {remote ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>可安装</CardTitle>
            <CardDescription>来自 npm registry，显示最近 12 个版本</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="divide-y divide-border">
              {remote.slice(0, 12).map((ver) => {
                const has = installed.has(ver);
                const isBusy = busy === ver;
                return (
                  <li key={ver} className="flex items-center justify-between gap-4 py-2">
                    <span className="font-mono text-[13px]">{ver}</span>
                    {has ? (
                      <Badge tone="neutral">已安装</Badge>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => void onInstall(ver)}
                      >
                        {isBusy ? <Loader2 className="animate-spin" /> : <Download />}
                        安装
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="mt-4 rounded-lg border border-dashed border-border px-4 py-3">
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">待接入：</span>
          切换当前版本并重启 Worker（dshc 支持
          <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-[11px]">--dsh &lt;bin&gt;</code>
          ，需 stop → start 串起来）。
        </p>
      </div>
    </Page>
  );
}
