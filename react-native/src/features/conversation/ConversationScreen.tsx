/**
 * 会话时间线：消息/工具卡片/审批卡片 + 输入区（主体界面，最大化）。
 */

import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { AppIcon } from '../../design-system/AppIcon';
import { usePreferences } from '../../preferences/PreferencesProvider';
import { useDshStore } from '../../state/dshStore';
import { spacing, radii } from '../../theme/tokens';
import type { TimelineItem } from './reducer';

export function ConversationScreen() {
  const { palette } = usePreferences();
  const view = useDshStore((s) => s.sessionView);
  const serverRequests = useDshStore((s) => s.serverRequests);
  const notice = useDshStore((s) => s.notice);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true })
  }, [view.items.length])

  if (useDshStore((s) => s.activeSessionId) === null) {
    return (
      <View style={[styles.empty, { backgroundColor: palette.background }]}>
        <Text style={[styles.emptyTitle, { color: palette.textSecondary }]}>从侧边栏选择一个会话</Text>
      </View>
    )
  }

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      {notice !== null && (
        <View style={[styles.notice, { backgroundColor: palette.warningSoft }]}>
          <Text style={[styles.noticeText, { color: palette.warning }]}>{notice}</Text>
        </View>
      )}
      <ScrollView ref={scrollRef} contentContainerStyle={styles.timeline}>
        {view.items.map((item) => (
          <TimelineRow key={item.key} item={item} />
        ))}
        {serverRequests.map((request) => (
          <ServerRequestCard key={request.body.requestId} request={request} />
        ))}
      </ScrollView>
      <Composer />
    </View>
  )
}

function TimelineRow({ item }: Readonly<{ item: TimelineItem }>) {
  const { palette } = usePreferences()
  if (item.kind === 'user') {
    return (
      <View style={styles.userRow}>
        <View style={[styles.userBubble, { backgroundColor: palette.brand }]}>
          <Text style={[styles.userText, { color: '#FFFFFF' }]}>{item.text}</Text>
        </View>
      </View>
    )
  }
  if (item.kind === 'assistant') {
    return (
      <View style={styles.assistantRow}>
        <View style={[styles.assistantBubble, { backgroundColor: palette.surface }]}>
          <Text style={[styles.assistantText, { color: palette.text }]}>
            {item.text}
            {item.streaming === true ? ' ▍' : ''}
          </Text>
        </View>
      </View>
    )
  }
  if (item.kind === 'tool') {
    const statusColor =
      item.toolStatus === 'error' ? palette.error : item.toolStatus === 'ok' ? palette.success : palette.warning
    return (
      <View style={[styles.toolCard, { borderColor: palette.border, backgroundColor: palette.surfaceMuted }]}>
        <View style={styles.toolHead}>
          <AppIcon name="check" color={statusColor} size={14} />
          <Text style={[styles.toolName, { color: palette.text }]} numberOfLines={1}>
            {item.toolName}
          </Text>
          <Text style={[styles.toolStatus, { color: statusColor }]}>
            {item.toolStatus === 'running' ? '执行中' : item.toolStatus === 'error' ? '失败' : '完成'}
          </Text>
        </View>
      </View>
    )
  }
  return (
    <Text style={[styles.turnEnd, { color: palette.textSecondary }]}>— 回合结束{item.turnReason ? `（${item.turnReason}）` : ''} —</Text>
  )
}

function ServerRequestCard({ request }: Readonly<{ request: import('@dsh-companion/bridge-protocol').ServerRequest }>) {
  const { palette } = usePreferences()
  const respondPermission = useDshStore((s) => s.respondPermission)
  const respondQuestion = useDshStore((s) => s.respondQuestion)
  const [answer, setAnswer] = useState('')

  if (request.kind === 'permission') {
    return (
      <View style={[styles.askCard, { borderColor: palette.warning, backgroundColor: palette.surface }]}>
        <Text style={[styles.askTitle, { color: palette.warning }]}>需要审批</Text>
        <Text style={[styles.askBody, { color: palette.text }]}>{request.body.summary}</Text>
        <View style={styles.askActions}>
          <AskButton label="拒绝" tone="deny" onPress={() => void respondPermission(request.body.requestId, 'deny')} />
          <AskButton label="允许" tone="allow" onPress={() => void respondPermission(request.body.requestId, 'allow')} />
        </View>
      </View>
    )
  }
  return (
    <View style={[styles.askCard, { borderColor: palette.info, backgroundColor: palette.surface }]}>
      <Text style={[styles.askTitle, { color: palette.info }]}>Agent 提问</Text>
      <Text style={[styles.askBody, { color: palette.text }]}>{request.body.question}</Text>
      {request.body.options !== undefined && (
        <View style={styles.askActions}>
          {request.body.options.map((option) => (
            <AskButton key={option} label={option} tone="allow" onPress={() => void respondQuestion(request.body.requestId, option)} />
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

function AskButton({ label, tone, onPress }: Readonly<{ label: string; tone: 'allow' | 'deny'; onPress: () => void }>) {
  const { palette } = usePreferences()
  const bg = tone === 'allow' ? palette.brand : palette.surfaceMuted
  const fg = tone === 'allow' ? '#FFFFFF' : palette.textSecondary
  return (
    <Pressable style={[styles.askButton, { backgroundColor: bg }]} onPress={onPress}>
      <Text style={[styles.askButtonText, { color: fg }]}>{label}</Text>
    </Pressable>
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

const styles = StyleSheet.create({
  container: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 15 },
  notice: { padding: spacing.x2, margin: spacing.x2, borderRadius: radii.control },
  noticeText: { fontSize: 13 },
  timeline: { padding: spacing.x3, gap: spacing.x2, paddingBottom: spacing.x4 },
  userRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  userBubble: { maxWidth: '80%', borderRadius: radii.card, padding: spacing.x3, borderBottomRightRadius: radii.small },
  userText: { fontSize: 15, lineHeight: 22 },
  assistantRow: { flexDirection: 'row', justifyContent: 'flex-start' },
  assistantBubble: { maxWidth: '85%', borderRadius: radii.card, padding: spacing.x3, borderBottomLeftRadius: radii.small },
  assistantText: { fontSize: 15, lineHeight: 22 },
  toolCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.control, padding: spacing.x2, alignSelf: 'flex-start' },
  toolHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2 },
  toolName: { fontSize: 13, fontFamily: 'Menlo' },
  toolStatus: { fontSize: 12 },
  turnEnd: { fontSize: 12, textAlign: 'center', paddingVertical: spacing.x1 },
  askCard: { borderWidth: 1, borderRadius: radii.card, padding: spacing.x3, gap: spacing.x2 },
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
  stopButton: { borderWidth: 1, borderRadius: radii.round, paddingHorizontal: spacing.x3, paddingVertical: spacing.x2 },
  stopText: { fontSize: 13 },
  input: { flex: 1, minHeight: 40, maxHeight: 120, padding: spacing.x2, fontSize: 15 },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
})
