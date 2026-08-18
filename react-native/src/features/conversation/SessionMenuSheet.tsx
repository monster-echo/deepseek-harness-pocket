/**
 * 会话菜单（对齐 dsh Web 顶栏功能面）：权限档位 / 模型 / 模式（agent preset）/ 命令面板。
 */

import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppIcon } from '../../design-system/AppIcon';
import { usePreferences } from '../../preferences/PreferencesProvider';
import { useDshStore } from '../../state/dshStore';
import { spacing, radii } from '../../theme/tokens';

const PERMISSION_LABELS: Readonly<Record<string, string>> = {
  'workspace-write': '工作区可写',
  'danger-full-access': '完全访问',
  'read-only': '只读',
  custom: '自定义',
}

/** preset id → 中文模式名（对齐 Web UI 呈现；以 dsh 返回的 name/description 优先）。 */
const PRESET_LABELS: Readonly<Record<string, string>> = {
  standard: '标准模式',
  code: '代码编排（PTC）',
  minimal: '极简模式',
  cordis: 'Cordis（创造）',
}

type Tab = 'main' | 'permission' | 'model' | 'preset' | 'commands'

export function SessionMenuSheet(props: Readonly<{ visible: boolean; onClose: () => void }>) {
  const { palette } = usePreferences();
  const [tab, setTab] = useState<Tab>('main');

  useEffect(() => {
    if (props.visible) setTab('main')
  }, [props.visible])

  return (
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={props.onClose}>
      <Pressable style={[styles.scrim, { backgroundColor: palette.scrim }]} onPress={props.onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: palette.surface }]} onPress={(e) => e.stopPropagation()}>
          {tab === 'main' && <MainTab onClose={props.onClose} onOpen={setTab} />}
          {tab === 'permission' && <PermissionTab onBack={() => setTab('main')} />}
          {tab === 'model' && <ModelTab onBack={() => setTab('main')} />}
          {tab === 'preset' && <PresetTab onBack={() => setTab('main')} />}
          {tab === 'commands' && <CommandsTab onClose={props.onClose} />}
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function SheetHeader(props: Readonly<{ title: string; onBack?: () => void; onClose: () => void }>) {
  const { palette } = usePreferences()
  return (
    <View style={[styles.header, { borderBottomColor: palette.border }]}>
      {props.onBack !== undefined ? (
        <Pressable onPress={props.onBack} hitSlop={12}>
          <AppIcon name="arrow-left" color={palette.text} size={20} />
        </Pressable>
      ) : (
        <View style={{ width: 20 }} />
      )}
      <Text style={[styles.title, { color: palette.text }]}>{props.title}</Text>
      <Pressable onPress={props.onClose} hitSlop={12}>
        <AppIcon name="close" color={palette.text} size={20} />
      </Pressable>
    </View>
  )
}

function MainTab(props: Readonly<{ onClose: () => void; onOpen: (tab: Tab) => void }>) {
  const { palette } = usePreferences()
  const permissionCurrent = useDshStore((s) => s.sessionView.permissionCurrent)
  const newSessionDefaults = useDshStore((s) => s.newSessionDefaults)
  const newSessionPreset = useDshStore((s) => s.newSessionPreset)
  const items: ReadonlyArray<{ key: Tab; label: string; value: string }> = [
    { key: 'permission', label: '权限', value: permissionCurrent !== null ? (PERMISSION_LABELS[permissionCurrent] ?? permissionCurrent) : '—' },
    { key: 'model', label: '新会话模型', value: newSessionDefaults !== null ? newSessionDefaults.model : '默认（v4-flash）' },
    { key: 'preset', label: '新会话模式', value: PRESET_LABELS[newSessionPreset] ?? newSessionPreset ?? '标准模式' },
    { key: 'commands', label: '命令', value: '/compact · /plan · /goal …' },
  ]
  return (
    <View>
      <SheetHeader title="会话设置" onClose={props.onClose} />
      {items.map((item) => (
        <Pressable key={item.key} style={[styles.row, { borderColor: palette.border }]} onPress={() => props.onOpen(item.key)}>
          <Text style={[styles.rowLabel, { color: palette.text }]}>{item.label}</Text>
          <Text style={[styles.rowValue, { color: palette.textSecondary }]} numberOfLines={1}>{item.value}</Text>
          <AppIcon name="chevron-right" color={palette.textSecondary} size={16} />
        </Pressable>
      ))}
    </View>
  )
}

