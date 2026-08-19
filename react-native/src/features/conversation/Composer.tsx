/**
 * 统一 Composer：new session 与 session 共用一个组件，通过 mode 控制功能显隐。
 *   - new：电脑/工作区/模式 chip + 输入卡（命令覆盖层）+ 命令/权限/模型；提交 = createSession + sendMessage
 *   - session：模式 chip + 输入框 + 命令/访问模式/模型；提交 = sendMessage（running 停止）
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { AppIcon, IconName } from "../../design-system/AppIcon";
import { Sheet } from "../../design-system/Sheet";
import { usePreferences } from "../../preferences/PreferencesProvider";
import { useApp } from "../../state/AppStore";
import { useDshStore } from "../../state/dshStore";
import { spacing, radii } from "../../theme/tokens";
import { readLastWorkspace, saveLastWorkspace } from "../../data/storage";
import { DirectoryPickerSheet } from "../workers/DirectoryPickerSheet";
import { CommandPaletteSheet } from "./CommandPaletteSheet";
import { ComposerInput } from "./ComposerInput";

const LOGO = require("../../../assets/brand/logo.png"); // eslint-disable-line @typescript-eslint/no-require-imports
const LOGO_DARK = require("../../../assets/brand/logo-dark.png"); // eslint-disable-line @typescript-eslint/no-require-imports

const MODES: ReadonlyArray<{ id: string; name: string; desc: string }> = [
  { id: "standard", name: "标准模式", desc: "功能完整的编码 Agent，支持文件编辑、Shell、文件与网页检索、Skills、计划、目标、子代理和工作流。" },
  { id: "code", name: "PTC 模式", desc: "具备标准模式的全部能力，并通过 Code Mode SDK 呈现工具，让模型用一个 TypeScript 程序组合多步操作。" },
  { id: "minimal", name: "极简模式", desc: "仅提供持久 bash 与 str_replace_editor 的双工具编码 Agent。" },
  { id: "cordis", name: "创造模式", desc: "用于创建自定义 Agent preset：具备标准模式的全部能力，并提供运行时检查、插件实验和 preset 创作指导。" },
];

const PERMISSIONS: ReadonlyArray<{ id: string; name: string; icon: IconName; desc: string; danger?: boolean }> = [
  { id: "read-only", name: "Read Only", icon: "lock", desc: "只读沙盒环境，仅支持检索与读取" },
  { id: "workspace-write", name: "Workspace Write", icon: "palette", desc: "允许在当前工作区内创建与编辑文件" },
  { id: "danger-full-access", name: "Full access", icon: "alert", desc: "包含全局 Shell 与系统最高执行权限", danger: true },
];

const REASONING: ReadonlyArray<{ id: string; label: string; sub: string; desc: string }> = [
  { id: "off", label: "Off", sub: "关", desc: "常规快速输出，不进行额外思维链推理" },
  { id: "low", label: "Low", sub: "轻度", desc: "轻度 Think，适合简单任务，响应更快" },
  { id: "high", label: "High", sub: "标准", desc: "开启标准 Think 思考，平衡速度与深度" },
  { id: "max", label: "Max", sub: "深度", desc: "启用超长 CoT 思考链，解决复杂逻辑算法" },
];

const FALLBACK_MODELS: ReadonlyArray<{ id: string; name?: string }> = [
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
];

const PRESET_LABELS: Readonly<Record<string, string>> = {
  standard: '标准', code: '代码编排', minimal: '极简', cordis: 'Cordis',
};
const PERMISSION_LABELS: Readonly<Record<string, string>> = {
  'workspace-write': '工作区可写', 'danger-full-access': '完全访问', 'read-only': '只读', custom: '自定义',
};
const CONTEXT_LIMITS: Readonly<Record<string, number>> = { 'deepseek-v4-flash': 128_000, 'deepseek-v4-pro': 128_000 };
const DEFAULT_CONTEXT_LIMIT = 128_000;

type SheetKind = "worker" | "project" | "mode" | "commands" | "permission" | "model" | null;

export function Composer(props: Readonly<{ mode: 'new' | 'session' }>): React.JSX.Element {
  const { palette, dark } = usePreferences();
  const { showToast } = useApp();
  const isNew = props.mode === 'new';

  // 共享 state
  const [text, setText] = useState("");
  const [sheet, setSheet] = useState<SheetKind>(null);
  // new 特有
  const [path, setPath] = useState("");
  const [workspaces, setWorkspaces] = useState<readonly { id: string; path: string; title: string }[]>([]);
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
  const [commandsCache, setCommandsCache] = useState<readonly { name: string; description: string }[]>([]);

  const sendMessage = useDshStore((s) => s.sendMessage);
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
  const running = useDshStore((s) => s.sessionView.agentStatus === 'running');
  const permissionCurrent = useDshStore((s) => s.sessionView.permissionCurrent);
  const totalUsage = useDshStore((s) => s.sessionView.totalUsage);
  const queueSend = useDshStore((s) => s.queueSend);
  const prevRunning = useRef(running);

  // new：加载工作区 + 沿用上次目录
  useEffect(() => {
    if (!isNew) return;
    void (async () => {
      const [list, last] = await Promise.all([listWorkspaces(), readLastWorkspace()]);
      setWorkspaces(list);
      const saved = last !== null ? list.find((w) => w.path === last) : undefined;
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

  const rememberWorkspace = (p: string): void => {
    setPath(p);
    void saveLastWorkspace(p);
  };

  // 内联命令联想（session）/ 命令覆盖层（new）
  const slashQuery = text.startsWith('/') && !text.includes(' ') ? text.slice(1).toLowerCase() : null;
  const suggestions = useMemo(() => {
    if (slashQuery === null) return [];
    return commandsCache.filter((c) => c.name.startsWith(slashQuery)).slice(0, 6);
  }, [slashQuery, commandsCache]);
  const parsed = useMemo(() => {
    if (!isNew || !text.startsWith('/')) return { name: null as string | null, body: "", placeholder: "" };
    const m = /^\/([a-zA-Z0-9_-]+)/.exec(text);
    if (m === null) return { name: null, body: "", placeholder: "" };
    const name = m[1]!.toLowerCase();
    const cmd = commandsCache.find((c) => c.name === name);
    return { name, body: text.slice(m[0].length).replace(/^\s+/, ""), placeholder: cmd?.description ?? "输入命令参数…" };
  }, [isNew, text, commandsCache]);

  const modeName = MODES.find((m) => m.id === (newSessionPreset.length > 0 ? newSessionPreset : "standard"))?.name ?? "标准模式";
  const perm = PERMISSIONS.find((p) => p.id === permission) ?? PERMISSIONS[1]!;
  const modelFull = newSessionDefaults?.model ?? "deepseek-v4-flash";
  const reasoningLabel = REASONING.find((r) => r.id === reasoning)?.label ?? "Off";
  const pathLabel = path.length > 0 ? path.split("/").filter(Boolean).pop() ?? path : "选择工作区";
  const activeWorkerName = workers.find((w) => w.workerId === activeWorkerId)?.name ?? '选择电脑';
  const models = modelCatalog.length > 0 ? modelCatalog : FALLBACK_MODELS;
  const presetLabel = PRESET_LABELS[newSessionPreset.length > 0 ? newSessionPreset : 'standard'] ?? '标准';
  const permissionLabel = isNew ? perm.name : (permissionCurrent !== null ? (PERMISSION_LABELS[permissionCurrent] ?? permissionCurrent) : '权限');

  const pickDirectory = (dir: string): void => {
    setBusy(true);
    void addWorkspace(dir).then((w) => {
      setBusy(false);
      if (w !== null) { rememberWorkspace(w.path); setWorkspaces((prev) => [...prev.filter((x) => x.id !== w.id), w]); }
    });
  };

  const choosePermission = (id: string): void => {
    setSheet(null);
    if (id === "danger-full-access") { setRiskAck(false); setFullAccessConfirm(true); return; }
    setPermissionState(id);
  };

  const runCommand = (name: string): void => {
    if (name === 'permission') { setSheet("permission"); return; }
    if (name === 'model') { setSheet("model"); return; }
    if (isNew) {
      if (name === 'export' || name === 'feedback' || name === 'goal') { showToast(`/${name} 暂未实现`, 'info'); return; }
      setText(`/${name} `);
    } else {
      if (name === 'export' || name === 'feedback' || name === 'goal') { showToast(`/${name} 暂未实现`, 'info'); return; }
      sendMessage(`/${name}`); showToast(`已执行 /${name}`, 'info');
    }
  };

  const submit = (): void => {
    const value = text.trim();
    if (value.length === 0) return;
    setText("");
    if (isNew) {
      if (path.length === 0 || busy) return;
      setBusy(true);
      void createSession(path, { reasoningEffort: reasoning, permission }).then(() => sendMessage(value)).finally(() => setBusy(false));
    } else {
      if (running && queueSend) { setPendingQueue((prev) => [...prev, value]); return; }
      void sendMessage(value);
    }
  };

  const canSend = isNew ? (text.trim().length > 0 && path.length > 0 && !busy) : text.trim().length > 0;

  // session：上下文圆环
  const usedTokens = totalUsage.input + totalUsage.output;
  const contextLimit = CONTEXT_LIMITS[modelFull] ?? DEFAULT_CONTEXT_LIMIT;
  const contextPct = Math.max(0, Math.min(1, usedTokens / contextLimit));
  const R = 7;
  const CIRC = 2 * Math.PI * R;

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      {isNew && (
        <View style={styles.titleRow}>
          <Image source={dark ? LOGO_DARK : LOGO} style={styles.logo} accessibilityLabel="掌鲸 DSH Pocket" />
          <Text style={[styles.title, { color: palette.text }]}>探索未至之境</Text>
          <View style={[styles.badge, { backgroundColor: palette.brandSoft }]}>
            <Text style={[styles.badgeText, { color: palette.brand }]}>预览版</Text>
          </View>
        </View>
      )}

      {/* chip 行：new 显示电脑/工作区/模式；session 只显示模式 */}
      <View style={styles.selectorRow}>
        {isNew && <Chip icon="home" label={activeWorkerName} onPress={() => setSheet("worker")} />}
        {isNew && <Chip icon="home" label={pathLabel} onPress={() => setSheet("project")} />}
        <Chip icon="crown" label={modeName} onPress={() => setSheet("mode")} />
      </View>

      {/* 输入区 */}
      {isNew ? (
        <View style={[styles.card, { backgroundColor: palette.surface, borderColor: focused ? palette.brand : palette.border }]}>
          <View style={styles.textAreaWrap}>
            {parsed.name !== null && (
              <View style={styles.overlay} pointerEvents="none">
                <Text style={styles.overlayLine}>
                  <Text style={[styles.cmdName, { color: palette.warning }]}>/{parsed.name} </Text>
                  {parsed.body.length === 0 ? (
                    <Text style={[styles.cmdHint, { color: palette.textSecondary }]}>{parsed.placeholder}</Text>
                  ) : (
                    <Text style={[styles.cmdBody, { color: palette.text }]}>{parsed.body}</Text>
                  )}
                </Text>
              </View>
            )}
            <TextInput
              style={[styles.textInput, { color: parsed.name !== null ? "transparent" : palette.text }]}
              placeholder={parsed.name !== null ? "" : "描述你想要构建的内容"}
              placeholderTextColor={palette.textSecondary}
              value={text}
              onChangeText={setText}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              multiline
              numberOfLines={1}
            />
          </View>
          <View style={[styles.actionBar, { borderTopColor: palette.border }]}>
            <View style={styles.actionLeft}>
              <Pressable style={({ pressed }) => [styles.plusButton, { backgroundColor: palette.surfaceMuted }, pressed && { opacity: 0.7 }]} onPress={() => setSheet("commands")}>
                <AppIcon name="plus" color={palette.text} size={16} />
              </Pressable>
              <Pressable style={styles.actionChip} onPress={() => setSheet("permission")}>
                <AppIcon name={perm.icon} color={perm.danger === true ? palette.error : palette.textSecondary} size={13} />
                <Text style={[styles.actionChipText, { color: palette.text }]} numberOfLines={1}>{perm.name}</Text>
                <Text style={[styles.chev, { color: palette.textSecondary }]}>▾</Text>
              </Pressable>
            </View>
            <View style={styles.actionRight}>
              <Pressable style={styles.actionChip} onPress={() => setSheet("model")}>
                <Text style={[styles.actionChipText, { color: palette.text, fontFamily: 'Menlo' }]}>{modelFull}</Text>
                <Text style={[styles.reasonTag, { color: palette.textSecondary }]}> {reasoningLabel}</Text>
                <Text style={[styles.chev, { color: palette.textSecondary }]}>▾</Text>
              </Pressable>
              <SendButton canSend={canSend} onPress={() => void submit()} />
            </View>
          </View>
        </View>
      ) : (
        <>
          {suggestions.length > 0 && (
            <View style={[styles.suggestBox, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              {suggestions.map((cmd) => (
                <Pressable key={cmd.name} style={({ pressed }) => [styles.suggestRow, pressed && { backgroundColor: palette.surfaceMuted }]} onPress={() => setText(`/${cmd.name} `)}>
                  <Text style={[styles.suggestName, { color: palette.brand, fontFamily: 'Menlo' }]}>/{cmd.name}</Text>
                  <Text style={[styles.suggestDesc, { color: palette.textSecondary }]} numberOfLines={1}>{cmd.description}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <ComposerInput text={text} onChangeText={setText} onSubmit={submit} onStop={() => void stopTurn()} running={running} canSend={canSend} />
          {(usedTokens > 0 || contextPct > 0) && (
            <Pressable style={styles.statsLine} onPress={() => setContextOpen(true)}>
              <Svg width={18} height={18} viewBox="0 0 20 20">
                <Circle cx="10" cy="10" r={R} stroke={palette.border} strokeWidth="2.5" fill="none" />
                <Circle cx="10" cy="10" r={R} stroke={contextPct > 0.9 ? palette.warning : palette.brand} strokeWidth="2.5" fill="none" strokeDasharray={`${CIRC * contextPct} ${CIRC}`} strokeLinecap="round" transform="rotate(-90 10 10)" />
              </Svg>
              <Text style={[styles.statsText, { color: contextPct > 0.9 ? palette.warning : palette.textSecondary }]}>{Math.round(contextPct * 100)}% 上下文</Text>
              <Text style={[styles.statsText, { color: palette.textSecondary }]}>{usedTokens > 0 ? ` · ${compact(usedTokens)} tok` : ''}</Text>
            </Pressable>
          )}
          <ContextUsageSheet visible={contextOpen} onClose={() => setContextOpen(false)} />
        </>
      )}

      {/* Sheets */}
      <CommandPaletteSheet visible={sheet === "commands"} onClose={() => setSheet(null)} onCommand={runCommand} />
      <WorkerSheet visible={sheet === "worker"} onClose={() => setSheet(null)} workers={workers} activeWorkerId={activeWorkerId} onPick={(id) => { openWorker(id); setSheet(null); }} />
      <ProjectSheet visible={sheet === "project"} onClose={() => setSheet(null)} workspaces={workspaces} selectedPath={path} onPick={(p) => { rememberWorkspace(p); setSheet(null); }} onAdd={() => { setSheet(null); setPicker(true); }} />
      <ModeSheet visible={sheet === "mode"} onClose={() => setSheet(null)} current={newSessionPreset} onPick={(id, name) => { setDefaults(null, id); showToast(`已切换模式：${name}`, 'info'); setSheet(null); }} />
      <PermissionSheet visible={sheet === "permission"} onClose={() => setSheet(null)} isNew={isNew} permission={permission} onPick={choosePermission} />
      <ModelSheet visible={sheet === "model"} onClose={() => setSheet(null)} models={models} modelFull={modelFull} reasoning={reasoning} onPickModel={(m) => { setDefaults({ provider: 'deepseek-official', model: m.id }); showToast(`已选模型 ${m.id}`, 'info'); }} onPickReasoning={setReasoning} />

      {/* Full access 确认 */}
      <Modal visible={fullAccessConfirm} transparent animationType="fade" onRequestClose={() => setFullAccessConfirm(false)}>
        <Pressable style={[styles.centerScrim, { backgroundColor: palette.scrim }]} onPress={() => setFullAccessConfirm(false)}>
          <Pressable style={[styles.confirmCard, { backgroundColor: palette.surface }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.confirmHeader}>
              <Text style={[styles.confirmTitle, { color: palette.text }]}>确认启用 Full access?</Text>
              <Pressable onPress={() => setFullAccessConfirm(false)} hitSlop={8}><AppIcon name="close" color={palette.textSecondary} size={16} /></Pressable>
            </View>
            <View style={styles.riskRow}>
              <View style={[styles.riskIcon, { backgroundColor: palette.warningSoft }]}><AppIcon name="alert" color={palette.warning} size={20} /></View>
              <Text style={[styles.riskText, { color: palette.textSecondary }]}>启用 Full access 后，agent 将减少确认步骤，并可直接执行敏感操作、文件修改或外部命令。仅建议在信任当前任务时使用。</Text>
            </View>
            <Pressable style={styles.checkRow} onPress={() => setRiskAck(!riskAck)}>
              <View style={[styles.checkBox, { borderColor: riskAck ? palette.brand : palette.border, backgroundColor: riskAck ? palette.brand : "transparent" }]}>{riskAck && <AppIcon name="check" color="#FFFFFF" size={12} />}</View>
              <Text style={[styles.checkText, { color: palette.text }]}>我已了解风险，并愿意继续</Text>
            </Pressable>
            <View style={styles.confirmActions}>
              <Pressable style={({ pressed }) => [styles.cancelButton, { borderColor: palette.border }, pressed && { opacity: 0.7 }]} onPress={() => setFullAccessConfirm(false)}><Text style={[styles.cancelText, { color: palette.text }]}>取消</Text></Pressable>
              <Pressable style={({ pressed }) => [styles.enableButton, { backgroundColor: riskAck ? palette.text : palette.surfaceMuted }, pressed && riskAck && { opacity: 0.85 }]} disabled={!riskAck} onPress={() => { setPermissionState("danger-full-access"); setFullAccessConfirm(false); }}><Text style={[styles.enableText, { color: riskAck ? palette.surface : palette.textSecondary }]}>启用 Full access</Text></Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <DirectoryPickerSheet visible={picker} onClose={() => setPicker(false)} onPicked={(dir) => pickDirectory(dir)} />
    </View>
  );
}

function SendButton(props: Readonly<{ canSend: boolean; onPress: () => void }>): React.JSX.Element {
  const { palette } = usePreferences();
  return (
    <Pressable style={({ pressed }) => [styles.send, { backgroundColor: props.canSend ? palette.brand : palette.surfaceMuted }, pressed && props.canSend && { transform: [{ scale: 0.92 }] }]} onPress={props.onPress} disabled={!props.canSend}>
      <AppIcon name="chevron-right" color={props.canSend ? "#FFFFFF" : palette.textSecondary} size={18} />
    </Pressable>
  );
}

function Chip(props: Readonly<{ icon: IconName; label: string; onPress: () => void }>): React.JSX.Element {
  const { palette } = usePreferences();
  return (
    <Pressable style={({ pressed }) => [styles.chip, { backgroundColor: palette.surfaceMuted }, pressed && { opacity: 0.75 }]} onPress={props.onPress}>
      <AppIcon name={props.icon} color={palette.textSecondary} size={14} />
      <Text style={[styles.chipText, { color: palette.text }]} numberOfLines={1}>{props.label}</Text>
      <Text style={[styles.chev, { color: palette.textSecondary }]}>▾</Text>
    </Pressable>
  );
}

function SheetRow(props: Readonly<{ selected: boolean; onPress: () => void; label: string; sub?: string; icon?: IconName }>): React.JSX.Element {
  const { palette } = usePreferences();
  return (
    <Pressable style={({ pressed }) => [styles.sheetRow, { backgroundColor: props.selected ? palette.brandSoft : "transparent" }, pressed && { opacity: 0.7 }]} onPress={props.onPress}>
      {props.icon !== undefined && <AppIcon name={props.icon} color={props.selected ? palette.brand : palette.textSecondary} size={14} />}
      <View style={{ flex: 1 }}>
        <Text style={[styles.sheetRowLabel, { color: props.selected ? palette.brand : palette.text }]} numberOfLines={1}>{props.label}</Text>
        {props.sub !== undefined && <Text style={[styles.sheetRowSub, { color: palette.textSecondary }]} numberOfLines={1}>{props.sub}</Text>}
      </View>
      {props.selected && <AppIcon name="check" color={palette.brand} size={14} />}
    </Pressable>
  );
}

function WorkerSheet(props: Readonly<{ visible: boolean; onClose: () => void; workers: readonly { workerId: string; name: string; online: boolean }[]; activeWorkerId: string | null; onPick: (id: string) => void }>): React.JSX.Element {
  const { palette } = usePreferences();
  return (
    <Sheet visible={props.visible} title="选择电脑" onClose={props.onClose} scrollable snapPoints={["50%", "85%"]}>
      {props.workers.map((worker) => {
        const active = worker.workerId === props.activeWorkerId;
        return (
          <Pressable key={worker.workerId} style={[styles.modelRow, { borderColor: active ? palette.brand : palette.border }]} onPress={() => props.onPick(worker.workerId)}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.modelName, { color: palette.text }]} numberOfLines={1}>{worker.name}</Text>
              <Text style={[styles.modelSub, { color: palette.textSecondary }]}>{worker.online ? '在线' : '离线'}</Text>
            </View>
            {active && <AppIcon name="check" color={palette.brand} size={16} />}
          </Pressable>
        );
      })}
      {props.workers.length === 0 && <Text style={[styles.modeDesc, { color: palette.textSecondary }]}>还没有电脑，请先在侧边栏配对</Text>}
    </Sheet>
  );
}

function ProjectSheet(props: Readonly<{ visible: boolean; onClose: () => void; workspaces: readonly { id: string; path: string; title: string }[]; selectedPath: string; onPick: (path: string) => void; onAdd: () => void }>): React.JSX.Element {
  const { palette } = usePreferences();
  return (
    <Sheet visible={props.visible} title="选择工作区项目" onClose={props.onClose} scrollable snapPoints={["50%", "85%"]}>
      {props.workspaces.map((w) => <SheetRow key={w.id} selected={props.selectedPath === w.path} onPress={() => props.onPick(w.path)} label={w.title} sub={w.path} icon="home" />)}
      {props.workspaces.length === 0 && <Text style={[styles.modeDesc, { color: palette.textSecondary }]}>还没有工作区，点下方「新建工作区」添加</Text>}
      <View style={styles.sheetDivider} />
      <Pressable style={styles.addRow} onPress={props.onAdd}>
        <AppIcon name="plus" color={palette.brand} size={14} />
        <Text style={[styles.addText, { color: palette.brand }]}>新建工作区（浏览电脑目录）</Text>
      </Pressable>
    </Sheet>
  );
}

function ModeSheet(props: Readonly<{ visible: boolean; onClose: () => void; current: string; onPick: (id: string, name: string) => void }>): React.JSX.Element {
  const { palette } = usePreferences();
  return (
    <Sheet visible={props.visible} title="选择运行模式" onClose={props.onClose} scrollable snapPoints={["65%", "92%"]}>
      {MODES.map((m) => {
        const selected = props.current === m.id || (props.current.length === 0 && m.id === "standard");
        return (
          <Pressable key={m.id} style={({ pressed }) => [styles.modeCard, { backgroundColor: selected ? palette.brandSoft : palette.surface, borderColor: palette.border }, pressed && { opacity: 0.8 }]} onPress={() => props.onPick(m.id, m.name)}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.modeName, { color: palette.text }]}>{m.name}</Text>
              <Text style={[styles.modeDesc, { color: palette.textSecondary }]}>{m.desc}</Text>
            </View>
            {selected && <AppIcon name="check" color={palette.brand} size={16} />}
          </Pressable>
        );
      })}
    </Sheet>
  );
}

function PermissionSheet(props: Readonly<{ visible: boolean; onClose: () => void; isNew: boolean; permission: string; onPick: (id: string) => void }>): React.JSX.Element {
  const { palette } = usePreferences();
  const setPermission = useDshStore((s) => s.setPermission);
  const [names, setNames] = useState<string[]>([]);
  const permissionOptions = useDshStore((s) => s.permissionOptions);
  const current = useDshStore((s) => s.sessionView.permissionCurrent);
  useEffect(() => { if (props.visible && !props.isNew) void permissionOptions().then((o) => setNames(o.names)); }, [props.visible, props.isNew, permissionOptions]);
  if (props.isNew) {
    return (
      <Sheet visible={props.visible} title="工作区权限设置" onClose={props.onClose} snapPoints={["55%"]}>
        {PERMISSIONS.map((p) => {
          const selected = props.permission === p.id;
          return (
            <Pressable key={p.id} style={({ pressed }) => [styles.modeCard, { backgroundColor: selected ? palette.brandSoft : palette.surface, borderColor: palette.border }, pressed && { opacity: 0.8 }]} onPress={() => props.onPick(p.id)}>
              <View style={[styles.permIcon, { backgroundColor: selected ? palette.brand : palette.surfaceMuted }]}><AppIcon name={p.icon} color={selected ? "#FFFFFF" : palette.textSecondary} size={14} /></View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modeName, { color: palette.text }]}>{p.name}</Text>
                <Text style={[styles.modeDesc, { color: palette.textSecondary }]}>{p.desc}</Text>
              </View>
              {selected && <AppIcon name="check" color={palette.brand} size={16} />}
            </Pressable>
          );
        })}
      </Sheet>
    );
  }
  return (
    <Sheet visible={props.visible} title="访问模式" onClose={props.onClose} snapPoints={["50%"]}>
      {names.map((name) => {
        const label = PERMISSION_LABELS[name] ?? name;
        const selected = current === name;
        return (
          <Pressable key={name} style={[styles.optionRow, { borderColor: selected ? palette.brand : palette.border }]} onPress={() => { props.onClose(); void setPermission(name); }}>
            <Text style={[styles.optionText, { color: selected ? palette.brand : palette.text }]}>{label}</Text>
            {selected && <AppIcon name="check" color={palette.brand} size={16} />}
          </Pressable>
        );
      })}
      {names.length === 0 && <Text style={[styles.modeDesc, { color: palette.textSecondary }]}>未取到档位目录（worker 需 m3 caps）</Text>}
    </Sheet>
  );
}

