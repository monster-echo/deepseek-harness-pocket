/**
 * 会话输入区（对齐 dsh Web composer）：
 *   上：胶囊工具行（命令 / 权限 / 模型 / 拍照 / 相册）——每个按钮都是直接功能，
 *       不再进入「会话设置」二级/三级（#18）；模式已上移到顶栏副标题（#19）。
 *   中：大圆角输入区（附件缩略图 + 多行 + 发送/停止）
 *   下：状态行（上下文剩余量圆环 · 模型 · 累计 tokens）
 * 输入 "/" 触发内联命令联想。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { AppIcon } from '../../design-system/AppIcon';
import { Sheet } from '../../design-system/Sheet';
import { usePreferences } from '../../preferences/PreferencesProvider';
import { useApp } from '../../state/AppStore';
import { useDshStore } from '../../state/dshStore';
import { spacing, radii } from '../../theme/tokens';
import { CommandPaletteSheet } from './CommandPaletteSheet';
import { ComposerInput } from './ComposerInput';

const PERMISSION_LABELS: Readonly<Record<string, string>> = {
  'workspace-write': '工作区可写',
  'danger-full-access': '完全访问',
  'read-only': '只读',
  custom: '自定义',
}

/** worker 未下发模型目录时的回退目录（#10：deepseek-v4-flash / pro 双选）。 */
const FALLBACK_MODELS: ReadonlyArray<{ id: string; name?: string }> = [
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
]

/** 模型上下文窗口映射（#20 圆环的 limit；未知模型取默认）。 */
const CONTEXT_LIMITS: Readonly<Record<string, number>> = {
  'deepseek-v4-flash': 128_000,
  'deepseek-v4-pro': 128_000,
}
const DEFAULT_CONTEXT_LIMIT = 128_000

