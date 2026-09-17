/**
 * Gateway 帧：Worker↔Gateway uplink 与 手机↔Gateway 两条 WebSocket 的信封。
 *
 * Gateway 是隧道：`phone-frame` / `worker-frame` 只按 workerId 路由，
 * 不解析内层 /mobile 协议内容（内层仍是本包 rpc/events 的 JSON 文本）。
 */

import type { DshSessionEvent } from './events.js'

// ---------- Worker uplink（插件 → gateway）----------

/**
 * Worker 机器的静态信息（注册时上送一次）。
 *
 * 用途：手机端「选择 Worker / Worker 详情」要显示 `macOS 14.6 · 8 核 16GB`
 * 这类机器信息，而这些字段不在会话协议里，必须随注册帧带上来。
 * 运行时指标（CPU / 内存占用）不在这里——那需要单独的采集 RPC。
 */
export interface WorkerHostInfo {
  readonly hostname?: string
  /** 人类可读的系统版本，如 `macOS 14.6` / `Windows 11` */
  readonly osVersion?: string
  readonly cpuCores?: number
  readonly memoryBytes?: number
  /** 上报时的 dsh 运行版本（可能比 capabilities.dshVersion 更细） */
  readonly runtimeVersion?: string
}

export interface WorkerRegisterFrame {
  readonly kind: 'worker-register'
  readonly hostKey: string
  readonly protocolVersion: string
  readonly name: string
  readonly hostFingerprint: string
  readonly dshVersion: string | null
  /** 机器静态信息（旧版插件不带，缺失时手机端只显示名称与在线态） */
  readonly host?: WorkerHostInfo
  /**
   * Worker 持有的账号 session token（可选；桌面端登录后写入本机会话文件，
   * 插件每次连接时读取）。gateway 验签通过后把该 Worker 自动绑定到对应账号，
   * 同账号手机端免扫码直连。
   */
  readonly accountToken?: string
}

export type WorkerToGatewayFrame =
  | WorkerRegisterFrame
  | { readonly kind: 'pong'; readonly nonce: number }
  /** 发往当前已接入手机的内层 /mobile 帧（文本 JSON） */
  | { readonly kind: 'phone-frame'; readonly inner: string }
  /** 通知信号（带外）：待审批 / agent 空闲 / turn 完成 */
  | {
      readonly kind: 'notify'
      readonly signal: 'approval-pending' | 'agent-idle' | 'turn-complete' | 'worker-online' | 'worker-offline'
      readonly sessionId?: string
      readonly title: string
      readonly body: string
    }

// ---------- Gateway → Worker ----------

export type GatewayToWorkerFrame =
  | {
      readonly kind: 'register-ok'
      readonly workerId: string
      /** 本次注册经 accountToken 自动绑定的账号（null = 未携带/验签失败/已解绑） */
      readonly boundUserId?: string | null
    }
  | { readonly kind: 'register-rejected'; readonly reason: string }
  | { readonly kind: 'ping'; readonly nonce: number }
  /** 来自手机的内层 /mobile 帧（文本 JSON） */
  | { readonly kind: 'phone-frame'; readonly phoneId: string; readonly inner: string }

// ---------- 手机 ↔ Gateway ----------

export interface PhoneAuthFrame {
  readonly kind: 'phone-auth'
  /** 掌鲸 DSH Pocket session token（Bearer）；gateway 调内部校验端点验真 */
  readonly authToken: string
  /** 设备推送标识（expo push token，可后续注册） */
  readonly deviceKey: string
}

export type PhoneToGatewayFrame =
  | PhoneAuthFrame
  | { readonly kind: 'pong'; readonly nonce: number }
  /** 打开/关闭与某 Worker 的转发通道 */
  | { readonly kind: 'worker-open'; readonly workerId: string }
  | { readonly kind: 'worker-close'; readonly workerId: string }
  /** 发往 Worker 的内层 /mobile 帧（文本 JSON） */
  | { readonly kind: 'worker-frame'; readonly workerId: string; readonly inner: string }

export interface GatewayToPhoneFrame$Presence {
  readonly kind: 'presence'
  readonly workers: readonly WorkerPresence[]
}

export interface WorkerPresence {
  readonly workerId: string
  readonly name: string
  readonly hostFingerprint: string
  readonly online: boolean
  readonly lastSeenAt: number
  /** Worker 端能力（缓存自最近一次注册；离线时为 null） */
  readonly capabilities: {
    readonly dshVersion: string | null
    readonly protocolVersion: string
  } | null
  /** 机器静态信息（注册时上送；离线或旧版插件时为 null） */
  readonly host: WorkerHostInfo | null
}

export type GatewayToPhoneFrame =
  | GatewayToPhoneFrame$Presence
  | { readonly kind: 'auth-ok'; readonly userId: string }
  | { readonly kind: 'auth-rejected'; readonly reason: string }
  | { readonly kind: 'ping'; readonly nonce: number }
  | { readonly kind: 'worker-open-result'; readonly workerId: string; readonly ok: boolean; readonly reason?: string }
  | { readonly kind: 'worker-frame'; readonly workerId: string; readonly inner: string }
  | { readonly kind: 'push'; readonly title: string; readonly body: string; readonly sessionId?: string }

