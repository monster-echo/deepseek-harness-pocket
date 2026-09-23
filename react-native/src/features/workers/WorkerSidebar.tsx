/**
 * Worker 侧边栏（对齐新版设计稿抽屉）：
 *   品牌行 → 深色「新会话」→ 搜索 → 「全部工作区」+ 计数 →
 *   工作区卡片（当前高亮，内嵌会话子列表）→ 底部服务器卡片 + 我的账户|系统设置。
 *   - 工作区卡片：点按折叠/展开，长按动作（重命名/查看作品/删除），卡内 + 新建会话
 *   - 会话子项：点开、长按 pin、运行中黄点
 *   - 无当前 worker：中部引导「选择电脑」（dsh.pair）
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import {
  Bell,
  Check,
  ChevronRight,
  Eye,
  Folder,
  Monitor,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  TriangleAlert,
  User,
  FileText,
  GitBranch,
  X,
} from "lucide-react-native";
import { useCSSVariable, useUniwind } from "uniwind";
import { Button } from "@/components/ui/button";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { Sheet } from "@/design-system/Sheet";
import { IconBadge, ListRow, ListSeparator } from "@/components/app";
import { useApp } from "@/state/AppStore";
import { useDshStore } from "@/state/dshStore";
import type { SessionListItem } from "@/features/conversation/reducer";
import type { WorkerPresence } from "@deepseek-harness-pocket/bridge-protocol";
import { DirectoryPickerSheet } from "./DirectoryPickerSheet";
import { WorkspaceArtifactsSheet } from "./WorkspaceArtifactsSheet";

interface WorkspaceRow {
  id: string;
  path: string;
  title: string;
}
const LOGO = require("../../../assets/brand/logo.png"); // eslint-disable-line @typescript-eslint/no-require-imports
const LOGO_DARK = require("../../../assets/brand/logo-dark.png"); // eslint-disable-line @typescript-eslint/no-require-imports

/** 每个工作区默认展示的会话条数（对齐 web：默认 5 条 + 「显示更多」）。 */
const SESSION_PREVIEW = 5

/** human-readable 时间：刚刚 / N 分钟前 / 今天 HH:mm / 昨天 / MM-DD。 */
function formatRelativeTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  const d = new Date(ts);
  const today = new Date();
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
  if (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  ) {
    return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const y = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - 1,
  );
  if (
    d.getFullYear() === y.getFullYear() &&
    d.getMonth() === y.getMonth() &&
    d.getDate() === y.getDate()
  )
    return "昨天";
  if (d.getFullYear() === today.getFullYear())
    return `${d.getMonth() + 1}-${d.getDate()}`;
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * Worker 卡副标题：`macOS 14.6 · 8 核 16GB`（host 由 bridge 注册帧上送），
 * 缺字段时退回在线/离线文案。
 */
function describeWorkerLine(
  worker: WorkerPresence | undefined,
  workers: readonly WorkerPresence[],
): string {
  if (worker === undefined) return "点按选择电脑";
  if (!worker.online) return "离线";
  const host = worker.host;
  const parts: string[] = [];
  if (host?.osVersion !== undefined) parts.push(host.osVersion);
  if (host?.cpuCores !== undefined) parts.push(`${host.cpuCores} 核`);
  if (host?.memoryBytes !== undefined) {
    parts.push(`${Math.round(host.memoryBytes / 1024 ** 3)}GB`);
  }
  if (parts.length > 0) return parts.join(" · ");
  return `${workers.filter((w) => w.online).length} 台在线`;
}

