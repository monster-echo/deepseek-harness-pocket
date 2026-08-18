/**
 * 会话事件通道：dsh SessionEvent 原样透传。
 *
 * dsh 的 Session log 是 append-only、全 JSON、seq 连续的事件流
 * （turn/*、step/*、user/message、assistant/chunk、assistant/message、
 * tool/call、tool/result …，见 dsh docs/subsystems/session.md）。
 * 本包不逐一枚举事件负载（dsh 预览期演进快），以宽松类型透传，
 * 视图模型由 app 侧 reducer 依据 `type` 分派。
 */

/**
 * dsh SessionEvent 的宽松透传类型。
 * `type` 与 `seq` 为稳定字段；其余负载按事件类型不同。
 */
export interface DshSessionEvent {
  readonly type: string
  readonly seq: number
  readonly [key: string]: unknown
}

/** 下行事件信封：标注会话与来源 worker（经 gateway 时填充）。 */
export interface MobileEvent {
  readonly sessionId: string
  readonly seq: number
  readonly event: DshSessionEvent
  readonly workerId?: string
}

/** 快照：sessions.open 时从 log 重放的既有事件（可按 seq 截断）。 */
export interface SessionSnapshot {
  readonly sessionId: string
  /** 快照起点（含）；0 表示从头 */
  readonly fromSeq: number
  /** 快照终点（含）；-1 表示当前末尾 */
  readonly toSeq: number
  readonly events: readonly DshSessionEvent[]
}

export function parseMobileEvent(value: unknown): MobileEvent | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (typeof v.sessionId !== 'string' || v.sessionId.length === 0) return null
  if (typeof v.seq !== 'number' || !Number.isInteger(v.seq) || v.seq < 0) return null
  const event = v.event
  if (typeof event !== 'object' || event === null) return null
  const e = event as Record<string, unknown>
  if (typeof e.type !== 'string') return null
  if (typeof e.seq !== 'number') return null
  const workerId = v.workerId
  if (workerId !== undefined && typeof workerId !== 'string') return null
  if (workerId === undefined) {
    return { sessionId: v.sessionId, seq: v.seq, event: e as DshSessionEvent }
  }
  return { sessionId: v.sessionId, seq: v.seq, event: e as DshSessionEvent, workerId }
}
