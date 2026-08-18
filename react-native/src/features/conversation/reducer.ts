/**
 * 会话视图模型 reducer（纯函数）：dsh SessionEvent 流 → 时间线。
 *
 * 展示模型对齐 dsh Web GUI（packages/client/ui-conversation / ui-tool）：
 *   user/message        → 右侧气泡
 *   assistant/chunk     → 流式块（text-delta 追加 / reasoning-delta 进 Think 块）
 *   assistant/message   → 定稿：blocks 原顺序混排（text 正文 + reasoning 折叠）
 *   tool/call           → 工具卡（变体名 + 单行摘要 + 状态；result 按 callId 配对）
 *   turn/start|end      → 尾部状态行（完成 / error / max-tokens / stopped）
 * 事件负载全部在 event.data 下。
 */

import type { DshSessionEvent } from '@deepseek-harness-pocket/bridge-protocol'

// ---------- 视图模型 ----------

export interface TextBlock { type: 'text'; text: string }
export interface ReasoningBlock { type: 'reasoning'; text: string; streaming?: boolean }
export type AssistantBlock = TextBlock | ReasoningBlock

export type ToolVariant = 'Bash' | 'Read' | 'Write' | 'Edit' | 'Search' | 'Code' | 'Tool'
export type ToolStatus = 'running' | 'ok' | 'error' | 'stopped'

export interface TimelineItem {
  readonly key: string
  readonly kind: 'user' | 'assistant' | 'tool' | 'turnEnd' | 'compaction' | 'contextInjection'
  /** 产生该条目的事件 seq（分叉 boundary 用） */
  readonly seq?: number
  // user
  readonly text?: string
  // assistant
  readonly blocks?: readonly AssistantBlock[]
  readonly streaming?: boolean
  readonly stopped?: boolean
  readonly usage?: { input: number; output: number }
  // tool
  readonly callId?: string
  readonly variant?: ToolVariant
  readonly summary?: string
  readonly toolStatus?: ToolStatus
  readonly argsPretty?: string
  readonly outputPreview?: string
  readonly errorLine?: string
  // turnEnd（turn-tail 统计，对齐 dsh TurnTailNodeView 时钟行）
  readonly turnReason?: 'completed' | 'error' | 'max-tokens' | 'aborted'
  readonly reasonMessage?: string
  readonly ranMs?: number
  readonly turnTokens?: { input: number; output: number }
  // compaction 标记行（对齐 dsh CompactionItem）
  readonly compaction?: { items: number; tokens: number; summaryText: string }
  // contextInjection（对齐 dsh ContextInjectionRow：非 user 来源的上下文注入）
  readonly producer?: string
  readonly contextForm?: string
  readonly sections?: readonly { name: string; text: string }[]
}

/** 会话统计（对齐 dsh Web 顶栏 stats 行；缺失字段为 0/NaN，展示侧用「—」）。 */
export interface SessionStats {
  readonly turns: number
  readonly steps: number
  /** 累计 LLM 耗时（ms）：step/start → assistant/message */
  readonly llmMs: number
  /** 累计工具调用耗时（ms）：tool/call → tool/result */
  readonly toolMs: number
  /** 累计首 token 延迟（ms） */
  readonly ttftMs: number
  /** 有首 token 的步数（用于平均） */
  readonly ttftSteps: number
  /** 累计解码耗时（ms）：首 token → assistant/message */
  readonly decodeMs: number
  /** 累计解码输出 tokens */
  readonly decodeTokens: number
  /** 累计缓存命中率（0-100；无缓存数据时 NaN） */
  readonly cacheHitPct: number
  /** 最近一回合输入/输出 tokens */
  readonly turnInput: number
  readonly turnOutput: number
}

