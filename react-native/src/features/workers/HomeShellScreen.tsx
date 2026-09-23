/**
 * 主界面外壳（对齐新版设计稿顶栏）：
 *   左：☰ 圆钮（开侧边栏）+ 工作区名一级标题（点开工作区切换 Sheet）
 *       + 副标题行（状态点 · 当前电脑 · N 台在线，点开服务器切换 Sheet）
 *   右：PRO 徽章（非 free 会员）+ ✎ 新会话圆钮；会话中保留 ⓘ（会话信息）
 * 登录后首屏；无 Worker 时按连接状态区分「连接中 / 连接失败 / 引导配对」，
 * 避免把「还没连上网关」误展示成「没有绑定过电脑」。
 */

import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  Pressable,
  useWindowDimensions,
  View,
} from "react-native";
import { Activity, Check, ChevronDown, ChevronRight, Folder, GitBranch, Info, ListChecks, Menu, Pencil } from "lucide-react-native";
import { useCSSVariable, useUniwind } from "uniwind";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import type { JobSnapshot } from "@deepseek-harness-pocket/bridge-protocol";
import type { SessionListItem } from "@/features/conversation/reducer";
import { Sheet } from "@/design-system/Sheet";
import type { GatewayStatus } from "@/dsh/connection";
import { useApp } from "@/state/AppStore";
import { useDshStore } from "@/state/dshStore";
import { ConversationScreen } from "@/features/conversation/ConversationScreen";
import { SessionInfoSheet } from "@/features/conversation/SessionInfoSheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WorkerSidebar, WorkerSwitchSheet } from "./WorkerSidebar";

/** 抽屉面板宽度：窄屏（SE 等）夹到窗口宽度 - 56，避免内容越界。 */
function sidebarWidth(windowWidth: number): number {
  return Math.max(240, Math.min(300, Math.round(windowWidth - 56)));
}
const LOGO = require("../../../assets/brand/logo.png"); // eslint-disable-line @typescript-eslint/no-require-imports
const LOGO_DARK = require("../../../assets/brand/logo-dark.png"); // eslint-disable-line @typescript-eslint/no-require-imports

