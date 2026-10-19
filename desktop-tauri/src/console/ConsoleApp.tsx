import { useEffect, useState } from "react";
import { Activity, UserRound, Layers, type LucideIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { Dot } from "../components/ui";
import { onConsoleFocus, onConsolePanel } from "../lib/worker";
import { useWorkerStatus } from "./useWorker";
import { TitleBar } from "./TitleBar";
import { RunPage } from "./pages/RunPage";
import { AccountPage } from "./pages/AccountPage";
import { VersionsPage } from "./pages/VersionsPage";

type PanelId = "run" | "account" | "versions";

const NAV: { id: PanelId; label: string; icon: LucideIcon }[] = [
  { id: "run", label: "运行", icon: Activity },
  { id: "account", label: "账号", icon: UserRound },
  { id: "versions", label: "版本", icon: Layers },
];

/**
 * panel id 解析：新 id + **旧 id 显式映射**（合并前的深链、托盘/菜单、引导面内联调用仍在用）。
 *
 * 这里刻意**不用** `?? "status"` 之类的兜底：静默回退会让"id 迁移漏改一处"变成暗坑——
 * 不报错、只悄悄打开错的页（verify-ui 的「未知 panel 不得静默回退」断言就是为此设的）。
 * 未知 id 一律返回 null → 渲染显式错误态。
 */
const PANEL_ALIAS: Record<string, PanelId> = {
  run: "run",
  account: "account",
  versions: "versions",
  // 合并前：status/settings/logs 三个面板 → 运行页
  status: "run",
  settings: "run",
  logs: "run",
};

function resolvePanel(raw: string | null | undefined): PanelId | null {
  if (!raw) return "run"; // 无参数 = 默认面板（不是"未知"）
  return PANEL_ALIAS[raw] ?? null;
}

/** 未知 panel 的显式错误态：宁可显示"入口坏了"，也不要静默打开别的页面。 */
function UnknownPanel({ raw }: { raw: string }) {
  return (
    <div className="mx-auto max-w-[560px] px-7 py-10">
      <div className="rounded-lg border border-dashed border-border px-6 py-8 text-center">
        <p className="text-sm font-medium">面板不存在：{raw}</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
          这个入口指向已合并或已删除的面板。请从左侧导航进入，或更新发起跳转的那个入口。
        </p>
      </div>
    </div>
  );
}

/**
 * 控制台窗口外壳：左侧导航（224px，与画布同底，仅用描边分隔）+ 右侧内容。
 *
 * 导航从 5 项收敛到 3 项（运行 / 账号 / 版本）：原「日志」「设置」并入运行页
 * （日志 → 故障恢复卡内的折叠区；设置 → 运行参数卡），见
 * docs/worker-ui-feature-scorecard.md §6/§7。导航宽度维持 224px。
 */
export function ConsoleApp({
  initialPanel,
  initialFocus,
}: {
  initialPanel: string;
  /** 合并后用于"落在原来的位置"：`logs` → 运行页日志折叠区展开；`params` → 滚到运行参数 */
  initialFocus?: string | null;
}) {
  const [panel, setPanel] = useState<PanelId | null>(() => resolvePanel(initialPanel));
  const [focus, setFocus] = useState<string | null>(initialFocus ?? null);
  const status = useWorkerStatus();

  useEffect(() => {
    const unlisten = onConsolePanel((p) => {
      // 托盘/菜单深链：旧 id 走别名表；未知 id 保持当前面板不动（不跳错页）
      const id = PANEL_ALIAS[p];
      if (id) setPanel(id);
    });
    return () => void unlisten.then((fn) => fn());
  }, []);

  // 控制台已开着时再收到聚焦要求（窗口不重建，走事件）
  useEffect(() => {
    const unlisten = onConsoleFocus((f) => setFocus(f));
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
        {panel === null ? <UnknownPanel raw={initialPanel} /> : null}
        {panel === "run" && <RunPage status={status} focus={focus} />}
        {panel === "account" && <AccountPage />}
        {panel === "versions" && <VersionsPage activeVersion={status?.run?.dshVersion} />}
      </main>
      </div>
    </div>
  );
}