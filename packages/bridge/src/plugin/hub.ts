/**
 * 手机连接 Hub：/mobile 协议的路由分发与推送扇出。
 *
 * 与传输解耦：直连 server 与 gateway uplink 都把「已认证的手机连接」注册到这里，
 * 共享同一套路由、订阅与审批逻辑。仅依赖 DshAdapter 窄接口，可脱离 dsh 单测。
 */

import {
  isCompatibleVersion,
  M1_CAPABILITIES,
  PROTOCOL_VERSION,
  parsePhoneFrame,
  type BridgeCapabilities,
  type DshSessionEvent,
  type WireRequest,
  type WireResponse,
} from '@deepseek-harness-pocket/bridge-protocol'
import { makeRpcId, methodKey, parseWireRequest, rpcFailure, rpcSuccess } from '@deepseek-harness-pocket/bridge-protocol'
import type { ApprovalAsk, DshAdapter, QuestionAsk } from './adapter-dsh.js'
import type { DirEntry } from './adapter-dsh.js'

export interface PhoneSender {
  send(text: string): void
}

interface PhoneConn {
  readonly id: string
  readonly sender: PhoneSender
  authed: boolean
  /** gateway 隧道连接：gateway 已完成用户鉴权与配对校验，免 pairing token */
  readonly trusted: boolean
  readonly subscribed: Set<string>
}

export interface HubOptions {
  readonly workerName: string
  readonly fingerprint: string
  readonly capsLevel: 'm1' | 'm2' | 'm3'
  readonly readOnly: boolean
  readonly pairingToken: string
  readonly verifyToken: (expected: string, actual: string) => boolean
  readonly now?: () => number
  /** 新会话默认模型路由 */
  readonly defaultModel: { provider: string; model: string }
}

export function capsForLevel(level: 'm1' | 'm2' | 'm3'): BridgeCapabilities {
  if (level === 'm1') return M1_CAPABILITIES
  if (level === 'm2') {
    return { ...M1_CAPABILITIES, turnControl: true, approvals: true }
  }
  return { ...M1_CAPABILITIES, turnControl: true, approvals: true, sessionCreate: true, artifacts: true }
}

let connSeq = 0

export class BridgeHub {
  private readonly conns = new Map<string, PhoneConn>()
  private readonly pendingAsks = new Map<string, ApprovalAsk | QuestionAsk>()
  private readonly disposer: () => void
  readonly capabilities: BridgeCapabilities

  constructor(private readonly adapter: DshAdapter, private readonly opts: HubOptions) {
    this.capabilities = capsForLevel(opts.capsLevel)
    this.disposer = adapter.onEvent((sessionId, event) => this.broadcastEvent(sessionId, event))
  }

  dispose(): void {
    this.disposer()
    for (const ask of this.pendingAsks.values()) {
      if ('decide' in ask) void ask.decide('pass')
    }
    this.pendingAsks.clear()
    this.conns.clear()
  }

  /** 已认证连接数（审批应答器据此决定是否接手）。 */
  connectedCount(): number {
    let n = 0
    for (const c of this.conns.values()) if (c.authed) n++
    return n
  }

  /** 注册一个新的物理连接；trusted=true（经 gateway）时立即完成认证。返回连接 id。 */
  attach(sender: PhoneSender, options?: { trusted?: boolean }): string {
    const id = `c${++connSeq}`
    const trusted = options?.trusted === true
    const conn: PhoneConn = { id, sender, authed: trusted, trusted, subscribed: new Set() }
    this.conns.set(id, conn)
    if (trusted) this.sendTo(conn, { kind: 'auth-ok' })
    return id
  }

  detach(connId: string): void {
    this.conns.delete(connId)
  }