export function HomeShellScreen() {
  const { theme } = useUniwind();
  const { navigate, user } = useApp();
  const jobs = useDshStore((s) => s.jobs);
  const sessions = useDshStore((s) => s.sessions);
  const openSession = useDshStore((s) => s.openSession);
  const refreshJobs = useDshStore((s) => s.refreshJobs);
  const logo = theme === "dark" ? LOGO_DARK : LOGO;
  // 抽屉挂在 App 的 SafeAreaView 内，absolute inset-0 只到安全区底边；
  // 用底部 inset 反向抵消，让遮罩与面板铺满整屏（内容侧再补同等内边距）。
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [wsSheet, setWsSheet] = useState(false);
  const [workerSheet, setWorkerSheet] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const translate = useState(new Animated.Value(0))[0];
  const drawerWidth = sidebarWidth(useWindowDimensions().width);
  const connectGateway = useDshStore((s) => s.connectGateway);
  const startNewSession = useDshStore((s) => s.startNewSession);
  const setNewSessionWorkspace = useDshStore((s) => s.setNewSessionWorkspace);
  const workers = useDshStore((s) => s.workers);
  const workspaces = useDshStore((s) => s.workspaces);
  const gatewayStatus = useDshStore((s) => s.gatewayStatus);
  const activeWorker = useDshStore((s) =>
    s.workers.find((w) => w.workerId === s.activeWorkerId),
  );
  const activeSessionId = useDshStore((s) => s.activeSessionId);
  const activeSession = useDshStore((s) =>
    s.sessions.find((x) => x.id === s.activeSessionId),
  );

  useEffect(() => {
    connectGateway();
  }, [connectGateway]);

  const showSidebar = (visible: boolean): void => {
    setOpen(visible);
    Animated.timing(translate, {
      toValue: visible ? 0 : -drawerWidth,
      duration: 200,
      useNativeDriver: true,
    }).start();
  };

  const hasWorker = workers.length > 0;
  const online = workers.filter((w) => w.online).length;
  const isPro = user !== null && user.tierId !== "free";

  // 标题：当前会话的 workspace 名 → 无会话时退回电脑名 → 品牌名
  const activeWorkspaceTitle = (() => {
    const cwd = activeSession?.cwd;
    if (cwd != null && cwd.length > 0) {
      const ws = workspaces.find((w) => w.path === cwd);
      if (ws !== undefined) return ws.title;
      const base = cwd.split("/").filter(Boolean).pop();
      if (base !== undefined && base.length > 0) return base;
      return "未分组";
    }
    return null;
  })();

  // 副标题：状态点 + 电脑短名（去 .local）· N 台在线；无 worker 时显示连接状态
  const serverShort =
    activeWorker !== undefined ? activeWorker.name.split(".")[0] : "";
  const sub = (() => {
    if (!hasWorker) {
      if (gatewayStatus === "connecting") return "正在连接云服务…";
      if (gatewayStatus !== "connected") return "网关未连接";
      return "把 DeepSeek Harness 装进口袋";
    }
    return `${serverShort} · ${online} 台在线`;
  })();
  // 血缘面包屑：从当前会话沿 parentSession 向上回溯（最多 5 层，防止异常数据成环）
  const lineage = (() => {
    if (activeSession === undefined) return [] as { id: string; title: string }[];
    const byId = new Map(sessions.map((x) => [x.id, x]));
    const chain: { id: string; title: string }[] = [];
    const seen = new Set<string>([activeSession.id]);
    let cursor = activeSession.parentSession;
    while (cursor !== null && !seen.has(cursor) && chain.length < 5) {
      seen.add(cursor);
      const parent = byId.get(cursor);
      if (parent === undefined) break;
      chain.unshift({ id: parent.id, title: parent.title });
      cursor = parent.parentSession;
    }
    return chain;
  })();
  // 当前会话的子代理会话（侧栏不展示，这里聚合入口）
  const subagents = activeSession === undefined
    ? []
    : sessions.filter((x) => x.origin === "subagent" && x.parentSession === activeSession.id);

  const subDotColor = (() => {
    if (!hasWorker) return gatewayStatus === "connected" ? "bg-success" : "bg-warning";
    return activeWorker?.online === true ? "bg-success" : "bg-warning";
  })();

  /** 工作区切换 = 预选该 workspace（store 驱动，Composer 即时生效）并回到新建会话页 */
  const pickWorkspace = (path: string): void => {
    setWsSheet(false);
    setNewSessionWorkspace(path);
    startNewSession();
  };

  return (
    <View className="bg-background flex-1">
      {/* 顶栏（状态栏高度由 App.tsx 全局 SafeAreaView 处理，这里只留呼吸空间） */}
      <View
        className="bg-background border-border flex-row items-center justify-between border-b px-2 py-2"
      >
        <View className="flex-1 flex-row items-center gap-2">
          <Pressable
            className="active:bg-accent h-9 w-9 items-center justify-center rounded-md"
            onPress={() => showSidebar(!open)}
            hitSlop={8}
            accessibilityLabel="菜单"
          >
            <Icon as={Menu} className="text-foreground size-[18px]" />
          </Pressable>

          <View className="flex-1 justify-center">
            <Pressable
              onPress={() => hasWorker && setWsSheet(true)}
              disabled={!hasWorker}
              hitSlop={4}
            >
              <View className="flex-row items-center gap-1">
                {activeWorkspaceTitle === null && !hasWorker && (
                  <Image source={logo} className="h-[22px] w-[22px] rounded-full" />
                )}
                <Text
                  className="text-foreground shrink text-base font-semibold"
                  numberOfLines={1}
                >
                  {activeWorkspaceTitle ??
                    (hasWorker ? (activeWorker?.name ?? "掌鲸 DSH Pocket") : "掌鲸 DSH Pocket")}
                </Text>
                {hasWorker && (
                  <Icon
                    as={ChevronDown}
                    className="text-muted-foreground size-3"
                  />
                )}
              </View>
            </Pressable>
            <Pressable
              onPress={() => hasWorker && setWorkerSheet(true)}
              disabled={!hasWorker}
              hitSlop={4}
              accessibilityLabel="切换服务节点"
            >
              <View className="mt-0.5 flex-row items-center gap-1">
                <View className={cn("h-1.5 w-1.5 rounded-full", subDotColor)} />
                <Text
                  className="text-muted-foreground text-xs"
                  numberOfLines={1}
                >
                  {sub}
                </Text>
              </View>
            </Pressable>
          </View>

          {(lineage.length > 0 || subagents.length > 0) && (
            <View className="mt-0.5 flex-row flex-wrap items-center gap-1.5">
              {lineage.map((crumb, index) => (
                <View key={crumb.id} className="flex-row items-center gap-1.5">
                  {index > 0 && (
                    <Icon as={ChevronRight} className="text-muted-foreground size-3" />
                  )}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`打开来源会话 ${crumb.title}`}
                    hitSlop={4}
                    onPress={() => openSession(crumb.id)}
                  >
                    <Text className="text-muted-foreground max-w-[110px] text-[11px] underline" numberOfLines={1}>
                      {crumb.title}
                    </Text>
                  </Pressable>
                </View>
              ))}
              {subagents.length > 0 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`查看 ${subagents.length} 个子代理会话`}
                  className="bg-muted flex-row items-center gap-1 rounded-md px-2 py-0.5"
                  hitSlop={4}
                  onPress={() => setSubOpen(true)}
                >
                  <Icon as={GitBranch} className="text-muted-foreground size-[10px]" />
                  <Text className="text-muted-foreground text-[10px] font-semibold">
                    {subagents.length} 个子代理
                  </Text>
                </Pressable>
              )}
            </View>
          )}
        </View>

        <View className="flex-row items-center gap-2">
          {isPro && (
            <Pressable
              className="bg-secondary rounded-md px-2 py-0.5"
              onPress={() => navigate("membership.home")}
              accessibilityLabel="会员"
            >
              <Text className="text-secondary-foreground text-[10px] font-semibold">
                PRO
              </Text>
            </Pressable>
          )}
          {hasWorker && activeSessionId !== null && jobs.length > 0 && (
            <Pressable
              className="active:bg-accent h-9 w-9 items-center justify-center rounded-md"
              onPress={() => {
                void refreshJobs();
                setJobsOpen(true);
              }}
              hitSlop={8}
              accessibilityLabel={`后台任务 ${liveJobCount(jobs)} 个进行中`}
            >
              <Icon as={ListChecks} className="text-foreground size-[18px]" />
              {liveJobCount(jobs) > 0 && (
                <View className="bg-primary absolute -right-0.5 -top-0.5 min-w-[15px] items-center rounded-full px-1">
                  <Text className="text-primary-foreground text-[9px] font-bold">
                    {liveJobCount(jobs)}
                  </Text>
                </View>
              )}
            </Pressable>
          )}
          {hasWorker && activeSessionId !== null && (
            <Pressable
              className="active:bg-accent h-9 w-9 items-center justify-center rounded-md"
              onPress={() => navigate("session.trajectory")}
              hitSlop={8}
              accessibilityLabel="轨迹"
            >
              <Icon as={Activity} className="text-foreground size-[18px]" />
            </Pressable>
          )}
          {hasWorker && activeSessionId !== null && (
            <Pressable
              className="active:bg-accent h-9 w-9 items-center justify-center rounded-md"
              onPress={() => setInfoOpen(true)}
              hitSlop={8}
              accessibilityLabel="会话信息"
            >
              <Icon as={Info} className="text-foreground size-[18px]" />
            </Pressable>
          )}
          {hasWorker && (
            <Pressable
              className="active:bg-accent h-9 w-9 items-center justify-center rounded-md"
              onPress={() => startNewSession()}
              hitSlop={8}
              accessibilityLabel="新会话"
            >
              <Icon as={Pencil} className="text-foreground size-[18px]" />
            </Pressable>
          )}
        </View>
      </View>

      {/* 主区域：会话聊天（最大化） */}
      <View className="flex-1">
        {!hasWorker ? (
          <EmptyWorker
            status={gatewayStatus}
            onRetry={() => connectGateway()}
          />
        ) : (
          <ConversationScreen />
        )}
      </View>

      <SessionInfoSheet visible={infoOpen} onClose={() => setInfoOpen(false)} />
      <JobsSheet visible={jobsOpen} onClose={() => setJobsOpen(false)} jobs={jobs} />
      <SubagentSheet
        visible={subOpen}
        onClose={() => setSubOpen(false)}
        subagents={subagents}
        onOpen={(id) => {
          setSubOpen(false);
          openSession(id);
        }}
      />

      {/* 工作区切换 Sheet：列 workspace 注册表，选中即以此为预设新建会话 */}
      <WorkspaceSwitchSheet
        visible={wsSheet}
        onClose={() => setWsSheet(false)}
        activePath={activeSession?.cwd ?? null}
        onPick={pickWorkspace}
      />
      <WorkerSwitchSheet
        visible={workerSheet}
        onClose={() => setWorkerSheet(false)}
      />

      {/* 侧边栏抽屉 */}
      {open && (
        <Pressable
          className="absolute inset-0 z-10 bg-black/50"
          style={{ bottom: -insets.bottom }}
          onPress={() => showSidebar(false)}
        >
          <Animated.View
            className="bg-background border-border absolute bottom-0 left-0 top-0 border-r"
            style={{
              width: drawerWidth,
              bottom: -insets.bottom,
              transform: [{ translateX: translate }],
            }}
          >
            <WorkerSidebar onClose={() => showSidebar(false)} />
          </Animated.View>
        </Pressable>
      )}
    </View>
  );
}