export function ComposerBar(): React.JSX.Element | null {
  const { palette } = usePreferences()
  const { showToast } = useApp()
  const [text, setText] = useState('')
  const [commandsOpen, setCommandsOpen] = useState(false)
  const [permissionOpen, setPermissionOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const sendMessage = useDshStore((s) => s.sendMessage)
  const stopTurn = useDshStore((s) => s.stopTurn)
  const listCommands = useDshStore((s) => s.listCommands)
  const running = useDshStore((s) => s.sessionView.agentStatus === 'running')
  const permission = useDshStore((s) => s.sessionView.permissionCurrent)
  const totalUsage = useDshStore((s) => s.sessionView.totalUsage)
  const newSessionDefaults = useDshStore((s) => s.newSessionDefaults)
  const modelCatalog = useDshStore((s) => s.modelCatalog)
  const queueSend = useDshStore((s) => s.queueSend)
  const [pendingQueue, setPendingQueue] = useState<string[]>([])
  const [commandsCache, setCommandsCache] = useState<readonly { name: string; description: string }[]>([])
  const prevRunning = useRef(running)

  // 排队发送：turn 结束后自动发送队列下一条
  useEffect(() => {
    if (prevRunning.current && !running && pendingQueue.length > 0) {
      const [next, ...rest] = pendingQueue
      setPendingQueue(rest)
      void sendMessage(next)
    }
    prevRunning.current = running
  }, [running, pendingQueue, sendMessage])

  useEffect(() => {
    void listCommands().then(setCommandsCache)
  }, [listCommands])

  // "/" 内联命令联想
  const slashQuery = text.startsWith('/') && !text.includes(' ') ? text.slice(1).toLowerCase() : null
  const suggestions = useMemo(() => {
    if (slashQuery === null) return []
    return commandsCache.filter((c) => c.name.startsWith(slashQuery)).slice(0, 6)
  }, [slashQuery, commandsCache])

  const submit = (): void => {
    const value = text.trim()
    if (value.length === 0) return
    setText('')
    // 排队发送：turn 进行时入队，等 turn 结束自动发送
    if (running && queueSend) {
      setPendingQueue((prev) => [...prev, value])
      return
    }
    void sendMessage(value)
  }

  const canSend = text.trim().length > 0
  const modelLabel = newSessionDefaults !== null ? newSessionDefaults.model : 'deepseek-v4-flash'
  const permissionLabel = permission !== null ? (PERMISSION_LABELS[permission] ?? permission) : '权限'
  const models = modelCatalog.length > 0 ? modelCatalog : FALLBACK_MODELS

  // #20 上下文剩余量：used = 累计输入+输出，limit 取模型上下文窗口
  const usedTokens = totalUsage.input + totalUsage.output
  const contextLimit = CONTEXT_LIMITS[modelLabel] ?? DEFAULT_CONTEXT_LIMIT
  const contextPct = Math.max(0, Math.min(1, usedTokens / contextLimit))
  const R = 7
  const CIRC = 2 * Math.PI * R

  return (
    <View style={[styles.container, { backgroundColor: palette.surface, borderTopColor: palette.border }]}>
      {/* 内联命令联想 */}
      {suggestions.length > 0 && (
        <View style={[styles.suggestBox, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          {suggestions.map((cmd) => (
            <Pressable
              key={cmd.name}
              style={({ pressed }) => [styles.suggestRow, pressed && { backgroundColor: palette.surfaceMuted }]}
              onPress={() => setText(`/${cmd.name} `)}
            >
              <Text style={[styles.suggestName, { color: palette.brand, fontFamily: 'Menlo' }]}>/{cmd.name}</Text>
              <Text style={[styles.suggestDesc, { color: palette.textSecondary }]} numberOfLines={1}>{cmd.description}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* 功能条：对齐 dsh Web「命令 / 访问模式 / 选择模型」 */}
      <View style={styles.dockRow}>
        <DockButton label="命令" onPress={() => setCommandsOpen(true)} />
        <DockButton label={`访问模式：${permissionLabel}`} onPress={() => setPermissionOpen(true)} />
        <DockButton label={`模型：${modelLabel}`} onPress={() => setModelOpen(true)} />
      </View>

      {/* 输入区（共享 ComposerInput） */}
      <ComposerInput
        text={text}
        onChangeText={setText}
        onSubmit={submit}
        onStop={() => void stopTurn()}
        running={running}
        canSend={canSend}
      />

      {/* 状态行：上下文剩余量圆环（可点击查看占用详情）· 累计 tokens */}
      {(usedTokens > 0 || contextPct > 0) && (
        <Pressable style={styles.statsLine} onPress={() => setContextOpen(true)}>
          <Svg width={18} height={18} viewBox="0 0 20 20">
            <Circle cx="10" cy="10" r={R} stroke={palette.border} strokeWidth="2.5" fill="none" />
            <Circle
              cx="10" cy="10" r={R} stroke={contextPct > 0.9 ? palette.warning : palette.brand}
              strokeWidth="2.5" fill="none"
              strokeDasharray={`${CIRC * contextPct} ${CIRC}`}
              strokeLinecap="round" transform="rotate(-90 10 10)"
            />
          </Svg>
          <Text style={[styles.statsText, { color: contextPct > 0.9 ? palette.warning : palette.textSecondary }]}>
            {Math.round(contextPct * 100)}% 上下文
          </Text>
          <Text style={[styles.statsText, { color: palette.textSecondary }]}>
            {usedTokens > 0 ? ` · ${compact(usedTokens)} tok` : ''}
          </Text>
        </Pressable>
      )}

      <ContextUsageSheet visible={contextOpen} onClose={() => setContextOpen(false)} />
      <CommandPaletteSheet visible={commandsOpen} onClose={() => setCommandsOpen(false)} onCommand={(name) => {
        if (name === 'permission') { setPermissionOpen(true); return }
        if (name === 'model') { setModelOpen(true); return }
        if (name === 'export' || name === 'feedback' || name === 'goal') { showToast(`/${name} 暂未实现`, 'info'); return }
        sendMessage(`/${name}`); showToast(`已执行 /${name}`, 'info')
      }} />
      <PermissionSheet visible={permissionOpen} onClose={() => setPermissionOpen(false)} onChanged={(label) => showToast(`权限已切换为 ${label}`, 'info')} />
      <ModelSheet visible={modelOpen} onClose={() => setModelOpen(false)} models={models} currentModel={modelLabel} onChanged={(m) => showToast(`已选模型 ${m.id}`, 'info')} />
    </View>
  )
}

/** 上下文占用详情（对齐 dsh token-meter：系统提示词/工具/对话消息 + 用量/容量）。 */
function ContextUsageSheet(props: Readonly<{ visible: boolean; onClose: () => void }>) {
  const { palette } = usePreferences()
  const [ctx, setCtx] = useState<{ projectedTokens: number; contextWindow: number; systemTokens: number; toolsTokens: number; messageTokens: number } | null>(null)
  const activeSessionId = useDshStore((s) => s.activeSessionId)
  const sessionContext = useDshStore((s) => s.sessionContext)
  useEffect(() => {
    if (!props.visible || activeSessionId === null) return
    void sessionContext(activeSessionId).then(setCtx)
  }, [props.visible, activeSessionId, sessionContext])
  const pct = ctx !== null && ctx.contextWindow > 0 ? Math.round((ctx.projectedTokens / ctx.contextWindow) * 1000) / 10 : 0
  const fmt = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n))
  return (
    <Sheet visible={props.visible} title="上下文占用" onClose={props.onClose} snapPoints={['50%']}>
      {ctx === null ? (
        <Text style={[styles.sheetHint, { color: palette.textSecondary }]}>上下文占用不可用（需活跃会话）</Text>
      ) : (
        <>
          <Text style={[styles.ctxPct, { color: palette.text }]}>上下文已用 {pct}%</Text>
          <Text style={[styles.ctxTotal, { color: palette.textSecondary, fontFamily: 'Menlo' }]}>
            ~{fmt(ctx.projectedTokens)} / {fmt(ctx.contextWindow)}
          </Text>
          <View style={[styles.ctxRow, { borderTopColor: palette.border }]}>
            <Text style={[styles.ctxLabel, { color: palette.textSecondary }]}>系统提示词</Text>
            <Text style={[styles.ctxValue, { color: palette.text, fontFamily: 'Menlo' }]}>~{fmt(ctx.systemTokens)}</Text>
          </View>
          <View style={[styles.ctxRow, { borderTopColor: palette.border }]}>
            <Text style={[styles.ctxLabel, { color: palette.textSecondary }]}>工具</Text>
            <Text style={[styles.ctxValue, { color: palette.text, fontFamily: 'Menlo' }]}>~{fmt(ctx.toolsTokens)}</Text>
          </View>
          <View style={[styles.ctxRow, { borderTopColor: palette.border }]}>
            <Text style={[styles.ctxLabel, { color: palette.textSecondary }]}>对话消息</Text>
            <Text style={[styles.ctxValue, { color: palette.text, fontFamily: 'Menlo' }]}>~{fmt(ctx.messageTokens)}</Text>
          </View>
        </>
      )}
    </Sheet>
  )
}

/** 会话权限（直接切换，作用于当前会话）。 */
function PermissionSheet(props: Readonly<{ visible: boolean; onClose: () => void; onChanged: (label: string) => void }>) {
  const { palette } = usePreferences()
  const [names, setNames] = useState<string[]>([])
  const permissionOptions = useDshStore((s) => s.permissionOptions)
  const setPermission = useDshStore((s) => s.setPermission)
  const current = useDshStore((s) => s.sessionView.permissionCurrent)
  useEffect(() => {
    if (!props.visible) return
    void permissionOptions().then((o) => setNames(o.names))
  }, [props.visible, permissionOptions])
  return (
    <Sheet visible={props.visible} title="访问模式" onClose={props.onClose} snapPoints={['50%']}>
      <Text style={[styles.sheetHint, { color: palette.textSecondary }]}>立即作用于当前会话（Web 端同步）</Text>
      {names.map((name) => {
        const label = PERMISSION_LABELS[name] ?? name
        const selected = current === name
        return (
          <Pressable
            key={name}
            style={[styles.optionRow, { borderColor: selected ? palette.brand : palette.border }]}
            onPress={() => {
              props.onClose()
              void setPermission(name)
              props.onChanged(label)
            }}
          >
            <Text style={[styles.optionText, { color: selected ? palette.brand : palette.text }]}>{label}</Text>
            {selected && <AppIcon name="check" color={palette.brand} size={16} />}
          </Pressable>
        )
      })}
      {names.length === 0 && (
        <Text style={[styles.sheetHint, { color: palette.textSecondary }]}>未取到档位目录（worker 需 m3 caps）</Text>
      )}
    </Sheet>
  )
}

/** 模型选择：显示完整 id（#10），worker 目录为空时回退双模型。 */
function ModelSheet(props: Readonly<{ visible: boolean; onClose: () => void; models: readonly { id: string; name?: string }[]; currentModel: string; onChanged: (m: { id: string }) => void }>) {
  const { palette } = usePreferences()
  const setDefaults = useDshStore((s) => s.setNewSessionDefaults)
  const [sessionCurrent, setSessionCurrent] = useState('')
  const listModels = useDshStore((s) => s.listModels)
  useEffect(() => {
    if (!props.visible) return
    void listModels().then((r) => setSessionCurrent(r.current?.model ?? ''))
  }, [props.visible, listModels])
  return (
    <Sheet visible={props.visible} title="选择模型" onClose={props.onClose} scrollable snapPoints={['55%', '85%']}>
      {sessionCurrent.length > 0 && (
        <Text style={[styles.sheetHint, { color: palette.textSecondary }]}>当前会话：{sessionCurrent}</Text>
      )}
      {props.models.map((m) => {
        const selected = props.currentModel === m.id
        return (
          <Pressable
            key={m.id}
            style={[styles.optionRow, { borderColor: selected ? palette.brand : palette.border }]}
            onPress={() => {
              props.onClose()
              setDefaults({ provider: 'deepseek-official', model: m.id })
              props.onChanged(m)
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.optionText, { color: palette.text, fontFamily: 'Menlo' }]}>{m.id}</Text>
              {m.name !== undefined && m.name.length > 0 && (
                <Text style={[styles.optionSub, { color: palette.textSecondary }]}>{m.name}</Text>
              )}
            </View>
            {selected && <AppIcon name="check" color={palette.brand} size={16} />}
          </Pressable>
        )
      })}
    </Sheet>
  )
}

/** dsh Web 功能条按钮：文字按钮，无底色。 */
function DockButton(props: Readonly<{ label: string; onPress: () => void }>): React.JSX.Element {
  const { palette } = usePreferences()
  return (
    <Pressable
      style={({ pressed }) => [styles.dockButton, pressed && { opacity: 0.6 }]}
      onPress={props.onPress}
    >
      <Text style={[styles.dockText, { color: palette.textSecondary }]}>{props.label}</Text>
    </Pressable>
  )
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1_000)}K`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

const styles = StyleSheet.create({
  container: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.x2, paddingBottom: spacing.x2, gap: spacing.x2 },
  suggestBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, marginBottom: spacing.x1, overflow: 'hidden' },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, paddingHorizontal: spacing.x3, paddingVertical: spacing.x2 },
  suggestName: { fontSize: 13 },
  suggestDesc: { flex: 1, fontSize: 12 },
  dockRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x3, paddingHorizontal: spacing.x4, flexWrap: 'wrap' },
  dockButton: { paddingVertical: 2 },
  dockText: { fontSize: 13 },
  statsLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.x1 },
  statsText: { fontSize: 11 },
  sheetHint: { fontSize: 12, paddingBottom: spacing.x2 },
  ctxPct: { fontSize: 22, fontWeight: '700', textAlign: 'center', marginTop: spacing.x2 },
  ctxTotal: { fontSize: 13, textAlign: 'center', marginTop: spacing.x1, marginBottom: spacing.x3 },
  ctxRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.x2, borderTopWidth: StyleSheet.hairlineWidth },
  ctxLabel: { fontSize: 14 },
  ctxValue: { fontSize: 14 },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, padding: spacing.x3, marginBottom: spacing.x2 },
  optionText: { fontSize: 15 },
  optionSub: { fontSize: 11, marginTop: 2 },
})
