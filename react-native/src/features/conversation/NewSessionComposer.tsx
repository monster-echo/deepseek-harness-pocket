/**
 * 新建会话首屏（按 2026-08 设计稿重写）：
 * 鲸鱼 Logo 标题 · 项目/模式胶囊 · 大圆角输入卡（/命令覆盖层 + 发送上箭头）
 * · ＋命令 · 权限（Full access 风险确认）· 模型+推理档
 * 发送首条消息 = 创建会话（模型/模式/推理档/权限全生效）并发送。
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { AppIcon, IconName } from "../../design-system/AppIcon";
import { usePreferences } from "../../preferences/PreferencesProvider";
import { useDshStore } from "../../state/dshStore";
import { spacing, radii } from "../../theme/tokens";
import { DirectoryPickerSheet } from "../workers/DirectoryPickerSheet";

// ---------- 静态目录（展示名 → dsh 标识） ----------

/** 模式（设计稿命名；ptc→dsh code、creative→dsh cordis） */
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
  { id: "high", label: "On", sub: "标准推理", desc: "开启标准 Think 思考，平衡速度与深度" },
  { id: "max", label: "Deep", sub: "深度思考", desc: "启用超长 CoT 思考链，解决复杂逻辑算法" },
];

const COMMAND_KINDS: Readonly<Record<string, "direct" | "text" | "modal">> = {
  compact: "direct", export: "direct", feedback: "text", goal: "text",
  permission: "modal", plan: "text", model: "modal",
}

type SheetKind = "project" | "mode" | "commands" | "permission" | "model" | null