/** 工作区切换 Sheet：workspace 注册表（点开子项 → 预设该 workspace 新建会话）。 */
function WorkspaceSwitchSheet(
  props: Readonly<{
    visible: boolean;
    onClose: () => void;
    activePath: string | null;
    onPick: (path: string) => void;
  }>,
): React.JSX.Element {
  const workspaces = useDshStore((s) => s.workspaces);
  const listWorkspaces = useDshStore((s) => s.listWorkspaces);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!props.visible || loaded) return;
    setLoaded(true);
    void listWorkspaces();
  }, [props.visible, loaded, listWorkspaces]);

  return (
    <Sheet
      visible={props.visible}
      onClose={props.onClose}
      title="切换工作区"
    >
      {workspaces.map((ws, index) => {
        const active = props.activePath !== null && ws.path === props.activePath;
        return (
          <React.Fragment key={ws.id}>
            {index > 0 && <View className="bg-border h-px w-full" />}
            <Pressable
              className="active:bg-accent flex-row items-center gap-3 px-4 py-3"
              onPress={() => props.onPick(ws.path)}
            >
            <View className="bg-muted h-8 w-8 items-center justify-center rounded-md">
              <Icon as={Folder} className="text-muted-foreground" size={16} />
            </View>
            <View className="flex-1">
              <Text
                className="text-foreground text-sm font-medium"
                numberOfLines={1}
              >
                {ws.title}
              </Text>
              <Text
                className="text-muted-foreground mt-0.5 font-mono text-xs"
                numberOfLines={1}
              >
                {ws.path}
              </Text>
            </View>
              {active && <Icon as={Check} className="text-foreground" size={16} />}
            </Pressable>
          </React.Fragment>
        );
      })}
      {workspaces.length === 0 && (
        <Text className="text-muted-foreground p-3 text-center text-[13px]">
          还没有工作区（新建会话时添加）
        </Text>
      )}
    </Sheet>
  );
}

