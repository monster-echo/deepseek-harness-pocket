/**
 * 统一 Composer（对齐新版设计稿「输入坞」）：new session 与 session 共用，
 * 通过 mode 控制功能显隐。
 *   - 共用输入卡（bgInput 圆角卡）：附件托盘 + 输入区 + 胶囊工具行
 *     （＋ /指令 @文件 权限[三色码] 模型）+ 右侧发送/停止圆钮
 *   - 输入卡上方：/ 命令与 @ 工作区的内联自动补全弹层（输入 / 或 @ 触发）
 *   - new：已就绪胶囊 + Hero + 2×2 意图卡网格 + 电脑/工作区/模式 Ghost 行；
 *     提交 = createSession + sendMessage
 *   - session：提交 = sendMessage（running 时停止/排队）；卡下上下文用量 InfoLine
 *
 * 视觉层：react-native-reusables + Uniwind（Tailwind className），业务逻辑保持不变。
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from "react-native";
import Svg, { Circle } from "react-native-svg";
import { KeyboardAvoidingView, useKeyboardState } from "react-native-keyboard-controller";
import * as ImagePicker from "expo-image-picker";
import { useCSSVariable, useUniwind } from "uniwind";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";
import { AppIcon, IconName } from "../../design-system/AppIcon";
import { Sheet } from "../../design-system/Sheet";
import { useApp } from "../../state/AppStore";
import { usePreferences } from "../../preferences/PreferencesProvider";
import { useDshStore } from "../../state/dshStore";
import type { TodoEntry } from "./toolPresentation";
import {
  filterMentionEntries,
  formatMentionRef,
  mentionBreadcrumb as buildMentionBreadcrumb,
  relativeToRoot as toRelativePath,
} from "./reference";
import { cn } from "@/lib/utils";

const LOGO = require("../../../assets/brand/logo.png"); // eslint-disable-line @typescript-eslint/no-require-imports
const LOGO_DARK = require("../../../assets/brand/logo-dark.png"); // eslint-disable-line @typescript-eslint/no-require-imports
import { readLastWorkspace, saveLastWorkspace } from "../../data/storage";
import { DirectoryPickerSheet } from "../workers/DirectoryPickerSheet";
import { CommandPaletteSheet } from "./CommandPaletteSheet";

export const useResponsive = () => {
  const { width } = useWindowDimensions();

  return {
    isMobile: width < 640,
    isTablet: width >= 640 && width < 1024,
    isDesktop: width >= 1024,
    isMdDown: width < 768,
    isLgDown: width < 1024,
  };
};

/**
 * 需要命令式颜色（图标 / SVG stroke）时的语义色读取：
 * 一律走 Uniwind CSS 变量，不再 import theme/tokens 或读 palette。
 */
function useThemeColors(): {
  fg: string;
  muted: string;
  primary: string;
  primaryFg: string;
  destructive: string;
  border: string;
  background: string;
} {
  const [fg, muted, primary, primaryFg, destructive, border, background] =
    useCSSVariable([
      '--color-foreground',
      '--color-muted-foreground',
      '--color-primary',
      '--color-primary-foreground',
      '--color-destructive',
      '--color-border',
      '--color-background',
    ]) as [string, string, string, string, string, string, string];
  return { fg, muted, primary, primaryFg, destructive, border, background };
}

const MODES: ReadonlyArray<{ id: string; name: string; desc: string }> = [
  {
    id: "standard",
    name: "标准模式",
    desc: "功能完整的编码 Agent，支持文件编辑、Shell、文件与网页检索、Skills、计划、目标、子代理和工作流。",
  },
  {
    id: "code",
    name: "PTC 模式",
    desc: "具备标准模式的全部能力，并通过 Code Mode SDK 呈现工具，让模型用一个 TypeScript 程序组合多步操作。",
  },
  {
    id: "minimal",
    name: "极简模式",
    desc: "仅提供持久 bash 与 str_replace_editor 的双工具编码 Agent。",
  },
  {
    id: "cordis",
    name: "创造模式",
    desc: "用于创建自定义 Agent preset：具备标准模式的全部能力，并提供运行时检查、插件实验和 preset 创作指导。",
  },
];

const PERMISSIONS: ReadonlyArray<{
  id: string;
  name: string;
  icon: IconName;
  desc: string;
  danger?: boolean;
}> = [
  {
    id: "read-only",
    name: "Read Only",
    icon: "lock",
    desc: "只读沙盒环境，仅支持检索与读取",
  },
  {
    id: "workspace-write",
    name: "Workspace Write",
    icon: "palette",
    desc: "允许在当前工作区内创建与编辑文件",
  },
  {
    id: "danger-full-access",
    name: "Full access",
    icon: "alert",
    desc: "包含全局 Shell 与系统最高执行权限",
    danger: true,
  },
];

const REASONING: ReadonlyArray<{
  id: string;
  label: string;
  sub: string;
  desc: string;
}> = [
  {
    id: "off",
    label: "Off",
    sub: "关",
    desc: "常规快速输出，不进行额外思维链推理",
  },
  {
    id: "low",
    label: "Low",
    sub: "轻度",
    desc: "轻度 Think，适合简单任务，响应更快",
  },
  {
    id: "high",
    label: "High",
    sub: "标准",
    desc: "开启标准 Think 思考，平衡速度与深度",
  },
  {
    id: "max",
    label: "Max",
    sub: "深度",
    desc: "启用超长 CoT 思考链，解决复杂逻辑算法",
  },
];

const FALLBACK_MODELS: ReadonlyArray<{
  id: string;
  name?: string;
  provider?: string;
  inputModalities?: readonly ("text" | "image")[];
}> = [
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", provider: "deepseek-official" },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", provider: "deepseek-official" },
];

const PERMISSION_LABELS: Readonly<Record<string, string>> = {
  "workspace-write": "工作区可写",
  "danger-full-access": "完全访问",
  "read-only": "只读",
  custom: "自定义",
};
const CONTEXT_LIMITS: Readonly<Record<string, number>> = {
  "deepseek-v4-flash": 128_000,
  "deepseek-v4-pro": 128_000,
};
const DEFAULT_CONTEXT_LIMIT = 128_000;

type SheetKind =
  | "worker"
  | "project"
  | "mode"
  | "commands"
  | "permission"
  | "model"
  | "queue"
  | null;

type AutoMode = "slash" | "mention" | null;

const SLASH_RE = /(?:^|\s)\/([a-zA-Z0-9_-]*)$/;
const MENTION_RE = /(?:^|\s)@([a-zA-Z0-9_./-]*)$/;

