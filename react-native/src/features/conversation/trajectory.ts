/**
 * 轨迹投影（批次 1 的纯逻辑部分）。
 *
 * 把 append-only 的 dsh SessionEvent 流折叠成按时间排序的步骤列表，
 * 供移动端「轨迹」全屏页渲染（对应 Web 的 Trajectory 视图，去掉缩放手势改列表 + 明细）。
 *
 * 提供两种用法：
 *   foldTrajectory      —— 增量 fold，reducer 每来一个事件调用一次（工具卡先 running 后定稿）
 *   projectTrajectory   —— 一次性投影整段事件流（测试/离线分析）
 * 纯函数、无 React 依赖。
 */
import type { DshSessionEvent } from '@deepseek-harness-pocket/bridge-protocol';

export type TrajectoryKind = 'user' | 'assistant' | 'tool' | 'compaction' | 'turn-end'

export type TrajectoryStatus = 'ok' | 'error' | 'running' | 'aborted' | 'info'

export interface TrajectoryStep {
  readonly seq: number
  readonly kind: TrajectoryKind
  /** 所属轮次（从 1 开始；turn/start 递增） */
  readonly turn: number
  readonly label: string
  readonly detail?: string
  readonly startMs: number | null
  readonly durationMs: number | null
  readonly status: TrajectoryStatus
  readonly tokensIn?: number
  readonly tokensOut?: number
  readonly toolName?: string
}

export interface TrajectoryFold {
  steps: TrajectoryStep[]
  turn: number
  /** callId → 已 push 的工具步骤下标 */
  pending: Record<string, number>
}

export function emptyTrajectoryFold(): TrajectoryFold {
  return { steps: [], turn: 0, pending: {} };
}

type Data = Record<string, unknown>

function dataOf(event: DshSessionEvent): Data {
  return ((event as unknown as { data?: Data }).data ?? {}) as Data
}

function timeOf(event: DshSessionEvent): number | null {
  const t = (event as unknown as { time?: unknown }).time
  return typeof t === 'number' && Number.isFinite(t) ? t : null
}

function textOfUser(data: Data): string {
  const content = data['content']
  if (!Array.isArray(content)) return ''
  return content
    .map((raw) => {
      if (typeof raw !== 'object' || raw === null) return ''
      const b = raw as Data
      return b['type'] === 'text' && typeof b['text'] === 'string' ? b['text'] : ''
    })
    .join('')
    .trim()
}

function usageOf(data: Data): Readonly<{ input?: number; output?: number }> {
  const usage = data['usage']
  if (typeof usage !== 'object' || usage === null) return {}
  const u = usage as Data
  const input = typeof u['inputTokens'] === 'number' ? u['inputTokens'] : undefined
  const output = typeof u['outputTokens'] === 'number' ? u['outputTokens'] : undefined
  return {
    ...(input !== undefined ? { input } : {}),
    ...(output !== undefined ? { output } : {}),
  }
}

/**
 * 增量折叠一个事件。
 *
 * **写时复制**：不影响传入的 fold（`emptySessionView` 是模块级单例，
 * 就地修改会让新会话继承上一个会话的轨迹）。未命中轨迹的事件原样返回入参。
 */