export function NewSessionComposer(
  props: Readonly<{
    onOpenMenu: (tab: "permission" | "model" | "preset" | "commands") => void;
  }>,
): React.JSX.Element {
  const { palette } = usePreferences();
  const [text, setText] = useState("");
  const [path, setPath] = useState("");
  const [workspaces, setWorkspaces] = useState<readonly { id: string; path: string; title: string }[]>([]);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const [commands, setCommands] = useState<readonly { name: string; description: string }[]>([]);
  // 权限（新建会话时经 permission preset 生效）
  const [permission, setPermission] = useState("workspace-write");
  const [fullAccessConfirm, setFullAccessConfirm] = useState(false);
  const [riskAck, setRiskAck] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [reasoning, setReasoning] = useState("off");

  const createSession = useDshStore((s) => s.createSession);
  const sendMessage = useDshStore((s) => s.sendMessage);
  const addWorkspace = useDshStore((s) => s.addWorkspace);
  const listWorkspaces = useDshStore((s) => s.listWorkspaces);
  const listCommands = useDshStore((s) => s.listCommands);
  const setDefaults = useDshStore((s) => s.setNewSessionDefaults);
  const newSessionDefaults = useDshStore((s) => s.newSessionDefaults);
  const newSessionPreset = useDshStore((s) => s.newSessionPreset);

  useEffect(() => {
    void listWorkspaces().then((list) => {
      setWorkspaces(list);
      const first = list[0];
      if (first !== undefined && path.length === 0) setPath(first.path);
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listWorkspaces])
  useEffect(() => {
    void listCommands().then(setCommands)
  }, [listCommands])

  const showToast = (msg: string): void => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  // /命令解析（设计稿覆盖层）
  const parsed = useMemo(() => {
    if (!text.startsWith("/")) return { name: null as string | null, body: "" , placeholder: "" }
    const m = /^\/([a-zA-Z0-9_-]+)/.exec(text)
    if (m === null) return { name: null, body: "", placeholder: "" }
    const name = m[1]!.toLowerCase()
    const cmd = commands.find((c) => c.name === name)
    return {
      name,
      body: text.slice(m[0].length).replace(/^\s+/, ""),
      placeholder: cmd?.description ?? "输入命令参数…",
    }
  }, [text, commands])

  const modeName = MODES.find((m) => m.id === (newSessionPreset.length > 0 ? newSessionPreset : "standard"))?.name ?? "标准模式"
  const perm = PERMISSIONS.find((p) => p.id === permission) ?? PERMISSIONS[1]!
  const modelShort = (newSessionDefaults?.model ?? "deepseek-v4-flash").replace("deepseek-", "")
  const reasoningLabel = REASONING.find((r) => r.id === reasoning)?.label ?? "Off"
  const pathLabel = path.length > 0 ? path.split("/").filter(Boolean).pop() ?? path : "选择工作区"

  const pickDirectory = (dir: string): void => {
    setBusy(true)
    void addWorkspace(dir).then((w) => {
      setBusy(false)
      if (w !== null) {
        setPath(w.path)
        setWorkspaces((prev) => [...prev.filter((x) => x.id !== w.id), w])
      }
    })
  }

  const choosePermission = (id: string): void => {
    setSheet(null)
    if (id === "danger-full-access") {
      setRiskAck(false)
      setFullAccessConfirm(true)
      return
    }
    setPermission(id)
  }

  const commandTap = (name: string): void => {
    const kind = COMMAND_KINDS[name] ?? "text"
    setSheet(null)
    if (kind === "direct") {
      showToast(`已执行 /${name}`)
      setPath(path)
      setText("")
      return
    }
    if (name === "permission") { setSheet("permission"); setText(""); return }
    if (name === "model") { setSheet("model"); setText(""); return }
    setText(`/${name} `)
  }

  const submit = (): Promise<void> => {
    const value = text.trim()
    if (value.length === 0 || path.length === 0 || busy) return Promise.resolve()
    setBusy(true)
    setText("")
    return createSession(path)
      .then(() => sendMessage(value))
      .finally(() => setBusy(false))
  }

  const canSend = text.trim().length > 0 && path.length > 0 && !busy

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      {/* Toast */}
      {toast !== null && (
        <View style={[styles.toast, { backgroundColor: palette.text }]} pointerEvents="none">
          <Text style={[styles.toastText, { color: palette.surface }]}>{toast}</Text>
        </View>
      )}

      {/* 标题 */}
      <View style={styles.titleRow}>
        <View style={[styles.logoDot, { backgroundColor: palette.brand }]} />
        <Text style={[styles.title, { color: palette.text }]}>探索未至之境</Text>
        <View style={[styles.badge, { backgroundColor: palette.brandSoft }]}>
          <Text style={[styles.badgeText, { color: palette.brand }]}>预览版</Text>
        </View>
      </View>

      {/* 项目 / 模式 胶囊 */}
      <View style={styles.selectorRow}>
        <Chip icon="home" label={pathLabel} onPress={() => setSheet("project")} />
        <Chip icon="crown" label={modeName} onPress={() => setSheet("mode")} />
      </View>

      {/* 输入卡 */}
      <View
        style={[
          styles.card,
          {
            backgroundColor: palette.surface,
            borderColor: focused ? palette.brand : palette.border,
          },
        ]}
      >
        {/* 文本区 + 命令覆盖层 */}
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
            style={[
              styles.textInput,
              { color: parsed.name !== null ? "transparent" : palette.text },
            ]}
            placeholder={parsed.name !== null ? "" : "描述你想要构建的内容"}
            placeholderTextColor={palette.textSecondary}
            value={text}
            onChangeText={setText}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            multiline
          />
        </View>

        {/* 底部操作栏 */}
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
              <Text style={[styles.actionChipText, { color: palette.text }]}>{modelShort}</Text>
              <Text style={[styles.reasonTag, { color: palette.textSecondary }]}> {reasoningLabel}</Text>
              <Text style={[styles.chev, { color: palette.textSecondary }]}>▾</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.send,
                { backgroundColor: canSend ? palette.brand : palette.surfaceMuted },
                pressed && canSend && { transform: [{ scale: 0.92 }] },
              ]}
              onPress={() => void submit()}
              disabled={!canSend}
            >
              <AppIcon name="chevron-right" color={canSend ? "#FFFFFF" : palette.textSecondary} size={18} />
            </Pressable>
          </View>
        </View>
      </View>

      {/* ===== Bottom Sheets ===== */}
      <BottomSheet visible={sheet === "project"} title="选择工作区项目" onClose={() => setSheet(null)}>
        {workspaces.map((w) => (
          <SheetRow key={w.id} selected={path === w.path} onPress={() => { setPath(w.path); setSheet(null) }} label={w.title} sub={w.path} icon="home" />
        ))}
        <View style={styles.sheetDivider} />
        <Pressable style={styles.addRow} onPress={() => { setSheet(null); setPicker(true) }}>
          <AppIcon name="plus" color={palette.brand} size={14} />
          <Text style={[styles.addText, { color: palette.brand }]}>浏览电脑目录添加…</Text>
        </Pressable>
      </BottomSheet>

      <BottomSheet visible={sheet === "mode"} title="选择运行模式" onClose={() => setSheet(null)}>
        {MODES.map((m) => (
          <Pressable
            key={m.id}
            style={({ pressed }) => [
              styles.modeCard,
              {
                backgroundColor: newSessionPreset === m.id || (newSessionPreset.length === 0 && m.id === "standard") ? palette.brandSoft : palette.surface,
                borderColor: palette.border,
              },
              pressed && { opacity: 0.8 },
            ]}
            onPress={() => { setDefaults(null, m.id); setSheet(null) }}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.modeName, { color: palette.text }]}>{m.name}</Text>
              <Text style={[styles.modeDesc, { color: palette.textSecondary }]}>{m.desc}</Text>
            </View>
            {(newSessionPreset === m.id || (newSessionPreset.length === 0 && m.id === "standard")) && (
              <AppIcon name="check" color={palette.brand} size={16} />
            )}
          </Pressable>
        ))}
      </BottomSheet>

      <BottomSheet visible={sheet === "commands"} title="快捷命令" onClose={() => setSheet(null)}>
        {commands.map((cmd) => {
          const kind = COMMAND_KINDS[cmd.name] ?? "text"
          return (
            <Pressable key={cmd.name} style={({ pressed }) => [styles.cmdRow, pressed && { opacity: 0.7 }]} onPress={() => commandTap(cmd.name)}>
              <Text style={[styles.cmdName2, { color: palette.warning }]}>/{cmd.name}</Text>
              <Text style={[styles.cmdDesc, { color: palette.textSecondary }]} numberOfLines={1}>{cmd.description}</Text>
              {kind === "modal" ? (
                <View style={[styles.kindBadge, { backgroundColor: palette.brandSoft }]}>
                  <Text style={[styles.kindText, { color: palette.brand }]}>设置</Text>
                </View>
              ) : (
                <Text style={[styles.chev, { color: palette.textSecondary }]}>›</Text>
              )}
            </Pressable>
          )
        })}
      </BottomSheet>

      <BottomSheet visible={sheet === "permission"} title="工作区权限设置" onClose={() => setSheet(null)}>
        {PERMISSIONS.map((p) => {
          const selected = permission === p.id
          return (
            <Pressable
              key={p.id}
              style={({ pressed }) => [
                styles.modeCard,
                { backgroundColor: selected ? palette.brandSoft : palette.surface, borderColor: palette.border },
                pressed && { opacity: 0.8 },
              ]}
              onPress={() => choosePermission(p.id)}
            >
              <View style={[styles.permIcon, { backgroundColor: selected ? palette.brand : palette.surfaceMuted }]}>
                <AppIcon name={p.icon} color={selected ? "#FFFFFF" : palette.textSecondary} size={14} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modeName, { color: palette.text }]}>{p.name}</Text>
                <Text style={[styles.modeDesc, { color: palette.textSecondary }]}>{p.desc}</Text>
              </View>
              {selected && <AppIcon name="check" color={palette.brand} size={16} />}
            </Pressable>
          )
        })}
      </BottomSheet>

      <BottomSheet visible={sheet === "model"} title="模型与推理设置" onClose={() => setSheet(null)}>
        {/* 推理档三段 */}
        <View style={[styles.reasonBox, { backgroundColor: palette.surfaceMuted }]}>
          <Text style={[styles.reasonTitle, { color: palette.text }]}>推理 Thinking (CoT)</Text>
          <View style={styles.reasonSeg}>
            {REASONING.map((r) => {
              const sel = reasoning === r.id
              return (
                <Pressable
                  key={r.id}
                  style={[styles.reasonSegItem, { backgroundColor: sel ? palette.surface : "transparent" }]}
                  onPress={() => setReasoning(r.id)}
                >
                  <Text style={[styles.reasonLabel, { color: sel ? palette.brand : palette.textSecondary }]}>{r.label}</Text>
                  <Text style={[styles.reasonSub, { color: sel ? palette.brand : palette.textSecondary }]}>{r.sub}</Text>
                </Pressable>
              )
            })}
          </View>
          <Text style={[styles.reasonDesc, { color: palette.textSecondary }]}>
            {REASONING.find((r) => r.id === reasoning)?.desc}
          </Text>
        </View>
        {/* 模型列表（从 worker 目录动态） */}
        <ModelList selected={newSessionDefaults?.model ?? "deepseek-v4-flash"} onSelect={(m) => setDefaults({ provider: "deepseek-official", model: m.id })} />
        <Pressable style={({ pressed }) => [styles.confirmButton, { backgroundColor: palette.brand }, pressed && { opacity: 0.85 }]} onPress={() => setSheet(null)}>
          <Text style={styles.confirmText}>确定</Text>
        </Pressable>
      </BottomSheet>

      {/* Full access 风险确认 */}
      <Modal visible={fullAccessConfirm} transparent animationType="fade" onRequestClose={() => setFullAccessConfirm(false)}>
        <Pressable style={[styles.centerScrim, { backgroundColor: palette.scrim }]} onPress={() => setFullAccessConfirm(false)}>
          <Pressable style={[styles.confirmCard, { backgroundColor: palette.surface }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.confirmHeader}>
              <Text style={[styles.confirmTitle, { color: palette.text }]}>确认启用 Full access?</Text>
              <Pressable onPress={() => setFullAccessConfirm(false)} hitSlop={8}>
                <AppIcon name="close" color={palette.textSecondary} size={16} />
              </Pressable>
            </View>
            <View style={styles.riskRow}>
              <View style={[styles.riskIcon, { backgroundColor: palette.warningSoft }]}>
                <AppIcon name="alert" color={palette.warning} size={20} />
              </View>
              <Text style={[styles.riskText, { color: palette.textSecondary }]}>
                启用 Full access 后，agent 将减少确认步骤，并可直接执行敏感操作、文件修改或外部命令。仅建议在信任当前任务时使用。
              </Text>
            </View>
            <Pressable style={styles.checkRow} onPress={() => setRiskAck(!riskAck)}>
              <View style={[styles.checkBox, { borderColor: riskAck ? palette.brand : palette.border, backgroundColor: riskAck ? palette.brand : "transparent" }]}>
                {riskAck && <AppIcon name="check" color="#FFFFFF" size={12} />}
              </View>
              <Text style={[styles.checkText, { color: palette.text }]}>我已了解风险，并愿意继续</Text>
            </Pressable>
            <View style={styles.confirmActions}>
              <Pressable style={({ pressed }) => [styles.cancelButton, { borderColor: palette.border }, pressed && { opacity: 0.7 }]} onPress={() => setFullAccessConfirm(false)}>
                <Text style={[styles.cancelText, { color: palette.text }]}>取消</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.enableButton, { backgroundColor: riskAck ? palette.text : palette.surfaceMuted }, pressed && riskAck && { opacity: 0.85 }]}
                disabled={!riskAck}
                onPress={() => { setPermission("danger-full-access"); setFullAccessConfirm(false) }}
              >
                <Text style={[styles.enableText, { color: riskAck ? palette.surface : palette.textSecondary }]}>启用 Full access</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <DirectoryPickerSheet visible={picker} onClose={() => setPicker(false)} onPicked={(dir) => pickDirectory(dir)} />
    </View>
  )
}