function PermissionTab(props: Readonly<{ onBack: () => void }>) {
  const { palette } = usePreferences()
  const [names, setNames] = useState<string[]>([])
  const permissionOptions = useDshStore((s) => s.permissionOptions)
  const setPermission = useDshStore((s) => s.setPermission)
  const current = useDshStore((s) => s.sessionView.permissionCurrent)
  useEffect(() => {
    void permissionOptions().then((o) => setNames(o.names))
  }, [permissionOptions])
  return (
    <View>
      <SheetHeader title="会话权限" onBack={props.onBack} onClose={props.onBack} />
      <Text style={[styles.hint, { color: palette.textSecondary }]}>立即作用于当前会话（写入 dsh 日志，Web 端同步）</Text>
      {names.map((name) => (
        <Pressable
          key={name}
          style={[styles.optionRow, { borderColor: current === name ? palette.brand : palette.border }]}
          onPress={() => void setPermission(name)}
        >
          <Text style={[styles.optionText, { color: palette.text }]}>{PERMISSION_LABELS[name] ?? name}</Text>
          {current === name && <AppIcon name="check" color={palette.brand} size={16} />}
        </Pressable>
      ))}
      {names.length === 0 && (
        <Text style={[styles.hint, { color: palette.textSecondary }]}>未取到档位目录（worker 需 m3 caps）</Text>
      )}
    </View>
  )
}

function ModelTab(props: Readonly<{ onBack: () => void }>) {
  const { palette } = usePreferences()
  const [models, setModels] = useState<readonly { id: string; name?: string }[]>([])
  const [provider, setProvider] = useState('')
  const [current, setCurrent] = useState<string>('')
  const listModels = useDshStore((s) => s.listModels)
  const setDefaults = useDshStore((s) => s.setNewSessionDefaults)
  const newSessionDefaults = useDshStore((s) => s.newSessionDefaults)
  useEffect(() => {
    void listModels().then((r) => {
      const p = r.providers[0]
      if (p !== undefined) {
        setProvider(p.id)
        setModels(p.models)
      }
      setCurrent(r.current?.model ?? '')
    })
  }, [listModels])
  return (
    <View>
      <SheetHeader title="模型（新会话生效）" onBack={props.onBack} onClose={props.onBack} />
      {current.length > 0 && (
        <Text style={[styles.hint, { color: palette.textSecondary }]}>当前会话：{current}</Text>
      )}
      {models.map((m) => {
        const selected = newSessionDefaults?.model === m.id
        return (
          <Pressable
            key={m.id}
            style={[styles.optionRow, { borderColor: selected ? palette.brand : palette.border }]}
            onPress={() => setDefaults({ provider: provider.length > 0 ? provider : 'deepseek-official', model: m.id })}
          >
            <Text style={[styles.optionText, { color: palette.text }]}>{m.name ?? m.id}</Text>
            <Text style={[styles.optionId, { color: palette.textSecondary }]}>{m.id}</Text>
            {selected && <AppIcon name="check" color={palette.brand} size={16} />}
          </Pressable>
        )
      })}
      {models.length === 0 && (
        <Text style={[styles.hint, { color: palette.textSecondary }]}>目录为空</Text>
      )}
    </View>
  )
}

function PresetTab(props: Readonly<{ onBack: () => void }>) {
  const { palette } = usePreferences()
  const [presets, setPresets] = useState<readonly { id: string; name?: string; description?: string; isDefault: boolean }[]>([])
  const listPresets = useDshStore((s) => s.listPresets)
  const setDefaults = useDshStore((s) => s.setNewSessionDefaults)
  const newSessionPreset = useDshStore((s) => s.newSessionPreset)
  useEffect(() => {
    void listPresets().then(setPresets)
  }, [listPresets])
  return (
    <View>
      <SheetHeader title="模式（agent preset，新会话生效）" onBack={props.onBack} onClose={props.onBack} />
      {presets.map((preset) => {
        const selected = (newSessionPreset.length > 0 ? newSessionPreset : 'standard') === preset.id
        return (
          <Pressable
            key={preset.id}
            style={[styles.optionRow, { borderColor: selected ? palette.brand : palette.border }]}
            onPress={() => setDefaults(null, preset.id)}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.optionText, { color: palette.text }]}>
                {preset.name ?? PRESET_LABELS[preset.id] ?? preset.id}
                {preset.isDefault ? '（默认）' : ''}
              </Text>
              {preset.description !== undefined && (
                <Text style={[styles.optionId, { color: palette.textSecondary }]} numberOfLines={2}>{preset.description}</Text>
              )}
            </View>
            {selected && <AppIcon name="check" color={palette.brand} size={16} />}
          </Pressable>
        )
      })}
      {presets.length === 0 && (
        <Text style={[styles.hint, { color: palette.textSecondary }]}>preset 目录为空</Text>
      )}
    </View>
  )
}

