/**
 * 新建会话首屏（对齐 dsh Web 3080 无会话页）：
 * 选择工作区 + 功能条（模式/命令入口/权限/模型）+ 大输入区；
 * 发送首条消息 = 创建会话（带选定模型/模式）并发送。
 */

import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { AppIcon } from '../../design-system/AppIcon';
import { usePreferences } from '../../preferences/PreferencesProvider';
import { useDshStore } from '../../state/dshStore';
import { spacing, radii } from '../../theme/tokens';
import { DirectoryPickerSheet } from '../workers/DirectoryPickerSheet';

const PERMISSION_LABELS: Readonly<Record<string, string>> = {
  'workspace-write': '工作区可写',
  'danger-full-access': '完全访问',
  'read-only': '只读',
  custom: '自定义',
}

const PRESET_LABELS: Readonly<Record<string, string>> = {
  standard: '标准模式',
  code: '代码编排',
  minimal: '极简',
  cordis: 'Cordis',
}

export function NewSessionComposer(props: Readonly<{
  onOpenMenu: (tab: 'permission' | 'model' | 'preset' | 'commands') => void;
}>): React.JSX.Element {
  const { palette } = usePreferences()
  const [text, setText] = useState('')
  const [path, setPath] = useState('')
  const [picker, setPicker] = useState(false)
  const [workspaces, setWorkspaces] = useState<readonly { id: string; path: string; title: string }[]>([])
  const [chooser, setChooser] = useState(false)
  const [busy, setBusy] = useState(false)
  const createSession = useDshStore((s) => s.createSession)
  const sendMessage = useDshStore((s) => s.sendMessage)
  const addWorkspace = useDshStore((s) => s.addWorkspace)
  const listWorkspaces = useDshStore((s) => s.listWorkspaces)
  const newSessionDefaults = useDshStore((s) => s.newSessionDefaults)
  const newSessionPreset = useDshStore((s) => s.newSessionPreset)
  const permission = useDshStore((s) => s.sessionView.permissionCurrent)

  useEffect(() => {
    void listWorkspaces().then(setWorkspaces)
  }, [listWorkspaces])

  const pickDirectory = (dir: string): void => {
    setChooser(false)
    setBusy(true)
    void addWorkspace(dir).then((w) => {
      setBusy(false)
      if (w !== null) {
        setPath(w.path)
        setWorkspaces((prev) => [...prev.filter((x) => x.id !== w.id), w])
      }
    })
  }

  const submit = (): Promise<void> => {
    const value = text.trim()
    if (value.length === 0 || path.length === 0 || busy) return Promise.resolve()
    setBusy(true)
    setText('')
    return createSession(path)
      .then(() => sendMessage(value))
      .finally(() => setBusy(false))
  }

  const canSend = text.trim().length > 0 && path.length > 0 && !busy
  const modelLabel = newSessionDefaults !== null ? newSessionDefaults.model.replace('deepseek-', '') : 'v4-flash'
  const presetLabel = PRESET_LABELS[newSessionPreset.length > 0 ? newSessionPreset : 'standard'] ?? newSessionPreset
  const permissionLabel = permission !== null ? (PERMISSION_LABELS[permission] ?? permission) : '权限'
  const pathLabel = path.length > 0 ? path.split('/').filter(Boolean).pop() ?? path : ''

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      {/* 选择工作区（大按钮，对齐 Web 首屏） */}
      <Pressable
        style={({ pressed }) => [styles.workspaceButton, { borderColor: path.length > 0 ? palette.brand : palette.border, backgroundColor: palette.surface }, pressed && { opacity: 0.8 }]}
        onPress={() => setChooser(true)}
      >
        <AppIcon name={path.length > 0 ? 'check' : 'plus'} color={palette.brand} size={18} />
        <Text style={[styles.workspaceText, { color: palette.text }]} numberOfLines={1}>
          {path.length > 0 ? pathLabel : '选择工作区'}
        </Text>
        <Text style={[styles.workspacePath, { color: palette.textSecondary }]} numberOfLines={1}>
          {path.length > 0 ? path : ''}
        </Text>
      </Pressable>

      {/* 会话卡片：功能条 + 输入区 */}
      <View style={[styles.card, { backgroundColor: palette.surface }]}>
        <View style={styles.dockRow}>
          <DockButton label={`${presetLabel} ▾`} active onPress={() => props.onOpenMenu('preset')} />
          <DockButton label="命令" onPress={() => props.onOpenMenu('commands')} />
          <DockButton label={`${permissionLabel} ▾`} onPress={() => props.onOpenMenu('permission')} />
          <DockButton label={`${modelLabel} ▾`} onPress={() => props.onOpenMenu('model')} />
        </View>
        <View style={[styles.inputShell, { borderColor: palette.border, backgroundColor: palette.surfaceMuted }]}>
          <TextInput
            style={[styles.input, { color: palette.text }]}
            placeholder="描述你想要构建的内容…"
            placeholderTextColor={palette.textSecondary}
            value={text}
            onChangeText={setText}
            multiline
          />
          <Pressable
            style={[styles.send, { backgroundColor: canSend ? palette.brand : palette.surfaceMuted }]}
            onPress={() => void submit()}
            disabled={!canSend}
          >
            <AppIcon name="chevron-right" color={canSend ? '#FFFFFF' : palette.textSecondary} size={20} />
          </Pressable>
        </View>
      </View>

      {/* 工作区选择弹层：已有列表 + 浏览目录 */}
      <Modal visible={chooser} transparent animationType="slide" onRequestClose={() => setChooser(false)}>
        <Pressable style={[styles.scrim, { backgroundColor: palette.scrim }]} onPress={() => setChooser(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: palette.surface }]} onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.sheetTitle, { color: palette.text }]}>选择工作区</Text>
            <ScrollView style={{ maxHeight: 300 }}>
              {workspaces.map((w) => (
                <Pressable
                  key={w.id}
                  style={[styles.wsRow, { borderColor: path === w.path ? palette.brand : palette.border }]}
                  onPress={() => { setPath(w.path); setChooser(false) }}
                >
                  <Text style={[styles.wsTitle, { color: palette.text }]} numberOfLines={1}>{w.title}</Text>
                  <Text style={[styles.wsPath, { color: palette.textSecondary }]} numberOfLines={1}>{w.path}</Text>
                </Pressable>
              ))}
              {workspaces.length === 0 && (
                <Text style={[styles.sheetHint, { color: palette.textSecondary }]}>还没有工作区，浏览电脑目录添加</Text>
              )}
            </ScrollView>
            <Pressable style={[styles.browseButton, { borderColor: palette.brand }]} onPress={() => { setChooser(false); setPicker(true) }}>
              <Text style={[styles.browseText, { color: palette.brand }]}>浏览电脑目录…</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      <DirectoryPickerSheet
        visible={picker}
        onClose={() => setPicker(false)}
        onPicked={(dir) => pickDirectory(dir)}
      />
    </View>
  )
}

