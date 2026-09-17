import { useEffect, useState } from "react";
import {
  Activity, UserRound, Layers, ScrollText, Settings, type LucideIcon,
} from "lucide-react";
import { cn } from "../lib/utils";
import { Dot } from "../components/ui";
import { onConsolePanel } from "../lib/worker";
import { useWorkerStatus } from "./useWorker";
import { TitleBar } from "./TitleBar";
import { StatusPage } from "./pages/StatusPage";
import { AccountPage } from "./pages/AccountPage";
import { VersionsPage } from "./pages/VersionsPage";
import { LogsPage } from "./pages/LogsPage";
import { SettingsPage } from "./pages/SettingsPage";

type PanelId = "status" | "account" | "versions" | "logs" | "settings";

const NAV: { id: PanelId; label: string; icon: LucideIcon }[] = [
  { id: "status", label: "运行状态", icon: Activity },
  { id: "account", label: "账号", icon: UserRound },
  { id: "versions", label: "版本", icon: Layers },
  { id: "logs", label: "日志", icon: ScrollText },
  { id: "settings", label: "设置", icon: Settings },
];

/**
 * 控制台窗口外壳：左侧导航（224px，与画布同底，仅用描边分隔）+ 右侧内容。
 * 导航宽度是刻意的——5 项的管理面板不需要更宽，「导航服务于内容」。
 */
export function ConsoleApp({ initialPanel }: { initialPanel: string }) {
  const [panel, setPanel] = useState<PanelId>(
    (NAV.find((n) => n.id === initialPanel)?.id ?? "status") as PanelId,
  );
  const status = useWorkerStatus();

  useEffect(() => {
    const unlisten = onConsolePanel((p) => {
      const hit = NAV.find((n) => n.id === p);
      if (hit) setPanel(hit.id);
    });
    return () => void unlisten.then((fn) => fn());
  }, []);

  const running = status?.running ?? false;

  return (
    <div className="flex h-full flex-col bg-background">
      <TitleBar title="DSH Pocket · 控制台" />
      <div className="flex min-h-0 flex-1">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border">
        <div className="flex items-center gap-2 px-4 pt-5 pb-4">
          <img src="/logo.png" alt="DSH Pocket" className="size-7 rounded-md" draggable={false} />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold leading-tight">DSH Pocket</p>
            <p className="truncate text-[11px] leading-tight text-muted-foreground">控制台</p>
          </div>
        </div>

        <nav className="flex flex-col gap-0.5 px-2">
          {NAV.map(({ id, label, icon: Icon }) => {
            const active = panel === id;
            return (
              <button
                key={id}
                onClick={() => setPanel(id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-150",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </button>
            );
          })}
        </nav>

        {/* 底部实时状态：视线余光就能确认 Worker 死活 */}
        <div className="mt-auto flex items-center gap-2 px-4 py-4">
          <Dot tone={running ? "success" : "neutral"} />
          <span className="text-[11px] tabular text-muted-foreground">
            {running ? `运行中 · ${status?.pid ?? "—"}` : "未运行"}
          </span>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        {panel === "status" && <StatusPage status={status} />}
        {panel === "account" && <AccountPage />}
        {panel === "versions" && <VersionsPage activeVersion={status?.run?.dshVersion} />}
        {panel === "logs" && <LogsPage />}
        {panel === "settings" && <SettingsPage />}
      </main>
      </div>
    </div>
  );
}