// ---------- 子组件 ----------

function Chip(props: Readonly<{ icon: IconName; label: string; onPress: () => void }>): React.JSX.Element {
  const { palette } = usePreferences()
  return (
    <Pressable style={({ pressed }) => [styles.chip, { backgroundColor: palette.surfaceMuted }, pressed && { opacity: 0.75 }]} onPress={props.onPress}>
      <AppIcon name={props.icon} color={palette.textSecondary} size={14} />
      <Text style={[styles.chipText, { color: palette.text }]} numberOfLines={1}>{props.label}</Text>
      <Text style={[styles.chev, { color: palette.textSecondary }]}>▾</Text>
    </Pressable>
  )
}

function BottomSheet(props: Readonly<{ visible: boolean; title: string; onClose: () => void; children: React.ReactNode }>): React.JSX.Element | null {
  const { palette } = usePreferences()
  if (!props.visible) return null
  return (
    <Modal visible transparent animationType="slide" onRequestClose={props.onClose}>
      <Pressable style={[styles.scrim, { backgroundColor: palette.scrim }]} onPress={props.onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: palette.surface }]} onPress={(e) => e.stopPropagation()}>
          <View style={[styles.grabber, { backgroundColor: palette.border }]} />
          <View style={[styles.sheetHeader, { borderBottomColor: palette.border }]}>
            <Text style={[styles.sheetTitle, { color: palette.text }]}>{props.title}</Text>
            <Pressable onPress={props.onClose} hitSlop={8}>
              <AppIcon name="close" color={palette.textSecondary} size={16} />
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingBottom: spacing.x4 }}>
            {props.children}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function SheetRow(props: Readonly<{ selected: boolean; onPress: () => void; label: string; sub?: string; icon?: IconName }>): React.JSX.Element {
  const { palette } = usePreferences()
  return (
    <Pressable
      style={({ pressed }) => [styles.sheetRow, { backgroundColor: props.selected ? palette.brandSoft : "transparent" }, pressed && { opacity: 0.7 }]}
      onPress={props.onPress}
    >
      {props.icon !== undefined && <AppIcon name={props.icon} color={props.selected ? palette.brand : palette.textSecondary} size={14} />}
      <View style={{ flex: 1 }}>
        <Text style={[styles.sheetRowLabel, { color: props.selected ? palette.brand : palette.text }]} numberOfLines={1}>{props.label}</Text>
        {props.sub !== undefined && (
          <Text style={[styles.sheetRowSub, { color: palette.textSecondary }]} numberOfLines={1}>{props.sub}</Text>
        )}
      </View>
      {props.selected && <AppIcon name="check" color={palette.brand} size={14} />}
    </Pressable>
  )
}

