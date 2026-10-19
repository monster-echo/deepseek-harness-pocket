import { useEffect, useRef, useState } from "react";
import {
  ExternalLink, Play, Square, Copy, Check, CircleSlash, Loader2, Sparkles, Download,
  FileDown, Wrench,
} from "lucide-react";
import {
  Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle,
  Dot, Field, Fold,
} from "../../components/ui";
import {
  checkUpdate, exportDiagnostics, giveUpText, installUpdate, onUpdateAvailable,
  openExternal, repair, workerResume, workerStart, workerStop,
  type RepairReport, type UpdateInfo, type WorkerStatus,
} from "../../lib/worker";
import { Page, PageHeader } from "./PageHeader";
import { DshcUpdateCard } from "../../onboarding/steps/DshcUpdateCard";
import { LogTail } from "./run/LogTail";
import { RunParams } from "./run/RunParams";

/**
 * 运行页 —— 承 S1（常驻可见）+ S2（出事自救）+ S5（低频配置），见
 * docs/worker-ui-feature-scorecard.md §6/§7。合并自原「运行状态 / 日志 / 设置」三页：
 *
 *   ① 状态头（含启停与「Web 控制台」）—— 唯一的状态真相，替代原空态卡
 *   ② 更新区（有新版本才渲染；应用更新 + dshc 更新合并到此）
 *   ③ 故障恢复（尝试修复 / 导出诊断 / 日志尾）—— **不折叠，位置随健康态变**：
 *        健康 → 排在运行参数之后；故障 → 置顶到状态头下面，且日志尾默认展开
 *   ④ 运行参数（原设置页 4 个字段 + 生效中的只读摘要，就地编辑）
 *   ⑤ 高级折叠（运行信息 / 文件位置 / 诊断文本）—— 排查用，默认收起
 *
 * 刻意去掉的（评分卡 §3.1/§3.2）：重复的「Web 控制台」第二入口、未运行空态、
 * 日志页的手动刷新与跟随开关、设置页的「还原」与常驻「生效时机」说明。
 */
