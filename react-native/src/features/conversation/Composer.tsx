/**
 * 统一 Composer：new session 与 session 共用一个组件，通过 mode 控制功能显隐。
 *   - new：电脑/工作区/模式 chip + 输入卡（命令覆盖层）+ 命令/权限/模型；提交 = createSession + sendMessage
 *   - session：模式 chip + 输入框 + 命令/访问模式/模型；提交 = sendMessage（running 停止）
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from "react-native";
import Svg, { Circle } from "react-native-svg";
import * as ImagePicker from "expo-image-picker";
import { AppIcon, IconName } from "../../design-system/AppIcon";
import { Sheet } from "../../design-system/Sheet";
import { usePreferences } from "../../preferences/PreferencesProvider";
import { useApp } from "../../state/AppStore";
import { useDshStore } from "../../state/dshStore";
import { spacing, radii } from "../../theme/tokens";
import { readLastWorkspace, saveLastWorkspace } from "../../data/storage";
import { DirectoryPickerSheet } from "../workers/DirectoryPickerSheet";
import { CommandPaletteSheet } from "./CommandPaletteSheet";

import { useWindowDimensions } from "react-native";

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
  inputModalities?: readonly ("text" | "image")[];
}> = [
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
];

// 空态引导的起点提示词（点击填入输入框）
const HELLO_CHIPS: ReadonlyArray<{ label: string; fill: string }> = [
  { label: "修一个报错", fill: "帮我排查并修复这个报错：" },
  { label: "写个新功能", fill: "给这个项目加一个新功能：" },
  { label: "读懂这个仓库", fill: "带我把这个仓库的整体结构和入口读一遍" },
  { label: "重构一段代码", fill: "帮我把这段代码重构一下：" },
];

const PRESET_LABELS: Readonly<Record<string, string>> = {
  standard: "标准",
  code: "代码编排",
  minimal: "极简",
  cordis: "Cordis",
};
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
  | null;

export function Composer(
  props: Readonly<{ mode: "new" | "session" }>,
): React.JSX.Element {
  const { palette } = usePreferences();
  const { showToast } = useApp();
  const isNew = props.mode === "new";

  // 共享 state
  const [text, setText] = useState("");
  const [sheet, setSheet] = useState<SheetKind>(null);
  // 待发送图片（本地 base64 缩略 + 发送时上传为附件 ref）
  const [images, setImages] = useState<
    readonly { base64: string; mime: string }[]
  >([]);
  // new 特有
  const [path, setPath] = useState("");
  const [workspaces, setWorkspaces] = useState<
    readonly { id: string; path: string; title: string }[]
  >([]);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const [permission, setPermissionState] = useState("workspace-write");
  const [fullAccessConfirm, setFullAccessConfirm] = useState(false);
  const [riskAck, setRiskAck] = useState(false);
  const [reasoning, setReasoning] = useState("off");
  // session 特有
  const [contextOpen, setContextOpen] = useState(false);
  const [pendingQueue, setPendingQueue] = useState<string[]>([]);
  const [commandsCache, setCommandsCache] = useState<
    readonly { name: string; description: string }[]
  >([]);
  // 豆包式形态：session 空闲收成单行胶囊，聚焦/已输入展开
  const [dockExpanded, setDockExpanded] = useState(isNew);
  // session 当前实际模型（listModels 返回，修复沿用 newSessionDefaults 的显示错误）
  const [sessionModel, setSessionModel] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  // 胶囊→展开时 TextInput 尚未挂载（条件渲染），聚焦需等 commit 后在 effect 里补
  const pendingFocusRef = useRef(false);

  const sendMessage = useDshStore((s) => s.sendMessage);
  const uploadImage = useDshStore((s) => s.uploadImage);
  const stopTurn = useDshStore((s) => s.stopTurn);
  const createSession = useDshStore((s) => s.createSession);
  const addWorkspace = useDshStore((s) => s.addWorkspace);
  const listWorkspaces = useDshStore((s) => s.listWorkspaces);
  const listCommands = useDshStore((s) => s.listCommands);
  const setDefaults = useDshStore((s) => s.setNewSessionDefaults);
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

  // new：加载工作区 + 沿用上次目录
  useEffect(() => {
    if (!isNew) return;
    void (async () => {
      const [list, last] = await Promise.all([
        listWorkspaces(),
        readLastWorkspace(),
      ]);
      setWorkspaces(list);
      const saved =
        last !== null ? list.find((w) => w.path === last) : undefined;
      if (saved !== undefined) setPath(saved.path);
      else if (list[0] !== undefined) setPath(list[0].path);
    })();
  }, [isNew, listWorkspaces]);

  // 命令目录（联想 + 命令面板）
  useEffect(() => {
    void listCommands().then(setCommandsCache);
  }, [listCommands]);

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
  // 模型 pill 文案：目录里的展示名优先（fallback id 太长），思考档合并展示
  const modelMeta = models.find((m) => m.id === displayModel);
  const modelPillLabel =
    (modelMeta?.name !== undefined && modelMeta.name.length > 0
      ? modelMeta.name
      : displayModel) +
    (isNew && reasoning !== "off" ? ` · ${reasoningLabel}` : "");

  // 胶囊↔展开切换（输入空 + 未聚焦时 session 收成单行）
  const inputEmpty = text.trim().length === 0 && images.length === 0;
  const showStop = !isNew && running && inputEmpty;
  const docked = !isNew && !dockExpanded;
  const helloVisible = isNew && inputEmpty && !focused;
  const tokPerSec =
    stats.decodeMs > 0
      ? Math.round((stats.decodeTokens / stats.decodeMs) * 1000)
      : 0;

  /** 胶囊↔展开的布局动画（Android 需先开实验开关）。 */
  const animateLayout = (): void => {
    if (
      Platform.OS === "android" &&
      typeof UIManager.setLayoutAnimationEnabledExperimental === "function"
    ) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  };

  const expandDock = (): void => {
    animateLayout();
    pendingFocusRef.current = true;
    setDockExpanded(true);
  };

  // 展开卡 commit 后补聚焦（setDockExpanded 同一 tick 里 ref 还是 null，同步 focus 会被吞掉）
  useEffect(() => {
    if (dockExpanded && pendingFocusRef.current) {
      pendingFocusRef.current = false;
      inputRef.current?.focus();
    }
  }, [dockExpanded]);

  // 空态引导：一键填入起点提示词并聚焦
  const applyHelloChip = (fill: string): void => {
    setText(fill);
    inputRef.current?.focus();
  };

  const pickDirectory = (dir: string): void => {
    setBusy(true);
    void addWorkspace(dir).then((w) => {
      setBusy(false);
      if (w !== null) {
        rememberWorkspace(w.path);
        setWorkspaces((prev) => [...prev.filter((x) => x.id !== w.id), w]);
      }
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

  const runCommand = (name: string): void => {
    if (name === "permission") {
      setSheet("permission");
      return;
    }
    if (name === "model") {
      setSheet("model");
      return;
    }
    if (isNew) {
      if (name === "export" || name === "feedback" || name === "goal") {
        showToast(`/${name} 暂未实现`, "info");
        return;
      }
      setText(`/${name} `);
    } else {
      if (name === "export" || name === "feedback" || name === "goal") {
        showToast(`/${name} 暂未实现`, "info");
        return;
      }
      sendMessage(`/${name}`);
      showToast(`已执行 /${name}`, "info");
    }
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
      // 当前模型不支持视觉时提示（vision-exp 等带 image 输入模态的模型可理解图片）
      const current = models.find((m) => m.id === modelFull);
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

  return (
    <View
      style={[
        isNew ? styles.rootNew : styles.containerSession,
        { backgroundColor: palette.background },
      ]}
    >
      <KeyboardAvoidingView
        style={isNew ? styles.kavCenter : styles.kavDock}
        /* session 的键盘避让由 ConversationScreen 根部 KAV 统一处理（避免双层 padding）；
           底部安全区由 App.tsx 全局 SafeAreaView 统一处理 */
        behavior={isNew && Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* 空态引导：问候 + 起点 chips（开始输入即收起） */}
        {isNew && helloVisible && (
          <View style={styles.hello}>
            <Text style={[styles.helloTitle, { color: palette.text }]}>
              今天想构建什么？
            </Text>
            <View style={styles.helloChips}>
              {HELLO_CHIPS.map((chip) => (
                <Pressable
                  key={chip.label}
                  style={({ pressed }) => [
                    styles.helloChip,
                    { backgroundColor: palette.surface },
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={() => applyHelloChip(chip.fill)}
                >
                  <Text
                    style={[styles.helloChipText, { color: palette.text }]}
                    numberOfLines={1}
                  >
                    {chip.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* 卡外选择器（new）：电脑 / 工作区 / 模式，Ghost 轻量化 */}
        {isNew && (
          <View style={styles.ghostRow}>
            <GhostChip
              icon="monitor"
              label={activeWorkerName}
              onPress={() => setSheet("worker")}
            />
            <GhostChip
              icon="folder"
              label={pathLabel}
              onPress={() => setSheet("project")}
            />
            <GhostChip
              icon="crown"
              label={modeName}
              onPress={() => setSheet("mode")}
            />
          </View>
        )}

        {/* session 空闲：单行胶囊 Dock，点按展开 */}
        {docked ? (
          <Pressable
            style={({ pressed }) => [
              styles.dock,
              { backgroundColor: palette.surface },
              pressed && { opacity: 0.92 },
            ]}
            onPress={expandDock}
            accessibilityLabel="输入消息"
          >
            <View
              style={[
                styles.plusButton,
                { backgroundColor: palette.surfaceMuted },
              ]}
            >
              <AppIcon name="plus" color={palette.text} size={16} />
            </View>
            <Text
              style={[styles.dockPlaceholder, { color: palette.textSecondary }]}
              numberOfLines={1}
            >
              输入消息…
            </Text>
            {showStop ? (
              <StopButton onPress={() => void stopTurn()} />
            ) : (
              <SendButton canSend={false} onPress={() => {}} />
            )}
          </Pressable>
        ) : (
          /* 展开卡：new 常驻居中；session 聚焦或已输入时呈现 */
          <View style={[styles.card, { backgroundColor: palette.surface }]}>
            <View style={styles.textAreaWrap}>
              {parsed.name !== null && (
                <View style={styles.overlay} pointerEvents="none">
                  <Text style={styles.overlayLine}>
                    <Text style={[styles.cmdName, { color: palette.warning }]}>
                      /{parsed.name}{" "}
                    </Text>
                    {parsed.body.length === 0 ? (
                      <Text
                        style={[styles.cmdHint, { color: palette.textSecondary }]}
                      >
                        {parsed.placeholder}
                      </Text>
                    ) : (
                      <Text style={[styles.cmdBody, { color: palette.text }]}>
                        {parsed.body}
                      </Text>
                    )}
                  </Text>
                </View>
              )}
              <TextInput
                ref={inputRef}
                style={[
                  styles.textInput,
                  { color: parsed.name !== null ? "transparent" : palette.text },
                ]}
                placeholder={
                  parsed.name !== null
                    ? ""
                    : isNew
                      ? "描述你想要构建的内容"
                      : "输入消息，/ 唤起命令"
                }
                placeholderTextColor={palette.textSecondary}
                value={text}
                onChangeText={setText}
                onFocus={() => {
                  setFocused(true);
                  if (!dockExpanded) setDockExpanded(true);
                }}
                onBlur={() => {
                  setFocused(false);
                  if (inputEmpty) {
                    animateLayout();
                    setDockExpanded(false);
                  }
                }}
                multiline
                numberOfLines={1}
              />
            </View>
          {images.length > 0 && (
            <ScrollView
              horizontal
              style={styles.thumbRow}
              contentContainerStyle={{ gap: spacing.x2 }}
              showsHorizontalScrollIndicator={false}
            >
              {images.map((img, i) => (
                <View key={i} style={styles.thumbWrap}>
                  <Image
                    source={{ uri: `data:${img.mime};base64,${img.base64}` }}
                    style={styles.thumb}
                    accessibilityLabel="待发送图片"
                  />
                  <Pressable
                    style={[
                      styles.thumbRemove,
                      { backgroundColor: palette.error },
                    ]}
                    onPress={() =>
                      setImages((prev) => prev.filter((_, j) => j !== i))
                    }
                    hitSlop={6}
                  >
                    <AppIcon name="close" color="#FFFFFF" size={10} />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}
            <View style={styles.toolRow}>
              <View style={styles.actionLeft}>
                <Pressable
                  style={({ pressed }) => [
                    styles.plusButton,
                    { backgroundColor: palette.surfaceMuted },
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={() => setSheet("commands")}
                  accessibilityLabel="更多功能"
                >
                  <AppIcon name="plus" color={palette.text} size={16} />
                </Pressable>
                <ToolPill
                  icon={currentPerm.icon}
                  label={permissionLabel}
                  danger={currentPerm.danger === true}
                  onPress={() => setSheet("permission")}
                />
                {/* 模型 + 思考档合并入口：点开 ModelSheet 一处选齐 */}
                <ToolPill
                  icon="sparkles"
                  label={modelPillLabel}
                  active={isNew && reasoning !== "off"}
                  onPress={() => setSheet("model")}
                />
              </View>
              <View style={styles.actionRight}>
                {showStop ? (
                  <StopButton onPress={() => void stopTurn()} />
                ) : (
                  <SendButton canSend={canSend} onPress={() => void submit()} />
                )}
              </View>
            </View>
          </View>
        )}

        {/* 卡下信息带（仅 session）：右 = 上下文/速率/排队（→用量 Sheet）。
            模型入口已并入卡内工具行的模型 pill */}
        {!isNew && (usedTokens > 0 || pendingQueue.length > 0) && (
          <View style={[styles.infoLine, styles.infoLineEnd]}>
            <Pressable
              style={styles.infoSeg}
              onPress={() => setContextOpen(true)}
              hitSlop={4}
            >
              <ContextDot pct={contextPct} />
              <Text
                style={[
                  styles.infoText,
                  {
                    color:
                      contextPct > 0.9
                        ? palette.warning
                        : palette.textSecondary,
                  },
                ]}
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
          setDefaults({ provider: "deepseek-official", model: m.id });
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
          style={[styles.centerScrim, { backgroundColor: palette.scrim }]}
          onPress={() => setFullAccessConfirm(false)}
        >
          <Pressable
            style={[styles.confirmCard, { backgroundColor: palette.surface }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.confirmHeader}>
              <Text style={[styles.confirmTitle, { color: palette.text }]}>
                确认启用 Full access?
              </Text>
              <Pressable
                onPress={() => setFullAccessConfirm(false)}
                hitSlop={8}
              >
                <AppIcon name="close" color={palette.textSecondary} size={16} />
              </Pressable>
            </View>
            <View style={styles.riskRow}>
              <View
                style={[
                  styles.riskIcon,
                  { backgroundColor: palette.warningSoft },
                ]}
              >
                <AppIcon name="alert" color={palette.warning} size={20} />
              </View>
              <Text style={[styles.riskText, { color: palette.textSecondary }]}>
                启用 Full access 后，agent
                将减少确认步骤，并可直接执行敏感操作、文件修改或外部命令。仅建议在信任当前任务时使用。
              </Text>
            </View>
            <Pressable
              style={styles.checkRow}
              onPress={() => setRiskAck(!riskAck)}
            >
              <View
                style={[
                  styles.checkBox,
                  {
                    borderColor: riskAck ? palette.brand : palette.border,
                    backgroundColor: riskAck ? palette.brand : "transparent",
                  },
                ]}
              >
                {riskAck && <AppIcon name="check" color="#FFFFFF" size={12} />}
              </View>
              <Text style={[styles.checkText, { color: palette.text }]}>
                我已了解风险，并愿意继续
              </Text>
            </Pressable>
            <View style={styles.confirmActions}>
              <Pressable
                style={({ pressed }) => [
                  styles.cancelButton,
                  { borderColor: palette.border },
                  pressed && { opacity: 0.7 },
                ]}
                onPress={() => setFullAccessConfirm(false)}
              >
                <Text style={[styles.cancelText, { color: palette.text }]}>
                  取消
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.enableButton,
                  {
                    backgroundColor: riskAck
                      ? palette.text
                      : palette.surfaceMuted,
                  },
                  pressed && riskAck && { opacity: 0.85 },
                ]}
                disabled={!riskAck}
                onPress={() => {
                  setPermissionState("danger-full-access");
                  setFullAccessConfirm(false);
                }}
              >
                <Text
                  style={[
                    styles.enableText,
                    {
                      color: riskAck ? palette.surface : palette.textSecondary,
                    },
                  ]}
                >
                  启用 Full access
                </Text>
              </Pressable>
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
    </View>
  );
}

function SendButton(
  props: Readonly<{ canSend: boolean; onPress: () => void }>,
): React.JSX.Element {
  const { palette } = usePreferences();
  return (
    <Pressable
      style={({ pressed }) => [
        styles.send,
        {
          backgroundColor: props.canSend ? palette.brand : palette.surfaceMuted,
        },
        pressed && props.canSend && { transform: [{ scale: 0.92 }] },
      ]}
      onPress={props.onPress}
      disabled={!props.canSend}
      accessibilityLabel="发送"
    >
      <AppIcon
        name="arrow-up"
        color={props.canSend ? "#FFFFFF" : palette.textSecondary}
        size={18}
      />
    </Pressable>
  );
}

/** 运行中的停止按钮（红圆 + 白色实心方块），只停当前 turn。 */
function StopButton(
  props: Readonly<{ onPress: () => void }>,
): React.JSX.Element {
  const { palette } = usePreferences();
  return (
    <Pressable
      style={({ pressed }) => [
        styles.send,
        { backgroundColor: palette.error },
        pressed && { transform: [{ scale: 0.92 }] },
      ]}
      onPress={props.onPress}
      accessibilityLabel="停止"
    >
      <View style={styles.stopSquare} />
    </Pressable>
  );
}

/** 工具行 pill 开关：inactive 灰面 / active 品牌软底；danger 用警示红。 */
function ToolPill(props: Readonly<{
  icon: IconName;
  label: string;
  active?: boolean;
  danger?: boolean;
  onPress: () => void;
}>): React.JSX.Element {
  const { palette } = usePreferences();
  const color =
    props.danger === true
      ? palette.error
      : props.active === true
        ? palette.brand
        : palette.text;
  return (
    <Pressable
      style={({ pressed }) => [
        styles.toolPill,
        {
          backgroundColor:
            props.active === true ? palette.brandSoft : palette.surfaceMuted,
        },
        pressed && { opacity: 0.75 },
      ]}
      onPress={props.onPress}
      accessibilityRole="button"
    >
      <AppIcon name={props.icon} color={color} size={13} />
      <Text style={[styles.toolPillText, { color }]} numberOfLines={1}>
        {props.label}
      </Text>
    </Pressable>
  );
}

/** 卡外 Ghost 选择器（new 模式）：透明底、次级色，视觉降噪。 */
function GhostChip(
  props: Readonly<{ icon: IconName; label: string; onPress: () => void }>,
): React.JSX.Element {
  const { palette } = usePreferences();
  return (
    <Pressable
      style={({ pressed }) => [
        styles.ghostChip,
        pressed && { backgroundColor: palette.surfaceMuted },
      ]}
      onPress={props.onPress}
    >
      <AppIcon name={props.icon} color={palette.textSecondary} size={12} />
      <Text
        style={[styles.ghostChipText, { color: palette.textSecondary }]}
        numberOfLines={1}
      >
        {props.label}
      </Text>
      <AppIcon name="chevron-down" color={palette.textSecondary} size={10} />
    </Pressable>
  );
}

/** InfoLine 的迷你上下文环（12px）。 */
function ContextDot(props: Readonly<{ pct: number }>): React.JSX.Element {
  const { palette } = usePreferences();
  const r = 7;
  const circ = 2 * Math.PI * r;
  return (
    <Svg width={13} height={13} viewBox="0 0 20 20">
      <Circle
        cx="10"
        cy="10"
        r={r}
        stroke={palette.border}
        strokeWidth="2.5"
        fill="none"
      />
      <Circle
        cx="10"
        cy="10"
        r={r}
        stroke={props.pct > 0.9 ? palette.warning : palette.brand}
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
  const { palette } = usePreferences();
  return (
    <Pressable
      style={({ pressed }) => [
        styles.sheetRow,
        { backgroundColor: props.selected ? palette.brandSoft : "transparent" },
        pressed && { opacity: 0.7 },
      ]}
      onPress={props.onPress}
    >
      {props.icon !== undefined && (
        <AppIcon
          name={props.icon}
          color={props.selected ? palette.brand : palette.textSecondary}
          size={14}
        />
      )}
      <View style={{ flex: 1 }}>
        <Text
          style={[
            styles.sheetRowLabel,
            { color: props.selected ? palette.brand : palette.text },
          ]}
          numberOfLines={1}
        >
          {props.label}
        </Text>
        {props.sub !== undefined && (
          <Text
            style={[styles.sheetRowSub, { color: palette.textSecondary }]}
            numberOfLines={1}
          >
            {props.sub}
          </Text>
        )}
      </View>
      {props.selected && (
        <AppIcon name="check" color={palette.brand} size={14} />
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
  const { palette } = usePreferences();
  return (
    <Sheet
      visible={props.visible}
      title="选择电脑"
      onClose={props.onClose}
      scrollable
      snapPoints={["50%", "85%"]}
      // 默认半屏（1/2），可拖到 85%
    >
      {props.workers.map((worker) => {
        const active = worker.workerId === props.activeWorkerId;
        return (
          <Pressable
            key={worker.workerId}
            style={[
              styles.modelRow,
              { borderColor: active ? palette.brand : palette.border },
            ]}
            onPress={() => props.onPick(worker.workerId)}
          >
            <View style={{ flex: 1 }}>
              <Text
                style={[styles.modelName, { color: palette.text }]}
                numberOfLines={1}
              >
                {worker.name}
              </Text>
              <Text style={[styles.modelSub, { color: palette.textSecondary }]}>
                {worker.online ? "在线" : "离线"}
              </Text>
            </View>
            {active && <AppIcon name="check" color={palette.brand} size={16} />}
          </Pressable>
        );
      })}
      {props.workers.length === 0 && (
        <Text style={[styles.modeDesc, { color: palette.textSecondary }]}>
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
  const { palette } = usePreferences();
  return (
    <Sheet
      visible={props.visible}
      title="选择工作区项目"
      onClose={props.onClose}
      scrollable
      snapPoints={["66%", "92%"]}
      // 默认 2/3 屏，可拖到 92%
    >
      {props.workspaces.length === 0 && (
        <Text style={[styles.modeDesc, { color: palette.textSecondary }]}>
          还没有工作区，点下方「新建工作区」添加
        </Text>
      )}
      <View style={styles.sheetDivider} />
      <Pressable style={styles.addRow} onPress={props.onAdd}>
        <AppIcon name="plus" color={palette.brand} size={14} />
        <Text style={[styles.addText, { color: palette.brand }]}>
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
  const { palette } = usePreferences();
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
            style={({ pressed }) => [
              styles.modeCard,
              {
                backgroundColor: selected ? palette.brandSoft : palette.surface,
                borderColor: palette.border,
              },
              pressed && { opacity: 0.8 },
            ]}
            onPress={() => props.onPick(m.id, m.name)}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.modeName, { color: palette.text }]}>
                {m.name}
              </Text>
              <Text style={[styles.modeDesc, { color: palette.textSecondary }]}>
                {m.desc}
              </Text>
            </View>
            {selected && (
              <AppIcon name="check" color={palette.brand} size={16} />
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
  const { palette } = usePreferences();
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
              style={({ pressed }) => [
                styles.modeCard,
                {
                  backgroundColor: selected
                    ? palette.brandSoft
                    : palette.surface,
                  borderColor: palette.border,
                },
                pressed && { opacity: 0.8 },
              ]}
              onPress={() => props.onPick(p.id)}
            >
              <View
                style={[
                  styles.permIcon,
                  {
                    backgroundColor: selected
                      ? palette.brand
                      : palette.surfaceMuted,
                  },
                ]}
              >
                <AppIcon
                  name={p.icon}
                  color={selected ? "#FFFFFF" : palette.textSecondary}
                  size={14}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modeName, { color: palette.text }]}>
                  {p.name}
                </Text>
                <Text
                  style={[styles.modeDesc, { color: palette.textSecondary }]}
                >
                  {p.desc}
                </Text>
              </View>
              {selected && (
                <AppIcon name="check" color={palette.brand} size={16} />
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
            style={[
              styles.optionRow,
              { borderColor: selected ? palette.brand : palette.border },
            ]}
            onPress={() => {
              props.onClose();
              void setPermission(name);
            }}
          >
            <Text
              style={[
                styles.optionText,
                { color: selected ? palette.brand : palette.text },
              ]}
            >
              {label}
            </Text>
            {selected && (
              <AppIcon name="check" color={palette.brand} size={16} />
            )}
          </Pressable>
        );
      })}
      {names.length === 0 && (
        <Text style={[styles.modeDesc, { color: palette.textSecondary }]}>
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
      inputModalities?: readonly ("text" | "image")[];
    }[];
    modelFull: string;
    reasoning: string;
    showReasoning: boolean;
    onPickModel: (m: { id: string }) => void;
    onPickReasoning: (id: string) => void;
  }>,
): React.JSX.Element {
  const { palette } = usePreferences();
  return (
    <Sheet
      visible={props.visible}
      title="选择模型"
      onClose={props.onClose}
      scrollable
      snapPoints={["70%", "95%"]}
    >
      {!props.showReasoning && (
        <Text style={[styles.sheetHint, { color: palette.textSecondary }]}>
          模型与推理档将于下次新建会话时生效
        </Text>
      )}
      {props.showReasoning && (
      <View
        style={[styles.reasonBox, { backgroundColor: palette.surfaceMuted }]}
      >
        <Text style={[styles.reasonTitle, { color: palette.text }]}>
          推理 Thinking (CoT)
        </Text>
        <View style={styles.reasonSeg}>
          {REASONING.map((r) => {
            const sel = props.reasoning === r.id;
            return (
              <Pressable
                key={r.id}
                style={[
                  styles.reasonSegItem,
                  { backgroundColor: sel ? palette.surface : "transparent" },
                ]}
                onPress={() => props.onPickReasoning(r.id)}
              >
                <Text
                  style={[
                    styles.reasonLabel,
                    { color: sel ? palette.brand : palette.textSecondary },
                  ]}
                >
                  {r.label}
                </Text>
                <Text
                  style={[
                    styles.reasonSub,
                    { color: sel ? palette.brand : palette.textSecondary },
                  ]}
                >
                  {r.sub}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.reasonDesc, { color: palette.textSecondary }]}>
          {REASONING.find((r) => r.id === props.reasoning)?.desc}
        </Text>
      </View>
      )}
      {props.models.map((m) => {
        const selected = props.modelFull === m.id;
        return (
          <Pressable
            key={m.id}
            style={[
              styles.modelRow,
              { borderColor: selected ? palette.brand : palette.border },
            ]}
            onPress={() => props.onPickModel(m)}
          >
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.modelName,
                  { color: palette.text, fontFamily: "Menlo" },
                ]}
              >
                {m.id}
              </Text>
              {m.name !== undefined && m.name.length > 0 && (
                <Text
                  style={[styles.modelSub, { color: palette.textSecondary }]}
                >
                  {m.name}
                </Text>
              )}
            </View>
            {m.inputModalities?.includes("image") && (
              <View
                style={[styles.visionBadge, { backgroundColor: palette.brandSoft }]}
              >
                <AppIcon name="image" color={palette.brand} size={11} />
                <Text style={[styles.visionBadgeText, { color: palette.brand }]}>
                  视觉
                </Text>
              </View>
            )}
            {selected && (
              <AppIcon name="check" color={palette.brand} size={16} />
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
  const { palette } = usePreferences();
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
        <Text style={[styles.sheetHint, { color: palette.textSecondary }]}>
          上下文占用不可用（需活跃会话）
        </Text>
      ) : (
        <>
          <Text style={[styles.ctxPct, { color: palette.text }]}>
            上下文已用 {pct}%
          </Text>
          <Text
            style={[
              styles.ctxTotal,
              { color: palette.textSecondary, fontFamily: "Menlo" },
            ]}
          >
            ~{fmt(ctx.projectedTokens)} / {fmt(ctx.contextWindow)}
          </Text>
          <View style={[styles.ctxRow, { borderTopColor: palette.border }]}>
            <Text style={[styles.ctxLabel, { color: palette.textSecondary }]}>
              系统提示词
            </Text>
            <Text
              style={[
                styles.ctxValue,
                { color: palette.text, fontFamily: "Menlo" },
              ]}
            >
              ~{fmt(ctx.systemTokens)}
            </Text>
          </View>
          <View style={[styles.ctxRow, { borderTopColor: palette.border }]}>
            <Text style={[styles.ctxLabel, { color: palette.textSecondary }]}>
              工具
            </Text>
            <Text
              style={[
                styles.ctxValue,
                { color: palette.text, fontFamily: "Menlo" },
              ]}
            >
              ~{fmt(ctx.toolsTokens)}
            </Text>
          </View>
          <View style={[styles.ctxRow, { borderTopColor: palette.border }]}>
            <Text style={[styles.ctxLabel, { color: palette.textSecondary }]}>
              对话消息
            </Text>
            <Text
              style={[
                styles.ctxValue,
                { color: palette.text, fontFamily: "Menlo" },
              ]}
            >
              ~{fmt(ctx.messageTokens)}
            </Text>
          </View>
          {/* 运行统计（原底部 StatsLine 收纳于此） */}
          {stats.turns > 0 && (
            <>
              <View style={[styles.ctxRow, { borderTopColor: palette.border }]}>
                <Text style={[styles.ctxLabel, { color: palette.textSecondary }]}>
                  本会话运行
                </Text>
                <Text
                  style={[
                    styles.ctxValue,
                    { color: palette.text, fontFamily: "Menlo" },
                  ]}
                >
                  {stats.turns} 轮 · {stats.steps} 步
                </Text>
              </View>
              <View style={[styles.ctxRow, { borderTopColor: palette.border }]}>
                <Text style={[styles.ctxLabel, { color: palette.textSecondary }]}>
                  耗时 LLM / 工具
                </Text>
                <Text
                  style={[
                    styles.ctxValue,
                    { color: palette.text, fontFamily: "Menlo" },
                  ]}
                >
                  {fmtMs(stats.llmMs)} / {fmtMs(stats.toolMs)}
                </Text>
              </View>
              <View style={[styles.ctxRow, { borderTopColor: palette.border }]}>
                <Text style={[styles.ctxLabel, { color: palette.textSecondary }]}>
                  首 token / 速率
                </Text>
                <Text
                  style={[
                    styles.ctxValue,
                    { color: palette.text, fontFamily: "Menlo" },
                  ]}
                >
                  {fmtMs(stats.ttftSteps > 0 ? stats.ttftMs / stats.ttftSteps : 0)}
                  {stats.decodeMs > 0
                    ? ` · ${Math.round((stats.decodeTokens / stats.decodeMs) * 1000)} tok/s`
                    : ""}
                </Text>
              </View>
              {Number.isFinite(stats.cacheHitPct) && (
                <View style={[styles.ctxRow, { borderTopColor: palette.border }]}>
                  <Text style={[styles.ctxLabel, { color: palette.textSecondary }]}>
                    缓存命中
                  </Text>
                  <Text
                    style={[
                      styles.ctxValue,
                      { color: palette.text, fontFamily: "Menlo" },
                    ]}
                  >
                    {Math.round(stats.cacheHitPct)}%
                  </Text>
                </View>
              )}
              <View style={[styles.ctxRow, { borderTopColor: palette.border }]}>
                <Text style={[styles.ctxLabel, { color: palette.textSecondary }]}>
                  累计 tokens (in/out)
                </Text>
                <Text
                  style={[
                    styles.ctxValue,
                    { color: palette.text, fontFamily: "Menlo" },
                  ]}
                >
                  {fmt(totalUsage.input)} / {fmt(totalUsage.output)}
                </Text>
              </View>
            </>
          )}
        </>
      )}
    </Sheet>
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

const styles = StyleSheet.create({
  rootNew: { flex: 1 },
  containerSession: {
    justifyContent: "flex-end",
  },
  kavCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "stretch",
    paddingHorizontal: spacing.x4,
  },
  kavDock: {
    // 注意：不能加 flex:1（flexBasis 0 会在 auto 高度的根容器里被量成 0，
    // 导致 Dock/InfoLine 被推出屏幕）；session 根容器本身贴底自适应。
    // 底部安全区 padding 由渲染处按 insets 内联注入。
    justifyContent: "flex-end",
    paddingHorizontal: spacing.x3,
  },
  hello: {
    alignSelf: "stretch",
    paddingHorizontal: spacing.x1,
    marginBottom: spacing.x6,
  },
  helloTitle: {
    fontSize: 25,
    fontWeight: "800",
    letterSpacing: 0.3,
    marginBottom: 15,
  },
  helloChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.x2,
  },
  helloChip: {
    borderRadius: radii.round,
    paddingVertical: 9,
    paddingHorizontal: 15,
    shadowColor: "#0A0C10",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  helloChipText: { fontSize: 13, fontWeight: "500" },
  ghostRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.x1,
    paddingHorizontal: spacing.x3,
    marginBottom: spacing.x2,
    alignSelf: "stretch",
  },
  ghostChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 5,
    borderRadius: radii.round,
  },
  ghostChipText: { fontSize: 12, maxWidth: 130 },
  card: {
    alignSelf: "stretch",
    borderRadius: 26,
    padding: spacing.x3,
    backgroundColor: "#FFFFFF",
    shadowColor: "#0A0C10",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
    elevation: 3,
  },
  dock: {
    alignSelf: "stretch",
    borderRadius: radii.round,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.x2,
    paddingVertical: 7,
    paddingLeft: 9,
    paddingRight: 7,
    shadowColor: "#0A0C10",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
    elevation: 3,
  },
  dockPlaceholder: { flex: 1, fontSize: 15 },
  textAreaWrap: { minHeight: 44 },
  overlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: 2,
  },
  overlayLine: { fontSize: 15, lineHeight: 22, flexWrap: "wrap" },
  cmdName: { fontWeight: "700", fontSize: 15 },
  cmdHint: { fontSize: 15 },
  cmdBody: { fontSize: 15 },
  textInput: {
    fontSize: 16,
    minHeight: 44,
    maxHeight: 144,
    padding: 0,
    textAlignVertical: "top",
  },
  toolRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.x1,
  },
  thumbRow: {
    paddingHorizontal: spacing.x2,
    paddingTop: spacing.x2,
  },
  thumbWrap: { position: "relative" },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: radii.small,
    resizeMode: "cover",
  },
  thumbRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  visionBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: radii.round,
    marginRight: spacing.x2,
  },
  visionBadgeText: { fontSize: 10, fontWeight: "600" },
  actionLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.x2,
    flexShrink: 1,
  },
  actionRight: { flexDirection: "row", alignItems: "center", gap: spacing.x2 },
  plusButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  toolPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.round,
  },
  toolPillText: { fontSize: 13, fontWeight: "500" },
  infoLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.x3,
    paddingHorizontal: 20,
    paddingTop: 6,
    alignSelf: "stretch",
  },
  infoLineEnd: { justifyContent: "flex-end" },
  infoSeg: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minWidth: 0,
  },
  infoText: { fontSize: 11 },
  send: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  stopSquare: {
    width: 12,
    height: 12,
    borderRadius: 3,
    backgroundColor: "#FFFFFF",
  },
  sheetHint: { fontSize: 12, paddingBottom: spacing.x2 },
  sheetDivider: { height: StyleSheet.hairlineWidth, marginTop: spacing.x2 },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.x2,
    paddingVertical: spacing.x3,
  },
  addText: { fontSize: 14, fontWeight: "500" },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.x3,
    paddingVertical: spacing.x3,
    borderRadius: radii.control,
    paddingHorizontal: spacing.x2,
  },
  sheetRowLabel: { fontSize: 14, fontWeight: "500" },
  sheetRowSub: { fontSize: 11 },
  modeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.x3,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    padding: spacing.x3,
    marginBottom: spacing.x2,
  },
  modeName: { fontSize: 14, fontWeight: "700", marginBottom: 3 },
  modeDesc: { fontSize: 12, lineHeight: 17 },
  permIcon: {
    width: 32,
    height: 32,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  modelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.x2,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.control,
    padding: spacing.x3,
    marginBottom: spacing.x2,
  },
  modelName: { fontSize: 15, fontWeight: "600" },
  modelSub: { fontSize: 11, marginTop: 2 },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.x2,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.control,
    padding: spacing.x3,
    marginBottom: spacing.x2,
  },
  optionText: { fontSize: 15, flex: 1 },
  reasonBox: {
    borderRadius: 20,
    padding: spacing.x3,
    marginBottom: spacing.x3,
  },
  reasonTitle: { fontSize: 13, fontWeight: "600", marginBottom: spacing.x2 },
  reasonSeg: { flexDirection: "row", borderRadius: 12, overflow: "hidden" },
  reasonSegItem: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing.x2,
    borderRadius: 10,
  },
  reasonLabel: { fontSize: 12, fontWeight: "600" },
  reasonSub: { fontSize: 10 },
  reasonDesc: { fontSize: 11, marginTop: spacing.x2 },
  ctxPct: {
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
    marginTop: spacing.x2,
  },
  ctxTotal: {
    fontSize: 13,
    textAlign: "center",
    marginTop: spacing.x1,
    marginBottom: spacing.x3,
  },
  ctxRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.x2,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  ctxLabel: { fontSize: 14 },
  ctxValue: { fontSize: 14 },
  centerScrim: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.x6,
  },
  confirmCard: { alignSelf: "stretch", borderRadius: 24, padding: spacing.x5 },
  confirmHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: spacing.x3,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  confirmTitle: { fontSize: 17, fontWeight: "700" },
  riskRow: {
    flexDirection: "row",
    gap: spacing.x3,
    paddingVertical: spacing.x4,
  },
  riskIcon: {
    width: 44,
    height: 44,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  riskText: { flex: 1, fontSize: 14, lineHeight: 21 },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.x2,
    paddingVertical: spacing.x2,
  },
  checkBox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  checkText: { fontSize: 14, fontWeight: "600" },
  confirmActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.x3,
    paddingTop: spacing.x4,
    marginTop: spacing.x2,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cancelButton: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: spacing.x5,
    paddingVertical: spacing.x2,
  },
  cancelText: { fontSize: 14, fontWeight: "500" },
  enableButton: {
    borderRadius: 12,
    paddingHorizontal: spacing.x4,
    paddingVertical: spacing.x2,
  },
  enableText: { fontSize: 14, fontWeight: "600" },
});