function ModelList(props: Readonly<{ selected: string; onSelect: (m: { id: string; name?: string }) => void }>): React.JSX.Element | null {
  const models = useDshStore((s) => s.modelCatalog)
  const { palette } = usePreferences()
  if (models.length === 0) return null
  return (
    <View>
      {models.map((m) => (
        <SheetRow
          key={m.id}
          selected={props.selected === m.id}
          onPress={() => props.onSelect(m)}
          label={m.name ?? m.id}
          sub={m.id}
        />
      ))}
    </View>
  )
}

// ---------- 样式 ----------

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.x4 },
  toast: { position: "absolute", top: spacing.x8, paddingHorizontal: spacing.x4, paddingVertical: spacing.x2, borderRadius: radii.round, zIndex: 30 },
  toastText: { fontSize: 12 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.x2, marginBottom: spacing.x4 },
  logoDot: { width: 28, height: 28, borderRadius: 14 },
  title: { fontSize: 22, fontWeight: "700" },
  badge: { paddingHorizontal: spacing.x2, paddingVertical: 2, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: "500" },
  selectorRow: { flexDirection: "row", gap: spacing.x2, marginBottom: spacing.x3, alignSelf: "stretch", justifyContent: "center" },
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
  actionChipText: { fontSize: 12, fontWeight: "500", maxWidth: 110 },
  reasonTag: { fontSize: 12 },
  send: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  scrim: { flex: 1, justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet, paddingHorizontal: spacing.x4, paddingBottom: spacing.x4 },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginVertical: spacing.x2 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.x2, borderBottomWidth: StyleSheet.hairlineWidth, marginBottom: spacing.x2 },
  sheetTitle: { fontSize: 16, fontWeight: "700" },
  sheetRow: { flexDirection: "row", alignItems: "center", gap: spacing.x3, paddingVertical: spacing.x3, borderRadius: radii.control, paddingHorizontal: spacing.x2 },
  sheetRowLabel: { fontSize: 14, fontWeight: "500" },
  sheetRowSub: { fontSize: 11 },
  sheetDivider: { height: StyleSheet.hairlineWidth, marginTop: spacing.x2 },
  addRow: { flexDirection: "row", alignItems: "center", gap: spacing.x2, paddingVertical: spacing.x3 },
  addText: { fontSize: 14, fontWeight: "500" },
  modeCard: { flexDirection: "row", alignItems: "center", gap: spacing.x3, borderWidth: StyleSheet.hairlineWidth, borderRadius: 20, padding: spacing.x3, marginBottom: spacing.x2 },
  modeName: { fontSize: 14, fontWeight: "700", marginBottom: 3 },
  modeDesc: { fontSize: 12, lineHeight: 17 },
  permIcon: { width: 32, height: 32, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cmdRow: { flexDirection: "row", alignItems: "center", gap: spacing.x2, paddingVertical: spacing.x3 },
  cmdName2: { fontSize: 14, fontWeight: "700", fontFamily: "Menlo" },
  cmdDesc: { flex: 1, fontSize: 12 },
  kindBadge: { paddingHorizontal: spacing.x2, paddingVertical: 2, borderRadius: 6 },
  kindText: { fontSize: 10, fontWeight: "500" },
  reasonBox: { borderRadius: 20, padding: spacing.x3, marginBottom: spacing.x3 },
  reasonTitle: { fontSize: 13, fontWeight: "600", marginBottom: spacing.x2 },
  reasonSeg: { flexDirection: "row", borderRadius: 12, overflow: "hidden" },
  reasonSegItem: { flex: 1, alignItems: "center", paddingVertical: spacing.x2, borderRadius: 10 },
  reasonLabel: { fontSize: 12, fontWeight: "600" },
  reasonSub: { fontSize: 10 },
  reasonDesc: { fontSize: 11, marginTop: spacing.x2 },
  confirmButton: { borderRadius: radii.control, alignItems: "center", paddingVertical: spacing.x3, marginTop: spacing.x2 },
  confirmText: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },
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
})