function ModelSheet(props: Readonly<{ visible: boolean; onClose: () => void; models: readonly { id: string; name?: string }[]; modelFull: string; reasoning: string; onPickModel: (m: { id: string }) => void; onPickReasoning: (id: string) => void }>): React.JSX.Element {
  const { palette } = usePreferences();
  return (
    <Sheet visible={props.visible} title="选择模型" onClose={props.onClose} scrollable snapPoints={["70%", "95%"]}>
      <View style={[styles.reasonBox, { backgroundColor: palette.surfaceMuted }]}>
        <Text style={[styles.reasonTitle, { color: palette.text }]}>推理 Thinking (CoT)</Text>
        <View style={styles.reasonSeg}>
          {REASONING.map((r) => {
            const sel = props.reasoning === r.id;
            return (
              <Pressable key={r.id} style={[styles.reasonSegItem, { backgroundColor: sel ? palette.surface : "transparent" }]} onPress={() => props.onPickReasoning(r.id)}>
                <Text style={[styles.reasonLabel, { color: sel ? palette.brand : palette.textSecondary }]}>{r.label}</Text>
                <Text style={[styles.reasonSub, { color: sel ? palette.brand : palette.textSecondary }]}>{r.sub}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.reasonDesc, { color: palette.textSecondary }]}>{REASONING.find((r) => r.id === props.reasoning)?.desc}</Text>
      </View>
      {props.models.map((m) => {
        const selected = props.modelFull === m.id;
        return (
          <Pressable key={m.id} style={[styles.modelRow, { borderColor: selected ? palette.brand : palette.border }]} onPress={() => props.onPickModel(m)}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.modelName, { color: palette.text, fontFamily: 'Menlo' }]}>{m.id}</Text>
              {m.name !== undefined && m.name.length > 0 && <Text style={[styles.modelSub, { color: palette.textSecondary }]}>{m.name}</Text>}
            </View>
            {selected && <AppIcon name="check" color={palette.brand} size={16} />}
          </Pressable>
        );
      })}
    </Sheet>
  );
}