export function Composer(
  props: Readonly<{ mode: "new" | "session" }>,
): React.JSX.Element {
  const { showToast } = useApp();
  const { textScale } = usePreferences();
  const {
    fg: cssFg,
    muted: cssMuted,
    primary: cssPrimary,
    primaryFg: cssPrimaryFg,
    destructive: cssDestructive,
    background: cssBackground,
  } = useThemeColors();
  const { theme } = useUniwind();
  const isNew = props.mode === "new";

  // 共享 state
  const [text, setText] = useState("");
  const [sheet, setSheet] = useState<SheetKind>(null);
  // 自动补全：/ 命令 与 @ 工作区
  const [autoMode, setAutoMode] = useState<AutoMode>(null);
  const [autoQuery, setAutoQuery] = useState("");
  // @ 文件引用：在当前工作区内逐级浏览（复用 fs.list，无需新协议）
  const [mentionPath, setMentionPath] = useState<string | null>(null);
  const [mentionEntries, setMentionEntries] = useState<
    readonly { name: string; path: string; type: "file" | "directory" }[]
  >([]);
  // 待发送图片（本地 base64 缩略 + 发送时上传为附件 ref）
  const [images, setImages] = useState<
    readonly { base64: string; mime: string }[]
  >([]);
  // new 特有
  const [path, setPath] = useState("");
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [permission, setPermissionState] = useState("workspace-write");
  const [fullAccessConfirm, setFullAccessConfirm] = useState(false);
  const [riskAck, setRiskAck] = useState(false);
  const [reasoning, setReasoning] = useState("off");
  // session 特有
  const [contextOpen, setContextOpen] = useState(false);
  const [pendingQueue, setPendingQueue] = useState<string[]>([]);
  // 队列编辑草稿（批次 1：Web 的 inline edit / remove）
  const [queueEditIndex, setQueueEditIndex] = useState<number | null>(null);
  const [queueDraft, setQueueDraft] = useState("");
  const [commandsCache, setCommandsCache] = useState<
    readonly { name: string; description: string }[]
  >([]);
  // session 当前实际模型（listModels 返回，修复沿用 newSessionDefaults 的显示错误）
  const [sessionModel, setSessionModel] = useState<string | null>(null);
  // new：键盘可见性 → 居中布局切贴底（输入卡贴键盘上方）
  const keyboard = useKeyboardState();
  const inputRef = useRef<React.ComponentRef<typeof Textarea>>(null);

  const todos = useDshStore((s) => s.sessionView.todos);
  const listEntries = useDshStore((s) => s.listEntries);
  const skillCatalog = useDshStore((s) => s.skillCatalog);
  const listSkills = useDshStore((s) => s.listSkills);
  const sessions = useDshStore((s) => s.sessions);
  const goal = useDshStore((s) => s.sessionView.goal);
  const planActive = useDshStore((s) => s.sessionView.planActive);
  const sendMessage = useDshStore((s) => s.sendMessage);
  const uploadImage = useDshStore((s) => s.uploadImage);
  const stopTurn = useDshStore((s) => s.stopTurn);
  const createSession = useDshStore((s) => s.createSession);
  const addWorkspace = useDshStore((s) => s.addWorkspace);
  const listWorkspaces = useDshStore((s) => s.listWorkspaces);
  // workspace 列表读 store 缓存（重开首屏不等待网络），effect 里只做后台刷新
  const workspaces = useDshStore((s) => s.workspaces);
  const listCommands = useDshStore((s) => s.listCommands);
  const setDefaults = useDshStore((s) => s.setNewSessionDefaults);
  const newSessionWorkspace = useDshStore((s) => s.newSessionWorkspace);
  const setNewSessionWorkspace = useDshStore((s) => s.setNewSessionWorkspace);
  const newSessionDefaults = useDshStore((s) => s.newSessionDefaults);
  const newSessionPreset = useDshStore((s) => s.newSessionPreset);
  const modelCatalog = useDshStore((s) => s.modelCatalog);
  const workers = useDshStore((s) => s.workers);
  const activeWorkerId = useDshStore((s) => s.activeWorkerId);
  const openWorker = useDshStore((s) => s.openWorker);
  const running = useDshStore((s) => s.sessionView.agentStatus === "running");
  const permissionCurrent = useDshStore((s) => s.sessionView.permissionCurrent);
  const totalUsage = useDshStore((s) => s.sessionView.totalUsage);
  const queueSend = useDshStore((s) => s.queueSend);
  const listModels = useDshStore((s) => s.listModels);
  const stats = useDshStore((s) => s.sessionView.stats);
  const activeSessionId = useDshStore((s) => s.activeSessionId);
  const prevRunning = useRef(running);

  // new：顶栏/侧边栏「切换工作区」预选 —— 即使已停留在新建页也要即时生效
  // （切换后消费掉 store 值，避免下次进入新建页时覆盖用户后来手选的目录）
  useEffect(() => {
    if (!isNew || newSessionWorkspace === null) return;
    setPath(newSessionWorkspace);
    void saveLastWorkspace(newSessionWorkspace);
    setNewSessionWorkspace(null);
  }, [isNew, newSessionWorkspace, setNewSessionWorkspace]);

  // new：刷新工作区缓存 + 沿用上次目录（渲染走 store 订阅的 workspaces）
  // 若挂载时已有预选工作区，交给上一个 effect 处理，避免异步读到旧 storage 覆盖
  useEffect(() => {
    if (!isNew) return;
    if (newSessionWorkspace !== null) return;
    void (async () => {
      const [list, last] = await Promise.all([
        listWorkspaces(),
        readLastWorkspace(),
      ]);
      const saved =
        last !== null ? list.find((w) => w.path === last) : undefined;
      if (saved !== undefined) setPath(saved.path);
      else if (list[0] !== undefined) setPath(list[0].path);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在挂载/isNew 变化时读一次
  }, [isNew, listWorkspaces]);

  // 命令目录（联想 + 命令面板）
  useEffect(() => {
    void listCommands().then(setCommandsCache);
  }, [listCommands]);

  // 技能目录（`/` 的技能源）：进入 / 模式时按需拉取
  useEffect(() => {
    if (autoMode === "slash") void listSkills();
  }, [autoMode, listSkills]);

  const filteredSkills = useMemo(() => {
    if (autoQuery.length === 0) return skillCatalog.slice(0, 8);
    return skillCatalog
      .filter(
        (s) =>
          s.name.toLowerCase().includes(autoQuery) ||
          s.description.toLowerCase().includes(autoQuery),
      )
      .slice(0, 8);
  }, [skillCatalog, autoQuery]);

  // session：排队发送（turn 结束自动发下一条）
  useEffect(() => {
    if (isNew) return;
    if (prevRunning.current && !running && pendingQueue.length > 0) {
      const [next, ...rest] = pendingQueue;
      setPendingQueue(rest);
      void sendMessage(next);
    }
    prevRunning.current = running;
  }, [isNew, running, pendingQueue, sendMessage]);

  // session：拉取当前会话实际模型（仅展示用）
  useEffect(() => {
    if (isNew) return;
    let alive = true;
    listModels()
      .then((result) => {
        if (!alive) return;
        const m = result.current?.model;
        if (typeof m === "string" && m.length > 0) setSessionModel(m);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isNew, listModels, activeSessionId]);

  const rememberWorkspace = (p: string): void => {
    setPath(p);
    void saveLastWorkspace(p);
  };

  // 输入变化 → 检测 / 与 @ 触发自动补全（含胶囊点开的空 query 态）
  const handleInputChange = (value: string): void => {
    setText(value);
    const slashMatch = SLASH_RE.exec(value);
    if (slashMatch !== null) {
      setAutoMode("slash");
      setAutoQuery(slashMatch[1]!.toLowerCase());
      return;
    }
    const mentionMatch = MENTION_RE.exec(value);
    if (mentionMatch !== null) {
      setAutoMode("mention");
      setAutoQuery(mentionMatch[1]!.toLowerCase());
      return;
    }
    setAutoMode(null);
  };

  const closeAutocomplete = (): void => {
    setAutoMode(null);
    setAutoQuery("");
  };

  // 命令覆盖层（new 模式）：/cmd 语法高亮
  const parsed = useMemo(() => {
    if (!isNew || !text.startsWith("/"))
      return { name: null as string | null, body: "", placeholder: "" };
    const m = /^\/([a-zA-Z0-9_-]+)/.exec(text);
    if (m === null) return { name: null, body: "", placeholder: "" };
    const name = m[1]!.toLowerCase();
    const cmd = commandsCache.find((c) => c.name === name);
    return {
      name,
      body: text.slice(m[0].length).replace(/^\s+/, ""),
      placeholder: cmd?.description ?? "输入命令参数…",
    };
  }, [isNew, text, commandsCache]);

  const modeName =
    MODES.find(
      (m) =>
        m.id === (newSessionPreset.length > 0 ? newSessionPreset : "standard"),
    )?.name ?? "标准模式";
  const permissionId = isNew
    ? permission
    : (permissionCurrent ?? permission);
  const currentPerm =
    PERMISSIONS.find((p) => p.id === permissionId) ?? PERMISSIONS[1]!;
  const permissionLabel = PERMISSION_LABELS[permissionId] ?? currentPerm.name;
  const modelFull = newSessionDefaults?.model ?? "deepseek-v4-flash";
  const displayModel = isNew ? modelFull : (sessionModel ?? modelFull);
  const reasoningLabel =
    REASONING.find((r) => r.id === reasoning)?.label ?? "Off";
  const pathLabel =
    path.length > 0
      ? (path.split("/").filter(Boolean).pop() ?? path)
      : "选择工作区";
  const activeWorkerName =
    workers.find((w) => w.workerId === activeWorkerId)?.name ?? "选择电脑";
  const models = modelCatalog.length > 0 ? modelCatalog : FALLBACK_MODELS;
  const permTint =
    currentPerm.danger === true
      ? cssDestructive
      : permissionId === "workspace-write"
        ? cssPrimary
        : cssMuted;
  const permTone: DeckTone =
    currentPerm.danger === true
      ? "danger"
      : permissionId === "workspace-write"
        ? "brand"
        : "default";

  const inputEmpty = text.trim().length === 0 && images.length === 0;
  const showStop = !isNew && running && inputEmpty;
  const helloVisible = isNew && inputEmpty;
  const tokPerSec =
    stats.decodeMs > 0
      ? Math.round((stats.decodeTokens / stats.decodeMs) * 1000)
      : 0;

  // 自动补全候选
  const filteredCommands = useMemo(
    () =>
      commandsCache.filter(
        (c) =>
          c.name.toLowerCase().includes(autoQuery) ||
          c.description.toLowerCase().includes(autoQuery),
      ),
    [commandsCache, autoQuery],
  );
  const filteredWorkspaces = useMemo(
    () =>
      workspaces.filter(
        (w) =>
          w.title.toLowerCase().includes(autoQuery) ||
          w.path.toLowerCase().includes(autoQuery),
      ),
    [workspaces, autoQuery],
  );

  /** @ 会话引用：匹配标题/路径，排除当前会话，最多 5 条 */
  const filteredSessions = useMemo(() => {
    if (autoQuery.length === 0) return [];
    return sessions
      .filter((s) => s.id !== activeSessionId && s.origin !== "subagent")
      .filter(
        (s) =>
          s.title.toLowerCase().includes(autoQuery) ||
          (s.cwd ?? "").toLowerCase().includes(autoQuery),
      )
      .slice(0, 5);
  }, [sessions, autoQuery, activeSessionId]);

  /** @ 文件浏览的根：session 用当前会话 cwd，新建用选中的工作区 */
  const mentionRoot = useMemo(() => {
    if (isNew) return newSessionWorkspace;
    return sessions.find((s) => s.id === activeSessionId)?.cwd ?? null;
  }, [isNew, newSessionWorkspace, sessions, activeSessionId]);

  const mentionDir = mentionPath ?? mentionRoot;

  // 进入 @ 模式时回到根目录
  useEffect(() => {
    if (autoMode === "mention") setMentionPath(null);
  }, [autoMode]);

  // 拉取当前浏览目录（复用 fs.list；离开 @ 模式不请求）
  useEffect(() => {
    if (autoMode !== "mention" || mentionDir === null) return;
    let cancelled = false;
    void listEntries(mentionDir)
      .then((entries) => {
        if (!cancelled) setMentionEntries(entries);
      })
      .catch(() => {
        if (!cancelled) setMentionEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [autoMode, mentionDir, listEntries]);

  const mentionMatches = useMemo(
    () => filterMentionEntries(mentionEntries, autoQuery),
    [mentionEntries, autoQuery],
  );
  const relativeToRoot = (abs: string): string => toRelativePath(abs, mentionRoot);
  const mentionBreadcrumb = useMemo(
    () => buildMentionBreadcrumb(mentionRoot, mentionDir),
    [mentionRoot, mentionDir],
  );

  const runCommand = (name: string): void => {
    if (name === "permission") {
      setSheet("permission");
      return;
    }
    if (name === "model") {
      setSheet("model");
      return;
    }
    if (name === "export" || name === "feedback" || name === "goal") {
      showToast(`/${name} 暂未实现`, "info");
      return;
    }
    if (isNew) {
      setText(`/${name} `);
    } else {
      void sendMessage(`/${name}`);
      // 执行后清掉输入框里的 / 命令残字，避免留下半截文本
      setText((prev) => (prev.trimStart().startsWith("/") ? "" : prev));
      showToast(`已执行 /${name}`, "info");
    }
  };

  /** 自动补全点选：特殊命令走 runCommand 分支，其余按模式插入/直接执行。 */
  const applyAutocomplete = (name: string): void => {
    closeAutocomplete();
    if (
      name === "permission" ||
      name === "model" ||
      name === "export" ||
      name === "feedback" ||
      name === "goal"
    ) {
      runCommand(name);
      return;
    }
    if (isNew) {
      setText(`/${name} `);
      return;
    }
    void sendMessage(`/${name}`);
    setText((prev) => (prev.trimStart().startsWith("/") ? "" : prev));
    showToast(`已执行 /${name}`, "info");
  };

  /**
   * @ 引用点选：插入 `@<相对路径>`（文件）或 `@<工作区名>`（无会话 cwd 时）。
   * 胶囊直接唤起时文本里还没有 @，此时 append；否则就地替换当前 @token。
   */
  const applyMention = (title: string): void => {
    closeAutocomplete();
    const match = MENTION_RE.exec(text);
    if (match !== null) {
      // match[0] 形如 " @abc" / "@abc"，回退到 @ 起点，避免多切掉前导空格
      const at = match.index + match[0].length - match[1]!.length - 1;
      setText(`${text.slice(0, at)}@${title} `);
    } else {
      const base = text.trimEnd();
      setText(base.length > 0 ? `${base} @${title} ` : `@${title} `);
    }
    inputRef.current?.focus();
  };

  /** 技能点选：插入 `/name `（不直接执行，交给用户确认后发送）。 */
  const insertSlashToken = (name: string): void => {
    closeAutocomplete();
    const match = /(?:^|\s)\/([a-zA-Z0-9_-]*)$/.exec(text);
    if (match !== null) {
      const at = match.index + match[0].length - match[1]!.length - 1;
      setText(`${text.slice(0, at)}/${name} `);
    } else {
      const base = text.trimEnd();
      setText(base.length > 0 ? `${base} /${name} ` : `/${name} `);
    }
    inputRef.current?.focus();
  };

  const pickDirectory = (dir: string): void => {
    setBusy(true);
    // store.addWorkspace 成功后自动合并进缓存
    void addWorkspace(dir).then((w) => {
      setBusy(false);
      if (w !== null) rememberWorkspace(w.path);
    });
  };

  const choosePermission = (id: string): void => {
    setSheet(null);
    if (id === "danger-full-access") {
      setRiskAck(false);
      setFullAccessConfirm(true);
      return;
    }
    setPermissionState(id);
  };

  // 选图（相册；base64 供预览与上传）
  const pickImage = (): void => {
    void (async () => {
      const perm =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        showToast("需要相册权限才能添加图片", "info");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        base64: true,
        quality: 0.6,
      });
      const asset = result.assets?.[0];
      if (result.canceled || asset?.base64 === undefined || asset.base64 === null) return;
      setImages((prev) => [
        ...prev,
        { base64: asset.base64!, mime: asset.mimeType ?? "image/jpeg" },
      ]);
      // 当前模型不支持视觉时提示（带 image 输入模态的模型可理解图片）
      const providerId = newSessionDefaults?.provider;
      const current = models.find(
        (m) =>
          m.id === modelFull &&
          (providerId === undefined || m.provider === undefined || m.provider === providerId),
      );
      if (current !== undefined && current.inputModalities?.includes("image") !== true) {
        showToast("当前模型不支持读图，可在模型里切换 vision 模型", "info");
      }
    })();
  };

  /** 上传图片为 worker 附件 ref，随消息一起发送（vision 模型可理解）。 */
  const sendWithImages = (value: string, imgs: readonly { base64: string; mime: string }[]): void => {
    void (async () => {
      try {
        const refs: unknown[] = [];
        for (const img of imgs) {
          const ref = await uploadImage(img.base64, img.mime);
          if (ref !== null) refs.push(ref);
        }
        await sendMessage(value, refs.length > 0 ? refs : undefined);
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : "图片上传失败",
          "error",
        );
      }
    })();
  };

  const submit = (): void => {
    const value = text.trim();
    if (value.length === 0 && images.length === 0) return;
    const sending = images;
    setText("");
    setImages([]);
    closeAutocomplete();
    if (isNew) {
      if (path.length === 0 || busy) return;
      setBusy(true);
      void createSession(path, { reasoningEffort: reasoning, permission })
        .then(() => {
          if (sending.length > 0) sendWithImages(value, sending);
          else void sendMessage(value);
        })
        .finally(() => setBusy(false));
    } else {
      if (running && queueSend) {
        if (sending.length > 0) {
          showToast("本轮进行中：图片请在回合结束后发送", "info");
          setImages(sending);
          setText(value);
          return;
        }
        setPendingQueue((prev) => [...prev, value]);
        return;
      }
      if (sending.length > 0) sendWithImages(value, sending);
      else void sendMessage(value);
    }
  };

  const canSend = isNew
    ? (text.trim().length > 0 || images.length > 0) && path.length > 0 && !busy
    : text.trim().length > 0 || images.length > 0;

  // 上下文占比（InfoLine 圆点）
  const usedTokens = totalUsage.input + totalUsage.output;
  const contextLimit = CONTEXT_LIMITS[displayModel] ?? DEFAULT_CONTEXT_LIMIT;
  const contextPct = Math.max(0, Math.min(1, usedTokens / contextLimit));

  // 权限胶囊三色码（设计稿）：可写=主色 / 只读=中性 / 全权=红
  // KeyboardAvoidingView 来自 react-native-keyboard-controller，Uniwind 不接管其
  // className，故这里保留内联 style（背景走 CSS 变量，符合迁移规范第 6 条）。
  // 新会话页位置固定为贴底：之前按「未聚焦居中 / 聚焦或键盘弹出贴底」切换，
  // 点一下输入框整块内容就会纵向跳一段（用户反馈「点击之后为什么会变化」）。
  // 键盘弹出只需要 paddingBottom 把它顶起来，不再改变对齐方式。
  const kavStyle = isNew
    ? {
        flex: 1,
        justifyContent: "flex-end" as const,
        alignItems: "stretch" as const,
        paddingHorizontal: 16,
        paddingBottom: keyboard.isVisible ? 8 : 16,
        backgroundColor: cssBackground,
      }
    : {
        justifyContent: "flex-end" as const,
        paddingHorizontal: 12,
        backgroundColor: cssBackground,
      };

  return (
    <View className={cn("bg-background", isNew ? "flex-1" : "justify-end")}>
      <KeyboardAvoidingView
        style={kavStyle}
        /* new：双平台 padding 避让（SDK 57 edge-to-edge 下 Android adjustResize 失效，
           keyboard-controller 的 KAV 双平台可用）；键盘弹出时布局从居中切贴底，
           输入卡正好坐在键盘上方，而不是在剩余空间里重新居中悬在半空。
           session 的键盘避让由 ConversationScreen 根部 KAV 统一处理（避免双层 padding）；
           底部安全区由 App.tsx 全局 SafeAreaView 统一处理。
           automaticOffset：App 全局 SafeAreaView 把内容下移了状态栏高度，KAV 的
           onLayout 是局部坐标、键盘高是窗口坐标，不纠偏会少算状态栏高度 → 被键盘盖住 */
        behavior={isNew ? "padding" : undefined}
        automaticOffset
      >
        {/* 新会话页（简化版）：一行状态 + 一行引导，开始输入即收起 */}
        {isNew && helloVisible && (
          <View className="mb-4 self-stretch px-1">
            <Image
              source={theme === "dark" ? LOGO_DARK : LOGO}
              className="mb-3 h-12 w-12"
              resizeMode="contain"
              accessibilityLabel="掌鲸 DSH Pocket"
            />
            <View className="mb-3 flex-row items-center gap-1.5 self-start rounded-lg border border-border bg-card px-2.5 py-1">
              <View className="size-2 rounded-full bg-success" />
              <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                {pathLabel} · {permissionLabel} · {modeName}
              </Text>
            </View>
            <Text className="text-[22px] font-semibold tracking-tight text-foreground">
              今天想构建什么？
            </Text>
            <Text className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
              直接描述，或用 / 指令、@ 引用文件与会话。
            </Text>
          </View>
        )}

        {/* 自动补全弹层：/ 命令 与 @ 工作区 */}
        {autoMode !== null && (
          <View className="mb-2 max-h-[200px] rounded-xl border border-border bg-card p-2">
            <View className="mb-1.5 flex-row items-center justify-between border-b border-border pb-1.5">
              <Text className="text-[11px] font-bold text-muted-foreground">
                {autoMode === "slash" ? "快捷命令 (/ Commands)" : "文件与工作区 (@ Reference)"}
              </Text>
              <Pressable onPress={closeAutocomplete} hitSlop={8}>
                <AppIcon name="close" color={cssMuted} size={13} />
              </Pressable>
            </View>
            <ScrollView
              className="max-h-[150px]"
              keyboardShouldPersistTaps="handled"
            >
              {autoMode === "slash" ? (
                filteredCommands.length === 0 && filteredSkills.length === 0 ? (
                  <Text className="p-2 text-center text-xs text-muted-foreground">
                    无匹配命令（需活跃会话加载命令目录）
                  </Text>
                ) : (
                  <>
                  {filteredCommands.map((item) => (
                    <Pressable
                      key={item.name}
                      onPress={() => applyAutocomplete(item.name)}
                      className="flex-row items-center justify-between border-b border-border px-1 py-[7px]"
                    >
                      <View className="mr-1.5 flex-1">
                        <Text className="font-mono text-xs font-bold text-foreground">
                          /{item.name}
                        </Text>
                        <Text
                          className="mt-px text-[10.5px] text-muted-foreground"
                          numberOfLines={1}
                        >
                          {item.description}
                        </Text>
                      </View>
                      <AppIcon
                        name="chevron-right"
                        color={cssMuted}
                        size={13}
                      />
                    </Pressable>
                  ))}
                  {filteredSkills.map((skill) => (
                    <Pressable
                      key={`skill-${skill.name}`}
                      onPress={() => insertSlashToken(skill.name)}
                      className="flex-row items-center justify-between border-b border-border px-1 py-[7px]"
                    >
                      <View className="mr-1.5 flex-1">
                        <Text className="font-mono text-xs font-bold text-foreground">
                          /{skill.name}
                        </Text>
                        <Text
                          className="mt-px text-[10.5px] text-muted-foreground"
                          numberOfLines={1}
                        >
                          {skill.description}
                        </Text>
                      </View>
                      <Badge variant="secondary">
                        <Text>技能</Text>
                      </Badge>
                    </Pressable>
                  ))}
                  </>
                )
              ) : mentionRoot !== null ? (
                <>
                  {/* 工作区内文件浏览：目录可进，文件插入真实相对路径 */}
                  <View className="mb-1 flex-row flex-wrap items-center gap-1 px-1">
                    <Pressable onPress={() => setMentionPath(null)} hitSlop={6}>
                      <Text className="text-primary text-[10.5px]">
                        {mentionRoot.split("/").pop() ?? "工作区"}
                      </Text>
                    </Pressable>
                    {mentionBreadcrumb.map((crumb) => (
                      <View key={crumb.path} className="flex-row items-center gap-1">
                        <Text className="text-muted-foreground text-[10.5px]">/</Text>
                        <Pressable onPress={() => setMentionPath(crumb.path)} hitSlop={6}>
                          <Text className="text-primary text-[10.5px]">{crumb.label}</Text>
                        </Pressable>
                      </View>
                    ))}
                  </View>
                  {mentionMatches.length === 0 ? (
                    <Text className="p-2 text-center text-xs text-muted-foreground">
                      此目录无可引用文件
                    </Text>
                  ) : (
                    mentionMatches.map((entry) =>
                      entry.type === "directory" ? (
                        <Pressable
                          key={entry.path}
                          onPress={() => {
                            setMentionPath(entry.path);
                            setAutoQuery("");
                          }}
                          className="flex-row items-center justify-between border-b border-border px-1 py-[7px]"
                        >
                          <Text className="mr-1.5 flex-1 font-mono text-xs text-foreground" numberOfLines={1}>
                            {entry.name}/
                          </Text>
                          <Badge variant="secondary">
                            <Text>目录</Text>
                          </Badge>
                        </Pressable>
                      ) : (
                        <Pressable
                          key={entry.path}
                          onPress={() => applyMention(formatMentionRef(relativeToRoot(entry.path)))}
                          className="flex-row items-center justify-between border-b border-border px-1 py-[7px]"
                        >
                          <Text className="mr-1.5 flex-1 font-mono text-xs text-foreground" numberOfLines={1}>
                            @{entry.name}
                          </Text>
                          <AppIcon name="file-text" color={cssMuted} size={13} />
                        </Pressable>
                      ),
                    )
                  )}
                </>
              ) : filteredWorkspaces.length === 0 ? (
                <Text className="p-2 text-center text-xs text-muted-foreground">
                  无匹配工作区
                </Text>
              ) : (
                filteredWorkspaces.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => applyMention(item.title)}
                    className="flex-row items-center justify-between border-b border-border px-1 py-[7px]"
                  >
                    <View className="mr-1.5 flex-1">
                      <Text className="font-mono text-xs font-bold text-foreground">
                        @{item.title}
                      </Text>
                      <Text
                        className="mt-px text-[10.5px] text-muted-foreground"
                        numberOfLines={1}
                      >
                        {item.path}
                      </Text>
                    </View>
                    <Badge variant="secondary">
                      <Text>工作区</Text>
                    </Badge>
                  </Pressable>
                ))
              )}
              {autoMode === "mention" &&
                filteredSessions.map((session) => (
                  <Pressable
                    key={`session-${session.id}`}
                    onPress={() => applyMention(session.title)}
                    className="flex-row items-center justify-between border-b border-border px-1 py-[7px]"
                  >
                    <View className="mr-1.5 flex-1">
                      <Text className="text-xs font-bold text-foreground" numberOfLines={1}>
                        {session.title}
                      </Text>
                      {session.cwd !== null && (
                        <Text
                          className="mt-px text-[10.5px] text-muted-foreground"
                          numberOfLines={1}
                        >
                          {session.cwd}
                        </Text>
                      )}
                    </View>
                    <Badge variant="secondary">
                      <Text>会话</Text>
                    </Badge>
                  </Pressable>
                ))}
            </ScrollView>
          </View>
        )}

        <GoalBar goal={goal} mode={props.mode} onCommand={(cmd) => void sendMessage(cmd)} />
        <TodoDock todos={todos} mode={props.mode} />

        {/* 输入卡：附件托盘 + 输入区 + 胶囊工具行 */}
        <View className="self-stretch rounded-xl border border-border bg-card p-2">
          {images.length > 0 && (
            <View className="mb-1 border-b border-border pb-1.5">
              <ThumbRow
                images={images}
                onRemove={(i) => setImages((prev) => prev.filter((_, j) => j !== i))}
              />
            </View>
          )}

          <View className="min-h-[44px] px-1">
            {parsed.name !== null && (
              <View className="absolute inset-x-1 top-0.5 bottom-0.5" pointerEvents="none">
                <Text className="flex-wrap text-base leading-[22px]">
                  <Text className="text-base font-bold text-warning">
                    /{parsed.name}{" "}
                  </Text>
                  {parsed.body.length === 0 ? (
                    <Text className="text-base text-muted-foreground">
                      {parsed.placeholder}
                    </Text>
                  ) : (
                    <Text className="text-base text-foreground">
                      {parsed.body}
                    </Text>
                  )}
                </Text>
              </View>
            )}
            <Textarea
              ref={inputRef}
              className="max-h-[120px] min-h-[44px] border-0 bg-transparent p-0 text-base leading-[22px] shadow-none"
              style={[
                { fontSize: 16 * textScale, lineHeight: 22 * textScale },
                parsed.name !== null ? { color: "transparent" } : undefined,
              ]}
              placeholder={
                parsed.name !== null
                  ? ""
                  : isNew
                    ? "描述你想要构建的内容，或点下方 / 与 @ ..."
                    : "输入消息，/ 唤起命令"
              }
              placeholderTextColor={cssMuted}
              value={text}
              onChangeText={handleInputChange}
              numberOfLines={5}
            />
          </View>

          {/* 胶囊工具行 + 发送 */}
          <View className="mt-1 flex-row items-center border-t border-border pt-1.5">
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="mr-2 flex-1"
              contentContainerClassName="flex-row items-center gap-1.5 pr-1.5"
              keyboardShouldPersistTaps="handled"
            >
              <Button
                variant="secondary"
                size="icon"
                className="size-7 rounded-lg"
                onPress={() => setSheet("commands")}
                accessibilityLabel="更多功能"
              >
                <AppIcon name="plus" color={cssMuted} size={16} />
              </Button>

              <DeckCapsule
                icon={currentPerm.icon}
                iconColor={permTint}
                label={permissionLabel}
                tone={permTone}
                borderColor={permTint}
                onPress={() => setSheet("permission")}
              />

              {!isNew && (
                <DeckCapsule
                  icon="file-text"
                  iconColor={planActive ? cssPrimary : cssMuted}
                  label={planActive ? "计划中" : "计划"}
                  tone={planActive ? "brand" : "default"}
                  onPress={() => void sendMessage(planActive ? "/plan off" : "/plan")}
                />
              )}
            </ScrollView>

            {showStop ? (
              <StopButton onPress={() => void stopTurn()} />
            ) : (
              <SendButton canSend={canSend} onPress={() => void submit()} />
            )}
          </View>
        </View>

        {/* 卡下信息带（仅 session）：上下文/速率/排队（→用量 Sheet） */}
        {!isNew && (usedTokens > 0 || pendingQueue.length > 0) && (
          <View className="flex-row items-center justify-end gap-3 self-stretch px-5 pt-1.5">
            <Pressable
              className="min-w-0 flex-row items-center gap-[5px]"
              onPress={() => setContextOpen(true)}
              hitSlop={4}
            >
              <ContextDot pct={contextPct} />
              <Text
                className={cn(
                  "text-xs",
                  contextPct > 0.9
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
                numberOfLines={1}
              >
                {Math.round(contextPct * 100)}%
                {tokPerSec > 0
                  ? ` · ${tokPerSec} tok/s`
                  : usedTokens > 0
                    ? ` · ${compact(usedTokens)} tok`
                    : ""}
                {pendingQueue.length > 0
                  ? ` · 已排 ${pendingQueue.length} 条`
                  : ""}
              </Text>
            </Pressable>
            {pendingQueue.length > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="编辑排队消息"
                className="rounded-md bg-muted px-2 py-0.5 active:bg-accent"
                hitSlop={4}
                onPress={() => setSheet("queue")}
              >
                <Text className="text-muted-foreground text-[11px]">编辑队列</Text>
              </Pressable>
            )}
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Sheets */}
      <CommandPaletteSheet
        visible={sheet === "commands"}
        onClose={() => setSheet(null)}
        onCommand={runCommand}
        onPickImage={pickImage}
      />
      <WorkerSheet
        visible={sheet === "worker"}
        onClose={() => setSheet(null)}
        workers={workers}
        activeWorkerId={activeWorkerId}
        onPick={(id) => {
          openWorker(id);
          setSheet(null);
        }}
      />
      <ProjectSheet
        visible={sheet === "project"}
        onClose={() => setSheet(null)}
        workspaces={workspaces}
        selectedPath={path}
        onPick={(p) => {
          rememberWorkspace(p);
          setSheet(null);
        }}
        onAdd={() => {
          setSheet(null);
          setPicker(true);
        }}
      />
      <ModeSheet
        visible={sheet === "mode"}
        onClose={() => setSheet(null)}
        current={newSessionPreset}
        onPick={(id, name) => {
          setDefaults(null, id);
          showToast(`已切换模式：${name}`, "info");
          setSheet(null);
        }}
      />
      <PermissionSheet
        visible={sheet === "permission"}
        onClose={() => setSheet(null)}
        isNew={isNew}
        permission={permission}
        onPick={choosePermission}
      />
      <ModelSheet
        visible={sheet === "model"}
        onClose={() => setSheet(null)}
        models={models}
        modelFull={modelFull}
        reasoning={reasoning}
        showReasoning={isNew}
        onPickModel={(m) => {
          // 用模型所属路由创建会话：硬编码 deepseek-official 会让
          // 自定义 provider（glm / ali-codingplan 等）的模型选了也建不出来
          setDefaults({
            provider: m.provider ?? newSessionDefaults?.provider ?? "deepseek-official",
            model: m.id,
          });
          showToast(`已选模型 ${m.id}`, "info");
          setSheet(null);
        }}
        onPickReasoning={setReasoning}
      />

      {/* Full access 确认 */}
      <Modal
        visible={fullAccessConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setFullAccessConfirm(false)}
      >
        <Pressable
          className="flex-1 items-center justify-center bg-black/60 p-6"
          onPress={() => setFullAccessConfirm(false)}
        >
          <Pressable
            className="bg-card border-border self-stretch rounded-xl border p-5"
            onPress={(e) => e.stopPropagation()}
          >
            <View className="flex-row items-center justify-between border-b border-border pb-3">
              <Text className="text-base font-bold text-foreground">
                确认启用 Full access?
              </Text>
              <Pressable
                onPress={() => setFullAccessConfirm(false)}
                hitSlop={8}
              >
                <AppIcon name="close" color={cssMuted} size={16} />
              </Pressable>
            </View>
            <View className="flex-row gap-3 py-4">
              <View className="size-11 items-center justify-center rounded-lg bg-destructive/10">
                <AppIcon name="alert" color={cssDestructive} size={20} />
              </View>
              <Text className="flex-1 text-sm leading-[21px] text-muted-foreground">
                启用 Full access 后，agent
                将减少确认步骤，并可直接执行敏感操作、文件修改或外部命令。仅建议在信任当前任务时使用。
              </Text>
            </View>
            <Pressable
              className="flex-row items-center gap-2 py-2"
              onPress={() => setRiskAck(!riskAck)}
            >
              <View
                className={cn(
                  "size-[18px] items-center justify-center rounded-sm border-[1.5px]",
                  riskAck ? "border-primary bg-primary" : "border-border",
                )}
              >
                {riskAck && <AppIcon name="check" color={cssPrimaryFg} size={12} />}
              </View>
              <Text className="text-sm font-semibold text-foreground">
                我已了解风险，并愿意继续
              </Text>
            </Pressable>
            <View className="mt-2 flex-row justify-end gap-3 border-t border-border pt-4">
              <Button
                variant="outline"
                onPress={() => setFullAccessConfirm(false)}
              >
                <Text>取消</Text>
              </Button>
              <Button
                variant="destructive"
                disabled={!riskAck}
                onPress={() => {
                  setPermissionState("danger-full-access");
                  setFullAccessConfirm(false);
                }}
              >
                <Text>启用 Full access</Text>
              </Button>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <DirectoryPickerSheet
        visible={picker}
        onClose={() => setPicker(false)}
        onPicked={(dir) => pickDirectory(dir)}
      />
      <ContextUsageSheet
        visible={contextOpen}
        onClose={() => setContextOpen(false)}
      />
      <QueueSheet
        visible={sheet === "queue"}
        onClose={() => {
          setQueueEditIndex(null);
          setSheet(null);
        }}
        queue={pendingQueue}
        editIndex={queueEditIndex}
        draft={queueDraft}
        onStartEdit={(index, value) => {
          setQueueEditIndex(index);
          setQueueDraft(value);
        }}
        onChangeDraft={setQueueDraft}
        onCancelEdit={() => setQueueEditIndex(null)}
        onSaveEdit={(index) => {
          const next = queueDraft.trim();
          if (next.length === 0) return;
          setPendingQueue((prev) => prev.map((v, i) => (i === index ? next : v)));
          setQueueEditIndex(null);
        }}
        onRemove={(index) => {
          setPendingQueue((prev) => prev.filter((_, i) => i !== index));
          setQueueEditIndex(null);
        }}
      />
    </View>
  );
}

/** 待发送图片横排（输入卡附件托盘）。 */
function ThumbRow(
  props: Readonly<{
    images: readonly { base64: string; mime: string }[];
    onRemove: (index: number) => void;
  }>,
): React.JSX.Element {
  const { destructive } = useThemeColors();
  return (
    <ScrollView
      horizontal
      className="px-1 pt-1"
      contentContainerClassName="gap-2"
      showsHorizontalScrollIndicator={false}
    >
      {props.images.map((img, i) => (
        <View key={i} className="relative">
          <Image
            source={{ uri: `data:${img.mime};base64,${img.base64}` }}
            className="size-[46px] rounded-lg"
            resizeMode="cover"
            accessibilityLabel="待发送图片"
          />
          <Pressable
            className="absolute -right-1.5 -top-1.5 size-[18px] items-center justify-center rounded-full"
            style={{ backgroundColor: destructive }}
            onPress={() => props.onRemove(i)}
            hitSlop={6}
          >
            <AppIcon name="close" color="#FFFFFF" size={10} />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

function SendButton(
  props: Readonly<{ canSend: boolean; onPress: () => void }>,
): React.JSX.Element {
  const { muted, primaryFg } = useThemeColors();
  return (
    <Button
      size="icon"
      variant={props.canSend ? "default" : "secondary"}
      className="size-9"
      onPress={props.onPress}
      disabled={!props.canSend}
      accessibilityLabel="发送"
    >
      <AppIcon
        name="arrow-up"
        color={props.canSend ? primaryFg : muted}
        size={17}
      />
    </Button>
  );
}

/** 运行中的停止按钮（红圆 + 白色实心方块），只停当前 turn。 */
function StopButton(
  props: Readonly<{ onPress: () => void }>,
): React.JSX.Element {
  return (
    <Button
      size="icon"
      variant="destructive"
      className="size-9"
      onPress={props.onPress}
      accessibilityLabel="停止"
    >
      <View className="size-3 rounded-sm bg-white" />
    </Button>
  );
}

type DeckTone = "default" | "brand" | "success" | "danger";

/** 输入坞通用胶囊（设计稿 deck capsules）：icon/前缀 + 标签 + ▾。 */
function DeckCapsule(props: Readonly<{
  label: string;
  prefix?: React.JSX.Element;
  icon?: IconName;
  iconColor?: string;
  tone: DeckTone;
  borderColor?: string;
  onPress: () => void;
}>): React.JSX.Element {
  const { muted } = useThemeColors();
  const toneClass =
    props.tone === "brand"
      ? "border-primary bg-primary/10"
      : props.tone === "success"
        ? "border-success/40 bg-success/10"
        : props.tone === "danger"
          ? "border-destructive bg-destructive/10"
          : "border-border bg-muted";
  return (
    <Pressable
      className={cn(
        "flex-row items-center gap-1 rounded-lg border px-2.5 py-[5px] active:bg-accent",
        toneClass,
      )}
      style={props.borderColor !== undefined ? { borderColor: props.borderColor } : undefined}
      onPress={props.onPress}
      accessibilityRole="button"
    >
      {props.prefix}
      {props.icon !== undefined && (
        <AppIcon
          name={props.icon}
          color={props.iconColor ?? muted}
          size={12}
        />
      )}
      <Text
        className="max-w-[110px] text-[11.5px] font-semibold text-foreground"
        numberOfLines={1}
      >
        {props.label}
      </Text>
      <AppIcon name="chevron-down" color={muted} size={9} />
    </Pressable>
  );
}

/** InfoLine 的迷你上下文环（12px）。 */
function ContextDot(props: Readonly<{ pct: number }>): React.JSX.Element {
  const [border, primary, destructive] = useCSSVariable([
    '--color-border',
    '--color-primary',
    '--color-destructive',
  ]) as [string, string, string];
  const r = 7;
  const circ = 2 * Math.PI * r;
  return (
    <Svg width={13} height={13} viewBox="0 0 20 20">
      <Circle
        cx="10"
        cy="10"
        r={r}
        stroke={border}
        strokeWidth="2.5"
        fill="none"
      />
      <Circle
        cx="10"
        cy="10"
        r={r}
        stroke={props.pct > 0.9 ? destructive : primary}
        strokeWidth="2.5"
        fill="none"
        strokeDasharray={`${circ * props.pct} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 10 10)"
      />
    </Svg>
  );
}

function SheetRow(
  props: Readonly<{
    selected: boolean;
    onPress: () => void;
    label: string;
    sub?: string;
    icon?: IconName;
  }>,
): React.JSX.Element {
  const { primary, muted } = useThemeColors();
  return (
    <Pressable
      className={cn(
        "flex-row items-center gap-3 rounded-xl px-2 py-3 active:bg-accent",
        props.selected && "bg-primary/10",
      )}
      onPress={props.onPress}
    >
      {props.icon !== undefined && (
        <AppIcon
          name={props.icon}
          color={props.selected ? primary : muted}
          size={14}
        />
      )}
      <View className="flex-1">
        <Text
          className={cn(
            "text-sm font-medium",
            props.selected ? "text-primary" : "text-foreground",
          )}
          numberOfLines={1}
        >
          {props.label}
        </Text>
        {props.sub !== undefined && (
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {props.sub}
          </Text>
        )}
      </View>
      {props.selected && (
        <AppIcon name="check" color={primary} size={14} />
      )}
    </Pressable>
  );
}

function WorkerSheet(
  props: Readonly<{
    visible: boolean;
    onClose: () => void;
    workers: readonly { workerId: string; name: string; online: boolean }[];
    activeWorkerId: string | null;
    onPick: (id: string) => void;
  }>,
): React.JSX.Element {
  const { primary } = useThemeColors();
  return (
    <Sheet
      visible={props.visible}
      title="选择电脑"
      onClose={props.onClose}
      scrollable
      snapPoints={["50%", "85%"]}
    >
      {props.workers.map((worker) => {
        const active = worker.workerId === props.activeWorkerId;
        return (
          <Pressable
            key={worker.workerId}
            className={cn(
              "mb-2 flex-row items-center gap-2 rounded-xl border bg-card p-3",
              active ? "border-primary" : "border-border",
            )}
            onPress={() => props.onPick(worker.workerId)}
          >
            <View className="flex-1">
              <Text
                className="text-base font-semibold text-foreground"
                numberOfLines={1}
              >
                {worker.name}
              </Text>
              <Text className="mt-0.5 text-xs text-muted-foreground">
                {worker.online ? "在线" : "离线"}
              </Text>
            </View>
            {active && <AppIcon name="check" color={primary} size={16} />}
          </Pressable>
        );
      })}
      {props.workers.length === 0 && (
        <Text className="text-xs leading-[17px] text-muted-foreground">
          还没有电脑，请先在侧边栏配对
        </Text>
      )}
    </Sheet>
  );
}

function ProjectSheet(
  props: Readonly<{
    visible: boolean;
    onClose: () => void;
    workspaces: readonly { id: string; path: string; title: string }[];
    selectedPath: string;
    onPick: (path: string) => void;
    onAdd: () => void;
  }>,
): React.JSX.Element {
  const { primary } = useThemeColors();
  return (
    <Sheet
      visible={props.visible}
      title="选择工作区项目"
      onClose={props.onClose}
      scrollable
      snapPoints={["66%", "92%"]}
    >
      {props.workspaces.length === 0 && (
        <Text className="text-xs leading-[17px] text-muted-foreground">
          还没有工作区，点下方「新建工作区」添加
        </Text>
      )}
      <Separator className="mt-2" />
      <Pressable className="flex-row items-center gap-2 py-3" onPress={props.onAdd}>
        <AppIcon name="plus" color={primary} size={14} />
        <Text className="text-sm font-medium text-primary">
          新建工作区（浏览电脑目录）
        </Text>
      </Pressable>
      {props.workspaces.map((w) => (
        <SheetRow
          key={w.id}
          selected={props.selectedPath === w.path}
          onPress={() => props.onPick(w.path)}
          label={w.title}
          sub={w.path}
          icon="folder"
        />
      ))}
    </Sheet>
  );
}

function ModeSheet(
  props: Readonly<{
    visible: boolean;
    onClose: () => void;
    current: string;
    onPick: (id: string, name: string) => void;
  }>,
): React.JSX.Element {
  const { primary } = useThemeColors();
  return (
    <Sheet
      visible={props.visible}
      title="选择运行模式"
      onClose={props.onClose}
      scrollable
      snapPoints={["65%", "92%"]}
    >
      {MODES.map((m) => {
        const selected =
          props.current === m.id ||
          (props.current.length === 0 && m.id === "standard");
        return (
          <Pressable
            key={m.id}
            className={cn(
              "mb-2 flex-row items-center gap-3 rounded-xl border border-border p-3 active:bg-accent",
              selected ? "bg-primary/10" : "bg-card",
            )}
            onPress={() => props.onPick(m.id, m.name)}
          >
            <View className="flex-1">
              <Text className="mb-[3px] text-sm font-bold text-foreground">
                {m.name}
              </Text>
              <Text className="text-xs leading-[17px] text-muted-foreground">
                {m.desc}
              </Text>
            </View>
            {selected && (
              <AppIcon name="check" color={primary} size={16} />
            )}
          </Pressable>
        );
      })}
    </Sheet>
  );
}

function PermissionSheet(
  props: Readonly<{
    visible: boolean;
    onClose: () => void;
    isNew: boolean;
    permission: string;
    onPick: (id: string) => void;
  }>,
): React.JSX.Element {
  const { primary, primaryFg, muted } = useThemeColors();
  const setPermission = useDshStore((s) => s.setPermission);
  const [names, setNames] = useState<string[]>([]);
  const permissionOptions = useDshStore((s) => s.permissionOptions);
  const current = useDshStore((s) => s.sessionView.permissionCurrent);
  useEffect(() => {
    if (props.visible && !props.isNew)
      void permissionOptions().then((o) => setNames(o.names));
  }, [props.visible, props.isNew, permissionOptions]);
  if (props.isNew) {
    return (
      <Sheet
        visible={props.visible}
        title="工作区权限设置"
        onClose={props.onClose}
        snapPoints={["55%"]}
      >
        {PERMISSIONS.map((p) => {
          const selected = props.permission === p.id;
          return (
            <Pressable
              key={p.id}
              className={cn(
                "mb-2 flex-row items-center gap-3 rounded-xl border border-border p-3 active:bg-accent",
                selected ? "bg-primary/10" : "bg-card",
              )}
              onPress={() => props.onPick(p.id)}
            >
              <View
                className={cn(
                  "size-8 items-center justify-center rounded-xl",
                  selected ? "bg-primary" : "bg-muted",
                )}
              >
                <AppIcon
                  name={p.icon}
                  color={selected ? primaryFg : muted}
                  size={14}
                />
              </View>
              <View className="flex-1">
                <Text className="mb-[3px] text-sm font-bold text-foreground">
                  {p.name}
                </Text>
                <Text className="text-xs leading-[17px] text-muted-foreground">
                  {p.desc}
                </Text>
              </View>
              {selected && (
                <AppIcon name="check" color={primary} size={16} />
              )}
            </Pressable>
          );
        })}
      </Sheet>
    );
  }
  return (
    <Sheet
      visible={props.visible}
      title="访问模式"
      onClose={props.onClose}
      snapPoints={["50%"]}
    >
      {names.map((name) => {
        const label = PERMISSION_LABELS[name] ?? name;
        const selected = current === name;
        return (
          <Pressable
            key={name}
            className={cn(
              "mb-2 flex-row items-center gap-2 rounded-xl border bg-card p-3",
              selected ? "border-primary" : "border-border",
            )}
            onPress={() => {
              props.onClose();
              void setPermission(name);
            }}
          >
            <Text
              className={cn(
                "flex-1 text-base",
                selected ? "text-primary" : "text-foreground",
              )}
            >
              {label}
            </Text>
            {selected && (
              <AppIcon name="check" color={primary} size={16} />
            )}
          </Pressable>
        );
      })}
      {names.length === 0 && (
        <Text className="text-xs leading-[17px] text-muted-foreground">
          未取到档位目录（worker 需 m3 caps）
        </Text>
      )}
    </Sheet>
  );
}

function ModelSheet(
  props: Readonly<{
    visible: boolean;
    onClose: () => void;
    models: readonly {
      id: string;
      name?: string;
      provider?: string;
      inputModalities?: readonly ("text" | "image")[];
    }[];
    modelFull: string;
    reasoning: string;
    showReasoning: boolean;
    onPickModel: (m: { id: string; provider?: string }) => void;
    onPickReasoning: (id: string) => void;
  }>,
): React.JSX.Element {
  const { primary } = useThemeColors();
  // 多路由时标注每个模型所属的 provider，避免同名模型分不清
  const multiProvider =
    new Set(props.models.map((m) => m.provider ?? "")).size > 1;
  return (
    <Sheet
      visible={props.visible}
      title="选择模型"
      onClose={props.onClose}
      scrollable
      snapPoints={["70%", "95%"]}
    >
      {!props.showReasoning && (
        <Text className="pb-2 text-xs text-muted-foreground">
          模型与推理档将于下次新建会话时生效
        </Text>
      )}
      {props.showReasoning && (
      <View className="mb-3 rounded-xl bg-muted p-3">
        <Text className="mb-2 text-[13px] font-semibold text-foreground">
          推理 Thinking (CoT)
        </Text>
        <View className="flex-row overflow-hidden rounded-xl">
          {REASONING.map((r) => {
            const sel = props.reasoning === r.id;
            return (
              <Pressable
                key={r.id}
                className={cn(
                  "flex-1 items-center rounded-lg py-2",
                  sel && "bg-card",
                )}
                onPress={() => props.onPickReasoning(r.id)}
              >
                <Text
                  className={cn(
                    "text-xs font-semibold",
                    sel ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {r.label}
                </Text>
                <Text
                  className={cn(
                    "text-xs",
                    sel ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {r.sub}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text className="mt-2 text-xs text-muted-foreground">
          {REASONING.find((r) => r.id === props.reasoning)?.desc}
        </Text>
      </View>
      )}
      {props.models.map((m) => {
        const selected = props.modelFull === m.id;
        return (
          <Pressable
            key={m.id}
            className={cn(
              "mb-2 flex-row items-center gap-2 rounded-xl border bg-card p-3",
              selected ? "border-primary" : "border-border",
            )}
            onPress={() => props.onPickModel(m)}
          >
            <View className="flex-1">
              <Text
                className="font-mono text-base font-semibold text-foreground"
              >
                {m.id}
              </Text>
              {((m.name !== undefined && m.name.length > 0) ||
                (multiProvider && m.provider !== undefined)) && (
                <Text className="mt-0.5 text-xs text-muted-foreground">
                  {[
                    multiProvider ? m.provider : undefined,
                    m.name !== undefined && m.name.length > 0 ? m.name : undefined,
                  ]
                    .filter((part) => part !== undefined)
                    .join(" · ")}
                </Text>
              )}
            </View>
            {m.inputModalities?.includes("image") && (
              <Badge className="mr-2 border-primary/20 bg-primary/10">
                <AppIcon name="image" color={primary} size={11} />
                <Text className="text-primary">视觉</Text>
              </Badge>
            )}
            {selected && (
              <AppIcon name="check" color={primary} size={16} />
            )}
          </Pressable>
        );
      })}
    </Sheet>
  );
}

function ContextUsageSheet(
  props: Readonly<{ visible: boolean; onClose: () => void }>,
): React.JSX.Element {
  const [ctx, setCtx] = useState<{
    projectedTokens: number;
    contextWindow: number;
    systemTokens: number;
    toolsTokens: number;
    messageTokens: number;
  } | null>(null);
  const activeSessionId = useDshStore((s) => s.activeSessionId);
  const sessionContext = useDshStore((s) => s.sessionContext);
  const stats = useDshStore((s) => s.sessionView.stats);
  const totalUsage = useDshStore((s) => s.sessionView.totalUsage);
  useEffect(() => {
    if (props.visible && activeSessionId !== null)
      void sessionContext(activeSessionId).then(setCtx);
  }, [props.visible, activeSessionId, sessionContext]);
  const pct =
    ctx !== null && ctx.contextWindow > 0
      ? Math.round((ctx.projectedTokens / ctx.contextWindow) * 1000) / 10
      : 0;
  const fmt = (n: number): string =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
  return (
    <Sheet
      visible={props.visible}
      title="上下文占用"
      onClose={props.onClose}
      snapPoints={["50%"]}
    >
      {ctx === null ? (
        <Text className="pb-2 text-xs text-muted-foreground">
          上下文占用不可用（需活跃会话）
        </Text>
      ) : (
        <>
          <Text className="mt-2 text-center text-xl font-bold text-foreground">
            上下文已用 {pct}%
          </Text>
          <Text className="mt-1 mb-3 text-center font-mono text-[13px] text-muted-foreground">
            ~{fmt(ctx.projectedTokens)} / {fmt(ctx.contextWindow)}
          </Text>
          <CtxRow label="系统提示词" value={`~${fmt(ctx.systemTokens)}`} />
          <CtxRow label="工具" value={`~${fmt(ctx.toolsTokens)}`} />
          <CtxRow label="对话消息" value={`~${fmt(ctx.messageTokens)}`} />
          {/* 运行统计（原底部 StatsLine 收纳于此） */}
          {stats.turns > 0 && (
            <>
              <CtxRow
                label="本会话运行"
                value={`${stats.turns} 轮 · ${stats.steps} 步`}
              />
              <CtxRow
                label="耗时 LLM / 工具"
                value={`${fmtMs(stats.llmMs)} / ${fmtMs(stats.toolMs)}`}
              />
              <CtxRow
                label="首 token / 速率"
                value={`${fmtMs(stats.ttftSteps > 0 ? stats.ttftMs / stats.ttftSteps : 0)}${
                  stats.decodeMs > 0
                    ? ` · ${Math.round((stats.decodeTokens / stats.decodeMs) * 1000)} tok/s`
                    : ""
                }`}
              />
              {Number.isFinite(stats.cacheHitPct) && (
                <CtxRow
                  label="缓存命中"
                  value={`${Math.round(stats.cacheHitPct)}%`}
                />
              )}
              <CtxRow
                label="累计 tokens (in/out)"
                value={`${fmt(totalUsage.input)} / ${fmt(totalUsage.output)}`}
              />
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

/** 上下文用量 Sheet 的一行统计（标签 + 等宽数值）。 */
function CtxRow(
  props: Readonly<{ label: string; value: string }>,
): React.JSX.Element {
  return (
    <View className="flex-row items-center justify-between border-t border-border py-2">
      <Text className="text-sm text-muted-foreground">{props.label}</Text>
      <Text className="font-mono text-sm text-foreground">{props.value}</Text>
    </View>
  );
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1_000)}K`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** ms → 320ms / 5.2s / 1m8s（运行统计用）。 */
function fmtMs(n: number): string {
  if (n <= 0) return "—";
  const s = n / 1000;
  return s >= 60
    ? `${Math.floor(s / 60)}m${Math.round(s % 60)}s`
    : `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
}

/**
 * To-do dock（批次 1，移动端形态）：对齐 Web 的 composer To-do dock。
 * 数据来自 reducer 对最近一次 todo_write 工具调用的投影（sessionView.todos）。
 */
function TodoDock({
  todos,
  mode,
}: Readonly<{ todos: readonly TodoEntry[]; mode: "new" | "session" }>) {
  const [open, setOpen] = useState(false);
  if (mode !== "session" || todos.length === 0) return null;
  const done = todos.filter((t) => t.status === "completed").length;
  return (
    <View className="border-border bg-card mb-2 self-stretch overflow-hidden rounded-xl border">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? "收起待办" : "展开待办"}
        className="flex-row items-center gap-2 px-3 py-2"
        onPress={() => setOpen((v) => !v)}
      >
        <AppIcon name="check-circle" size={14} />
        <Text className="text-foreground flex-1 text-xs font-semibold">
          待办 {done}/{todos.length}
        </Text>
        <Text className="text-muted-foreground text-[11px]">
          {open ? "收起" : "展开"}
        </Text>
      </Pressable>
      {open && (
        <View className="border-border gap-1.5 border-t px-3 py-2">
          {todos.map((todo, index) => (
            <View key={index} className="flex-row items-center gap-2">
              <AppIcon
                name={
                  todo.status === "completed"
                    ? "check-circle"
                    : todo.status === "in_progress"
                      ? "clock"
                      : "minus"
                }
                size={12}
              />
              <Text
                className={
                  todo.status === "completed"
                    ? "text-muted-foreground flex-1 text-xs line-through"
                    : "text-foreground flex-1 text-xs"
                }
              >
                {todo.text}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * 队列编辑 Sheet（批次 1）：对应 Web 的 message queue dock（Edit / Save / Cancel / Remove）。
 * 手机端不做 steer/插入附件，只保留编辑与删除。
 */
function QueueSheet({
  visible,
  onClose,
  queue,
  editIndex,
  draft,
  onStartEdit,
  onChangeDraft,
  onCancelEdit,
  onSaveEdit,
  onRemove,
}: Readonly<{
  visible: boolean;
  onClose: () => void;
  queue: readonly string[];
  editIndex: number | null;
  draft: string;
  onStartEdit: (index: number, value: string) => void;
  onChangeDraft: (value: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (index: number) => void;
  onRemove: (index: number) => void;
}>) {
  return (
    <Sheet visible={visible} title={`排队消息（${queue.length}）`} onClose={onClose} scrollable>
      {queue.length === 0 && (
        <Text className="text-muted-foreground p-3 text-center text-sm">
          队列为空
        </Text>
      )}
      {queue.map((item, index) => (
        <View key={index} className="border-border bg-card mb-2 rounded-xl border px-4 py-3">
          {editIndex === index ? (
            <View className="gap-2">
              <Textarea
                className="min-h-[60px] text-sm"
                value={draft}
                onChangeText={onChangeDraft}
                numberOfLines={3}
              />
              <View className="flex-row justify-end gap-2">
                <Button size="sm" variant="ghost" onPress={onCancelEdit}>
                  <Text>取消</Text>
                </Button>
                <Button size="sm" onPress={() => onSaveEdit(index)}>
                  <Text>保存</Text>
                </Button>
              </View>
            </View>
          ) : (
            <View className="gap-2">
              <Text className="text-foreground text-sm" numberOfLines={3}>
                {item}
              </Text>
              <View className="flex-row justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => onRemove(index)}
                >
                  <Text className="text-destructive">删除</Text>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onPress={() => onStartEdit(index, item)}
                >
                  <Text>编辑</Text>
                </Button>
              </View>
            </View>
          )}
        </View>
      ))}
    </Sheet>
  );
}

/**
 * GoalBar（批次 2，移动端形态）：对齐 Web 的 composer 目标条。
 * 数据来自 reducer 对 `goal/change` + `goal/activation-changed` 的投影。
 * 动作通过 `/goal pause|resume|clear` 命令回传（命令语法取自 dsh-command-goal）。
 */
function GoalBar({
  goal,
  mode,
  onCommand,
}: Readonly<{
  goal: import("./reducer").GoalState | null;
  mode: "new" | "session";
  onCommand: (command: string) => void;
}>) {
  const [open, setOpen] = useState(false);
  if (mode !== "session" || goal === null) return null;
  const phaseLabel =
    goal.phase === "paused"
      ? "已暂停"
      : goal.phase === "blocked"
        ? "受阻"
        : goal.phase === "complete"
          ? "已完成"
          : "进行中";
  const phaseClass =
    goal.phase === "blocked"
      ? "text-destructive text-[11px] font-semibold"
      : goal.phase === "complete"
        ? "text-muted-foreground text-[11px] font-semibold"
        : "text-primary text-[11px] font-semibold";
  return (
    <View className="border-border bg-card mb-2 self-stretch overflow-hidden rounded-xl border">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? "收起目标" : "展开目标"}
        className="flex-row items-center gap-2 px-3 py-2"
        onPress={() => setOpen((v) => !v)}
      >
        <AppIcon name="sparkles" size={14} />
        <Text className="text-foreground flex-1 text-xs font-semibold" numberOfLines={1}>
          {goal.objective}
        </Text>
        <Text className={phaseClass}>{phaseLabel}</Text>
      </Pressable>
      {open && (
        <View className="border-border gap-2 border-t px-3 py-2">
          {goal.blockedReason !== undefined && (
            <Text className="text-destructive text-xs">{goal.blockedReason.message}</Text>
          )}
          <Text className="text-muted-foreground text-[11px]">
            回合 {goal.roundsStarted}
            {goal.maxGoalRounds > 0 ? ` / ${goal.maxGoalRounds}` : ""}
            {goal.activation !== null
              ? ` · ${goal.activation === "armed" ? "自动续跑开启" : "自动续跑关闭"}`
              : ""}
          </Text>
          <View className="flex-row gap-2">
            {goal.phase === "active" ? (
              <Button size="sm" variant="outline" onPress={() => onCommand("/goal pause")}>
                <Text>暂停</Text>
              </Button>
            ) : (
              <Button size="sm" variant="outline" onPress={() => onCommand("/goal resume")}>
                <Text>继续</Text>
              </Button>
            )}
            <Button size="sm" variant="ghost" onPress={() => onCommand("/goal clear")}>
              <Text className="text-destructive">清除目标</Text>
            </Button>
          </View>
        </View>
      )}
    </View>
  );
}