export function foldTrajectory(fold: TrajectoryFold, event: DshSessionEvent): TrajectoryFold {
  const data = dataOf(event)
  const time = timeOf(event)
  const turn = Math.max(fold.turn, 1)

  switch (event.type) {
    case 'turn/start': {
      return { ...fold, turn: fold.turn + 1 }
    }

    case 'user/message': {
      const source = data['source'] as Data | undefined
      if (source !== undefined && typeof source['kind'] === 'string' && source['kind'] !== 'user') return fold
      const text = textOfUser(data)
      return {
        ...fold,
        steps: [...fold.steps, {
          seq: event.seq,
          kind: 'user',
          turn,
          label: '用户消息',
          detail: text.length > 120 ? `${text.slice(0, 120)}…` : text,
          startMs: time,
          durationMs: null,
          status: 'info',
        }],
      }
    }

    case 'assistant/message': {
      const usage = usageOf(data)
      return {
        ...fold,
        steps: [...fold.steps, {
          seq: event.seq,
          kind: 'assistant',
          turn,
          label: '模型输出',
          startMs: time,
          durationMs: null,
          status: 'ok',
          ...(usage.input !== undefined ? { tokensIn: usage.input } : {}),
          ...(usage.output !== undefined ? { tokensOut: usage.output } : {}),
        }],
      }
    }

    case 'tool/call': {
      const callId = data['callId']
      const name = data['name']
      if (typeof callId !== 'string' || typeof name !== 'string') return fold
      return {
        ...fold,
        steps: [...fold.steps, {
          seq: event.seq,
          kind: 'tool',
          turn,
          label: name,
          toolName: name,
          startMs: time,
          durationMs: null,
          status: 'running',
        }],
        pending: { ...fold.pending, [callId]: fold.steps.length },
      }
    }

    case 'tool/result': {
      const message = data['message'] as Data | undefined
      const callId = (message?.['source'] as Data | undefined)?.['callId']
      if (typeof callId !== 'string') return fold
      const index = fold.pending[callId]
      if (index === undefined) return fold
      const step = fold.steps[index]
      if (step === undefined) return fold
      const blocks = Array.isArray(message?.['content']) ? (message!['content'] as unknown[]) : []
      const isError = blocks.some((raw) =>
        typeof raw === 'object' && raw !== null && (raw as Data)['isError'] === true)
      const durationMs = step.startMs !== null && time !== null
        ? Math.max(0, time - step.startMs)
        : null
      const steps = fold.steps.slice()
      steps[index] = { ...step, status: isError ? 'error' : 'ok', durationMs }
      const pending = { ...fold.pending }
      delete pending[callId]
      return { ...fold, steps, pending }
    }

    case 'compaction/summary': {
      const shadowed = data['shadowedSeqs']
      const count = Array.isArray(shadowed) ? shadowed.length : 0
      const tokens = typeof data['shadowedTokenCount'] === 'number' ? data['shadowedTokenCount'] : 0
      return {
        ...fold,
        steps: [...fold.steps, {
          seq: event.seq,
          kind: 'compaction',
          turn,
          label: '上下文压缩',
          detail: `${count} 条 · ${tokens} tokens`,
          startMs: time,
          durationMs: null,
          status: 'info',
        }],
      }
    }

    case 'turn/end': {
      const reason = data['reason'] as Data | undefined
      const kind = reason?.['kind']
      const isAborted = kind === 'aborted' || kind === 'interrupted' || kind === 'blocked'
      const isError = kind === 'error'
      const err = reason?.['error'] as Data | undefined
      return {
        ...fold,
        steps: [...fold.steps, {
          seq: event.seq,
          kind: 'turn-end',
          turn,
          label: '回合结束',
          ...(isError && typeof err?.['message'] === 'string' ? { detail: err['message'] } : {}),
          startMs: time,
          durationMs: null,
          status: isAborted ? 'aborted' : isError ? 'error' : 'ok',
        }],
      }
    }

    default:
      return fold
  }
}

/** 一次性投影整段事件流。 */
export function projectTrajectory(events: readonly DshSessionEvent[]): readonly TrajectoryStep[] {
  let fold = emptyTrajectoryFold()
  for (const event of events) fold = foldTrajectory(fold, event)
  return fold.steps.slice().sort((a, b) => a.seq - b.seq)
}

/** 轨迹聚合统计：按状态计数 + 工具总耗时，供页面顶部概览。 */
export function summarizeTrajectory(steps: readonly TrajectoryStep[]): Readonly<{
  turns: number
  tools: number
  toolMs: number
  errors: number
}> {
  let tools = 0
  let toolMs = 0
  let errors = 0
  let maxTurn = 0
  for (const step of steps) {
    if (step.turn > maxTurn) maxTurn = step.turn
    if (step.kind === 'tool') {
      tools += 1
      if (step.durationMs !== null) toolMs += step.durationMs
    }
    if (step.status === 'error') errors += 1
  }
  return { turns: maxTurn, tools, toolMs, errors }
}