export interface SessionView {
  readonly items: readonly TimelineItem[]
  /** 当前流式 assistant 条目下标（-1 无） */
  readonly streamingIndex: number
  readonly agentStatus: 'idle' | 'running' | 'unknown'
  /** 当前回合起点时间戳（turn/start 的 event.time；-1 无） */
  readonly turnStartAt: number
  /** 回合内各 step usage 聚合（turn/end 写入统计行后清零） */
  readonly turnUsage: { input: number; output: number }
  /** 当前权限档位（permission/preset last-wins；null 未知） */
  readonly permissionCurrent: string | null
  /** 会话累计 usage（状态行统计，跨回合） */
  readonly totalUsage: { input: number; output: number }
  /** 会话统计（#21 顶栏 stats） */
  readonly stats: SessionStats
  /** 跨事件 fold 状态：当前 open step（用于 llmMs/ttftMs/decodeMs 累计） */
  readonly openStep: { startTime: number; firstTokenTime: number } | null
  /** 跨事件 fold 状态：tool/call 派发时间（callId → time，用于 toolMs 累计） */
  readonly pendingCalls: Record<string, number>
}

export const emptyStats: SessionStats = {
  turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0, cacheHitPct: NaN, turnInput: 0, turnOutput: 0,
}

export const emptySessionView: SessionView = {
  items: [], streamingIndex: -1, agentStatus: 'unknown', turnStartAt: -1, turnUsage: { input: 0, output: 0 }, permissionCurrent: null, totalUsage: { input: 0, output: 0 }, stats: emptyStats, openStep: null, pendingCalls: {},
}

// ---------- dsh 事件负载工具 ----------

type Data = Record<string, unknown>

function dataOf(event: DshSessionEvent): Data {
  return ((event as unknown as { data?: Data }).data ?? {}) as Data
}

function pickBlocks(message: Data): AssistantBlock[] {
  const content = message['content']
  if (!Array.isArray(content)) return []
  const blocks: AssistantBlock[] = []
  for (const raw of content) {
    if (typeof raw !== 'object' || raw === null) continue
    const b = raw as Data
    if (b['type'] === 'text' && typeof b['text'] === 'string') {
      blocks.push({ type: 'text', text: b['text'] })
    } else if (b['type'] === 'reasoning' && typeof b['text'] === 'string') {
      blocks.push({ type: 'reasoning', text: b['text'] })
    }
  }
  return blocks
}

function pickUserText(data: Data): string {
  const content = data['content']
  if (!Array.isArray(content)) return ''
  return content
    .map((raw) => {
      if (typeof raw === 'object' && raw !== null) {
        const b = raw as Data
        if (b['type'] === 'text' && typeof b['text'] === 'string') return b['text']
      }
      return ''
    })
    .join('')
}