  /**
   * 处理一帧文本（来自直连 WS 或 gateway 转发）。
   * - 'authed'：本帧完成认证（调用方可取消认证超时）
   * - 'ok'：正常处理
   * - 'reject'：协议错误或认证失败，调用方应断开连接
   */
  handleFrame(connId: string, text: string): 'authed' | 'ok' | 'reject' {
    const conn = this.conns.get(connId)
    if (!conn) return 'reject'
    const frame = parsePhoneFrame(text)
    if (frame === null) return 'reject'
    switch (frame.kind) {
      case 'auth': {
        if (conn.trusted || this.opts.verifyToken(this.opts.pairingToken, frame.token)) {
          conn.authed = true
          this.sendTo(conn, { kind: 'auth-ok' })
          return 'authed'
        }
        this.sendTo(conn, { kind: 'auth-rejected', reason: 'invalid pairing token' })
        return 'reject'
      }
      case 'pong':
        return 'ok'
      case 'rpc': {
        if (!conn.authed) {
          const response = rpcFailure(frame.request.id, 'unauthorized', 'authenticate first')
          this.sendTo(conn, { kind: 'rpc-result', response })
          return 'ok'
        }
        void this.dispatch(frame.request)
          .then((response) => this.sendTo(conn, { kind: 'rpc-result', response }))
          .catch((error: unknown) => {
            const response = rpcFailure(
              frame.request.id,
              'internal',
              error instanceof Error ? error.message : String(error),
            )
            this.sendTo(conn, { kind: 'rpc-result', response })
          })
        return 'ok'
      }
    }
  }

