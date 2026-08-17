/**
 * 会话视图模型 reducer（纯函数）：SessionEvent 流 → 时间线条目。
 *
 * dsh 事件类型众多且在演进，这里按稳定的关键事件聚合：
 *   user/message        → 用户消息
 *   assistant/chunk     → 流式文本（聚合到当前 assistant 条目）
 *   assistant/message   → 完成 assistant 消息
 *   tool/call           → 工具调用卡片（tool/result 到达时补状态）
 *   turn/start|turn/end → 分隔/状态
 * 其余事件忽略（透传不影响正确性）。
 */

import type { DshSessionEvent } from '@dsh-companion/bridge-protocol'

export type ToolStatus = 'running' | 'ok' | 'error'

export interface TimelineItem {
  readonly key: string
  readonly kind: 'user' | 'assistant' | 'tool' | 'turnEnd'
  readonly text?: string
  readonly streaming?: boolean
  readonly toolName?: string
  readonly toolStatus?: ToolStatus
  readonly turnReason?: string
  /** 流式期间累计的 reasoning 字符数（折叠提示"思考中…"用） */
  readonly reasoningLength?: number
}

export interface SessionView {
  readonly items: readonly TimelineItem[]
  /** 最近的 chunk 落点（聚合用） */
  readonly lastAssistantIndex: number
  readonly agentStatus: 'idle' | 'running' | 'unknown'
}

export const emptySessionView: SessionView = { items: [], lastAssistantIndex: -1, agentStatus: 'unknown' }

function pickText(data: Record<string, unknown>): string {
  const direct = data['text']
  if (typeof direct === 'string') return direct
  const content = data['content']
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'object' && block !== null) {
          const b = block as Record<string, unknown>
          if (b['type'] === 'text' && typeof b['text'] === 'string') return b['text']
        }
        return ''
      })
      .join('')
  }
  return ''
}

/** 消息里的 reasoning 文本（App 折叠展示用）。 */
function pickReasoning(data: Record<string, unknown>): string {
  const content = data['content']
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (typeof block === 'object' && block !== null) {
        const b = block as Record<string, unknown>
        if (b['type'] === 'reasoning' && typeof b['text'] === 'string') return b['text']
      }
      return ''
    })
    .join('')
}

export function reduceSessionEvent(view: SessionView, event: DshSessionEvent): SessionView {
  const data = event as unknown as Record<string, unknown>
  const items = [...view.items]
  let lastAssistantIndex = view.lastAssistantIndex

  switch (event.type) {
    case 'user/message': {
      items.push({ key: `u${event.seq}`, kind: 'user', text: pickText(data) })
      break
    }
    case 'assistant/chunk': {
      // dsh StreamChunk 协议：data.chunk = block-start | text-delta | reasoning-delta |
      // tool-call-delta | block-end | usage；reasoning 不展开正文（折叠提示），text 增量追加
      const chunk = data['chunk'] as Record<string, unknown> | undefined
      if (chunk === undefined) break
      if (chunk['type'] === 'text-delta' && typeof chunk['text'] === 'string' && (chunk['text'] as string).length > 0) {
        const delta = chunk['text'] as string
        if (lastAssistantIndex >= 0 && items[lastAssistantIndex]?.streaming) {
          items[lastAssistantIndex] = { ...items[lastAssistantIndex]!, text: `${items[lastAssistantIndex]!.text ?? ''}${delta}` }
        } else {
          items.push({ key: `a${event.seq}`, kind: 'assistant', text: delta, streaming: true })
          lastAssistantIndex = items.length - 1
        }
      } else if (chunk['type'] === 'reasoning-delta') {
        if (lastAssistantIndex < 0 || items[lastAssistantIndex]?.kind !== 'assistant') {
          items.push({ key: `a${event.seq}`, kind: 'assistant', text: '', streaming: true })
          lastAssistantIndex = items.length - 1
        }
        const cur = items[lastAssistantIndex]!
        items[lastAssistantIndex] = { ...cur, reasoningLength: (cur.reasoningLength ?? 0) + (typeof chunk['text'] === 'string' ? (chunk['text'] as string).length : 0) }
      } else if (chunk['type'] === 'tool-call-delta' && typeof chunk['name'] === 'string') {
        items.push({ key: `t${event.seq}`, kind: 'tool', toolName: chunk['name'], toolStatus: 'running' })
        lastAssistantIndex = -1
      }
      break
    }
    case 'assistant/message': {
      const message = data['message'] as Record<string, unknown> | undefined
      const finalText = message !== undefined ? pickText(message) : pickText(data)
      if (lastAssistantIndex >= 0 && items[lastAssistantIndex]?.streaming) {
        items[lastAssistantIndex] = {
          ...items[lastAssistantIndex]!,
          text: finalText.length > 0 ? finalText : items[lastAssistantIndex]!.text,
          streaming: false,
        }
      } else if (finalText.length > 0) {
        items.push({ key: `a${event.seq}`, kind: 'assistant', text: finalText, streaming: false })
        lastAssistantIndex = items.length - 1
      }
      break
    }
    case 'tool/call': {
      const name = data['name'] ?? data['tool'] ?? data['toolName']
      items.push({
        key: `t${event.seq}`,
        kind: 'tool',
        toolName: typeof name === 'string' ? name : 'tool',
        toolStatus: 'running',
      })
      lastAssistantIndex = -1
      break
    }
    case 'tool/result': {
      // 倒序找最近一个 running 的工具卡片补状态
      for (let i = items.length - 1; i >= 0; i -= 1) {
        const item = items[i]
        if (item.kind === 'tool' && item.toolStatus === 'running') {
          const isError = data['error'] !== undefined && data['error'] !== null
          items[i] = { ...item, toolStatus: isError ? 'error' : 'ok' }
          break
        }
      }
      break
    }
    case 'turn/start': {
      return { items, lastAssistantIndex, agentStatus: 'running' }
    }
    case 'turn/end': {
      const reason = data['reason']
      items.push({
        key: `e${event.seq}`,
        kind: 'turnEnd',
        turnReason: typeof reason === 'string' ? reason : '',
      })
      return { items, lastAssistantIndex, agentStatus: 'idle' }
    }
    default:
      return view
  }
  return { items, lastAssistantIndex, agentStatus: view.agentStatus }
}

export function reduceSessionEvents(events: readonly DshSessionEvent[]): SessionView {
  return events.reduce(reduceSessionEvent, emptySessionView)
}

/** 会话列表条目投影。 */
export interface SessionListItem {
  readonly id: string
  readonly createdAt: number
  readonly cwd: string | null
  readonly lastSeq: number
  readonly live: boolean
  readonly agentStatus: string | null
  readonly title: string
}

export function projectSessionList(raw: unknown): readonly SessionListItem[] {
  if (!Array.isArray(raw)) return []
  const items: SessionListItem[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    if (typeof e['id'] !== 'string') continue
    const createdAt = typeof e['createdAt'] === 'number' ? e['createdAt'] : 0
    const cwd = typeof e['cwd'] === 'string' ? e['cwd'] : null
    items.push({
      id: e['id'],
      createdAt,
      cwd,
      lastSeq: typeof e['lastSeq'] === 'number' ? e['lastSeq'] : -1,
      live: e['live'] === true,
      agentStatus: typeof e['agentStatus'] === 'string' ? e['agentStatus'] : null,
      title: cwd !== null ? cwd.split('/').filter(Boolean).pop() ?? cwd : `会话 ${new Date(createdAt).toLocaleString()}`,
    })
  }
  return items.sort((a, b) => b.createdAt - a.createdAt)
}
