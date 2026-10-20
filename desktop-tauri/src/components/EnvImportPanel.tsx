import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, ShieldAlert } from "lucide-react";
import { Badge, Button } from "./ui";
import {
  envImport, envScan, workerEnvReport,
  type EnvGroup, type EnvScanReport, type WorkerEnvReport,
} from "../lib/worker";

/**
 * 终端环境导入面板 —— **启动引导 / 向导 / 控制台三处共用同一份**。
 *
 * 解决的事：GUI 启动的 Worker 看不到用户 `.zshrc` 里的东西（Flutter/Android/Homebrew/
 * 代理…），而普通用户不会去手写环境文件。流程是「发现 → 分类 → 勾选 → 写入」，不是
 * 把整份环境灌进去：
 *   - shell 现场类（PWD/SHLVL/TERM/_…）默认不勾：带进长驻进程只会误导；
 *   - 上游禁止类（PATH/HOME/GIT_PAGER…）不可勾：写进 `.env` 会让 Harness 拒绝启动；
 *   - 敏感类（*_API_KEY/_TOKEN/_SECRET…）默认不勾，由用户显式点头。
 *
 * 值从不经过前端：这里只处理**键名**，值由 Rust 从登录 shell 取出后直接写文件。
 */
export function EnvImportPanel({
  variant = "console",
  onImported,
}: {
  variant?: "console" | "wizard";
  onImported?: (count: number) => void;
}) {
  const [scan, setScan] = useState<EnvScanReport | null>(null);
  const [envReport, setEnvReport] = useState<WorkerEnvReport | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ count: number; envFile: string } | null>(null);

  const load = useCallback(async (force = false) => {
    setError(null);
    try {
      const s = await envScan(force);
      setScan(s);
      // 默认勾选：分组默认值 ∩ 非敏感 ∩ 非禁令 ∩ 非现场
      const next: Record<string, boolean> = {};
      for (const g of s.groups) {
        for (const k of g.keys) {
          const blocked = g.refusedKeys.includes(k) || s.junkKeys.includes(k);
          next[k] = g.defaultChecked && !blocked && !g.sensitiveKeys.includes(k);
        }
      }
      setChecked(next);
      // 顺带读一份 .env / PATH 现状（同一份报告在控制台里也要看）
      void workerEnvReport()
        .then(setEnvReport)
        .catch(() => {});
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const blockedKeys = useMemo(() => {
    if (!scan) return new Set<string>();
    return new Set([...scan.refusedKeys, ...scan.junkKeys]);
  }, [scan]);

  /** 组里真正可勾选的键：禁令名与现场变量永远勾不上，也不该影响组勾选框的状态 */
  const importableOf = (g: EnvGroup) => g.keys.filter((k) => !blockedKeys.has(k));

  const selected = useMemo(
    () => Object.entries(checked).filter(([, v]) => v).map(([k]) => k),
    [checked],
  );

  const doImport = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await envImport(selected);
      setDone({ count: r.count, envFile: r.envFile });
      onImported?.(r.count);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (error && scan === null) {
    return (
      <p className="text-xs leading-relaxed text-hue-red">
        读取终端环境失败：{error}
        <Button variant="ghost" size="sm" className="ml-2" onClick={() => void load(true)}>
          重试
        </Button>
      </p>
    );
  }
  if (scan === null) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        正在读取你的终端环境…
      </p>
    );
  }
  // 平台说明优先：Windows 上"没解析到登录 shell"是正常的，不能报成超时
  if (scan.platformNote) {
    return (
      <p className="rounded-md bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        {scan.platformNote}
      </p>
    );
  }
  if (!scan.loginShellOk) {
    return (
      <p className="text-xs leading-relaxed text-hue-orange">
        没能读到你的登录 shell 环境（超时或没有 $SHELL）。PATH 仍会从继承环境回退，其余变量无法导入。
      </p>
    );
  }

  const pending = scan.refusedKeys.length + scan.junkKeys.length;

  return (
    <div className="space-y-3 text-[13px]">
      {variant === "wizard" ? (
        <p className="rounded-md bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          这一步是可选的：直接点「下一步」也可以。之后随时能在控制台「运行 → 高级」里补导入。
        </p>
      ) : null}

      {/* ① 能一键导入的分组 */}
      <div className="space-y-2">
        {scan.groups.map((g) => (
          <div key={g.name} className="rounded-md border border-border px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <label className="flex cursor-pointer items-center gap-2 font-medium">
                <input
                  type="checkbox"
                  className="size-3.5 accent-current"
                  checked={importableOf(g).length > 0 && importableOf(g).every((k) => checked[k])}
                  disabled={importableOf(g).length === 0}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setChecked((prev) => {
                      const next = { ...prev };
                      for (const k of importableOf(g)) next[k] = on;
                      return next;
                    });
                  }}
                />
                {g.name}
              </label>
              {g.defaultChecked ? null : (
                <span className="text-[11px] text-muted-foreground">默认不导入</span>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              {g.keys.map((k) => {
                const blocked = blockedKeys.has(k);
                const refused = scan.refusedKeys.includes(k);
                const sensitive = g.sensitiveKeys.includes(k);
                return (
                  <label
                    key={k}
                    className={
                      "flex items-center gap-1.5 font-mono text-[11px] " +
                      (blocked ? "cursor-not-allowed text-muted-foreground line-through" : "cursor-pointer")
                    }
                    title={
                      refused
                        ? "上游禁止写进 .env（会让 Harness 拒绝启动）——PATH 这类由客户端启动时注入"
                        : blocked
                          ? "shell 会话现场变量，导入到长驻进程只会误导"
                          : sensitive
                            ? "看起来是密钥：导入后会出现在 Worker 进程环境里，请确认"
                            : undefined
                    }
                  >
                    <input
                      type="checkbox"
                      className="size-3 accent-current"
                      disabled={blocked}
                      checked={Boolean(checked[k])}
                      onChange={(e) => setChecked((prev) => ({ ...prev, [k]: e.target.checked }))}
                    />
                    {k}
                    {refused ? <Badge tone="warning">不可导入</Badge> : null}
                    {!refused && sensitive ? <ShieldAlert className="size-3 text-hue-orange" /> : null}
                  </label>
                );
              })}
            </div>
            {g.sensitiveKeys.length > 0 ? (
              <p className="mt-1 text-[11px] leading-relaxed text-hue-orange">
                带 <ShieldAlert className="inline size-3" /> 的是密钥类：导入后 Worker（以及它能驱动的会话）就能读到，默认不勾。
              </p>
            ) : null}
          </div>
        ))}
      </div>

      {/* ② 不可导入 / 不建议导入的说明 */}
      {pending > 0 ? (
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          另有 {scan.refusedKeys.length} 个上游禁止写文件（{scan.refusedKeys.slice(0, 4).join("、")}
          {scan.refusedKeys.length > 4 ? "…" : ""}，PATH 类已由客户端启动时注入）、
          {scan.junkKeys.length} 个 shell 现场变量（{scan.junkKeys.slice(0, 4).join("、")}…）已自动排除。
        </p>
      ) : null}

      {scan.shadowedKeys.length > 0 ? (
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-hue-orange">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          另有 {scan.shadowedKeys.length} 个已被系统提供、写了也不生效（{scan.shadowedKeys.slice(0, 4).join("、")}
          {scan.shadowedKeys.length > 4 ? "…" : ""}）：启动器只在"进程里没有这个变量"时才采纳文件里的值。
        </p>
      ) : null}

      {/* ③ 操作 */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || selected.length === 0} onClick={() => void doImport()}>
          {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
          {busy ? "正在导入…" : `导入选中的 ${selected.length} 项`}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void load(true)}>
          重新扫描
        </Button>
        {scan.alreadyImported.length > 0 ? (
          <span className="text-[11px] text-muted-foreground">
            已导入过 {scan.alreadyImported.length} 项
          </span>
        ) : null}
      </div>

      {done ? (
        <p className="rounded-md bg-success-soft px-3 py-2 text-xs leading-relaxed text-hue-green">
          已把 {done.count} 项写入 {done.envFile} · <strong>重启 Worker 后生效</strong>
          （运行页的「停止 → 启动」）。
        </p>
      ) : null}
      {error ? (
        <p className="rounded-md bg-destructive-soft px-3 py-2 text-xs leading-relaxed text-hue-red">
          {error}
        </p>
      ) : null}

      {/* ④ 现状：PATH 来源 + .env 里已有的键（只有键名） */}
      {envReport ? (
        <div className="space-y-1.5 border-t border-border pt-3 text-[11px] text-muted-foreground">
          <p>
            PATH：
            {envReport.loginShellPath ? (
              <>
                来自登录 shell（{envReport.loginShellPath.segments} 段
                {envReport.loginShellPath.hasHomebrew ? " · 含 Homebrew" : ""}）；
                Worker 实收 {envReport.workerPathSegments ?? "—"} 段
              </>
            ) : (
              "未取到登录 shell，已回退继承 PATH"
            )}
          </p>
          <p className="break-all">
            环境文件 <span className="font-mono">{envReport.envFile ?? "—"}</span>：
            {envReport.envFileExists
              ? envReport.envKeys.length > 0
                ? `${envReport.envKeys.length} 项（${envReport.envKeys.slice(0, 6).join("、")}）`
                : "空文件"
              : "不存在（导入后自动创建）"}
          </p>
          <p className="flex items-start gap-1.5 leading-relaxed">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            为什么 Worker 读不到 .zshrc：本应用是 GUI 启动的，进程环境由 launchd 给出
            （PATH 只有 /usr/bin:/bin:/usr/sbin:/sbin），而 .zshrc 只被交互式 zsh 读取。
            所以 PATH 由客户端起一次登录 shell 解析后注入，其余变量请在这里导入。
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 启动引导横幅：只在"有东西可导入"时出现，一键导入默认分组。
 *
 * 这是"启动时引导用户导入环境变量"的落点：不打断（可稍后），但每次启动都会提醒，
 * 直到导入完成（`.env` 里已有全部候选时不出现）。
 */
export function EnvImportBanner({ onOpenDetail }: { onOpenDetail?: () => void }) {
  const [scan, setScan] = useState<EnvScanReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ count: number; envFile: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let alive = true;
    void envScan()
      .then((s) => alive && setScan(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // 导入成功：给一句明确反馈而不是"点完就消失"（否则用户不知道发生了什么、也不知道要重启 Worker）
  if (done !== null) {
    return (
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-success-soft/60 px-4 py-2">
        <CheckCircle2 className="size-4 shrink-0 text-hue-green" />
        <p className="min-w-0 flex-1 text-[12px] text-muted-foreground">
          已导入 {done.count} 项到 <span className="font-mono">{done.envFile}</span> ·{" "}
          <strong>重启 Worker 后生效</strong>（控制台「运行 → 停止 → 启动」）。
        </p>
        <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
          知道了
        </Button>
      </div>
    );
  }
  if (dismissed) return null;
  if (scan === null || !scan.loginShellOk || scan.pendingCount === 0) return null;

  // 一键导入的范围：默认分组 ∩ 非禁令 ∩ 非现场 ∩ **非密钥**。
  // 密钥必须由用户在「选择…」里逐个点头（与面板里的默认值保持一致），
  // 否则"一键导入"会悄悄把 *_TOKEN 之类塞进可被手机遥控的进程环境。
  const sensitive = new Set(scan.sensitiveKeys);
  const defaults = scan.groups
    .filter((g) => g.defaultChecked)
    .flatMap((g) =>
      g.keys.filter(
        (k) => !scan.refusedKeys.includes(k) && !scan.junkKeys.includes(k) && !sensitive.has(k),
      ),
    );
  const keptSensitive = scan.sensitiveKeys.filter((k) => !scan.refusedKeys.includes(k) && !scan.junkKeys.includes(k));

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border bg-accent-soft/40 px-4 py-2">
      <Info className="size-4 shrink-0 text-accent-soft-foreground" />
      <p className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
        检测到终端里有 {scan.pendingCount} 个环境变量可导入
        （Flutter/Android/Homebrew/代理等）——导入后手机遥控执行的命令才能用上它们。
        {defaults.length > 0 ? (
          <>
            {" "}
            一键导入将写入 {defaults.length} 项
            {keptSensitive.length > 0 ? `，不含 ${keptSensitive.length} 项密钥（请用「选择…」确认）` : ""}。
          </>
        ) : (
          " 可导入的都是密钥类，请用「选择…」逐个确认。"
        )}
      </p>
      <Button
        size="sm"
        disabled={busy || defaults.length === 0}
        onClick={() => {
          setBusy(true);
          void envImport(defaults)
            .then((r) => setDone({ count: r.count, envFile: r.envFile }))
            .catch(() => setDismissed(true))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
        一键导入
      </Button>
      {onOpenDetail ? (
        <Button variant="ghost" size="sm" onClick={onOpenDetail}>
          选择…
        </Button>
      ) : null}
      <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
        稍后
      </Button>
    </div>
  );
}