  /** mobile/v1 白名单分发。 */
  async dispatch(request: unknown): Promise<WireResponse> {
    const req = parseWireRequest(request)
    if (req === null) return rpcFailure('?', 'bad-request', 'malformed wire request')
    const key = methodKey(req.ns, req.method)
    const fail = (code: Parameters<typeof rpcFailure>[1], message: string): WireResponse =>
      rpcFailure(req.id, code, message)
    const denyIf = (condition: boolean, code: 'forbidden' | 'unavailable', message: string): WireResponse | null =>
      condition ? fail(code, message) : null

    switch (key) {
      case 'handshake.hello': {
        const client = req.args['client']
        const version = req.args['protocolVersion']
        if (typeof client !== 'string' || typeof version !== 'string') {
          return fail('bad-request', 'client and protocolVersion required')
        }
        if (!isCompatibleVersion(version, PROTOCOL_VERSION)) {
          return fail('version-mismatch', `server ${PROTOCOL_VERSION}, client ${version}`)
        }
        return rpcSuccess(req.id, {
          host: {
            name: this.opts.workerName,
            hostFingerprint: this.opts.fingerprint,
            dshVersion: this.adapter.dshVersion(),
            protocolVersion: PROTOCOL_VERSION,
            capabilities: this.capabilities,
          },
          serverTime: (this.opts.now ?? Date.now)(),
        })
      }

      case 'sessions.list':
        return rpcSuccess(req.id, { sessions: await this.adapter.listSessions() })

      case 'sessions.open': {
        const sessionId = req.args['sessionId']
        if (typeof sessionId !== 'string') return fail('bad-request', 'sessionId required')
        const slice = await this.adapter.readSlice(sessionId, 0)
        if (slice === null) return fail('not-found', `unknown session ${sessionId}`)
        for (const c of this.conns.values()) {
          if (c.authed) c.subscribed.add(sessionId)
        }
        this.broadcast(snapshotFrame(slice))
        return rpcSuccess(req.id, { fromSeq: slice.fromSeq, toSeq: slice.toSeq, count: slice.events.length })
      }

      case 'sessions.close': {
        const sessionId = req.args['sessionId']
        if (typeof sessionId !== 'string') return fail('bad-request', 'sessionId required')
        for (const c of this.conns.values()) c.subscribed.delete(sessionId)
        return rpcSuccess(req.id, { ok: true })
      }

      case 'sessions.resync': {
        const sessionId = req.args['sessionId']
        const lastSeq = req.args['lastSeq']
        if (typeof sessionId !== 'string' || typeof lastSeq !== 'number' || lastSeq < -1) {
          return fail('bad-request', 'sessionId and lastSeq required')
        }
        const slice = await this.adapter.readSlice(sessionId, lastSeq + 1)
        if (slice === null) return fail('not-found', `unknown session ${sessionId}`)
        this.broadcast(snapshotFrame(slice))
        return rpcSuccess(req.id, { fromSeq: slice.fromSeq, toSeq: slice.toSeq, count: slice.events.length })
      }

      case 'workspaces.list': {
        const denied = denyIf(!this.capabilities.sessionCreate, 'unavailable', 'session create not enabled')
        if (denied) return denied
        return rpcSuccess(req.id, { workspaces: await this.adapter.listWorkspaces() })
      }

      case 'fs.list': {
        const denied = denyIf(!this.capabilities.sessionCreate, 'unavailable', 'session create not enabled')
        if (denied) return denied
        const path = req.args['path']
        if (typeof path !== 'string' || !path.startsWith('/')) {
          return fail('bad-request', 'absolute path required')
        }
        const dirs: readonly DirEntry[] = await this.adapter.listDir(path)
        return rpcSuccess(req.id, { path, dirs })
      }

      case 'fs.home': {
        const denied = denyIf(!this.capabilities.sessionCreate, 'unavailable', 'session create not enabled')
        if (denied) return denied
        return rpcSuccess(req.id, { home: this.adapter.homePath() })
      }

      case 'workspaces.add': {
        const denied = denyIf(!this.capabilities.sessionCreate, 'unavailable', 'session create not enabled')
        if (denied) return denied
        const path = req.args['path']
        if (typeof path !== 'string' || !path.startsWith('/')) {
          return fail('bad-request', 'absolute path required')
        }
        const added = await this.adapter.addWorkspace(path)
        if (added === null) return fail('bad-request', '无法添加该目录（不存在或不可访问）')
        return rpcSuccess(req.id, { workspace: added })
      }

      case 'workspaces.rename': {
        const denied = denyIf(!this.capabilities.sessionCreate, 'unavailable', 'session create not enabled') ??
          denyIf(this.opts.readOnly, 'forbidden', 'worker is read-only')
        if (denied) return denied
        const id = req.args['id']
        const title = req.args['title']
        if (typeof id !== 'string' || typeof title !== 'string' || title.trim().length === 0) {
          return fail('bad-request', 'id and title required')
        }
        const ok = await this.adapter.renameWorkspace(id, title.trim())
        if (!ok) return fail('not-found', 'workspace 不存在或无法重命名')
        return rpcSuccess(req.id, { ok: true })
      }

      case 'workspaces.delete': {
        const denied = denyIf(!this.capabilities.sessionCreate, 'unavailable', 'session create not enabled') ??
          denyIf(this.opts.readOnly, 'forbidden', 'worker is read-only')
        if (denied) return denied
        const id = req.args['id']
        if (typeof id !== 'string') return fail('bad-request', 'id required')
        const ok = await this.adapter.deleteWorkspace(id)
        if (!ok) return fail('not-found', 'workspace 不存在或无法删除')
        return rpcSuccess(req.id, { ok: true })
      }

      case 'sessions.create': {
        const denied =
          denyIf(!this.capabilities.sessionCreate, 'unavailable', 'session create not enabled') ??
          denyIf(this.opts.readOnly, 'forbidden', 'worker is read-only')
        if (denied) return denied
        const cwd = req.args['cwd']
        if (typeof cwd !== 'string' || cwd.length === 0 || !cwd.startsWith('/')) {
          return fail('bad-request', 'absolute cwd required')
        }
        const provider = typeof req.args['provider'] === 'string' ? req.args['provider'] : this.opts.defaultModel.provider
        const model = typeof req.args['model'] === 'string' ? req.args['model'] : this.opts.defaultModel.model
        const agentPreset = typeof req.args['agentPreset'] === 'string' ? req.args['agentPreset'] : undefined
        const reasoningEffortRaw = req.args['reasoningEffort']
        const route = typeof reasoningEffortRaw === 'string'
          ? { provider, model, reasoningEffort: reasoningEffortRaw }
          : { provider, model }
        const sessionId = await this.adapter.createSession(cwd, route, agentPreset)
        return rpcSuccess(req.id, { sessionId })
      }

      case 'sessions.fork': {
        const denied =
          denyIf(!this.capabilities.sessionCreate, 'unavailable', 'session create not enabled') ??
          denyIf(this.opts.readOnly, 'forbidden', 'worker is read-only')
        if (denied) return denied
        const sessionId = req.args['sessionId']
        if (typeof sessionId !== 'string' || sessionId.length === 0) {
          return fail('bad-request', 'sessionId required')
        }
        const boundaryRaw = req.args['boundary']
        const boundary = typeof boundaryRaw === 'number' && Number.isInteger(boundaryRaw) && boundaryRaw >= 0 ? boundaryRaw : undefined
        const provider = typeof req.args['provider'] === 'string' ? req.args['provider'] : this.opts.defaultModel.provider
        const model = typeof req.args['model'] === 'string' ? req.args['model'] : this.opts.defaultModel.model
        try {
          const childId = await this.adapter.forkSession(sessionId, { provider, model }, boundary)
          return rpcSuccess(req.id, { sessionId: childId })
        } catch (error) {
          return fail('bad-request', error instanceof Error ? error.message : 'fork failed')
        }
      }

      case 'permissions.options': {
        const denied = denyIf(!this.capabilities.turnControl, 'unavailable', 'turn control not enabled')
        if (denied) return denied
        return rpcSuccess(req.id, await this.adapter.permissionOptions())
      }

      case 'permissions.set': {
        const denied =
          denyIf(!this.capabilities.turnControl, 'unavailable', 'turn control not enabled') ??
          denyIf(this.opts.readOnly, 'forbidden', 'worker is read-only')
        if (denied) return denied
        const sessionId = req.args['sessionId']
        const preset = req.args['preset']
        if (typeof sessionId !== 'string' || typeof preset !== 'string') {
          return fail('bad-request', 'sessionId and preset required')
        }
        try {
          await this.adapter.setPermission(sessionId, preset)
          return rpcSuccess(req.id, { ok: true })
        } catch (error) {
          return fail('bad-request', error instanceof Error ? error.message : 'set failed')
        }
      }

      case 'commands.list': {
        const denied = denyIf(!this.capabilities.turnControl, 'unavailable', 'turn control not enabled')
        if (denied) return denied
        const sessionId = req.args['sessionId']
        if (typeof sessionId !== 'string') return fail('bad-request', 'sessionId required')
        return rpcSuccess(req.id, { commands: await this.adapter.listCommands(sessionId) })
      }

      case 'models.list': {
        const denied = denyIf(!this.capabilities.turnControl, 'unavailable', 'turn control not enabled')
        if (denied) return denied
        const sessionIdRaw = req.args['sessionId']
        const sessionId = typeof sessionIdRaw === 'string' ? sessionIdRaw : ''
        return rpcSuccess(req.id, await this.adapter.listModels(sessionId))
      }

      case 'presets.list': {
        const denied = denyIf(!this.capabilities.sessionCreate, 'unavailable', 'session create not enabled')
        if (denied) return denied
        return rpcSuccess(req.id, { presets: await this.adapter.listPresets() })
      }

      case 'attachments.upload': {
        const denied =
          denyIf(!this.capabilities.turnControl, 'unavailable', 'turn control not enabled') ??
          denyIf(this.opts.readOnly, 'forbidden', 'worker is read-only')
        if (denied) return denied
        const dataB64 = req.args['dataB64']
        const mediaType = req.args['mediaType']
        const name = req.args['name']
        if (typeof dataB64 !== 'string' || typeof mediaType !== 'string') {
          return fail('bad-request', 'dataB64 and mediaType required')
        }
        if (dataB64.length > 8 * 1024 * 1024) {
          return fail('bad-request', 'image too large (base64 > 8MB)')
        }
        try {
          const ref = await this.adapter.uploadImage(dataB64, mediaType, typeof name === 'string' ? name : undefined)
          return rpcSuccess(req.id, { ref })
        } catch (error) {
          return fail('bad-request', error instanceof Error ? error.message : 'upload failed')
        }
      }

      case 'messages.send': {
        const denied =
          denyIf(!this.capabilities.turnControl, 'unavailable', 'turn control not enabled') ??
          denyIf(this.opts.readOnly, 'forbidden', 'worker is read-only')
        if (denied) return denied
        const sessionId = req.args['sessionId']
        const text = req.args['text']
        const images = req.args['images']
        const imageRefs = Array.isArray(images) ? images : undefined
        if (typeof sessionId !== 'string' || typeof text !== 'string') {
          return fail('bad-request', 'sessionId and text required')
        }
        if (text.length === 0 && (imageRefs === undefined || imageRefs.length === 0)) {
          return fail('bad-request', 'empty message')
        }
        await this.adapter.sendUserMessage(sessionId, text, imageRefs)
        return rpcSuccess(req.id, { ok: true })
      }

      case 'turn.stop': {
        const denied =
          denyIf(!this.capabilities.turnControl, 'unavailable', 'turn control not enabled') ??
          denyIf(this.opts.readOnly, 'forbidden', 'worker is read-only')
        if (denied) return denied
        const sessionId = req.args['sessionId']
        if (typeof sessionId !== 'string') return fail('bad-request', 'sessionId required')
        await this.adapter.stopTurn(sessionId)
        return rpcSuccess(req.id, { ok: true })
      }

      case 'permissions.respond': {
        const denied = denyIf(!this.capabilities.approvals, 'unavailable', 'approvals not enabled')
        if (denied) return denied
        const requestId = req.args['requestId']
        const decision = req.args['decision']
        if (typeof requestId !== 'string' || (decision !== 'allow' && decision !== 'allow-always' && decision !== 'deny')) {
          return fail('bad-request', 'requestId and decision required')
        }
        const ask = this.pendingAsks.get(requestId)
        if (!ask || !('decide' in ask)) return fail('not-found', `no pending approval ${requestId}`)
        this.pendingAsks.delete(requestId)
        await ask.decide(decision === 'deny' ? 'deny' : 'allow')
        return rpcSuccess(req.id, { ok: true })
      }

      case 'questions.respond': {
        const denied = denyIf(!this.capabilities.approvals, 'unavailable', 'approvals not enabled')
        if (denied) return denied
        const requestId = req.args['requestId']
        const answer = req.args['answer']
        if (typeof requestId !== 'string' || typeof answer !== 'string') {
          return fail('bad-request', 'requestId and answer required')
        }
        const ask = this.pendingAsks.get(requestId)
        if (!ask || !('answer' in ask)) return fail('not-found', `no pending question ${requestId}`)
        this.pendingAsks.delete(requestId)
        await ask.answer(answer)
        return rpcSuccess(req.id, { ok: true })
      }

      default:
        return fail('not-found', `unknown method ${key}`)
    }
  }