export function RunPage({ status, focus }: { status: WorkerStatus | null; focus?: string | null }) {
  const [busy, setBusy] = useState<"start" | "stop" | "resume" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [updating, setUpdating] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [repairReport, setRepairReport] = useState<RepairReport | null>(null);
  const [diagExporting, setDiagExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const running = status?.running ?? false;
  const run = status?.run;
  const standby = status?.standby ?? run?.supervisor === "standby";
  const webUrl = run?.webUrl ?? "";
  /** 健康态：决定故障恢复区的位置与日志尾是否默认展开（评分卡 §7） */
  const healthy = running && !standby;

  /** 深链 focus=params：把运行参数滚进视野（合并前它是独立页面，链接要"落在原处"） */
  const paramsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus === "params") paramsRef.current?.scrollIntoView({ block: "start" });
  }, [focus]);

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

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      /* 剪贴板不可用时静默 */
    }
  };

  const act = async (kind: "start" | "stop" | "resume") => {
    setBusy(kind);
    setActionError(null);
    try {
      if (kind === "start") await workerStart();
      else if (kind === "resume") await workerResume();
      else await workerStop();
    } catch (e) {
      setActionError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const onInstallUpdate = async () => {
    setUpdating(true);
    setActionError(null);
    try {
      await installUpdate(); // 成功后应用会自行重启
    } catch (e) {
      setActionError(String(e));
      setUpdating(false);
    }
  };

  const onRepair = async () => {
    setRepairing(true);
    setActionError(null);
    setRepairReport(null);
    try {
      setRepairReport(await repair());
    } catch (e) {
      setActionError(String(e));
    } finally {
      setRepairing(false);
    }
  };

  const onExportDiagnostics = async () => {
    setDiagExporting(true);
    setActionError(null);
    try {
      const path = await exportDiagnostics();
      setNotice(`诊断已导出（已脱敏，可在文件管理器查看）：${path}`);
    } catch (e) {
      setActionError(String(e));
    } finally {
      setDiagExporting(false);
    }
  };

  if (status === null) {
    return (
      <Page>
        <PageHeader title="运行" />
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          正在读取状态…
        </div>
      </Page>
    );
  }

  /* ── ③ 故障恢复：不折叠；位置由 healthy 决定（见 renderOrder）──────── */
  const recovery = (
    <Card>
      <CardHeader>
        <CardTitle>故障恢复</CardTitle>
        <CardDescription>
          {healthy
            ? "Worker 反复掉线、控制台打不开时使用"
            : "先试「尝试修复」；修不好就把诊断包发给支持"}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={healthy ? "outline" : "default"} size="sm" disabled={repairing || diagExporting} onClick={() => void onRepair()}>
            {repairing ? <Loader2 className="animate-spin" /> : <Wrench />}
            {repairing ? "正在修复…" : "尝试修复"}
          </Button>
          <Button variant="ghost" size="sm" disabled={repairing || diagExporting} onClick={() => void onExportDiagnostics()}>
            {diagExporting ? <Loader2 className="animate-spin" /> : <FileDown />}
            导出诊断
          </Button>
          <span className="text-xs text-muted-foreground">修复会清理端口占用、校验工具链并重启 Worker</span>
        </div>
        {notice ? (
          <p className="mt-3 rounded-md bg-muted px-3 py-2 text-xs leading-relaxed break-all">{notice}</p>
        ) : null}
        {repairReport ? (
          <div className="mt-3 space-y-1.5">
            {repairReport.steps.map((s) => (
              <div key={s.step} className="flex items-start gap-2 text-xs">
                {s.ok ? (
                  <Check className="mt-0.5 size-3.5 shrink-0 text-hue-green" />
                ) : (
                  <CircleSlash className="mt-0.5 size-3.5 shrink-0 text-hue-red" />
                )}
                <span className="shrink-0 font-mono">{s.step}</span>
                <span className="text-muted-foreground">{s.detail}</span>
              </div>
            ))}
          </div>
        ) : null}
        <LogTail defaultOpen={!healthy || focus === "logs"} />
      </CardContent>
    </Card>
  );

  return (
    <Page>
      <PageHeader
        title="运行"
        description="本机 Worker、运行参数与故障恢复。"
        actions={
          webUrl ? (
            <Button variant="outline" size="sm" onClick={() => void openExternal(webUrl)}>
              <ExternalLink />
              Web 控制台
            </Button>
          ) : null
        }
      />

      {/* ① 状态头：唯一的状态真相 + 主操作 */}
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

          {running && standby ? (
            <p className="mt-3 rounded-md bg-warning-soft px-3 py-2 text-xs leading-relaxed text-hue-orange">
              {giveUpText(run?.giveUp)}
            </p>
          ) : null}

          {actionError ? (
            <p className="mt-3 rounded-md bg-destructive-soft px-3 py-2 text-xs leading-relaxed text-hue-red">
              {actionError}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* 故障态：自救能力置顶（不折叠），用户不必先猜该去哪个页面 */}
      {!healthy ? <div className="mt-4">{recovery}</div> : null}

      {/* ② 更新区：有新版本才出现，避免平时占位 */}
      {update?.available ? (
        <Card className="mt-4 border-accent-soft bg-accent-soft/40">
          <CardContent className="flex items-center justify-between gap-4 pt-4">
            <div className="flex items-start gap-3">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-accent-soft-foreground" />
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-tight">DSH Pocket {update.version} 可用</p>
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

      <div className="mt-4">
        <DshcUpdateCard />
      </div>

      {/* ④ 运行参数：原设置页 4 个字段 + 生效中摘要（同一批数据不再分两页） */}
      <div ref={paramsRef}>
        <RunParams run={run} />
      </div>

      {healthy ? <div className="mt-4">{recovery}</div> : null}

      {/* ⑤ 高级：排查用，默认收起 */}
      <Fold title="高级" hint="运行信息 · 文件位置 · 诊断">
        <div className="divide-y divide-border">
          <Field label="版本">
            {run?.dshVersion || run?.bridgeVersion ? (
              <span className="flex items-center justify-end gap-1.5">
                {run?.dshVersion ? <Badge tone="neutral">dsh {run.dshVersion}</Badge> : null}
                {run?.bridgeVersion ? <Badge tone="neutral">dshc {run.bridgeVersion}</Badge> : null}
              </span>
            ) : (
              "—"
            )}
          </Field>
          <Field label="网关" mono>{run?.gatewayUrl || "—"}</Field>
          <Field label="Web 控制台">
            {webUrl ? (
              <span className="flex min-w-0 items-center justify-end gap-1">
                <span className="truncate font-mono text-xs" title={webUrl}>{webUrl}</span>
                <button
                  onClick={() => void copy(webUrl, "webUrl")}
                  className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  aria-label="复制 Web 控制台地址"
                >
                  {copied === "webUrl" ? <Check className="size-3.5 text-hue-green" /> : <Copy className="size-3.5" />}
                </button>
              </span>
            ) : (
              "—"
            )}
          </Field>
          {([
            ["主目录", status.home, "home"],
            ["日志", status.logFile, "log"],
            ["状态文件", status.stateFile, "state"],
            ["PID 文件", status.pidFile, "pid"],
          ] as const).map(([label, value, key]) => (
            <div key={key} className="flex items-center justify-between gap-3 py-2">
              <span className="shrink-0 text-[13px] text-muted-foreground">{label}</span>
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-mono text-xs" title={value ?? ""}>{value ?? "—"}</span>
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
          {status.error || status.parseError ? (
            <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
              {status.error ?? status.parseError}
            </pre>
          ) : null}
        </div>
      </Fold>
    </Page>
  );
}
