/**
 * DshClient：/mobile 协议客户端（跑在 Channel 之上）。
 *
 * 职责：首帧认证 → handshake → RPC 调用（id 关联）→
 * 事件/快照/服务端请求回调 → 心跳。
 */

import {
  makeRpcId,
  parseGatewayToPhoneFrame,
  parseFeedbackItem,
  parseFeedbackItems,
  parseJobs,
  parseCredentialRecords,
  parsePresets,
  parseSessionSearchHits,
  parseSettingsSections,
  parseSettingsUpdateOutcome,
  parseSkills,
  parseWorkerFrameSafe,
  PROTOCOL_VERSION,
  type BridgeCapabilities,
  type DshSessionEvent,
  type FeedbackCategory,
  type FeedbackItem,
  type FeedbackRating,
  type JobSnapshot,
  type CredentialRecordInfo,
  type AgentPresetInfo,
  type SessionSearchHit,
  type SettingsSectionInfo,
  type SettingsUpdateOutcome,
  type SkillInfo,
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
  /** 后台任务快照（dsh ctx.jobs，随会话订阅推送） */
  onJobs(sessionId: string, jobs: readonly JobSnapshot[]): void
  onAuthResult(ok: boolean, reason?: string): void
  onDisconnect(): void
}

interface PendingRpc {
  resolve: (response: WireResponse) => void
  reject: (error: Error) => void
}

interface PendingPreview {
  resolve: (result: { mime: string; base64: string }) => void
  reject: (error: Error) => void
  chunks: string[]
  mime: string
}

export interface HandshakeInfo {
  readonly name: string
  readonly fingerprint: string
  readonly capabilities: BridgeCapabilities
  readonly protocolVersion: string
}

export class DshClient {
  private readonly pending = new Map<string, PendingRpc>()
  private readonly pendingPreviews = new Map<string, PendingPreview>()
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
      case 'preview-begin':
      case 'preview-chunk':
      case 'preview-end':
      case 'preview-error':
        this.feedPreview(frame)
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
      case 'jobs':
        this.handlers.onJobs(frame.sessionId, frame.jobs)
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