  broadcastEvent(sessionId: string, event: DshSessionEvent): void {
    for (const c of this.conns.values()) {
      if (c.authed && c.subscribed.has(sessionId)) {
        this.sendTo(c, { kind: 'event', event: { sessionId, seq: event.seq, event } })
      }
    }
  }

  /** 审批/问题到达：无手机在线则立即放行（不阻塞 turn）。 */
  registerApproval(ask: ApprovalAsk): void {
    if (this.connectedCount() === 0) {
      void ask.decide('pass')
      return
    }
    this.pendingAsks.set(ask.requestId, ask)
    this.broadcast({ kind: 'server-request', request: permissionRequestOf(ask) })
  }

  registerQuestion(ask: QuestionAsk): void {
    if (this.connectedCount() === 0) {
      void ask.answer('')
      return
    }
    this.pendingAsks.set(ask.requestId, ask)
    this.broadcast({
      kind: 'server-request',
      request: { kind: 'question', body: { requestId: ask.requestId, sessionId: ask.sessionId, question: ask.question, ...(ask.options.length > 0 ? { options: ask.options } : {}) } },
    })
  }

  private broadcast(frame: unknown): void {
    const text = JSON.stringify(frame)
    for (const c of this.conns.values()) {
      if (c.authed) c.sender.send(text)
    }
  }