/** 命令面板：commands.list 发现，点击即以 /name 发送（dsh 侧免模型回合执行）。 */
function CommandsTab(props: Readonly<{ onClose: () => void }>) {
  const { palette } = usePreferences()
  const [commands, setCommands] = useState<readonly { name: string; description: string }[]>([])
  const [arg, setArg] = useState('')
  const listCommands = useDshStore((s) => s.listCommands)
  const sendMessage = useDshStore((s) => s.sendMessage)
  const notice = useDshStore((s) => s.notice)
  useEffect(() => {
    void listCommands().then(setCommands)
  }, [listCommands])
  const run = (name: string): void => {
    const line = arg.trim().length > 0 ? `/${name} ${arg.trim()}` : `/${name}`
    props.onClose()
    void sendMessage(line)
  }
  return (
    <View>
      <SheetHeader title="命令" onBack={props.onClose} onClose={props.onClose} />
      <Text style={[styles.hint, { color: palette.textSecondary }]}>
        点按即执行（免模型回合，等效 Web 端斜杠命令）；可选填参数
      </Text>
      <Text style={[styles.argHint, { color: palette.textSecondary }]}>参数（可选，如 goal 的目标文本）</Text>
      <ArgInput arg={arg} setArg={setArg} />
      <ScrollView style={{ maxHeight: 320 }}>
        {commands.map((cmd) => (
          <Pressable key={cmd.name} style={[styles.optionRow, { borderColor: palette.border }]} onPress={() => run(cmd.name)}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.optionText, { color: palette.text, fontFamily: 'Menlo' }]}>/{cmd.name}</Text>
              <Text style={[styles.optionId, { color: palette.textSecondary }]} numberOfLines={1}>{cmd.description}</Text>
            </View>
          </Pressable>
        ))}
        {commands.length === 0 && (
          <Text style={[styles.hint, { color: palette.textSecondary }]}>命令目录为空（需活跃会话）</Text>
        )}
      </ScrollView>
      {notice !== null && (
        <Text style={[styles.hint, { color: palette.brand }]}>{notice}</Text>
      )}
    </View>
  )
}

function ArgInput(props: Readonly<{ arg: string; setArg: (v: string) => void }>) {
  const { palette } = usePreferences()
  const { TextInput } = require('react-native')
  return (
    <TextInput
      style={[styles.argInput, { color: palette.text, borderColor: palette.border }]}
      placeholder="参数…"
      placeholderTextColor={palette.textSecondary}
      value={props.arg}
      onChangeText={props.setArg}
    />
  )
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet, paddingBottom: spacing.x6, maxHeight: '80%' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.x3, paddingHorizontal: spacing.x4, paddingVertical: spacing.x3, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 16, flex: 1, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, paddingHorizontal: spacing.x4, paddingVertical: spacing.x3, borderBottomWidth: StyleSheet.hairlineWidth },
  rowLabel: { fontSize: 15, width: 96 },
  rowValue: { flex: 1, fontSize: 13, textAlign: 'right' },
  hint: { fontSize: 12, paddingHorizontal: spacing.x4, paddingVertical: spacing.x2 },
  argHint: { fontSize: 11, paddingHorizontal: spacing.x4, paddingTop: spacing.x2 },
  argInput: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, marginHorizontal: spacing.x4, padding: spacing.x2, fontSize: 14 },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, marginHorizontal: spacing.x4, marginVertical: spacing.x1, padding: spacing.x3 },
  optionText: { fontSize: 15 },
  optionId: { fontSize: 11, fontFamily: 'Menlo' },
})