/**
 * 无 Worker 时的主区域三态：
 *   connecting → 加载态（连着但 presence 未到，不是「没有电脑」）
 *   offline/idle → 连接失败 + 重试
 *   connected → 真正的空态，才引导去配对
 */
function EmptyWorker({
  status,
  onRetry,
}: {
  status: GatewayStatus;
  onRetry: () => void;
}) {
  const { theme } = useUniwind();
  const primary = useCSSVariable("--color-primary") as string | undefined;
  const { navigate } = useApp();
  const logo = (
    <Image
      source={theme === "dark" ? LOGO_DARK : LOGO}
      className="mb-2 h-[72px] w-[72px] rounded-full"
      accessibilityLabel="掌鲸 DSH Pocket"
    />
  );
  if (status === "connecting") {
    return (
      <View className="flex-1 items-center justify-center gap-3 p-6">
        {logo}
        <ActivityIndicator color={primary} />
        <Text className="text-muted-foreground text-center text-sm leading-[22px]">
          正在连接云服务…
        </Text>
      </View>
    );
  }
  if (status !== "connected") {
    return (
      <View className="flex-1 items-center justify-center gap-3 p-6">
        {logo}
        <Text className="text-foreground text-lg font-bold">
          网关未连接
        </Text>
        <Text className="text-muted-foreground text-center text-sm leading-[22px]">
          无法连接到云服务，请检查网络后重试。
        </Text>
        <Button
          className="mt-2 px-6"
          onPress={onRetry}
        >
          <Text>重试</Text>
        </Button>
      </View>
    );
  }
  return (
    <View className="flex-1 items-center justify-center gap-3 p-6">
      {logo}
      <Text className="text-foreground text-lg font-bold">
        掌鲸 DSH Pocket
      </Text>
      <Text className="text-muted-foreground text-center text-sm leading-[22px]">
        还没有可用的电脑。在电脑上安装 dshc 并开机自启，{"\n"}
        然后用手机配对码绑定到你的账号。
      </Text>
      <Button
        className="mt-2 px-6"
        onPress={() => navigate("dsh.pair")}
      >
        <Text>开始</Text>
      </Button>
    </View>
  );
}