  private sendTo(conn: PhoneConn, frame: unknown): void {
    conn.sender.send(JSON.stringify(frame))
  }
}

/** 快照瘦身：UI 无关/可由定稿事件重建的事件不回放（长会话可达数十 MB）。 */
const SNAPSHOT_SKIP_TYPES = new Set([
  'assistant/chunk', // 回放由 assistant/message 定稿块重建；流式增量只在 live 推送
  'request/context', 'request/header', // 模型请求上下文快照，UI 不渲染
  'agent/inbox/spliced', // 收件箱投递记录
  // permission/preset、sandbox/mode、approval/policy 保留：全值变更事件，
  // App 折叠出当前权限档位（与 Web 端 projections 等价）
])
const SNAPSHOT_TEXT_LIMIT = 4000

function truncateTexts(event: DshSessionEvent): DshSessionEvent {
  if (event.type !== 'tool/result') return event
  try {
    const message = (event as { data?: { message?: { content?: unknown[] } } }).data?.message
    if (message === undefined) return event
    const blocks = message.content
    if (!Array.isArray(blocks)) return event
    let mutated = false
    const cloned = blocks.map((block) => {
      if (typeof block !== 'object' || block === null) return block
      const b = block as Record<string, unknown>
      const inner = b['content']
      if (!Array.isArray(inner)) return block
      const innerCloned = inner.map((leaf) => {
        if (typeof leaf !== 'object' || leaf === null) return leaf
        const l = leaf as Record<string, unknown>
        if (typeof l['text'] === 'string' && (l['text'] as string).length > SNAPSHOT_TEXT_LIMIT) {
          mutated = true
          return { ...l, text: `${(l['text'] as string).slice(0, SNAPSHOT_TEXT_LIMIT)}\n…（快照截断，完整内容见电脑）` }
        }
        return leaf
      })
      return { ...b, content: innerCloned }
    })
    if (!mutated) return event
    return { ...event, data: { ...(event as unknown as { data: Record<string, unknown> }).data, message: { ...message, content: cloned } } } as DshSessionEvent
  } catch {
    return event
  }
}

function snapshotFrame(slice: { id: string; fromSeq: number; toSeq: number; events: readonly DshSessionEvent[] }): {
  kind: 'snapshot'
  snapshot: { sessionId: string; fromSeq: number; toSeq: number; events: readonly DshSessionEvent[] }
} {
  const events = slice.events
    .filter((e) => !SNAPSHOT_SKIP_TYPES.has(e.type))
    .map(truncateTexts)
  return {
    kind: 'snapshot',
    snapshot: { sessionId: slice.id, fromSeq: slice.fromSeq, toSeq: slice.toSeq, events },
  }
}

function permissionRequestOf(ask: ApprovalAsk): {
  kind: 'permission'
  body: { requestId: string; sessionId: string; summary: string }
} {
  return {
    kind: 'permission',
    body: { requestId: ask.requestId, sessionId: ask.sessionId, summary: ask.summary },
  }
}

export { makeRpcId }
export type { WireRequest }