// ---------- 解析器 ----------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parseHostInfo(value: unknown): WorkerHostInfo | null {
  const v = asRecord(value)
  if (!v) return null
  const info: {
    hostname?: string
    osVersion?: string
    cpuCores?: number
    memoryBytes?: number
    runtimeVersion?: string
  } = {}
  if (typeof v.hostname === 'string' && v.hostname.length > 0) info.hostname = v.hostname
  if (typeof v.osVersion === 'string' && v.osVersion.length > 0) info.osVersion = v.osVersion
  if (typeof v.cpuCores === 'number' && Number.isFinite(v.cpuCores)) info.cpuCores = v.cpuCores
  if (typeof v.memoryBytes === 'number' && Number.isFinite(v.memoryBytes)) {
    info.memoryBytes = v.memoryBytes
  }
  if (typeof v.runtimeVersion === 'string' && v.runtimeVersion.length > 0) {
    info.runtimeVersion = v.runtimeVersion
  }
  return Object.keys(info).length > 0 ? info : null
}

function parsePresence(value: unknown): WorkerPresence | null {
  const v = asRecord(value)
  if (!v) return null
  if (typeof v.workerId !== 'string' || typeof v.name !== 'string') return null
  if (typeof v.hostFingerprint !== 'string' || typeof v.online !== 'boolean') return null
  if (typeof v.lastSeenAt !== 'number') return null
  let capabilities: WorkerPresence['capabilities'] = null
  const c = asRecord(v.capabilities)
  if (c && typeof c.protocolVersion === 'string') {
    capabilities = {
      dshVersion: typeof c.dshVersion === 'string' ? c.dshVersion : null,
      protocolVersion: c.protocolVersion,
    }
  }
  return {
    workerId: v.workerId,
    name: v.name,
    hostFingerprint: v.hostFingerprint,
    online: v.online,
    lastSeenAt: v.lastSeenAt,
    capabilities,
    host: parseHostInfo(v.host),
  }
}

/** 解析 gateway → phone 帧（app 侧使用）。 */
export function parseGatewayToPhoneFrame(value: unknown): GatewayToPhoneFrame | null {
  const v = asRecord(value)
  if (!v || typeof v.kind !== 'string') return null
  switch (v.kind) {
    case 'presence': {
      const workers = Array.isArray(v.workers) ? v.workers.map(parsePresence) : []
      if (workers.some((w) => w === null)) return null
      return { kind: 'presence', workers: workers as WorkerPresence[] }
    }
    case 'auth-ok':
      return typeof v.userId === 'string' ? { kind: 'auth-ok', userId: v.userId } : null
    case 'auth-rejected':
      return typeof v.reason === 'string' ? { kind: 'auth-rejected', reason: v.reason } : null
    case 'ping':
      return typeof v.nonce === 'number' ? { kind: 'ping', nonce: v.nonce } : null
    case 'worker-open-result':
      return typeof v.workerId === 'string' && typeof v.ok === 'boolean'
        ? { kind: 'worker-open-result', workerId: v.workerId, ok: v.ok }
        : null
    case 'worker-frame':
      return typeof v.workerId === 'string' && typeof v.inner === 'string'
        ? { kind: 'worker-frame', workerId: v.workerId, inner: v.inner }
        : null
    case 'push':
      return typeof v.title === 'string' && typeof v.body === 'string'
        ? { kind: 'push', title: v.title, body: v.body }
        : null
    default:
      return null
  }
}

/** 解析 gateway → worker 帧（插件侧使用）。 */
export function parseGatewayToWorkerFrame(value: unknown): GatewayToWorkerFrame | null {
  const v = asRecord(value)
  if (!v || typeof v.kind !== 'string') return null
  switch (v.kind) {
    case 'register-ok':
      return typeof v.workerId === 'string'
        ? {
            kind: 'register-ok',
            workerId: v.workerId,
            ...(typeof v.boundUserId === 'string' || v.boundUserId === null
              ? { boundUserId: v.boundUserId as string | null }
              : {}),
          }
        : null
    case 'register-rejected':
      return typeof v.reason === 'string' ? { kind: 'register-rejected', reason: v.reason } : null
    case 'ping':
      return typeof v.nonce === 'number' ? { kind: 'ping', nonce: v.nonce } : null
    case 'phone-frame':
      return typeof v.phoneId === 'string' && typeof v.inner === 'string'
        ? { kind: 'phone-frame', phoneId: v.phoneId, inner: v.inner }
        : null
    default:
      return null
  }
}

// ---------- 通知信号辅助（插件侧组装）----------

export interface NotifySignalInput {
  readonly signal: 'approval-pending' | 'agent-idle' | 'turn-complete'
  readonly sessionId?: string
  readonly title: string
  readonly body: string
}

export function makeNotifyFrame(input: NotifySignalInput): Extract<WorkerToGatewayFrame, { kind: 'notify' }> {
  return { kind: 'notify', ...input }
}

/** 内层事件帧序列化辅助（插件下发 /mobile 事件给手机）。 */
export function makePhoneEventInner(sessionId: string, event: DshSessionEvent): string {
  return JSON.stringify({ kind: 'event', sessionId, seq: event.seq, event })
}
