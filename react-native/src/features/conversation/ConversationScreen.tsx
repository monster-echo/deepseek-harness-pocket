/**
 * 会话时间线（展示模型对齐 dsh Web GUI）：
 *   - 用户右对齐气泡；assistant blocks 混排（text 正文 + Think 折叠行）
 *   - 工具行：状态点 + 变体名 · 单行摘要，点按展开 IN/OUT
 *   - 回合尾：completed 细线 / error 红 / max-tokens 琥珀 / stopped 标记
 *   - 审批与提问接管 composer 上方（对齐 dsh ApprovalPanel 行为：仅允许一次/拒绝）
 */

import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Markdown from 'react-native-markdown-display';
import * as Clipboard from 'expo-clipboard';
import { AppIcon, IconName } from '../../design-system/AppIcon';
import { usePreferences } from '../../preferences/PreferencesProvider';
import { useDshStore } from '../../state/dshStore';
import { spacing, radii } from '../../theme/tokens';
import type { AssistantBlock, TimelineItem, ToolStatus } from './reducer';

export function ConversationScreen() {
  const { palette } = usePreferences();
  const view = useDshStore((s) => s.sessionView);
  const notice = useDshStore((s) => s.notice);
  const activeSessionId = useDshStore((s) => s.activeSessionId);
  const serverRequests = useDshStore((s) => s.serverRequests);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true })
  }, [view.items.length])

  if (activeSessionId === null) {
    return (
      <View style={[styles.empty, { backgroundColor: palette.background }]}>
        <Text style={[styles.emptyTitle, { color: palette.textSecondary }]}>从侧边栏选择一个会话</Text>
      </View>
    )
  }

  const pending = serverRequests[0]
  const [actionTarget, setActionTarget] = useState<TimelineItem | null>(null)

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      {notice !== null && (
        <View style={[styles.notice, { backgroundColor: palette.warningSoft }]}>
          <Text style={[styles.noticeText, { color: palette.warning }]}>{notice}</Text>
        </View>
      )}
      <ScrollView
        ref={scrollRef}
        style={styles.timeline}
        contentContainerStyle={{ padding: spacing.x3, gap: spacing.x2, paddingBottom: spacing.x4 }}
      >
        {view.items.map((item) => (
          <TimelineRow key={item.key} item={item} onLongPress={setActionTarget} />
        ))}
      </ScrollView>
      <MessageActionSheet
        target={actionTarget}
        onClose={() => setActionTarget(null)}
      />
      {/* 审批/提问接管输入区上方（dsh ApprovalPanel 模式） */}
      {pending !== undefined ? (
        <ServerRequestCard request={pending} />
      ) : (
        <Composer />
      )}
    </View>
  )
}

// ---------- 时间线行 ----------

function TimelineRow({ item, onLongPress }: Readonly<{ item: TimelineItem; onLongPress: (item: TimelineItem) => void }>) {
  if (item.kind === 'user') return <UserRow item={item} onLongPress={onLongPress} />
  if (item.kind === 'assistant') return <AssistantRow item={item} onLongPress={onLongPress} />
  if (item.kind === 'tool') return <ToolRow item={item} />
  if (item.kind === 'compaction') return <CompactionRow item={item} />
  return <TurnEndRow item={item} />
}

function UserRow({ item, onLongPress }: Readonly<{ item: TimelineItem; onLongPress: (item: TimelineItem) => void }>) {
  const { palette } = usePreferences()
  return (
    <View style={styles.userRow}>
      <Pressable onLongPress={() => onLongPress(item)} delayLongPress={350}>
        <View style={[styles.userBubble, { backgroundColor: palette.brand }]}>
          <Text style={[styles.userText, { color: '#FFFFFF' }]}>{item.text}</Text>
        </View>
      </Pressable>
    </View>
  )
}

function AssistantRow({ item, onLongPress }: Readonly<{ item: TimelineItem; onLongPress: (item: TimelineItem) => void }>) {
  const { palette } = usePreferences()
  const blocks = item.blocks ?? []
  const fullText = blocks.map((b) => b.text).join('\n\n')
  return (
    <Pressable onLongPress={() => onLongPress(item)} delayLongPress={350}>
    <View style={[styles.assistantBubble, { backgroundColor: palette.surface }]}>
      {blocks.map((block, i) => (
        <AssistantBlockView key={i} block={block} streaming={item.streaming === true} />
      ))}
      {blocks.length === 0 && item.streaming === true && (
        <Text style={[styles.thinkSummary, { color: palette.textSecondary }]}>思考中…</Text>
      )}
      {item.stopped === true && (
        <Text style={[styles.stoppedMark, { color: palette.warning }]}>已停止</Text>
      )}
      {item.usage !== undefined && (
        <Text style={[styles.usageLine, { color: palette.textSecondary }]}>
          {item.usage.input} in · {item.usage.output} out
        </Text>
      )}
    </View>
    </Pressable>
  )
}