/** 从 usage 载荷宽容提取缓存命中/未命中 token（DeepSeek/dsh 字段名多版本）。 */
function pickNum(raw: Data, ...keys: string[]): number {
  for (const key of keys) {
    const v = raw[key]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return -1
}

function pickCacheTokens(usageRaw: Data | undefined): { hit: number; total: number } | null {
  if (usageRaw === undefined) return null
  // dsh 的 usage：cacheReadTokens=缓存命中，inputTokens=未缓存输入（miss）
  const cacheRead = pickNum(usageRaw, 'cacheReadTokens')
  const inputTokens = pickNum(usageRaw, 'inputTokens')
  if (cacheRead < 0 && inputTokens < 0) return null
  const hit = Math.max(0, cacheRead)
  const miss = Math.max(0, inputTokens)
  return { hit, total: hit + miss }
}

/** 工具变体与单行摘要（对齐 dsh Web tool-call-model 的 SUMMARY_KEYS）。 */
function toolPresentation(name: string, argsJson: string): { variant: ToolVariant; summary: string } {
  let args: Data = {}
  try {
    args = JSON.parse(argsJson) as Data
  } catch {
    // arguments 流式聚合期间可能不是完整 JSON
  }
  const pick = (...keys: string[]): string => {
    for (const key of keys) {
      const v = args[key]
      if (typeof v === 'string' && v.length > 0) return v
    }
    return ''
  }
  switch (name) {
    case 'bash': case 'pwsh':
      return { variant: 'Bash', summary: pick('description', 'command') || argsJson.slice(0, 80) }
    case 'read': case 'web_fetch':
      return { variant: 'Read', summary: pick('path', 'file_path', 'url') }
    case 'write':
      return { variant: 'Write', summary: pick('path', 'file_path') }
    case 'edit':
      return { variant: 'Edit', summary: pick('path', 'file_path') }
    case 'grep': case 'glob': case 'web_search':
      return { variant: 'Search', summary: pick('query', 'pattern') }
    case 'run_code':
      return { variant: 'Code', summary: pick('language', 'description') }
    default:
      return { variant: 'Tool', summary: argsJson.length > 0 ? `${name} · ${argsJson.slice(0, 60)}` : name }
  }
}

function reasonOf(data: Data): { kind: TimelineItem['turnReason']; message: string } {
  const reason = data['reason'] as Data | undefined
  if (reason === undefined) return { kind: 'completed', message: '' }
  const kind = reason['kind']
  if (kind === 'error') {
    const err = reason['error'] as Data | undefined
    return { kind: 'error', message: typeof err?.['message'] === 'string' ? err['message'] : 'unknown error' }
  }
  if (kind === 'max-tokens') return { kind: 'max-tokens', message: '' }
  if (kind === 'aborted' || kind === 'interrupted' || kind === 'blocked') return { kind: 'aborted', message: '' }
  return { kind: 'completed', message: '' }
}

// ---------- reducer ----------

interface MutableState {
  items: TimelineItem[]
  streamingIndex: number
  agentStatus: SessionView['agentStatus']
  turnStartAt: number
  turnUsage: { input: number; output: number }
  permissionCurrent: string | null
  totalUsage: { input: number; output: number }
  stats: SessionStats
  /** 当前回合首个 text-delta 的 event.time（用于首 token 延迟） */
  turnFirstTokenAt: number
  /** 当前回合缓存命中/总 token（assistant/message usage 聚合） */
  turnCacheHit: number
  turnCacheTotal: number
  /** 当前 open step（用于 llmMs/ttftMs/decodeMs 累计） */
  openStep: { startTime: number; firstTokenTime: number } | null
  /** tool/call 派发时间（callId → time，用于 toolMs 累计） */
  pendingCalls: Record<string, number>
}

function ensureStreamingAssistant(state: MutableState, key: string): number {
  if (state.streamingIndex >= 0) return state.streamingIndex
  state.items.push({ key, kind: 'assistant', blocks: [], streaming: true })
  state.streamingIndex = state.items.length - 1
  return state.streamingIndex
}

function appendDelta(state: MutableState, blockType: 'text' | 'reasoning', delta: string): void {
  const idx = state.streamingIndex
  if (idx < 0) return
  const item = state.items[idx]!
  const blocks = [...(item.blocks ?? [])]
  const last = blocks[blocks.length - 1]
  if (last !== undefined && last.type === blockType) {
    blocks[blocks.length - 1] = { ...last, text: last.text + delta } as AssistantBlock
  } else {
    blocks.push(blockType === 'text' ? { type: 'text', text: delta } : { type: 'reasoning', text: delta, streaming: true })
  }
  state.items[idx] = { ...item, blocks }
}

/** 按 callId 找工具卡下标。 */
function findToolIndex(state: MutableState, callId: string): number {
  for (let i = state.items.length - 1; i >= 0; i -= 1) {
    const item = state.items[i]!
    if (item.kind === 'tool' && item.callId === callId) return i
  }
  return -1
}

export function reduceSessionEvent(view: SessionView, event: DshSessionEvent): SessionView {
  const data = dataOf(event)
  const state: MutableState = {
    items: [...view.items],
    streamingIndex: view.streamingIndex,
    agentStatus: view.agentStatus,
    turnStartAt: view.turnStartAt,
    turnUsage: { ...view.turnUsage },
    permissionCurrent: view.permissionCurrent,
    totalUsage: { ...view.totalUsage },
    stats: { ...view.stats },
    turnFirstTokenAt: -1,
    turnCacheHit: 0,
    turnCacheTotal: 0,
    openStep: view.openStep,
    pendingCalls: view.pendingCalls,
  }

  switch (event.type) {
    case 'user/message': {
      const text = pickUserText(data)
      const source = data['source'] as { kind?: string; plugin?: string; form?: string; summary?: string } | undefined
      // 上下文注入：非 user 来源（dsh 里 plugin 注入 skill 目录/workspace 指令等）
      if (source !== undefined && source.kind !== undefined && source.kind !== 'user') {
        const sectionsRaw = (source as { sections?: unknown }).sections
        const sections = Array.isArray(sectionsRaw)
          ? (sectionsRaw as { name?: unknown; text?: unknown }[]).flatMap((s) => (
            typeof s?.name === 'string' && typeof s?.text === 'string' ? [{ name: s.name, text: s.text }] : []
          ))
          : undefined
        state.items.push({
          key: `ci${event.seq}`,
          kind: 'contextInjection',
          text,
          producer: source.plugin ?? source.kind,
          contextForm: source.form,
          summary: typeof source.summary === 'string' ? source.summary : undefined,
          sections,
          seq: event.seq,
        })
        break
      }
      if (text.length > 0) state.items.push({ key: `u${event.seq}`, kind: 'user', text, seq: event.seq })
      break
    }

    case 'assistant/chunk': {
      const chunk = data['chunk'] as Data | undefined
      if (chunk === undefined) break
      const ctype = chunk['type']
      if (ctype === 'text-delta' && typeof chunk['text'] === 'string') {
        if (state.turnFirstTokenAt < 0) {
          const t = (event as unknown as { time?: unknown }).time
          if (typeof t === 'number') state.turnFirstTokenAt = t
        }
        if (state.openStep !== null && state.openStep.firstTokenTime < 0) {
          const t = (event as unknown as { time?: unknown }).time
          if (typeof t === 'number') state.openStep = { ...state.openStep, firstTokenTime: t }
        }
        ensureStreamingAssistant(state, `a${event.seq}`)
        appendDelta(state, 'text', chunk['text'])
      } else if (ctype === 'reasoning-delta' && typeof chunk['text'] === 'string') {
        // 首 token：reasoning-delta 也计入（对齐 dsh isTokenDelta）
        if (state.openStep !== null && state.openStep.firstTokenTime < 0) {
          const t = (event as unknown as { time?: unknown }).time
          if (typeof t === 'number') state.openStep = { ...state.openStep, firstTokenTime: t }
        }
        ensureStreamingAssistant(state, `a${event.seq}`)
        appendDelta(state, 'reasoning', chunk['text'])
      } else if (ctype === 'tool-call-delta') {
        // 流式工具调用：首个带 name 的 delta 建 running 卡；durable tool/call 到达时补全
        const callId = chunk['id']
        const name = chunk['name']
        if (typeof callId === 'string' && typeof name === 'string' && findToolIndex(state, callId) < 0) {
          state.items.push({ key: `t${event.seq}`, kind: 'tool', callId, variant: 'Tool', summary: name, toolStatus: 'running' })
          state.streamingIndex = -1 // 工具块中断 assistant 流式聚合
        }
      }
      break
    }

    case 'assistant/message': {
      const message = data['message'] as Data | undefined
      const blocks = message !== undefined ? pickBlocks(message) : []
      const usageRaw = data['usage'] as Data | undefined
      const usage = usageRaw !== undefined && typeof usageRaw['inputTokens'] === 'number' && typeof usageRaw['outputTokens'] === 'number'
        ? { input: usageRaw['inputTokens'] as number, output: usageRaw['outputTokens'] as number }
        : undefined
      if (usage !== undefined) {
        state.turnUsage = { input: state.turnUsage.input + usage.input, output: state.turnUsage.output + usage.output }
        state.totalUsage = { input: state.totalUsage.input + usage.input, output: state.totalUsage.output + usage.output }
      }
      const cache = pickCacheTokens(usageRaw)
      if (cache !== null) {
        state.turnCacheHit += cache.hit
        state.turnCacheTotal += cache.total
      }
      // 累计统计（对齐 dsh session-stats）：llmMs / ttftMs / decodeMs / decodeTokens
      if (state.openStep !== null) {
        const t = (event as unknown as { time?: unknown }).time
        if (typeof t === 'number') {
          state.stats = { ...state.stats, llmMs: state.stats.llmMs + Math.max(0, t - state.openStep.startTime) }
          if (state.openStep.firstTokenTime >= 0) {
            const output = usage !== undefined ? usage.output : 0
            state.stats = {
              ...state.stats,
              ttftMs: state.stats.ttftMs + Math.max(0, state.openStep.firstTokenTime - state.openStep.startTime),
              ttftSteps: state.stats.ttftSteps + 1,
              decodeMs: state.stats.decodeMs + Math.max(0, t - state.openStep.firstTokenTime),
              decodeTokens: state.stats.decodeTokens + output,
            }
          }
        }
        state.openStep = null
      }
      if (state.streamingIndex >= 0) {
        const idx = state.streamingIndex
        state.items[idx] = { ...state.items[idx]!, blocks, streaming: false, usage, seq: event.seq }
      } else if (blocks.length > 0) {
        state.items.push({ key: `a${event.seq}`, kind: 'assistant', blocks, streaming: false, usage, seq: event.seq })
      }
      state.streamingIndex = -1
      break
    }

    case 'tool/call': {
      const callId = data['callId']
      const name = data['name']
      if (typeof callId !== 'string' || typeof name !== 'string') break
      const argsJson = typeof data['arguments'] === 'string' ? data['arguments'] : ''
      const { variant, summary } = toolPresentation(name, argsJson)
      let argsPretty = argsJson
      try {
        argsPretty = JSON.stringify(JSON.parse(argsJson), null, 2)
      } catch {
        // 聚合不全时保持原样
      }
      const existing = findToolIndex(state, callId)
      if (existing >= 0) {
        state.items[existing] = { ...state.items[existing]!, variant, summary, argsPretty }
      } else {
        state.items.push({ key: `t${event.seq}`, kind: 'tool', callId, variant, summary, toolStatus: 'running', argsPretty })
      }
      const t = (event as unknown as { time?: unknown }).time
      if (typeof t === 'number') state.pendingCalls[callId] = t
      break
    }

    case 'tool/result': {
      const message = data['message'] as Data | undefined
      const callId = (message?.['source'] as Data | undefined)?.['callId']
      if (typeof callId !== 'string') break
      const blocks = Array.isArray(message?.['content']) ? (message!['content'] as unknown[]) : []
      let output = ''
      let isError = false
      for (const raw of blocks) {
        if (typeof raw !== 'object' || raw === null) continue
        const b = raw as Data
        if (b['isError'] === true) isError = true
        const inner = Array.isArray(b['content']) ? (b['content'] as unknown[]) : []
        for (const leaf of inner) {
          if (typeof leaf === 'object' && leaf !== null) {
            const l = leaf as Data
            if (typeof l['text'] === 'string') {
              output = `${output}${(output.length > 0 ? '\n' : '')}${l['text']}`
            }
          }
        }
      }
      const idx = findToolIndex(state, callId)
      if (idx >= 0) {
        const item = state.items[idx]!
        const next: TimelineItem = {
          ...item,
          toolStatus: isError ? 'error' : 'ok',
          outputPreview: output.length > 2000 ? `${output.slice(0, 2000)}\n…` : output,
        }
        state.items[idx] = isError
          ? { ...next, errorLine: output.split('\n')[0] ?? '' }
          : next
      }
      // 工具耗时累计（tool/call 派发 → tool/result 落回）
      const dispatched = Object.prototype.hasOwnProperty.call(state.pendingCalls, callId) ? state.pendingCalls[callId] : undefined
      if (dispatched !== undefined) {
        const t = (event as unknown as { time?: unknown }).time
        if (typeof t === 'number') {
          state.stats = { ...state.stats, toolMs: state.stats.toolMs + Math.max(0, t - dispatched) }
        }
        delete state.pendingCalls[callId]
      }
      break
    }

    case 'turn/start': {
      state.agentStatus = 'running'
      state.streamingIndex = -1
      const startedAt = (event as unknown as { time?: unknown }).time
      state.turnStartAt = typeof startedAt === 'number' ? startedAt : -1
      state.turnUsage = { input: 0, output: 0 }
      state.turnFirstTokenAt = -1
      state.turnCacheHit = 0
      state.turnCacheTotal = 0
      state.stats = { ...state.stats, turns: state.stats.turns + 1 }
      break
    }

    case 'turn/end': {
      if (state.streamingIndex >= 0) {
        // 定稿缺失（异常中断）：把流式块定格
        const idx = state.streamingIndex
        state.items[idx] = { ...state.items[idx]!, streaming: false }
        state.streamingIndex = -1
      }
      const { kind, message } = reasonOf(data)
      if (kind === 'aborted') {
        // stopped 标记落在最后一条 assistant（对齐 dsh interrupted 呈现）
        for (let i = state.items.length - 1; i >= 0; i -= 1) {
          if (state.items[i]!.kind === 'assistant') {
            state.items[i] = { ...state.items[i]!, stopped: true }
            break
          }
        }
      }
      const endedAt = (event as unknown as { time?: unknown }).time
      const ranMs = state.turnStartAt > 0 && typeof endedAt === 'number' ? Math.max(0, endedAt - state.turnStartAt) : undefined
      const turnTokens = { ...state.turnUsage }
      const cacheHitPct = state.turnCacheTotal > 0
        ? Math.round((state.turnCacheHit / state.turnCacheTotal) * 100)
        : NaN
      state.stats = {
        ...state.stats,
        cacheHitPct,
        turnInput: turnTokens.input,
        turnOutput: turnTokens.output,
      }
      // turn 结束：清掉未落回的 tool 派发记录（对齐 dsh，取消/失败回合的残余调用丢弃）
      state.pendingCalls = {}
      state.openStep = null
      state.items.push({
        key: `e${event.seq}`,
        kind: 'turnEnd',
        turnReason: kind,
        reasonMessage: message,
        ranMs,
        turnTokens,
      })
      state.agentStatus = 'idle'
      break
    }

    case 'permission/preset': {
      const preset = data['preset']
      if (typeof preset === 'string') state.permissionCurrent = preset
      break
    }

    case 'compaction/summary': {
      // 对齐 dsh CompactionItem：折叠行「压缩 · N 条 · M tokens」，展开为摘要正文
      const shadowed = data['shadowedSeqs']
      const tokenCount = data['shadowedTokenCount']
      const items = Array.isArray(shadowed) ? shadowed.length : 0
      const tokens = typeof tokenCount === 'number' ? tokenCount : 0
      const summaryBlocks = Array.isArray(data['summary']) ? (data['summary'] as unknown[]) : []
      const summaryText = summaryBlocks
        .map((raw) => {
          if (typeof raw === 'object' && raw !== null) {
            const b = raw as Record<string, unknown>
            if (typeof b['text'] === 'string') return b['text']
          }
          return ''
        })
        .join('\n')
      state.items.push({
        key: `c${event.seq}`,
        kind: 'compaction',
        compaction: { items, tokens, summaryText: summaryText.slice(0, 2000) },
      })
      break
    }

    case 'step/start': {
      const t = (event as unknown as { time?: unknown }).time
      state.openStep = { startTime: typeof t === 'number' ? t : -1, firstTokenTime: -1 }
      break
    }

    case 'step/end': {
      state.stats = { ...state.stats, steps: state.stats.steps + 1 }
      break
    }

    default:
      // 其它 step/* 事件不单独处理
      if (typeof event.type === 'string' && event.type.startsWith('step/')) {
        break
      }
      return view
  }
  return {
    items: state.items,
    streamingIndex: state.streamingIndex,
    agentStatus: state.agentStatus,
    turnStartAt: state.turnStartAt,
    turnUsage: state.turnUsage,
    permissionCurrent: state.permissionCurrent,
    totalUsage: state.totalUsage,
    stats: state.stats,
    openStep: state.openStep,
    pendingCalls: state.pendingCalls,
  }
}

export function reduceSessionEvents(events: readonly DshSessionEvent[]): SessionView {
  return events.reduce(reduceSessionEvent, emptySessionView)
}

/** 会话列表条目投影。 */
export interface SessionListItem {
  readonly id: string
  readonly createdAt: number
  /** 最后一次活动时间（bridge 增强；缺失回退 createdAt） */
  readonly lastActivityAt: number
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
    const semanticTitle = typeof e['title'] === 'string' && e['title'].length > 0 ? e['title'] : null
    items.push({
      id: e['id'],
      createdAt,
      lastActivityAt: typeof e['lastActivityAt'] === 'number' ? e['lastActivityAt'] : createdAt,
      cwd,
      lastSeq: typeof e['lastSeq'] === 'number' ? e['lastSeq'] : -1,
      live: e['live'] === true,
      agentStatus: typeof e['agentStatus'] === 'string' ? e['agentStatus'] : null,
      title: semanticTitle ?? (cwd !== null ? cwd.split('/').filter(Boolean).pop() ?? cwd : `会话 ${new Date(createdAt).toLocaleString()}`),
    })
  }
  return items.sort((a, b) => b.lastActivityAt - a.lastActivityAt)
}