  /** 退订会话：切换走时停止旧会话的事件推送（释放隧道带宽）。 */
  async closeSession(sessionId: string): Promise<void> {
    const response = await this.rpc('sessions', 'close', { sessionId })
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

  /** 列目录（目录 + 文件）；产物列表用（v1 顶层浏览） */
  async fsEntries(path: string): Promise<readonly { name: string; path: string; type: 'file' | 'directory' }[]> {
    const response = await this.rpc('fs', 'list', { path })
    if (!response.ok) throw new Error(response.error.message)
    return (response.result as { entries: { name: string; path: string; type: 'file' | 'directory' }[] }).entries ?? []
  }

  /** 作品预览：preview 帧分块拉取，拼装 base64（worker 侧限 2MB/白名单） */
  async previewFile(path: string): Promise<{ mime: string; base64: string }> {
    const requestId = makeRpcId()
    return new Promise<{ mime: string; base64: string }>((resolve, reject) => {
      this.pendingPreviews.set(requestId, { resolve, reject, chunks: [], mime: '' })
      setTimeout(() => {
        const p = this.pendingPreviews.get(requestId)
        if (p !== undefined) {
          this.pendingPreviews.delete(requestId)
          p.reject(new Error('preview timeout'))
        }
      }, 60_000)
      this.send({ kind: 'preview', requestId, path })
    })
  }

  private feedPreview(
    frame:
      | { kind: 'preview-begin'; requestId: string; mime: string; bytes: number }
      | { kind: 'preview-chunk'; requestId: string; seq: number; dataBase64: string }
      | { kind: 'preview-end'; requestId: string; bytes: number }
      | { kind: 'preview-error'; requestId: string; code: string; message: string },
  ): void {
    const pending = this.pendingPreviews.get(frame.requestId)
    if (pending === undefined) return
    if (frame.kind === 'preview-begin') {
      pending.mime = frame.mime
      return
    }
    if (frame.kind === 'preview-chunk') {
      pending.chunks.push(frame.dataBase64)
      return
    }
    this.pendingPreviews.delete(frame.requestId)
    if (frame.kind === 'preview-error') {
      pending.reject(new Error(`${frame.code}: ${frame.message}`))
      return
    }
    pending.resolve({ mime: pending.mime, base64: pending.chunks.join('') })
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

  async listPresets(): Promise<readonly AgentPresetInfo[]> {
    const response = await this.rpc('presets', 'list', {})
    if (!response.ok) throw new Error(response.error.message)
    const result = response.result as { presets?: unknown } | null
    return parsePresets(result?.presets) ?? []
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

  /** 结构化回答（多选 / 计划评审）；`answers` 为 dsh 的 AskUserQuestionAnswerItem[]。 */
  /** 主动拉取某会话的后台任务（打开面板时用；推送帧是主路径）。 */
  async listJobs(sessionId: string): Promise<readonly JobSnapshot[]> {
    const response = await this.rpc('jobs', 'list', { sessionId })
    if (!response.ok) throw new Error(response.error.message)
    const result = response.result as { jobs?: unknown } | null
    return parseJobs(result?.jobs) ?? []
  }

  /** 跨会话内容搜索（Worker 侧 sessionQuery；未启用时返回空数组）。 */
  async searchSessions(query: string, limit?: number): Promise<readonly SessionSearchHit[]> {
    const response = await this.rpc('sessions', 'search', {
      query,
      ...(limit !== undefined ? { limit } : {}),
    })
    if (!response.ok) throw new Error(response.error.message)
    const result = response.result as { hits?: unknown } | null
    return parseSessionSearchHits(result?.hits) ?? []
  }

  /** 技能目录（cwd 决定分层解析）。 */
  async listSkills(cwd?: string): Promise<readonly SkillInfo[]> {
    const response = await this.rpc('skills', 'list', {
      ...(cwd !== undefined ? { cwd } : {}),
    })
    if (!response.ok) throw new Error(response.error.message)
    const result = response.result as { skills?: unknown } | null
    return parseSkills(result?.skills) ?? []
  }

  /** Worker 配置（设置命名空间 + 凭据元信息；秘密值由宿主打码/不下发）。 */
  async workerConfig(): Promise<{
    sections: readonly SettingsSectionInfo[]
    credentials: readonly CredentialRecordInfo[]
  }> {
    const response = await this.rpc('settings', 'describe', {})
    if (!response.ok) throw new Error(response.error.message)
    const result = response.result as { sections?: unknown; credentials?: unknown } | null
    return {
      sections: parseSettingsSections(result?.sections) ?? [],
      credentials: parseCredentialRecords(result?.credentials) ?? [],
    }
  }

  /** 写入一条凭据（值只在本次请求中存在，客户端不留存）。 */
  async setCredential(ref: string, value: string): Promise<void> {
    const response = await this.rpc('credentials', 'set', { ref, value })
    if (!response.ok) throw new Error(response.error.message)
  }

  /** 删除一条凭据。 */
  async unsetCredential(ref: string): Promise<void> {
    const response = await this.rpc('credentials', 'unset', { ref })
    if (!response.ok) throw new Error(response.error.message)
  }

  /** 写回一个设置命名空间（CAS：修订号不匹配返回冲突）。 */
  async updateSetting(
    ns: string,
    patch: Record<string, unknown>,
    expectedRevision?: number,
  ): Promise<SettingsUpdateOutcome> {
    const response = await this.rpc('settings', 'update', {
      ns,
      patch,
      ...(expectedRevision !== undefined ? { expectedRevision } : {}),
    })
    if (!response.ok) throw new Error(response.error.message)
    const outcome = parseSettingsUpdateOutcome(response.result)
    if (outcome === null) throw new Error('设置写入返回了无法识别的结果')
    return outcome
  }

  async listFeedback(sessionId: string): Promise<readonly FeedbackItem[]> {
    const response = await this.rpc('feedback', 'list', { sessionId })
    if (!response.ok) throw new Error(response.error.message)
    const result = response.result as { items?: unknown } | null
    return parseFeedbackItems(result?.items) ?? []
  }

  async putFeedback(
    sessionId: string,
    messageId: string,
    rating: FeedbackRating,
    note?: string,
    category?: FeedbackCategory,
  ): Promise<FeedbackItem | null> {
    const response = await this.rpc('feedback', 'put', {
      sessionId,
      messageId,
      rating,
      ...(note !== undefined && note.length > 0 ? { note } : {}),
      ...(category !== undefined ? { category } : {}),
    })
    if (!response.ok) throw new Error(response.error.message)
    const result = response.result as { item?: unknown } | null
    return parseFeedbackItem(result?.item)
  }

  async deleteFeedback(sessionId: string, messageId: string, version: string): Promise<boolean> {
    const response = await this.rpc('feedback', 'delete', { sessionId, messageId, version })
    return response.ok
  }

  async respondQuestion(
    requestId: string,
    answers: readonly { id: string; selected: readonly string[]; custom?: string }[],
  ): Promise<void> {
    const response = await this.rpc('questions', 'respond', { requestId, answers })
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
    for (const pending of this.pendingPreviews.values()) {
      pending.reject(new Error('client disposed'))
    }
    this.pendingPreviews.clear()
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