/** text → 正文（流式纯文本，定稿 Markdown）；reasoning → Think 折叠行。 */
function AssistantBlockView({ block, streaming }: Readonly<{ block: AssistantBlock; streaming: boolean }>) {
  const { palette } = usePreferences()
  const [open, setOpen] = useState(false)
  if (block.type === 'text') {
    if (streaming) {
      return (
        <Text style={[styles.assistantText, { color: palette.text }]}>
          {block.text}
          {' ▍'}
        </Text>
      )
    }
    return (
      <Markdown
        style={{
          body: { color: palette.text, fontSize: 15, lineHeight: 22 },
          strong: { color: palette.text },
          link: { color: palette.brand },
          code_inline: {
            backgroundColor: palette.surfaceMuted, color: palette.text,
            fontFamily: 'Menlo', fontSize: 13,
          },
          fence: {
            backgroundColor: palette.surfaceMuted, borderColor: palette.border, borderWidth: StyleSheet.hairlineWidth,
            fontFamily: 'Menlo', fontSize: 12, color: palette.text, borderRadius: 8, padding: 8,
          },
          bullet_list_icon: { color: palette.textSecondary },
          blockquote: { backgroundColor: palette.surfaceMuted, borderRadius: 8, paddingLeft: 8 },
        }}
      >
        {block.text}
      </Markdown>
    )
  }
  const lines = block.text.split('\n').filter((l) => l.trim().length > 0)
  const summary = streaming ? lines[lines.length - 1] ?? '' : lines[0] ?? ''
  return (
    <Pressable style={[styles.thinkRow, { borderColor: palette.border }]} onPress={() => setOpen(!open)}>
      <Text style={[styles.thinkLabel, { color: palette.textSecondary }]}>
        思考 {open ? '▾' : '▸'} · {lines.length > 0 ? '' : '…'}
      </Text>
      <Text style={[styles.thinkSummary, { color: palette.textSecondary }]} numberOfLines={open ? undefined : 1}>
        {summary.length > 0 ? summary : `${block.text.length} 字`}
      </Text>
      {open && (
        <Text style={[styles.thinkBody, { color: palette.textSecondary }]}>{block.text}</Text>
      )}
    </Pressable>
  )
}

const TOOL_STATUS_COLOR: Record<ToolStatus, 'success' | 'error' | 'warning' | 'textSecondary'> = {
  ok: 'success', error: 'error', running: 'warning', stopped: 'warning',
}
const TOOL_STATUS_LABEL: Record<ToolStatus, string> = {
  ok: '完成', error: '失败', running: '执行中', stopped: '已停止',
}
const TOOL_ICON: Record<string, IconName> = {
  Bash: 'globe', Read: 'check', Write: 'plus', Edit: 'palette', Search: 'globe', Code: 'palette', Tool: 'settings',
}

function ToolRow({ item }: Readonly<{ item: TimelineItem }>) {
  const { palette } = usePreferences()
  const [open, setOpen] = useState(false)
  const status = item.toolStatus ?? 'running'
  const colorKey = TOOL_STATUS_COLOR[status]
  const color = palette[colorKey]
  return (
    <View style={[styles.toolCard, { borderColor: palette.border, backgroundColor: palette.surfaceMuted }]}>
      <Pressable style={styles.toolHead} onPress={() => setOpen(!open)}>
        <AppIcon name={TOOL_ICON[item.variant ?? 'Tool'] ?? 'settings'} color={color} size={14} />
        <Text style={[styles.toolVariant, { color: palette.text }]}>{item.variant}</Text>
        <Text style={[styles.toolSummary, { color: status === 'error' ? palette.error : palette.textSecondary }]} numberOfLines={1}>
          {status === 'error' && (item.errorLine ?? '').length > 0 ? item.errorLine : item.summary}
        </Text>
        <Text style={[styles.toolStatus, { color }]}>{open ? '▾' : '▸'} {TOOL_STATUS_LABEL[status]}</Text>
      </Pressable>
      {open && (
        <View style={styles.toolBody}>
          {item.argsPretty !== undefined && item.argsPretty.length > 0 && (
            <>
              <Text style={[styles.toolBodyLabel, { color: palette.textSecondary }]}>输入</Text>
              <Text style={[styles.mono, { color: palette.text }]}>{item.argsPretty}</Text>
            </>
          )}
          {item.outputPreview !== undefined && item.outputPreview.length > 0 && (
            <>
              <Text style={[styles.toolBodyLabel, { color: palette.textSecondary }]}>输出</Text>
              <Text style={[styles.mono, { color: palette.text }]}>{item.outputPreview}</Text>
            </>
          )}
        </View>
      )}
    </View>
  )
}

