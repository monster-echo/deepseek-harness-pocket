import { useCallback, useEffect, useState } from "react";
import { Loader2, Save, RotateCcw } from "lucide-react";
import {
  Button, Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "../../../components/ui";
import { getSettings, saveSettings, type AppSettings, type WorkerStatus } from "../../../lib/worker";

/** 运行参数：原设置页（4 字段 + 校验 + 保存），补一条"生效中"只读摘要。
 *
 * 为什么摘要必须在同一张卡里：原设计把"可编辑的端口"放设置页、"生效中的监听地址"
 * 放运行状态页，用户改完端口回到状态页看到的还是旧值，两页打架（评分卡 §3.2 #2）。
 * 这里把"你要改的"和"现在生效的"放进同一张卡，改完立刻能对照。
 */
export function RunParams({ run }: { run?: WorkerStatus["run"] }) {
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [savedJson, setSavedJson] = useState<string>("");
  const [savedFlash, setSavedFlash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adopt = useCallback((s: AppSettings) => {
    setDraft(s);
    setSavedJson(JSON.stringify(s));
  }, []);

  useEffect(() => {
    getSettings()
      .then(adopt)
      .catch((e) => setError(String(e)));
  }, [adopt]);

  if (draft === null) {
    return (
      <Card className="mt-4">
        <CardContent className="flex items-center gap-2 pt-4 text-[13px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          正在读取运行参数…
        </CardContent>
      </Card>
    );
  }

  const portNum = Number(draft.port);
  const portBad = !Number.isInteger(portNum) || portNum < 1 || portNum > 65535;
  const dirty = JSON.stringify(draft) !== savedJson;

  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) =>
    setDraft({ ...draft, [k]: v });

  const onSave = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await saveSettings({ ...draft, port: portNum });
      adopt(next);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 4000);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const input = (value: string, onChange: (v: string) => void, opts?: { mono?: boolean; placeholder?: string; invalid?: boolean }) => (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={opts?.placeholder}
      aria-invalid={opts?.invalid || undefined}
      className={
        "h-9 w-full max-w-[320px] rounded-md border px-3 text-[13px] outline-none transition-colors " +
        "bg-background focus-visible:border-ring " +
        (opts?.mono ? "font-mono text-xs " : "") +
        (opts?.invalid ? "border-destructive " : "border-border ")
      }
    />
  );

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>运行参数</CardTitle>
        <CardDescription>
          写入 <code className="font-mono text-[11px]">~/.deepseek-harness-pocket/desktop-settings.json</code>
          （键名与 Flutter 端一致，老设置可直接沿用）
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y divide-border pt-0">
        <div className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0">
            <p className="text-[13px] font-medium">监听端口</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Worker 直连模式端口，默认 3780</p>
          </div>
          {input(String(draft.port ?? ""), (v) => set("port", Number(v) || 0), { mono: true, invalid: portBad })}
        </div>

        <div className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0">
            <p className="text-[13px] font-medium">监听地址</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              0.0.0.0 为全网卡（同局域网可访问），127.0.0.1 仅本机
            </p>
          </div>
          {input(draft.host ?? "", (v) => set("host", v), { mono: true })}
        </div>

        <div className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0">
            <p className="text-[13px] font-medium">电脑名称</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">手机端看到的名称；留空则用主机名</p>
          </div>
          {input(draft.workerName ?? "", (v) => set("workerName", v), { placeholder: "（用主机名）" })}
        </div>

        <div className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0">
            <p className="text-[13px] font-medium">npm registry</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">安装 dsh 版本时使用</p>
          </div>
          {input(draft.registry ?? "", (v) => set("registry", v), { mono: true })}
        </div>

        <div className="flex items-center justify-between gap-3 py-3">
          <p className="text-[11px] text-muted-foreground">
            改动在 <code className="font-mono">dshc start</code> 时下发，已在运行的 Worker 不会自动重启
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {dirty ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => getSettings().then(adopt)}>
                <RotateCcw />
                放弃修改
              </Button>
            ) : null}
            <Button size="sm" onClick={() => void onSave()} disabled={busy || portBad || !dirty}>
              {busy ? <Loader2 className="animate-spin" /> : <Save />}
              保存
            </Button>
          </div>
        </div>

        {portBad ? (
          <p className="py-3 text-xs text-hue-red">端口须为 1–65535 的整数</p>
        ) : null}
        <div className="py-3">
          <p className="text-[11px] text-muted-foreground">
            生效中（来自 dshc 上报）：
            <span className="ml-1 font-mono">
              {run ? `${run.host}:${run.port}` : "—"}
              {run?.name ? ` · ${run.name}` : ""}
              {run?.dshVersion ? ` · dsh ${run.dshVersion}` : ""}
              {run?.gatewayUrl ? ` · ${run.gatewayUrl}` : ""}
            </span>
          </p>
        </div>
        {savedFlash ? (
          <p className="py-3 text-xs text-hue-green">已保存 · 重启 Worker 后生效（状态头旁的「停止 → 启动」）</p>
        ) : null}
        {error ? (
          <p className="py-3 text-xs leading-relaxed text-hue-red">{error}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
