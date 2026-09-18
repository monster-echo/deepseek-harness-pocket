import { AlertTriangle, CheckCircle2, Loader2, Play, XCircle } from "lucide-react";
import { Badge, Button } from "../../components/ui";
import type { PreflightItem } from "../../lib/worker";
import { PortStep } from "../../guide/PortStep";
import { DshcUpdateCard } from "./DshcUpdateCard";

/**
 * 完成：环境自检总结（全部绿了才给「启动」）。
 * 这一步是硬门槛的具象化——用户亲眼看到每一项都通过，才进入程序。
 * dialog（菜单重开）形态下额外展示 dshc 更新卡片——这里是更新入口。
 */
export function DoneStep({
  items,
  loading,
  busy,
  showUpdate = false,
  onStart,
  onRefresh,
}: {
  items: PreflightItem[];
  loading: boolean;
  busy: boolean;
  /** 菜单重开（dialog）形态：展示 dshc 版本与更新入口 */
  showUpdate?: boolean;
  onStart: () => void;
  onRefresh: () => void;
}) {
  // 登录是可选项：账号未通过不阻塞「启动」（可稍后在控制台补登），其余失败才拦截
  const blocked = items.some((i) => i.state === "fail" && i.id !== "account");
  const accountPending = items.some((i) => i.id === "account" && i.state === "fail");
  const label: Record<PreflightItem["id"], string> = {
    node: "Node 运行时",
    bridge: "Worker 核心",
    runtime: "Harness 运行时",
    account: "掌鲸账号",
    port: "网络端口",
    gateway: "网关连接",
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="w-full space-y-1 rounded-md border border-dashed border-border px-3 py-2.5">
        {loading ? (
          <p className="flex items-center gap-2 px-1 py-1 text-[13px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            正在做最终自检…
          </p>
        ) : (
          items.map((item) => (
            <div key={item.id} className="flex items-center gap-2.5 px-1 py-1">
              {item.state === "pass" ? (
                <CheckCircle2 className="size-3.5 shrink-0 text-hue-green" />
              ) : item.state === "warn" ? (
                <AlertTriangle className="size-3.5 shrink-0 text-hue-orange" />
              ) : (
                <XCircle className="size-3.5 shrink-0 text-hue-red" />
              )}
              <span className="w-[92px] shrink-0 text-[13px] font-medium">{label[item.id]}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={item.detail}>
                {item.detail}
              </span>
              {item.fix ? <Badge tone="danger">待处理</Badge> : item.state === "warn" ? <Badge tone="warning">注意</Badge> : null}
            </div>
          ))
        )}
      </div>

      {/* dshc 版本与更新入口（菜单重开时） */}
      {showUpdate ? <DshcUpdateCard /> : null}

      {/* 端口冲突是唯一会卡住「启动」的项：内联给出口 */}
      {!loading && items.some((i) => i.fix === "free_port") ? (
        <PortStep onRetry={onRefresh} />
      ) : null}

      {blocked ? (
        <Button variant="outline" disabled={loading} onClick={onRefresh}>
          <Loader2 className={loading ? "animate-spin" : "hidden"} />
          重新自检
        </Button>
      ) : (
        <>
          <Button disabled={loading || busy} onClick={onStart}>
            {busy ? <Loader2 className="animate-spin" /> : <Play />}
            {busy ? "正在启动…" : "启动 Harness"}
          </Button>
          {accountPending ? (
            <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
              已跳过登录——启动后可在控制台「账号」页扫码补登，手机端即可远程使用。
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