/** dsh StatsLine 紧凑数字：517 / 1.3K / 1.2M（一位小数）。 */
function compactTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1_000)}K`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

/** turn-tail 时钟行（对齐 dsh TurnTailNodeView：耗时 · tokens · 速率）。 */
function tailStats(item: TimelineItem): string {
  const parts: string[] = []
  if (item.ranMs !== undefined) {
    const s = item.ranMs / 1000
    parts.push(s >= 60 ? `${Math.floor(s / 60)}m${Math.round(s % 60)}s` : `${s < 10 ? s.toFixed(1) : Math.round(s)}s`)
  }
  if (item.turnTokens !== undefined && (item.turnTokens.input > 0 || item.turnTokens.output > 0)) {
    parts.push(`${compactTokens(item.turnTokens.input)} in · ${compactTokens(item.turnTokens.output)} out`)
    if (item.ranMs !== undefined && item.ranMs > 1000 && item.turnTokens.output > 0) {
      parts.push(`${Math.round(item.turnTokens.output / (item.ranMs / 1000))} tok/s`)
    }
  }
  return parts.join(' · ')
}

function CompactionRow({ item }: Readonly<{ item: TimelineItem }>) {
  const { palette } = usePreferences()
  const [open, setOpen] = useState(false)
  const info = item.compaction
  if (info === undefined) return null
  return (
    <Pressable style={[styles.compactionRow, { borderColor: palette.border }]} onPress={() => setOpen(!open)}>
      <Text style={[styles.compactionLabel, { color: palette.info }]}>
        上下文压缩 {open ? '▾' : '▸'} · {info.items} 条 · {compactTokens(info.tokens)} tokens
      </Text>
      {open && (
        <Text style={[styles.compactionBody, { color: palette.textSecondary }]}>{info.summaryText}</Text>
      )}
    </Pressable>
  )
}

function TurnEndRow({ item }: Readonly<{ item: TimelineItem }>) {
  const { palette } = usePreferences()
  const stats = tailStats(item)
  if (item.turnReason === 'completed') {
    return (
      <Text style={[styles.turnEnd, { color: palette.textSecondary }]}>
        — 回合完成{stats.length > 0 ? ` · ${stats}` : ''} —
      </Text>
    )
  }
  if (item.turnReason === 'error') {
    return (
      <View style={[styles.turnEndCard, { borderColor: palette.error }]}>
        <View style={[styles.stateDot, { backgroundColor: palette.error }]} />
        <Text style={[styles.turnEndText, { color: palette.error }]} numberOfLines={2}>
          回合错误：{item.reasonMessage}{stats.length > 0 ? `（${stats}）` : ''}
        </Text>
      </View>
    )
  }
  if (item.turnReason === 'max-tokens') {
    return (
      <View style={[styles.turnEndCard, { borderColor: palette.warning }]}>
        <View style={[styles.stateDot, { backgroundColor: palette.warning }]} />
        <Text style={[styles.turnEndText, { color: palette.warning }]}>达到输出上限（max-tokens）</Text>
      </View>
    )
  }
  return <Text style={[styles.turnEnd, { color: palette.textSecondary }]}>— 已停止 —</Text>
}

// ---------- 审批 / 提问（接管输入区，对齐 dsh ApprovalPanel） ----------

function ServerRequestCard({ request }: Readonly<{ request: import('@dsh-companion/bridge-protocol').ServerRequest }>) {
  const { palette } = usePreferences()
  const respondPermission = useDshStore((s) => s.respondPermission)
  const respondQuestion = useDshStore((s) => s.respondQuestion)
  const [answer, setAnswer] = useState('')

  if (request.kind === 'permission') {
    return (
      <View style={[styles.composerCard, { borderTopColor: palette.warning, backgroundColor: palette.surface }]}>
        <Text style={[styles.askTitle, { color: palette.warning }]}>等待审批</Text>
        <Text style={[styles.askBody, { color: palette.text }]} numberOfLines={3}>{request.body.summary}</Text>
        <View style={styles.askActions}>
          <Pressable
            style={[styles.askButton, { borderColor: palette.textSecondary, borderWidth: 1 }]}
            onPress={() => void respondPermission(request.body.requestId, 'deny')}
          >
            <Text style={[styles.askButtonText, { color: palette.textSecondary }]}>拒绝</Text>
          </Pressable>
          <Pressable
            style={[styles.askButton, { backgroundColor: palette.brand }]}
            onPress={() => void respondPermission(request.body.requestId, 'allow')}
          >
            <Text style={[styles.askButtonText, { color: '#FFFFFF' }]}>允许一次</Text>
          </Pressable>
        </View>
      </View>
    )
  }
  return (
    <View style={[styles.composerCard, { borderTopColor: palette.info, backgroundColor: palette.surface }]}>
      <Text style={[styles.askTitle, { color: palette.info }]}>Agent 提问</Text>
      <Text style={[styles.askBody, { color: palette.text }]}>{request.body.question}</Text>
      {request.body.options !== undefined && (
        <View style={styles.askActions}>
          {request.body.options.map((option) => (
            <Pressable
              key={option}
              style={[styles.askButton, { backgroundColor: palette.brand }]}
              onPress={() => void respondQuestion(request.body.requestId, option)}
            >
              <Text style={[styles.askButtonText, { color: '#FFFFFF' }]}>{option}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <View style={[styles.answerRow, { borderColor: palette.border }]}>
        <TextInput
          style={[styles.answerInput, { color: palette.text }]}
          placeholder="输入回答…"
          placeholderTextColor={palette.textSecondary}
          value={answer}
          onChangeText={setAnswer}
        />
        <Pressable style={[styles.answerSend, { backgroundColor: palette.brand }]} onPress={() => void respondQuestion(request.body.requestId, answer)}>
          <Text style={styles.answerSendText}>发送</Text>
        </Pressable>
      </View>
    </View>
  )
}

function Composer() {
  const { palette } = usePreferences()
  const [text, setText] = useState('')
  const sendMessage = useDshStore((s) => s.sendMessage)
  const stopTurn = useDshStore((s) => s.stopTurn)
  const running = useDshStore((s) => s.sessionView.agentStatus === 'running')

  const submit = (): void => {
    const value = text.trim()
    if (value.length === 0) return
    setText('')
    void sendMessage(value)
  }

  return (
    <View style={[styles.composer, { borderTopColor: palette.border, backgroundColor: palette.surface }]}>
      {running && (
        <Pressable style={[styles.stopButton, { borderColor: palette.error }]} onPress={() => void stopTurn()}>
          <View style={[styles.stateDot, { backgroundColor: palette.error }]} />
          <Text style={[styles.stopText, { color: palette.error }]}>停止</Text>
        </Pressable>
      )}
      <TextInput
        style={[styles.input, { color: palette.text }]}
        placeholder="发送消息…"
        placeholderTextColor={palette.textSecondary}
        value={text}
        onChangeText={setText}
        multiline
      />
      <Pressable
        style={[styles.send, { backgroundColor: text.trim().length > 0 ? palette.brand : palette.surfaceMuted }]}
        onPress={submit}
        disabled={text.trim().length === 0}
      >
        <AppIcon name="chevron-right" color={text.trim().length > 0 ? '#FFFFFF' : palette.textSecondary} size={20} />
      </Pressable>
    </View>
  )
}

/** 长按消息菜单（hover 等价）：复制全文 / 从这里分支。 */
function MessageActionSheet(props: Readonly<{ target: TimelineItem | null; onClose: () => void }>) {
  const { palette } = usePreferences()
  const activeSessionId = useDshStore((s) => s.activeSessionId)
  const forkSession = useDshStore((s) => s.forkSession)
  const [copied, setNoticeCopied] = useState(false)
  const target = props.target
  if (target === null || activeSessionId === null) return null
  const text = (target.blocks ?? []).map((b) => b.text).join('\n\n') || target.text || ''

  const copy = (): void => {
    void Clipboard.setStringAsync(text).then(() => setNoticeCopied(true))
  }

  const fork = (): void => {
    props.onClose()
    void forkSession(activeSessionId, target.seq)
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={props.onClose}>
      <Pressable style={[sheetStyles.scrim, { backgroundColor: palette.scrim }]} onPress={props.onClose}>
        <View style={[sheetStyles.sheet, { backgroundColor: palette.surface }]}>
          <Text style={[sheetStyles.title, { color: palette.text }]} numberOfLines={2}>
            {text.slice(0, 80)}
          </Text>
          <SheetAction label={copied ? '已复制 ✓' : '复制全文'} onPress={copy} />
          <SheetAction label="从这里分支（fork 新会话）" onPress={fork} />
          <SheetAction label="取消" onPress={props.onClose} muted />
        </View>
      </Pressable>
    </Modal>
  )
}

function SheetAction({ label, onPress, muted }: Readonly<{ label: string; onPress: () => void; muted?: boolean }>) {
  const { palette } = usePreferences()
  return (
    <Pressable style={({ pressed }) => [sheetStyles.action, pressed && { backgroundColor: palette.surfaceMuted }]} onPress={onPress}>
      <Text style={[sheetStyles.actionText, { color: muted === true ? palette.textSecondary : palette.text }]}>{label}</Text>
    </Pressable>
  )
}

const sheetStyles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'center', padding: spacing.x6 },
  sheet: { borderRadius: radii.card, padding: spacing.x2 },
  title: { fontSize: 13, lineHeight: 18, padding: spacing.x2, opacity: 0.7 },
  action: { paddingVertical: spacing.x3, paddingHorizontal: spacing.x3, borderRadius: radii.control },
  actionText: { fontSize: 15 },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 15 },
  notice: { padding: spacing.x2, margin: spacing.x2, borderRadius: radii.control },
  noticeText: { fontSize: 13 },
  timeline: { flex: 1 },
  userRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  userBubble: { maxWidth: '80%', borderRadius: radii.card, padding: spacing.x3, borderBottomRightRadius: radii.small },
  userText: { fontSize: 15, lineHeight: 22 },
  assistantBubble: { alignSelf: 'flex-start', maxWidth: '90%', borderRadius: radii.card, padding: spacing.x3, borderBottomLeftRadius: radii.small, gap: spacing.x2 },
  assistantText: { fontSize: 15, lineHeight: 22 },
  thinkRow: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, padding: spacing.x2, gap: spacing.x1 },
  thinkLabel: { fontSize: 12 },
  thinkSummary: { fontSize: 13 },
  thinkBody: { fontSize: 12, lineHeight: 18, paddingTop: spacing.x1 },
  stoppedMark: { fontSize: 12, alignSelf: 'flex-end' },
  usageLine: { fontSize: 11, alignSelf: 'flex-end' },
  toolCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, alignSelf: 'stretch' },
  toolHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, padding: spacing.x2 },
  toolVariant: { fontSize: 13 },
  toolSummary: { flex: 1, fontSize: 12, fontFamily: 'Menlo' },
  toolStatus: { fontSize: 12 },
  toolBody: { padding: spacing.x2, borderTopWidth: StyleSheet.hairlineWidth, gap: spacing.x1 },
  toolBodyLabel: { fontSize: 11 },
  mono: { fontSize: 11, fontFamily: 'Menlo', lineHeight: 16 },
  turnEnd: { fontSize: 12, textAlign: 'center', paddingVertical: spacing.x1 },
  compactionRow: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, padding: spacing.x2, alignSelf: 'center' },
  compactionLabel: { fontSize: 12 },
  compactionBody: { fontSize: 12, lineHeight: 18, paddingTop: spacing.x1 },
  turnEndCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, borderWidth: 1, borderRadius: radii.control, padding: spacing.x2, alignSelf: 'center' },
  turnEndText: { fontSize: 13, flexShrink: 1 },
  stateDot: { width: 8, height: 8, borderRadius: 4 },
  composerCard: { borderTopWidth: 2, padding: spacing.x3, gap: spacing.x2 },
  askTitle: { fontSize: 13 },
  askBody: { fontSize: 14, lineHeight: 20 },
  askActions: { flexDirection: 'row', gap: spacing.x2, flexWrap: 'wrap' },
  askButton: { paddingHorizontal: spacing.x4, paddingVertical: spacing.x2, borderRadius: radii.round },
  askButtonText: { fontSize: 14 },
  answerRow: { flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, alignItems: 'center' },
  answerInput: { flex: 1, padding: spacing.x2, fontSize: 14 },
  answerSend: { padding: spacing.x2, borderRadius: radii.small },
  answerSendText: { color: '#FFFFFF', fontSize: 13 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.x2, padding: spacing.x2, borderTopWidth: StyleSheet.hairlineWidth },
  stopButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.x1, borderWidth: 1, borderRadius: radii.round, paddingHorizontal: spacing.x3, paddingVertical: spacing.x2 },
  stopText: { fontSize: 13 },
  input: { flex: 1, minHeight: 40, maxHeight: 120, padding: spacing.x2, fontSize: 15 },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
})