export function WorkerSidebar({ onClose }: Readonly<{ onClose: () => void }>) {
  // 抽屉本身铺满整屏，内容需要自己让开 Home indicator
  const insets = useSafeAreaInsets();
  const { theme } = useUniwind();
  const [refreshTint, refreshColor, refreshSurface] = useCSSVariable([
    "--color-muted-foreground",
    "--color-primary",
    "--color-card",
  ]) as [string, string, string];
  const { navigate, user } = useApp();
  const [query, setQuery] = useState("");
  const contentHits = useDshStore((s) => s.contentHits);
  const searchContent = useDshStore((s) => s.searchContent);
  const [newSheet, setNewSheet] = useState<WorkspaceRow | null>(null);
  const [actionTarget, setActionTarget] = useState<WorkspaceRow | null>(null);
  const [renameTarget, setRenameTarget] = useState<WorkspaceRow | null>(null);
  const [renameText, setRenameText] = useState("");
  const [artifactsTarget, setArtifactsTarget] = useState<WorkspaceRow | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  /** 每个工作区「显示更多会话」的展开态（默认只显示 SESSION_PREVIEW 条） */
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [workerSheet, setWorkerSheet] = useState(false);

  const workers = useDshStore((s) => s.workers);
  const activeWorkerId = useDshStore((s) => s.activeWorkerId);
  const activeWorker = useDshStore((s) =>
    s.workers.find((w) => w.workerId === s.activeWorkerId),
  );
  const sessions = useDshStore((s) => s.sessions);
  // workspace 注册表缓存在全局 store：重开 sidebar 首帧直接渲染，effect 只做后台刷新
  const workspaces = useDshStore((s) => s.workspaces);
  const activeSessionId = useDshStore((s) => s.activeSessionId);
  const activeSession = useDshStore((s) =>
    s.sessions.find((x) => x.id === s.activeSessionId),
  );
  const openSession = useDshStore((s) => s.openSession);
  const startNewSession = useDshStore((s) => s.startNewSession);
  const refreshSessions = useDshStore((s) => s.refreshSessions);
  const listWorkspaces = useDshStore((s) => s.listWorkspaces);
  const renameWorkspace = useDshStore((s) => s.renameWorkspace);
  const deleteWorkspace = useDshStore((s) => s.deleteWorkspace);
  const pinnedSessionIds = useDshStore((s) => s.pinnedSessionIds);
  const togglePinSession = useDshStore((s) => s.togglePinSession);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (activeWorkerId === null) return;
    // 打开即后台刷新（结果写 store 缓存，渲染走订阅值）：会话列表 + workspace 注册表
    void refreshSessions();
    void listWorkspaces();
  }, [activeWorkerId, refreshSessions, listWorkspaces]);

  /** 下拉刷新：会话列表 + workspace 一起刷，全部完成才收起指示器 */
  const onRefresh = (): void => {
    setRefreshing(true);
    void Promise.all([refreshSessions(), listWorkspaces()]).finally(() => {
      setRefreshing(false);
    });
  };

  const q = query.trim().toLowerCase();
  const signedIn = user !== null;

  // 正文搜索：250ms 防抖，交给 Worker 侧 sessionQuery（未启用时返回空）
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      void searchContent("");
      return;
    }
    const timer = setTimeout(() => {
      void searchContent(trimmed);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, searchContent]);

  // 固定排序：pin 置顶，其余按最近活动（设计稿即此形态，不再暴露排序选项）
  const sortList = (list: SessionListItem[]): SessionListItem[] =>
    [...list].sort((a, b) => {
      const ap = pinnedSessionIds.includes(a.id) ? 1 : 0;
      const bp = pinnedSessionIds.includes(b.id) ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return b.lastActivityAt - a.lastActivityAt;
    });

  // 子代理会话不进侧栏（对齐 Web 的 subagent-origin hiding）；按父会话计数
  const subagentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sessions) {
      if (s.origin !== "subagent" || s.parentSession === null) continue;
      counts.set(s.parentSession, (counts.get(s.parentSession) ?? 0) + 1);
    }
    return counts;
  }, [sessions]);

  const groups = useMemo(() => {
    const visibleSessions = sessions.filter((s) => s.origin !== "subagent");
    const filtered =
      q.length === 0
        ? visibleSessions
        : visibleSessions.filter(
            (s) =>
              s.title.toLowerCase().includes(q) ||
              (s.cwd ?? "").toLowerCase().includes(q),
          );
    // 按 workspace 注册表分组，cwd 不在任何 workspace 的 session 归「未分组」
    const wsByPath = new Map(workspaces.map((w) => [w.path, w]));
    const byWsPath = new Map<string, SessionListItem[]>();
    const ungrouped: SessionListItem[] = [];
    for (const s of filtered) {
      const cwd = s.cwd ?? "";
      const ws = wsByPath.get(cwd);
      if (ws !== undefined) {
        const list = byWsPath.get(ws.path) ?? [];
        list.push(s);
        byWsPath.set(ws.path, list);
      } else {
        ungrouped.push(s);
      }
    }
    const result: {
      key: string;
      workspace: WorkspaceRow | null;
      title: string;
      cwd: string;
      sessions: SessionListItem[];
      visible: boolean;
    }[] = [];
    for (const ws of workspaces) {
      const list = byWsPath.get(ws.path) ?? [];
      const visible =
        q.length === 0 ||
        list.length > 0 ||
        ws.title.toLowerCase().includes(q) ||
        ws.path.toLowerCase().includes(q);
      result.push({
        key: ws.path,
        workspace: ws,
        title: ws.title,
        cwd: ws.path,
        sessions: sortList(list),
        visible,
      });
    }
    result.push({
      key: "__ungrouped__",
      workspace: null,
      title: "未分组",
      cwd: "",
      sessions: sortList(ungrouped),
      visible: ungrouped.length > 0,
    });
    return result.filter((g) => g.visible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, workspaces, q, pinnedSessionIds]);

  // 工作区重名时才显示路径消歧（web 只显示名字；本账号确实存在同名工作区）
  const duplicatedTitles = useMemo(() => {
    const counts = new Map<string, number>();
    for (const w of workspaces) counts.set(w.title, (counts.get(w.title) ?? 0) + 1);
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([t]) => t));
  }, [workspaces]);

  const doRename = (): void => {
    if (renameTarget === null || renameText.trim().length === 0) return;
    // store 在成功时自动更新缓存，这里只收尾弹层
    void renameWorkspace(renameTarget.id, renameText.trim()).then(() => {
      setRenameTarget(null);
      setRenameText("");
    });
  };

  const doDelete = (w: WorkspaceRow): void => {
    setActionTarget(null);
    void deleteWorkspace(w.id);
  };

  return (
    <View
      className="bg-background flex-1 px-3 pt-4"
      style={{ paddingBottom: insets.bottom + 12 }}
    >
      {/* 品牌行 */}
      <View className="mb-3 flex-row items-center gap-2 px-1">
        <Image
          source={theme === "dark" ? LOGO_DARK : LOGO}
          className="h-7 w-7"
          resizeMode="contain"
          accessibilityLabel="掌鲸 DSH Pocket"
        />
        <Text className="text-foreground flex-1 text-[19px] font-extrabold tracking-tight">
          掌鲸 DSH Pocket
        </Text>
        <Pressable
          className="bg-card border-border h-8 w-8 items-center justify-center rounded-full border"
          onPress={() => navigate(signedIn ? "profile.home" : "auth.signIn")}
          accessibilityLabel={signedIn ? "我的账户" : "登录"}
        >
          <Icon as={User} className="text-muted-foreground size-[15px]" />
        </Pressable>
        <Pressable onPress={onClose} hitSlop={10}>
          <Icon as={X} className="text-muted-foreground size-4" />
        </Pressable>
      </View>

      {/* 当前电脑卡（设计稿侧栏顶部的 Worker 卡） */}
      <Pressable
        className="bg-card border-border mb-2 flex-row items-center gap-3 rounded-xl border px-3 py-3 active:bg-accent"
        onPress={() => setWorkerSheet(true)}
      >
        <IconBadge as={Monitor} hue="neutral" size="lg" />
        <View className="min-w-0 flex-1">
          <Text className="text-foreground text-[15px] font-semibold" numberOfLines={1}>
            {activeWorker !== undefined ? activeWorker.name : "选择电脑"}
          </Text>
          <View className="mt-0.5 flex-row items-center gap-1.5">
            <View
              className={cn(
                "h-[6px] w-[6px] rounded-full",
                activeWorker?.online === true ? "bg-success" : "bg-warning",
              )}
            />
            <Text
              className={cn(
                "text-[12px]",
                activeWorker?.online === true
                  ? "text-success"
                  : "text-muted-foreground",
              )}
              numberOfLines={1}
            >
              {describeWorkerLine(activeWorker, workers)}
            </Text>
          </View>
        </View>
        <Icon as={ChevronRight} className="text-muted-foreground/70 size-4" />
      </Pressable>

      {/* 新会话（设计稿：蓝描边全宽按钮） */}
      <Pressable
        className="border-border bg-card mb-2 flex-row items-center justify-center gap-1.5 rounded-xl border py-3 shadow-sm active:bg-accent"
        onPress={() => {
          startNewSession();
          onClose();
        }}
      >
        <Icon
          as={Plus}
          className="text-primary size-[17px]"
        />
        <Text className="text-foreground text-sm font-medium">
          新会话
        </Text>
      </Pressable>

      {/* 搜索 */}
      <View className="bg-card border-border mb-2 flex-row items-center gap-2 rounded-lg border px-3">
        <Icon as={Search} className="text-muted-foreground size-[14px]" />
        <Input
          className="h-[38px] flex-1 border-0 bg-transparent px-0 py-0 text-[14px] shadow-none"
          placeholder="搜索工作区与历史会话..."
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery("")} hitSlop={8}>
            <Icon as={X} className="text-muted-foreground size-[13px]" />
          </Pressable>
        )}
      </View>

      {/* 正文匹配（跨会话内容搜索；标题过滤仍在上方列表生效） */}
      {q.length >= 2 && contentHits.length > 0 && (
        <View className="border-border/60 border-b px-2 py-2">
          <Text className="text-muted-foreground mb-1 px-1 text-[10.5px] font-bold">
            正文匹配 · {contentHits.length}
          </Text>
          <ScrollView className="max-h-[180px]" keyboardShouldPersistTaps="handled">
            {contentHits.map((hit) => {
              const label = sessions.find((x) => x.id === hit.sessionId)?.title
                ?? hit.cwd?.split("/").filter(Boolean).pop()
                ?? hit.sessionId.slice(0, 8);
              return (
                <Pressable
                  key={hit.sessionId}
                  className="active:bg-muted/60 mb-1 rounded-[10px] px-2 py-1.5"
                  onPress={() => {
                    openSession(hit.sessionId);
                    onClose();
                  }}
                >
                  <View className="flex-row items-center gap-1.5">
                    <Icon as={FileText} className="text-muted-foreground size-[11px]" />
                    <Text
                      className="text-foreground flex-1 text-[11.5px] font-semibold"
                      numberOfLines={1}
                    >
                      {label}
                    </Text>
                    {hit.live && (
                      <View className="bg-success h-1.5 w-1.5 rounded-full" />
                    )}
                  </View>
                  <Text
                    className="text-muted-foreground mt-0.5 text-[10.5px] leading-[14px]"
                    numberOfLines={2}
                  >
                    {hit.snippet}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* 工作区 → 会话 */}
      <View className="flex-1">
        {activeWorkerId === null ? (
          <Pressable
            className="flex-1 items-center justify-center gap-2"
            onPress={() => {
              onClose();
              navigate("dsh.pair");
            }}
          >
            <Icon as={TriangleAlert} className="text-primary" size={20} />
            <Text className="text-foreground text-[15px] font-semibold">
              还没有选择电脑
            </Text>
            <Text
              className="text-muted-foreground text-[13px]"
            >
              点击选择或配对一台电脑
            </Text>
          </Pressable>
        ) : (
          <ScrollView
            className="flex-1"
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={refreshTint}
                colors={[refreshColor]}
                progressBackgroundColor={refreshSurface}
              />
            }
          >
            {/* 分类头 + 计数 */}
            <View className="flex-row items-center justify-between px-1 py-1">
              <Text
                className="text-muted-foreground text-[11px] font-bold uppercase"
              >
                全部工作区
              </Text>
              <View
                className="bg-muted rounded-md px-1 py-0.5"
              >
                <Text
                  className="text-muted-foreground text-[10px] font-semibold"
                >
                  {groups.length}个
                </Text>
              </View>
            </View>

            {groups.length === 0 && (
              <Text
                className="text-muted-foreground p-2 text-[13px]"
              >
                {sessions.length === 0 ? "暂无会话" : "无匹配结果"}
              </Text>
            )}
            {groups.map((group) => {
              const isCurrent = activeSession?.cwd === group.cwd;
              const showPath =
                group.workspace !== null && duplicatedTitles.has(group.title);
              const expanded = expandedGroups[group.key] === true;
              const shown = expanded
                ? group.sessions
                : group.sessions.slice(0, SESSION_PREVIEW);
              const hiddenCount = group.sessions.length - shown.length;
              return (
                <View key={group.key} className="mb-0.5">
                  <Pressable
                    className="active:bg-accent flex-row items-center gap-1.5 rounded-md px-2 py-1.5"
                    onPress={() =>
                      setCollapsed((c) => ({
                        ...c,
                        [group.key]: !c[group.key],
                      }))
                    }
                    onLongPress={() =>
                      group.workspace !== null && setActionTarget(group.workspace)
                    }
                    delayLongPress={350}
                  >
                    <Icon
                      as={Folder}
                      className={isCurrent ? "text-primary" : "text-muted-foreground"}
                      size={14}
                    />
                    <View className="ml-0.5 flex-1">
                      <Text
                        className={cn(
                          "text-foreground text-[13px] font-semibold",
                          isCurrent && "text-primary font-bold",
                        )}
                        numberOfLines={1}
                      >
                        {group.title}
                      </Text>
                      {showPath && (
                        <Text
                          className="text-muted-foreground mt-px text-[10.5px]"
                          numberOfLines={1}
                        >
                          {group.cwd}
                        </Text>
                      )}
                    </View>
                    {isCurrent && (
                      <View
                        className="bg-primary mx-1 h-1.5 w-1.5 rounded-full"
                      />
                    )}
                    {group.workspace !== null && (
                      <Pressable
                        onPress={() =>
                          setNewSheet({ id: "", path: group.cwd, title: "" })
                        }
                        hitSlop={8}
                        className="p-1"
                      >
                        <Icon as={Plus} className="text-primary" size={14} />
                      </Pressable>
                    )}
                  </Pressable>

                  {!collapsed[group.key] &&
                    shown.map((session) => (
                      <SessionRow
                        key={session.id}
                        session={session}
                        active={activeSessionId === session.id}
                        onPress={() => {
                          openSession(session.id);
                          onClose();
                        }}
                        onLongPress={() => togglePinSession(session.id)}
                        pinned={pinnedSessionIds.includes(session.id)}
                        subagentCount={subagentCounts.get(session.id) ?? 0}
                      />
                    ))}
                  {!collapsed[group.key] && hiddenCount > 0 && (
                    <Pressable
                      className="active:bg-accent ml-4 rounded-md px-2.5 py-1.5"
                      onPress={() =>
                        setExpandedGroups((c) => ({ ...c, [group.key]: true }))
                      }
                    >
                      <Text className="text-muted-foreground text-[12px]">
                        显示更多 {hiddenCount} 条
                      </Text>
                    </Pressable>
                  )}
                  {!collapsed[group.key] &&
                    expanded &&
                    group.sessions.length > SESSION_PREVIEW && (
                      <Pressable
                        className="active:bg-accent ml-4 rounded-md px-2.5 py-1.5"
                        onPress={() =>
                          setExpandedGroups((c) => ({ ...c, [group.key]: false }))
                        }
                      >
                        <Text className="text-muted-foreground text-[12px]">收起</Text>
                      </Pressable>
                    )}
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>

      {/* 底部：通知 / 设置 / 我的账户（设计稿底部的行组） */}
      <View className="border-border bg-card mt-1 shrink-0 overflow-hidden rounded-xl border">
        <ListRow
          title="通知"
          leading={<IconBadge as={Bell} hue="orange" />}
          showChevron
          minHeight={48}
          onPress={() => {
            onClose();
            navigate("notifications.center");
          }}
        />
        <ListSeparator />
        <ListRow
          title="设置"
          leading={<IconBadge as={Settings} hue="neutral" />}
          showChevron
          minHeight={48}
          onPress={() => {
            onClose();
            navigate("settings.home");
          }}
        />
        <ListSeparator />
        <ListRow
          title={signedIn ? "我的账户" : "登录"}
          leading={<IconBadge as={User} hue="blue" />}
          showChevron
          minHeight={48}
          onPress={() => {
            onClose();
            navigate(signedIn ? "profile.home" : "auth.signIn");
          }}
        />
      </View>

      {/* Sheets */}
      <WorkerSwitchSheet
        visible={workerSheet}
        onClose={() => setWorkerSheet(false)}
      />
      <NewSessionSheet
        visible={newSheet !== null}
        presetWorkspace={
          newSheet && newSheet.path.length > 0 ? newSheet : undefined
        }
        onClose={() => setNewSheet(null)}
        onCreated={() => {
          setNewSheet(null);
          onClose();
        }}
      />
      <Sheet
        visible={actionTarget !== null}
        title={actionTarget?.title ?? "工作区"}
        onClose={() => setActionTarget(null)}
        snapPoints={["50%"]}
      >
        <Pressable
          className="border-border mb-2 flex-row items-center gap-2 rounded-xl border p-3"
          onPress={() => {
            setRenameTarget(actionTarget);
            setRenameText(actionTarget?.title ?? "");
            setActionTarget(null);
          }}
        >
          <Icon as={Pencil} className="text-foreground" size={16} />
          <Text className="text-foreground flex-1 text-sm">
            重命名
          </Text>
        </Pressable>
        <Pressable
          className="border-border mb-2 flex-row items-center gap-2 rounded-xl border p-3"
          onPress={() => {
            setArtifactsTarget(actionTarget);
            setActionTarget(null);
          }}
        >
          <Icon as={Eye} className="text-primary" size={16} />
          <Text className="text-foreground flex-1 text-sm">
            查看作品
          </Text>
        </Pressable>
        <Pressable
          className="border-border mb-2 flex-row items-center gap-2 rounded-xl border p-3"
          onPress={() => actionTarget !== null && doDelete(actionTarget)}
        >
          <Icon as={Trash2} className="text-destructive" size={16} />
          <Text className="text-destructive flex-1 text-sm">
            删除工作区
          </Text>
        </Pressable>
      </Sheet>
      <Sheet
        visible={renameTarget !== null}
        title="重命名工作区"
        onClose={() => setRenameTarget(null)}
        snapPoints={["50%"]}
      >
        <Input
          className="border-border mb-3 h-auto rounded-xl bg-transparent p-3 text-[15px]"
          value={renameText}
          onChangeText={setRenameText}
          placeholder="工作区名称"
          autoFocus
        />
        <Button
          className="rounded-xl py-3"
          onPress={doRename}
        >
          <Text>确定</Text>
        </Button>
      </Sheet>
      <WorkspaceArtifactsSheet
        visible={artifactsTarget !== null}
        workspace={
          artifactsTarget !== null
            ? { title: artifactsTarget.title, path: artifactsTarget.path }
            : null
        }
        onClose={() => setArtifactsTarget(null)}
      />
    </View>
  );
}

function SessionRow({
  session,
  active,
  pinned,
  subagentCount = 0,
  onPress,
  onLongPress,
}: Readonly<{
  session: SessionListItem;
  active: boolean;
  pinned?: boolean;
  /** 该会话下的子代理会话数（侧栏不展开，只在父行提示） */
  subagentCount?: number;
  onPress: () => void;
  onLongPress?: () => void;
}>) {
  return (
    <Pressable
      className={cn(
        "active:bg-accent mb-0.5 ml-4 flex-row items-center justify-between gap-1 rounded-md px-2.5 py-2",
        active && "bg-accent",
      )}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
    >
      <Text
        className={cn(
          "flex-1 text-[14px]",
          active ? "text-foreground font-medium" : "text-foreground",
        )}
        numberOfLines={1}
      >
        {session.title}
      </Text>
      <View className="flex-row items-center gap-1">
        {pinned === true && (
          <Icon as={Pin} className="text-primary size-[11px]" />
        )}
        {subagentCount > 0 && (
          <View className="bg-muted flex-row items-center gap-0.5 rounded-full px-1.5 py-0.5">
            <Icon as={GitBranch} className="text-muted-foreground size-[9px]" />
            <Text className="text-muted-foreground text-[9px]">{subagentCount}</Text>
          </View>
        )}
        {session.agentStatus === "running" && (
          <View className="bg-warning h-1.5 w-1.5 rounded-full" />
        )}
        <Text className="text-muted-foreground text-[11px]">
          {formatRelativeTime(session.lastActivityAt)}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * 服务器切换 Sheet（worker 在线状态；设计稿的 ping/IP 无数据源）。
 * 顶栏副标题与侧边栏服务器卡片共用。
 */
export function WorkerSwitchSheet(
  props: Readonly<{ visible: boolean; onClose: () => void }>,
): React.JSX.Element {
  const workers = useDshStore((s) => s.workers);
  const activeWorkerId = useDshStore((s) => s.activeWorkerId);
  const openWorker = useDshStore((s) => s.openWorker);
  return (
    <Sheet
      visible={props.visible}
      title="切换服务节点"
      onClose={props.onClose}
      scrollable
      snapPoints={["50%", "85%"]}
    >
      {workers.map((worker) => {
        const active = worker.workerId === activeWorkerId;
        return (
          <Pressable
            key={worker.workerId}
            className={cn(
              "active:opacity-75 mb-2 flex-row items-center gap-2 rounded-xl border p-3",
              active
                ? "bg-primary/10 border-primary/40"
                : "bg-muted/30 border-border/50",
            )}
            onPress={() => {
              openWorker(worker.workerId);
              props.onClose();
            }}
          >
            <View className="flex-1">
              <Text
                className="text-foreground text-[13.5px] font-bold"
                numberOfLines={1}
              >
                {worker.name}
              </Text>
              <Text
                className="text-muted-foreground mt-0.5 text-[11px]"
                numberOfLines={1}
              >
                {worker.online ? "在线 · 服务就绪" : "离线"}
              </Text>
            </View>
            {active && <Icon as={Check} className="text-primary" size={16} />}
          </Pressable>
        );
      })}
      {workers.length === 0 && (
        <Text className="text-muted-foreground p-3 text-center text-[13px]">
          还没有配对的电脑
        </Text>
      )}
    </Sheet>
  );
}

/** 新建会话：选 workspace → sessions.create。 */
function NewSessionSheet({
  visible,
  presetWorkspace,
  onClose,
  onCreated,
}: Readonly<{
  visible: boolean;
  presetWorkspace?: WorkspaceRow;
  onClose: () => void;
  onCreated: () => void;
}>) {
  // workspace 列表读 store 缓存：重开弹层不重新等待网络
  const workspaces = useDshStore((s) => s.workspaces);
  const [listLoading, setListLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newPath, setNewPath] = useState("");
  const listWorkspaces = useDshStore((s) => s.listWorkspaces);
  const createSession = useDshStore((s) => s.createSession);
  const addWorkspace = useDshStore((s) => s.addWorkspace);
  const [picker, setPicker] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    // 缓存为空（冷启动）才需要加载态；否则后台刷新，先渲染缓存
    if (workspaces.length === 0) setListLoading(true);
    void listWorkspaces().then((list) => {
      setListLoading(false);
      if (list.length === 0)
        setError(
          "Worker 上还没有 workspace（在电脑 dsh Web UI 里添加项目目录后重试）",
        );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, listWorkspaces]);

  const create = (cwd: string): void => {
    setBusy(true);
    void createSession(cwd).then((id) => {
      setBusy(false);
      if (id !== null) onCreated();
      else setError("创建失败（Worker 需以 --caps m3 运行）");
    });
  };

  useEffect(() => {
    if (
      visible &&
      presetWorkspace !== undefined &&
      presetWorkspace.path.length > 0 &&
      !busy
    )
      create(presetWorkspace.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, presetWorkspace]);

  const add = (): void => {
    const path = newPath.trim();
    if (path.length === 0) return;
    setBusy(true);
    // store.addWorkspace 成功后自动合并进缓存
    void addWorkspace(path).then((w) => {
      setBusy(false);
      if (w !== null) {
        setNewPath("");
        setError(null);
      } else setError("添加失败：目录需是电脑上的绝对路径且存在");
    });
  };

  return (
    <Sheet
      visible={visible}
      title="选择 Workspace 创建会话"
      onClose={onClose}
      scrollable
      snapPoints={["50%", "85%"]}
    >
      {(busy || listLoading) && (
        <Text className="text-muted-foreground mb-2 text-[13px]">
          加载中…
        </Text>
      )}
      {error !== null && (
        <Text className="text-destructive mb-2 text-[13px]">
          {error}
        </Text>
      )}
      <Pressable
        className="border-primary mb-2 flex-row items-center justify-center gap-1 rounded-xl border py-2"
        onPress={() => setPicker(true)}
      >
        <Icon as={ChevronRight} className="text-primary" size={14} />
        <Text className="text-primary text-sm">
          浏览电脑目录…
        </Text>
      </Pressable>
      <DirectoryPickerSheet
        visible={picker}
        onClose={() => setPicker(false)}
        onPicked={(path) => {
          setPicker(false);
          setBusy(true);
          void addWorkspace(path).then((w) => {
            setBusy(false);
            if (w !== null) {
              setNewPath("");
              setError(null);
            } else
              setError(
                "添加失败：无法在电脑上创建该 workspace（目录不存在或无权限）",
              );
          });
        }}
      />
      <View className="border-border mb-2 flex-row rounded-xl border">
        <Input
          className="h-auto flex-1 border-0 bg-transparent px-2 py-2 font-mono text-[13px]"
          placeholder="/绝对/路径（电脑上的项目目录）"
          value={newPath}
          onChangeText={setNewPath}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable
          className="bg-primary mx-1 my-1 justify-center rounded-[10px] px-3"
          onPress={add}
          disabled={busy}
        >
          <Text className="text-primary-foreground text-[13px]">添加</Text>
        </Pressable>
      </View>
      <ScrollView>
        {workspaces.map((w) => (
          <Pressable
            key={w.id}
            className="border-border mb-2 rounded-xl border p-3"
            onPress={() => create(w.path)}
          >
            <Text className="text-foreground text-[15px]">
              {w.title}
            </Text>
            <Text
              className="text-muted-foreground font-mono text-xs"
              numberOfLines={1}
            >
              {w.path}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </Sheet>
  );
}