function DockButton(props: Readonly<{ label: string; active?: boolean; onPress: () => void }>): React.JSX.Element {
  const { palette } = usePreferences()
  return (
    <Pressable style={({ pressed }) => [styles.dockButton, pressed && { opacity: 0.6 }]} onPress={props.onPress}>
      <Text style={[styles.dockText, { color: props.active === true ? palette.brand : palette.textSecondary }]}>
        {props.label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.x4, gap: spacing.x4 },
  workspaceButton: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.x2,
    borderWidth: 1, borderRadius: radii.round, paddingHorizontal: spacing.x5, paddingVertical: spacing.x3,
    alignSelf: 'stretch', marginHorizontal: spacing.x4,
  },
  workspaceText: { fontSize: 16 },
  workspacePath: { flex: 1, fontSize: 11, fontFamily: 'Menlo', textAlign: 'right' },
  card: { alignSelf: 'stretch', marginHorizontal: spacing.x4, borderRadius: radii.card, padding: spacing.x2, gap: spacing.x2 },
  dockRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x3, paddingHorizontal: spacing.x2, paddingTop: spacing.x1, flexWrap: 'wrap' },
  dockButton: { paddingVertical: 2 },
  dockText: { fontSize: 13 },
  inputShell: { flexDirection: 'row', alignItems: 'flex-end', borderRadius: radii.card, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.x2 },
  input: { flex: 1, minHeight: 48, maxHeight: 140, paddingVertical: spacing.x2, fontSize: 15 },
  send: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginVertical: 6 },
  scrim: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet, padding: spacing.x4, paddingBottom: spacing.x6 },
  sheetTitle: { fontSize: 16, marginBottom: spacing.x2 },
  sheetHint: { fontSize: 13, padding: spacing.x2 },
  wsRow: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, padding: spacing.x3, marginBottom: spacing.x2 },
  wsTitle: { fontSize: 15 },
  wsPath: { fontSize: 11, fontFamily: 'Menlo', marginTop: 2 },
  browseButton: { borderWidth: 1, borderRadius: radii.control, alignItems: 'center', padding: spacing.x3, marginTop: spacing.x2 },
  browseText: { fontSize: 15 },
})
