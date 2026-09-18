import { useEffect, useState } from "react";
import {
  ExternalLink, Play, Square, Copy, Check, CircleSlash, Loader2, Sparkles, Download,
} from "lucide-react";
import {
  Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle,
  Dot, EmptyState, Field,
} from "../../components/ui";
import {
  checkUpdate, giveUpText, installUpdate, onUpdateAvailable, openExternal, workerResume, workerStart, workerStop,
  type UpdateInfo, type WorkerStatus,
} from "../../lib/worker";
import { Page, PageHeader } from "./PageHeader";
import { DshcUpdateCard } from "../../onboarding/steps/DshcUpdateCard";

/** 状态页：一眼看清 Worker 死活，并在原地把它拉起来 / 停下来。 */
export function StatusPage({ status }: { status: WorkerStatus | null }) {
  const [busy, setBusy] = useState<"start" | "stop" | "resume" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [updating, setUpdating] = useState(false);

  // 挂载后静默查一次更新；失败不打扰（离线/被墙都属正常）
  useEffect(() => {
    let alive = true;
    void checkUpdate()
      .then((u) => alive && setUpdate(u.available ? u : null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // 菜单「检查更新…」发现新版本：即使本页早已挂载也立即亮出更新卡片
  useEffect(() => {
    const unlisten = onUpdateAvailable((version) => setUpdate({ available: true, version }));
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  const onInstallUpdate = async () => {
    setUpdating(true);
    setError(null);
    try {
      await installUpdate(); // 成功后应用会自行重启
    } catch (e) {
      setError(String(e));
      setUpdating(false);
    }
  };

  const running = status?.running ?? false;
  const run = status?.run;
  // supervisor 待机：进程活着但已放弃自动重启（giveUp 说明原因）——不是"运行中"，更不是没事
  const standby = status?.standby ?? run?.supervisor === "standby";
  const webUrl = run?.webUrl ?? "";

  const act = async (kind: "start" | "stop" | "resume") => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "start") await workerStart();
      else if (kind === "resume") await workerResume();
      else await workerStop();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      /* 剪贴板不可用时静默 */
    }
  };

  if (status === null) {
    return (
      <Page>
        <PageHeader title="运行状态" />
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          正在读取状态…
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader title="运行状态" description="本机 Worker 与 DeepSeek Harness 的实时情况。" />

      {/* 焦点：状态 + 主操作 */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Dot tone={running ? (standby ? "warning" : "success") : "neutral"} />
              <div>
                <p className="text-sm font-semibold leading-tight">
                  {running ? (standby ? "Worker 待机中" : "Worker 运行中") : "Worker 未运行"}
                </p>
                <p className="mt-0.5 text-xs tabular text-muted-foreground">
                  {running && standby
                    ? "已暂停自动重启"
                    : running
                      ? `PID ${status.pid ?? "—"}${run?.dshVersion ? ` · dsh ${run.dshVersion}` : ""}`
                      : "启动后手机端才能连上这台电脑"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {webUrl ? (
                <Button variant="outline" size="sm" onClick={() => void openExternal(webUrl)}>
                  <ExternalLink />
                  Web 控制台
                </Button>
              ) : null}
              {running ? (
                <>
                  {standby ? (
                    <Button size="sm" disabled={busy !== null} onClick={() => void act("resume")}>
                      {busy === "resume" ? <Loader2 className="animate-spin" /> : <Play />}
                      重试启动
                    </Button>
                  ) : null}
                  <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void act("stop")}>
                    {busy === "stop" ? <Loader2 className="animate-spin" /> : <Square />}
                    停止
                  </Button>
                </>
              ) : (
                <Button size="sm" disabled={busy !== null} onClick={() => void act("start")}>
                  {busy === "start" ? <Loader2 className="animate-spin" /> : <Play />}
                  启动
                </Button>
              )}
            </div>
          </div>

          {/* 待机原因（giveUp）：不再无限重启，把原因和出口亮出来 */}
          {running && standby ? (
            <p className="mt-3 rounded-md bg-warning-soft px-3 py-2 text-xs leading-relaxed text-hue-orange">
              {giveUpText(run?.giveUp)}
            </p>
          ) : null}

          {error ? (
            <p className="mt-3 rounded-md bg-destructive-soft px-3 py-2 text-xs leading-relaxed text-hue-red">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* 有新版本才出现：不做常驻区域，避免平时占位 */}
      {update?.available ? (
        <Card className="mt-4 border-accent-soft bg-accent-soft/40">
          <CardContent className="flex items-center justify-between gap-4 pt-4">
            <div className="flex items-start gap-3">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-accent-soft-foreground" />
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-tight">
                  DSH Pocket {update.version} 可用
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {update.currentVersion ? `当前 ${update.currentVersion} · ` : ""}
                  安装后应用会自动重启
                </p>
                {update.notes ? (
                  <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                    {update.notes}
                  </p>
                ) : null}
              </div>
            </div>
            <Button size="sm" disabled={updating} onClick={() => void onInstallUpdate()}>
              {updating ? <Loader2 className="animate-spin" /> : <Download />}
              {updating ? "正在更新…" : "立即更新"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* dshc（bridge）有新版本时出现：不随应用发版，独立升级入口 */}
      <div className="mt-4">
        <DshcUpdateCard />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>运行信息</CardTitle>
            <CardDescription>由 dshc supervisor 上报</CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border pt-0">
            <Field label="版本">
              {run?.dshVersion || run?.bridgeVersion ? (
                <span className="flex items-center gap-1.5">
                  {run?.dshVersion ? <Badge tone="neutral">dsh {run.dshVersion}</Badge> : null}
                  {run?.bridgeVersion ? <Badge tone="neutral">dshc {run.bridgeVersion}</Badge> : null}
                </span>
              ) : (
                "—"
              )}
            </Field>
            <Field label="Web 控制台">
              {webUrl ? (
                <span className="flex min-w-0 items-center justify-end gap-1">
                  <span className="truncate font-mono text-xs" title={webUrl}>
                    {webUrl}
                  </span>
                  <button
                    onClick={() => void copy(webUrl, "webUrl")}
                    className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    aria-label="复制 Web 控制台地址"
                  >
                    {copied === "webUrl" ? <Check className="size-3.5 text-hue-green" /> : <Copy className="size-3.5" />}
                  </button>
                  <button
                    onClick={() => void openExternal(webUrl)}
                    className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    aria-label="在浏览器打开 Web 控制台"
                  >
                    <ExternalLink className="size-3.5" />
                  </button>
                </span>
              ) : (
                "—"
              )}
            </Field>
            <Field label="网关" mono>{run?.gatewayUrl || "—"}</Field>
            <Field label="监听">
              <span className="tabular">{run ? `${run.host}:${run.port}` : "—"}</span>
            </Field>
            <Field label="电脑名称">{run?.name || "—"}</Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>文件位置</CardTitle>
            <CardDescription>与 dshc CLI 共享同一主目录</CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border pt-0">
            {([
              ["主目录", status.home, "home"],
              ["日志", status.logFile, "log"],
              ["状态文件", status.stateFile, "state"],
              ["PID 文件", status.pidFile, "pid"],
            ] as const).map(([label, value, key]) => (
              <div key={key} className="flex items-center justify-between gap-3 py-2">
                <span className="shrink-0 text-[13px] text-muted-foreground">{label}</span>
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate font-mono text-xs" title={value ?? ""}>
                    {value ?? "—"}
                  </span>
                  {value ? (
                    <button
                      onClick={() => void copy(value, key)}
                      className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                      aria-label={`复制${label}`}
                    >
                      {copied === key ? <Check className="size-3.5 text-hue-green" /> : <Copy className="size-3.5" />}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {status.error || status.parseError ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>诊断</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-40 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
              {status.error ?? status.parseError}
            </pre>
          </CardContent>
        </Card>
      ) : null}

      {!running && !status.error ? (
        <div className="mt-4">
          <EmptyState
            icon={<CircleSlash />}
            title="还没有 Worker 在跑"
            description="点上面的「启动」，本机会拉起守护进程并接入掌鲸网关。"
          />
        </div>
      ) : null}
    </Page>
  );
}
