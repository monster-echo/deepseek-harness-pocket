import { useEffect, useState } from "react";
import { Loader2, Save, RotateCcw, Info } from "lucide-react";
import {
  Button, Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "../../components/ui";
import { getSettings, saveSettings, type AppSettings } from "../../lib/worker";
import { Page, PageHeader } from "./PageHeader";

/** 受控输入：统一的视觉与间距 */
function Input({
  value, onChange, mono, placeholder, invalid,
}: {
  value: string; onChange: (v: string) => void;
  mono?: boolean; placeholder?: string; invalid?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      className={
        "h-9 w-full max-w-[320px] rounded-md border px-3 text-[13px] outline-none transition-colors " +
        "bg-background focus-visible:border-ring " +
        (mono ? "font-mono text-xs " : "") +
        (invalid ? "border-destructive " : "border-border ")
      }
    />
  );
}

/**
 * 设置页：Worker 启动参数（端口/监听/名称/registry）。
 * 写入 ~/.deepseek-harness-pocket/desktop-settings.json —— 键名与 Flutter 端一致，
 * 老用户的设置可直接沿用。改完需重启 Worker 生效。
 * 能力档位（caps）是内部参数，不在此展示；默认 m3，必要时可经设置文件覆盖。
 */
export function SettingsPage() {
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSettings().then(setDraft).catch((e) => setError(String(e)));
  }, []);

  if (draft === null) {
    return (
      <Page>
        <PageHeader title="设置" />
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          正在读取设置…
        </div>
      </Page>
    );
  }

  const portNum = Number(draft.port);
  const portBad = !Number.isInteger(portNum) || portNum < 1 || portNum > 65535;

  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) =>
    setDraft({ ...draft, [k]: v });

  const onSave = async () => {
    setBusy(true); setError(null);
    try {
      setDraft(await saveSettings({ ...draft, port: portNum }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <PageHeader
        title="设置"
        description="Worker 启动参数。修改后需重启 Worker 生效。"
        actions={
          <>
            <Button
              variant="ghost" size="sm"
              onClick={() => getSettings().then(setDraft)}
              disabled={busy}
            >
              <RotateCcw />
              还原
            </Button>
            <Button size="sm" onClick={() => void onSave()} disabled={busy || portBad}>
              {busy ? <Loader2 className="animate-spin" /> : <Save />}
              {saved ? "已保存" : "保存"}
            </Button>
          </>
        }
      />

      {error ? (
        <p className="mb-4 rounded-md bg-destructive-soft px-3 py-2 text-xs leading-relaxed text-hue-red">
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Worker 启动参数</CardTitle>
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
            <Input value={String(draft.port ?? "")} invalid={portBad}
                   onChange={(v) => set("port", Number(v) || 0)} mono />
          </div>

          <div className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="text-[13px] font-medium">监听地址</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">0.0.0.0 为全网卡，127.0.0.1 仅本机</p>
            </div>
            <Input value={draft.host ?? ""} mono onChange={(v) => set("host", v)} />
          </div>

          <div className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="text-[13px] font-medium">电脑名称</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">手机端看到的名称；留空则用主机名</p>
            </div>
            <Input value={draft.workerName ?? ""} onChange={(v) => set("workerName", v)}
                   placeholder="（用主机名）" />
          </div>

          <div className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="text-[13px] font-medium">npm registry</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">安装 dsh 版本时使用</p>
            </div>
            <Input value={draft.registry ?? ""} mono onChange={(v) => set("registry", v)} />
          </div>
        </CardContent>
      </Card>

      {portBad ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-hue-red">
          <Info className="size-3.5" />
          端口须为 1–65535 的整数
        </p>
      ) : null}

      <div className="mt-4 rounded-lg border border-dashed border-border px-4 py-3">
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">生效时机：</span>
          这些参数在 <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-[11px]">dshc start</code>
          时下发。已在运行的 Worker 不会自动重启——
          请到「运行状态」页先停止再启动（或用版本页的切换）。
        </p>
      </div>
    </Page>
  );
}