/** 进行中（含正在停止）的任务数。 */
function liveJobCount(jobs: readonly JobSnapshot[]): number {
  return jobs.filter((j) => j.status === "running" || j.status === "stopping").length;
}

function elapsed(job: JobSnapshot, now: number): string {
  const end = job.finishedAt ?? now;
  const ms = Math.max(0, end - job.startedAt);
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

const JOB_LABEL: Record<JobSnapshot["status"], string> = {
  running: "进行中",
  stopping: "停止中",
  completed: "已完成",
  killed: "已停止",
  failed: "失败",
};

/**
 * 后台任务面板（批次 3）：对齐 Web 的会话头 Background jobs。
 * 数据来自 dsh ctx.jobs 注册表（经 jobs 帧推送，打开时再拉一次兜底）。
 */
function JobsSheet({
  visible,
  onClose,
  jobs,
}: Readonly<{
  visible: boolean;
  onClose: () => void;
  jobs: readonly JobSnapshot[];
}>) {
  const [now, setNow] = useState(() => Date.now());
  const hasLive = jobs.some((j) => j.status === "running" || j.status === "stopping");
  useEffect(() => {
    if (!visible || !hasLive) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [visible, hasLive]);

  return (
    <Sheet visible={visible} title={`后台任务（${jobs.length}）`} onClose={onClose} scrollable>
      {jobs.length === 0 && (
        <Text className="text-muted-foreground p-3 text-center text-sm">
          当前会话没有后台任务
        </Text>
      )}
      {jobs.length > 0 && (
        <View className="bg-card border-border overflow-hidden rounded-xl border">
      {jobs.map((job, index) => (
        <React.Fragment key={job.id}>
        {index > 0 && <View className="bg-border h-px w-full" />}
        <View className="px-4 py-3">
          <View className="flex-row items-center gap-2">
            <Text className="text-foreground flex-1 text-sm font-medium" numberOfLines={1}>
              {job.label}
            </Text>
            <Text
              className={
                job.status === "failed"
                  ? "text-destructive text-xs font-medium"
                  : job.status === "running"
                    ? "text-foreground text-xs font-medium"
                    : "text-muted-foreground text-xs font-medium"
              }
            >
              {JOB_LABEL[job.status]}
            </Text>
          </View>
          <Text className="text-muted-foreground mt-0.5 text-xs">
            {job.kind} · {elapsed(job, now)}
          </Text>
          {job.detail !== undefined && job.detail.length > 0 && (
            <Text className="text-muted-foreground mt-1 text-xs" numberOfLines={3}>
              {job.detail}
            </Text>
          )}
        </View>
        </React.Fragment>
      ))}
        </View>
      )}
    </Sheet>
  );
}

/**
 * 子代理会话目录（批次 3）：对齐 Web 的 subagent catalog（移动端用底部 Sheet）。
 * 子代理会话不进侧栏，只在这里按父会话聚合；打开即续聊（sessions.open 会挂 agent）。
 */
function SubagentSheet({
  visible,
  onClose,
  subagents,
  onOpen,
}: Readonly<{
  visible: boolean;
  onClose: () => void;
  subagents: readonly SessionListItem[];
  onOpen: (id: string) => void;
}>) {
  return (
    <Sheet visible={visible} title={`子代理会话（${subagents.length}）`} onClose={onClose} scrollable>
      {subagents.length === 0 && (
        <Text className="text-muted-foreground p-3 text-center text-sm">
          当前会话没有子代理
        </Text>
      )}
      {subagents.length > 0 && (
        <View className="bg-card border-border overflow-hidden rounded-xl border">
      {subagents.map((child, index) => (
        <React.Fragment key={child.id}>
        {index > 0 && <View className="bg-border h-px w-full" />}
        <Pressable
          accessibilityRole="button"
          className="active:bg-accent px-4 py-3"
          onPress={() => onOpen(child.id)}
        >
          <View className="flex-row items-center gap-2">
            <Icon as={GitBranch} className="text-muted-foreground size-4" />
            <Text className="text-foreground flex-1 text-sm font-medium" numberOfLines={1}>
              {child.title}
            </Text>
            {child.agentStatus === "running" && (
              <View className="bg-warning h-1.5 w-1.5 rounded-full" />
            )}
          </View>
          <Text className="text-muted-foreground mt-0.5 text-xs">
            深度 {child.delegationDepth} · {formatJobTime(child.lastActivityAt)}
          </Text>
        </Pressable>
        </React.Fragment>
      ))}
        </View>
      )}
    </Sheet>
  );
}

/** 相对时间（分钟级即可，子代理列表用）。 */
function formatJobTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}
