/**
 * DshClient：/mobile 协议客户端（跑在 Channel 之上）。
 *
 * 职责：首帧认证 → handshake → RPC 调用（id 关联）→
 * 事件/快照/服务端请求回调 → 心跳。
 */

import {
  makeRpcId,
  parseGatewayToPhoneFrame,
  parseWorkerFrameSafe,
  PROTOCOL_VERSION,
  type BridgeCapabilities,
  type DshSessionEvent,
  type PhoneToWorkerFrame,
  type ServerRequest,
  type SessionSnapshot,
  type WireResponse,
  type WorkerToPhoneFrame,
} from './frames'
import type { Channel, GatewayTunnel } from './channel'

export interface DshClientHandlers {
  onEvent(sessionId: string, event: DshSessionEvent): void
  onSnapshot(snapshot: SessionSnapshot): void
  onServerRequest(request: ServerRequest): void
  onAuthResult(ok: boolean, reason?: string): void
  onDisconnect(): void
}

interface PendingRpc {
  resolve: (response: WireResponse) => void
  reject: (error: Error) => void
}

export interface HandshakeInfo {
  readonly name: string
  readonly fingerprint: string
  readonly capabilities: BridgeCapabilities
  readonly protocolVersion: string
}

export class DshClient {
  private readonly pending = new Map<string, PendingRpc>()
  private authed = false
  private authTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private channel: Channel,
    private readonly pairingToken: string,
    private readonly handlers: DshClientHandlers,
  ) {
    this.authTimer = setTimeout(() => {
      if (!this.authed) this.handlers.onAuthResult(false, 'auth timeout')
    }, 10_000)
    this.send({ kind: 'auth', token: pairingToken })
  }

  attachChannel(channel: Channel): void {
    this.channel = channel
    this.authed = false
    this.send({ kind: 'auth', token: this.pairingToken })
  }

  /** 收到底层 inner 文本（两种通道共用入口）。 */
  handleInner(inner: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(inner)
    } catch {
      return
    }
    const frame = parseWorkerFrameSafe(parsed)
    if (frame !== null) this.handleFrame(frame)
  }

  /** 收到底层帧（解析后）。 */
  handleFrame(frame: WorkerToPhoneFrame): void {
    switch (frame.kind) {
      case 'auth-ok':
        this.authed = true
        if (this.authTimer !== null) clearTimeout(this.authTimer)
        this.pingTimer = setInterval(() => {
          this.send({ kind: 'pong', nonce: Date.now() })
        }, 25_000)
        this.handlers.onAuthResult(true)
        return
      case 'auth-rejected':
        this.handlers.onAuthResult(false, frame.reason)
        return
      case 'ping':
        this.send({ kind: 'pong', nonce: frame.nonce })
        return
      case 'rpc-result':
        this.resolveRpc(frame.response)
        return
      case 'event':
        this.handlers.onEvent(frame.event.sessionId, frame.event.event)
        return
      case 'snapshot':
        this.handlers.onSnapshot(frame.snapshot)
        return
      case 'server-request':
        this.handlers.onServerRequest(frame.request)
        return
      case 'resync-needed':
        // 序列有洞：由上层发起 sessions.resync
        void this.rpc('sessions', 'resync', { sessionId: frame.sessionId, lastSeq: -1 })
        return
    }
  }

  async handshake(): Promise<HandshakeInfo> {
    const response = await this.rpc('handshake', 'hello', {
      client: 'deepseek-harness-pocket-app',
      protocolVersion: PROTOCOL_VERSION,
    })
    if (!response.ok) throw new Error(`handshake failed: ${response.error.message}`)
    const result = response.result as { host: HandshakeInfo }
    return result.host
  }

  async listSessions(): Promise<readonly unknown[]> {
    const response = await this.rpc('sessions', 'list', {})
    if (!response.ok) throw new Error(response.error.message)
    return (response.result as { sessions: unknown[] }).sessions
  }

  async openSession(sessionId: string): Promise<void> {
    const response = await this.rpc('sessions', 'open', { sessionId })
    if (!response.ok) throw new Error(response.error.message)
  }

  async listWorkspaces(): Promise<readonly { id: string; path: string; title: string }[]> {
    const response = await this.rpc('workspaces', 'list', {})
    if (!response.ok) throw new Error(response.error.message)
    return (response.result as { workspaces: { id: string; path: string; title: string }[] }).workspaces
  }

  async fsList(path: string): Promise<readonly { name: string; path: string }[]> {
    const response = await this.rpc('fs', 'list', { path })
    if (!response.ok) throw new Error(response.error.message)
    return (response.result as { dirs: { name: string; path: string }[] }).dirs
  }

  async fsHome(): Promise<string> {
    const response = await this.rpc('fs', 'home', {})
    if (!response.ok) throw new Error(response.error.message)
    return (response.result as { home: string }).home
  }

  async addWorkspace(path: string): Promise<{ id: string; path: string; title: string } | null> {
    const response = await this.rpc('workspaces', 'add', { path })
    if (!response.ok) return null
    return (response.result as { workspace: { id: string; path: string; title: string } }).workspace
  }

  async renameWorkspace(id: string, title: string): Promise<boolean> {
    const response = await this.rpc('workspaces', 'rename', { id, title })
    return response.ok
  }

  async deleteWorkspace(id: string): Promise<boolean> {
    const response = await this.rpc('workspaces', 'delete', { id })
    return response.ok
  }

  async listPlugins(): Promise<readonly { id: string; name: string; enabled: boolean }[]> {
    const response = await this.rpc('plugins', 'list', {})
    if (!response.ok) return []
    return (response.result as { plugins: { id: string; name: string; enabled: boolean }[] }).plugins
  }

  async sessionContext(sessionId: string): Promise<{ projectedTokens: number; contextWindow: number; systemTokens: number; toolsTokens: number; messageTokens: number } | null> {
    const response = await this.rpc('session', 'context', { sessionId })
    if (!response.ok) return null
    return response.result as { projectedTokens: number; contextWindow: number; systemTokens: number; toolsTokens: number; messageTokens: number }
  }

  async forkSession(sessionId: string, boundary?: number): Promise<string> {
    const response = await this.rpc('sessions', 'fork', {
      sessionId,
      ...(boundary !== undefined ? { boundary } : {}),
    })
    if (!response.ok) throw new Error(response.error.message)
    return (response.result as { sessionId: string }).sessionId
  }

  async createSession(cwd: string): Promise<string> {
    const response = await this.rpc('sessions', 'create', { cwd })
    if (!response.ok) throw new Error(response.error.message)
    return (response.result as { sessionId: string }).sessionId
  }

  async createSessionWithRoute(cwd: string, provider: string, model: string, agentPreset?: string, reasoningEffort?: string): Promise<string> {
    const response = await this.rpc('sessions', 'create', {
      cwd,
      provider,
      model,
      ...(agentPreset !== undefined ? { agentPreset } : {}),
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    })
    if (!response.ok) throw new Error(response.error.message)
    return (response.result as { sessionId: string }).sessionId
  }

  async permissionOptions(): Promise<{ names: string[]; default: string }> {
    const response = await this.rpc('permissions', 'options', {})
    if (!response.ok) throw new Error(response.error.message)
    return response.result as { names: string[]; default: string }
  }

  async setPermission(sessionId: string, preset: string): Promise<void> {
    const response = await this.rpc('permissions', 'set', { sessionId, preset })
    if (!response.ok) throw new Error(response.error.message)
  }

  async listCommands(sessionId: string): Promise<readonly { name: string; description: string }[]> {
    const response = await this.rpc('commands', 'list', { sessionId })
    if (!response.ok) throw new Error(response.error.message)
    return (response.result as { commands: { name: string; description: string }[] }).commands
  }

  async listModels(sessionId: string): Promise<{ providers: readonly { id: string; name?: string; models: readonly { id: string; name?: string; inputModalities?: readonly ('text' | 'image')[] }[] }[]; current: { provider: string; model: string } | null }> {
    const response = await this.rpc('models', 'list', sessionId.length > 0 ? { sessionId } : {})
    if (!response.ok) throw new Error(response.error.message)
    return response.result as { providers: readonly { id: string; name?: string; models: readonly { id: string; name?: string; inputModalities?: readonly ('text' | 'image')[] }[] }[]; current: { provider: string; model: string } | null }
  }

  async listPresets(): Promise<readonly { id: string; name?: string; description?: string; isDefault: boolean }[]> {
    const response = await this.rpc('presets', 'list', {})
    if (!response.ok) throw new Error(response.error.message)
    return (response.result as { presets: { id: string; name?: string; description?: string; isDefault: boolean }[] }).presets
  }

  async sendMessage(sessionId: string, text: string, images?: readonly unknown[]): Promise<void> {
    const response = await this.rpc('messages', 'send', {
      sessionId,
      text,
      ...(images !== undefined && images.length > 0 ? { images } : {}),
    })
    if (!response.ok) throw new Error(response.error.message)
  }

  async uploadImage(dataB64: string, mediaType: string, name?: string): Promise<unknown> {
    const response = await this.rpc('attachments', 'upload', {
      dataB64,
      mediaType,
      ...(name !== undefined ? { name } : {}),
    })
    if (!response.ok) throw new Error(response.error.message)
    return (response.result as { ref: unknown }).ref
  }

  async stopTurn(sessionId: string): Promise<void> {
    const response = await this.rpc('turn', 'stop', { sessionId })
    if (!response.ok) throw new Error(response.error.message)
  }

  async respondPermission(requestId: string, decision: 'allow' | 'deny'): Promise<void> {
    const response = await this.rpc('permissions', 'respond', { requestId, decision })
    if (!response.ok) throw new Error(response.error.message)
  }

  async respondQuestion(requestId: string, answer: string): Promise<void> {
    const response = await this.rpc('questions', 'respond', { requestId, answer })
    if (!response.ok) throw new Error(response.error.message)
  }

  rpc(ns: string, method: string, args: Record<string, unknown>): Promise<WireResponse> {
    const id = makeRpcId()
    return new Promise<WireResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.send({ kind: 'rpc', request: { id, ns, method, args } })
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`rpc timeout: ${ns}.${method}`))
        }
      }, 30_000)
    })
  }

  /** silent=true：主动切换/清理，不触发 onDisconnect（避免误报"连接已断开"）。 */
  dispose(silent = false): void {
    if (this.authTimer !== null) clearTimeout(this.authTimer)
    if (this.pingTimer !== null) clearInterval(this.pingTimer)
    for (const pending of this.pending.values()) {
      pending.reject(new Error('client disposed'))
    }
    this.pending.clear()
    this.channel.close()
    if (!silent) this.handlers.onDisconnect()
  }

  private resolveRpc(response: WireResponse): void {
    const pending = this.pending.get(response.id)
    if (pending !== undefined) {
      this.pending.delete(response.id)
      pending.resolve(response)
    }
  }

  private send(frame: PhoneToWorkerFrame): void {
    try {
      this.channel.send(frame)
    } catch (error) {
      this.handlers.onDisconnect()
      throw error instanceof Error ? error : new Error(String(error))
    }
  }
}

export { parseGatewayToPhoneFrame }