function ContextUsageSheet(props: Readonly<{ visible: boolean; onClose: () => void }>): React.JSX.Element {
  const { palette } = usePreferences();
  const [ctx, setCtx] = useState<{ projectedTokens: number; contextWindow: number; systemTokens: number; toolsTokens: number; messageTokens: number } | null>(null);
  const activeSessionId = useDshStore((s) => s.activeSessionId);
  const sessionContext = useDshStore((s) => s.sessionContext);
  useEffect(() => { if (props.visible && activeSessionId !== null) void sessionContext(activeSessionId).then(setCtx); }, [props.visible, activeSessionId, sessionContext]);
  const pct = ctx !== null && ctx.contextWindow > 0 ? Math.round((ctx.projectedTokens / ctx.contextWindow) * 1000) / 10 : 0;
  const fmt = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));
  return (
    <Sheet visible={props.visible} title="上下文占用" onClose={props.onClose} snapPoints={["50%"]}>
      {ctx === null ? (
        <Text style={[styles.sheetHint, { color: palette.textSecondary }]}>上下文占用不可用（需活跃会话）</Text>
      ) : (
        <>
          <Text style={[styles.ctxPct, { color: palette.text }]}>上下文已用 {pct}%</Text>
          <Text style={[styles.ctxTotal, { color: palette.textSecondary, fontFamily: 'Menlo' }]}>~{fmt(ctx.projectedTokens)} / {fmt(ctx.contextWindow)}</Text>
          <View style={[styles.ctxRow, { borderTopColor: palette.border }]}><Text style={[styles.ctxLabel, { color: palette.textSecondary }]}>系统提示词</Text><Text style={[styles.ctxValue, { color: palette.text, fontFamily: 'Menlo' }]}>~{fmt(ctx.systemTokens)}</Text></View>
          <View style={[styles.ctxRow, { borderTopColor: palette.border }]}><Text style={[styles.ctxLabel, { color: palette.textSecondary }]}>工具</Text><Text style={[styles.ctxValue, { color: palette.text, fontFamily: 'Menlo' }]}>~{fmt(ctx.toolsTokens)}</Text></View>
          <View style={[styles.ctxRow, { borderTopColor: palette.border }]}><Text style={[styles.ctxLabel, { color: palette.textSecondary }]}>对话消息</Text><Text style={[styles.ctxValue, { color: palette.text, fontFamily: 'Menlo' }]}>~{fmt(ctx.messageTokens)}</Text></View>
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

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.x4 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.x2, marginBottom: spacing.x4 },
  logo: { width: 28, height: 28, borderRadius: 14 },
  title: { fontSize: 22, fontWeight: "700" },
  badge: { paddingHorizontal: spacing.x2, paddingVertical: 2, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: "500" },
  selectorRow: { flexDirection: "row", gap: spacing.x2, marginBottom: spacing.x3, alignSelf: "stretch", justifyContent: "center", flexWrap: "wrap" },
  chip: { flexDirection: "row", alignItems: "center", gap: spacing.x1, paddingHorizontal: spacing.x3, paddingVertical: spacing.x2, borderRadius: radii.control },
  chipText: { fontSize: 13, maxWidth: 130 },
  chev: { fontSize: 11 },
  card: { alignSelf: "stretch", borderRadius: 24, borderWidth: 1, padding: spacing.x3 },
  textAreaWrap: { minHeight: 80 },
  overlay: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, paddingVertical: 2 },
  overlayLine: { fontSize: 15, lineHeight: 22, flexWrap: "wrap" },
  cmdName: { fontWeight: "700", fontSize: 15 },
  cmdHint: { fontSize: 15 },
  cmdBody: { fontSize: 15 },
  textInput: { fontSize: 15, minHeight: 80, padding: 0, textAlignVertical: "top" },
  actionBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.x2, marginTop: spacing.x1 },
  actionLeft: { flexDirection: "row", alignItems: "center", gap: spacing.x2, flexShrink: 1 },
  actionRight: { flexDirection: "row", alignItems: "center", gap: spacing.x2 },
  plusButton: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  actionChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.x2, paddingVertical: spacing.x1, borderRadius: radii.small },
  actionChipText: { fontSize: 12, fontWeight: "500", maxWidth: 140 },
  reasonTag: { fontSize: 12 },
  send: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  suggestBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, marginBottom: spacing.x1, overflow: 'hidden' },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, paddingHorizontal: spacing.x3, paddingVertical: spacing.x2 },
  suggestName: { fontSize: 13 },
  suggestDesc: { flex: 1, fontSize: 12 },
  statsLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.x1, paddingVertical: spacing.x1 },
  statsText: { fontSize: 11 },
  sheetHint: { fontSize: 12, paddingBottom: spacing.x2 },
  sheetDivider: { height: StyleSheet.hairlineWidth, marginTop: spacing.x2 },
  addRow: { flexDirection: "row", alignItems: "center", gap: spacing.x2, paddingVertical: spacing.x3 },
  addText: { fontSize: 14, fontWeight: "500" },
  sheetRow: { flexDirection: "row", alignItems: "center", gap: spacing.x3, paddingVertical: spacing.x3, borderRadius: radii.control, paddingHorizontal: spacing.x2 },
  sheetRowLabel: { fontSize: 14, fontWeight: "500" },
  sheetRowSub: { fontSize: 11 },
  modeCard: { flexDirection: "row", alignItems: "center", gap: spacing.x3, borderWidth: StyleSheet.hairlineWidth, borderRadius: 20, padding: spacing.x3, marginBottom: spacing.x2 },
  modeName: { fontSize: 14, fontWeight: "700", marginBottom: 3 },
  modeDesc: { fontSize: 12, lineHeight: 17 },
  permIcon: { width: 32, height: 32, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  modelRow: { flexDirection: "row", alignItems: "center", gap: spacing.x2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, padding: spacing.x3, marginBottom: spacing.x2 },
  modelName: { fontSize: 15, fontWeight: "600" },
  modelSub: { fontSize: 11, marginTop: 2 },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, padding: spacing.x3, marginBottom: spacing.x2 },
  optionText: { fontSize: 15, flex: 1 },
  optionSub: { fontSize: 11, marginTop: 2 },
  reasonBox: { borderRadius: 20, padding: spacing.x3, marginBottom: spacing.x3 },
  reasonTitle: { fontSize: 13, fontWeight: "600", marginBottom: spacing.x2 },
  reasonSeg: { flexDirection: "row", borderRadius: 12, overflow: "hidden" },
  reasonSegItem: { flex: 1, alignItems: "center", paddingVertical: spacing.x2, borderRadius: 10 },
  reasonLabel: { fontSize: 12, fontWeight: "600" },
  reasonSub: { fontSize: 10 },
  reasonDesc: { fontSize: 11, marginTop: spacing.x2 },
  ctxPct: { fontSize: 22, fontWeight: '700', textAlign: 'center', marginTop: spacing.x2 },
  ctxTotal: { fontSize: 13, textAlign: 'center', marginTop: spacing.x1, marginBottom: spacing.x3 },
  ctxRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.x2, borderTopWidth: StyleSheet.hairlineWidth },
  ctxLabel: { fontSize: 14 },
  ctxValue: { fontSize: 14 },
  centerScrim: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.x6 },
  confirmCard: { alignSelf: "stretch", borderRadius: 24, padding: spacing.x5 },
  confirmHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.x3, borderBottomWidth: StyleSheet.hairlineWidth },
  confirmTitle: { fontSize: 17, fontWeight: "700" },
  riskRow: { flexDirection: "row", gap: spacing.x3, paddingVertical: spacing.x4 },
  riskIcon: { width: 44, height: 44, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  riskText: { flex: 1, fontSize: 14, lineHeight: 21 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: spacing.x2, paddingVertical: spacing.x2 },
  checkBox: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  checkText: { fontSize: 14, fontWeight: "600" },
  confirmActions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.x3, paddingTop: spacing.x4, marginTop: spacing.x2, borderTopWidth: StyleSheet.hairlineWidth },
  cancelButton: { borderWidth: 1, borderRadius: 12, paddingHorizontal: spacing.x5, paddingVertical: spacing.x2 },
  cancelText: { fontSize: 14, fontWeight: "500" },
  enableButton: { borderRadius: 12, paddingHorizontal: spacing.x4, paddingVertical: spacing.x2 },
  enableText: { fontSize: 14, fontWeight: "600" },
});
