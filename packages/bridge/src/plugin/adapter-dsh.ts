/**
 * ★★ dsh 版本适配唯一收敛点。
 *
 * 所有对 dsh Cordis 服务（ctx.sessions / ctx.sessionPersistence / ctx.agents /
 * ctx.approval / ctx.userQuestions）的调用都在本文件；dsh breaking changes 只改这里。
 * Hub 与路由只依赖本文件导出的窄接口，可脱离 dsh 单测。
 */

import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef, ImageMediaType, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { DshSessionEvent } from '@deepseek-harness-pocket/bridge-protocol'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

/**
 * 本地结构化类型：dsh rc 版本 npm 矩阵尚不稳定（部分类型包未发布），
 * 与 dsh 的类型对齐由 e2e 契约测试（e2e/dsh-compat）守护。
 */
type SessionId = string
type AgentStatusValue = 'idle' | 'running'

export interface WorkspaceSummary {
  readonly id: string
  readonly path: string
  readonly title: string
}

export interface DirEntry {
  readonly name: string
  readonly path: string
}

/**
 * 最小事件声明合并：只声明本插件监听的事件键（dsh 类型包未全部发布 npm）。
 * 真实事件签名对齐由 e2e 契约测试守护。
 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    sessions: {
      get(id: unknown): unknown
      list(): unknown[]
    }
    loader: {
      entries(): Iterable<{ id: unknown; options: { name: string; group?: unknown }; disabled: boolean }>
    }
    sessionProjections: {
      snapshot(session: unknown): { values: Record<string, unknown> }
    }
  }

  interface Events {
    'session/event'(session: { id: { toString(): string } }, event: unknown): void
    'session/created'(session: unknown): void
    'session/disposed'(session: unknown): void
    'agent/status'(payload: unknown): void
  }
}

export interface SessionSummary {
  readonly id: string
  readonly createdAt: number
  /** 最后活动时间（事件流最近一条 time；缺失回退 createdAt）。手机端「会话时间」排序/展示用 */
  readonly lastActivityAt: number
  /** 语义化标题（session/title 事件或首条 user/message；缺失为 null，App 端回退 cwd 名） */
  readonly title: string | null
  readonly cwd: string | null
  readonly lastSeq: number
  readonly live: boolean
  /** live agent 状态；离线为 null */
  readonly agentStatus: AgentStatusValue | null
}

export interface SessionSlice {
  readonly id: string
  readonly fromSeq: number
  readonly toSeq: number
  readonly events: readonly DshSessionEvent[]
}

/** 审批请求的窄投影（hub 侧不接触 dsh 对象）。 */
export interface ApprovalAsk {
  readonly requestId: string
  readonly sessionId: string
  readonly toolName: string
  readonly summary: string
  readonly detail: Record<string, unknown> | null
  readonly decide: (decision: 'allow' | 'deny' | 'pass') => Promise<void>
}

export interface QuestionAsk {
  readonly requestId: string
  readonly sessionId: string
  readonly question: string
  readonly options: readonly string[]
  readonly answer: (text: string) => Promise<void>
}

/** dsh 宿主能力探测结果（缺服务时优雅降级）。 */
export interface AdapterCaps {
  readonly persistence: boolean
  readonly agents: boolean
  readonly approval: boolean
  readonly userQuestions: boolean
}

/** 模型目录条目（dsh listModels 投影）。 */
export interface ModelInfo {
  readonly id: string
  readonly name?: string
  /**
   * dsh ModelModality 投影：模型接受的输入模态（'text' | 'image'）。
   * 缺省表示「未知 / 未声明」，消费者据此不得拒绝，仅可用于 UI 能力提示。
   */
  readonly inputModalities?: readonly ('text' | 'image')[]
}

export interface DshAdapter {
  readonly caps: AdapterCaps
  dshVersion(): string | null
  listSessions(): Promise<readonly SessionSummary[]>
  listWorkspaces(): Promise<readonly WorkspaceSummary[]>
  /** 权限档位目录与默认值（dsh permissionPresets） */
  permissionOptions(): Promise<{ names: readonly string[]; default: string }>
  setPermission(sessionId: string, preset: string): Promise<void>
  /** 会话可用斜杠命令目录 */
  listCommands(sessionId: string): Promise<readonly { name: string; description: string }[]>
  /** 模型目录（provider/模型列表，含输入模态）+ 会话当前选择 */
  listModels(sessionId: string): Promise<{ providers: readonly { id: string; name?: string; models: readonly ModelInfo[] }[]; current: { provider: string; model: string } | null }>
  /** agent preset 目录（standard/code/minimal/…） */
  listPresets(): Promise<readonly { id: string; name?: string; description?: string; isDefault: boolean }[]>
  /** 列目录（仅目录，隐藏目录排后）；供手机端目录树浏览 */
  listDir(path: string): Promise<readonly DirEntry[]>
  /** Worker 端用户 home（目录树起点） */
  homePath(): string
  /** 添加 workspace（按绝对路径）；已存在时幂等返回既有记录 */
  addWorkspace(path: string): Promise<WorkspaceSummary | null>
  /** 重命名 workspace（dsh entity.setTitle） */
  renameWorkspace(id: string, title: string): Promise<boolean>
  /** 删除 workspace 注册（dsh registry.delete） */
  deleteWorkspace(id: string): Promise<boolean>
  /** 已加载插件列表（只读，cordis loader.entries） */
  listPlugins(): Promise<readonly { id: string; name: string; enabled: boolean }[]>
  /** 上下文占用（token-meter projection：projectedTokens/contextWindow/system/tools/message） */
  sessionContext(sessionId: string): Promise<{ projectedTokens: number; contextWindow: number; systemTokens: number; toolsTokens: number; messageTokens: number } | null>
  /** 在指定 cwd 创建新会话（M3）；返回 sessionId */
  createSession(cwd: string, route: { provider: string; model: string; reasoningEffort?: string }, agentPreset?: string): Promise<string>
  /** 从既有会话分叉（dsh fork：取平衡的已完成回合前缀作种子）并挂 agent；返回新 sessionId */
  forkSession(sessionId: string, route: { provider: string; model: string }, boundary?: number): Promise<string>
  readSlice(id: string, fromSeq: number): Promise<SessionSlice | null>
  /** 打开已有会话并挂 live agent（无 agent 时），使命令目录/当前模型可查询 */
  openSession(id: string, route: { provider: string; model: string }): Promise<void>
  sendUserMessage(id: string, text: string, imageRefs?: readonly unknown[]): Promise<void>
  /** 图片字节入 dsh 附件库（ref 可拼进用户消息 content） */
  uploadImage(dataB64: string, mediaType: string, name?: string): Promise<ImageAttachmentRef>
  stopTurn(id: string): Promise<void>
  /** 订阅事件流；返回退订函数 */
  onEvent(handler: (sessionId: string, event: DshSessionEvent) => void): () => void
  /** 状态/生命周期变化通知（presence 刷新用） */
  onSessionsChanged(handler: () => void): () => void
  /** M2：注册审批应答器（无 approval 服务时 no-op 返回 null） */
  registerApprovalAsker(ask: (a: ApprovalAsk) => void): (() => void) | null
  /** M2：注册用户问题应答器（无服务或已有 provider 时返回 null） */
  registerQuestionAsker(ask: (q: QuestionAsk) => void): (() => void) | null
}

interface LiveSessionLike {
  readonly id: { toString(): string }
  readonly seq: number
  readonly header: { createdAt: number; cwd?: string }
  readonly events: readonly unknown[]
}

interface PersistenceLike {
  list(): Promise<readonly { id: { toString(): string }; createdAt: number; cwd?: string; lastSeq?: number }[]>
  readFrom(id: unknown, fromSeq: number, signal?: AbortSignal): Promise<{ meta: unknown; events: readonly unknown[] }>
}

interface AgentLike {
  readonly id: { toString(): string }
  readonly status: AgentStatusValue
  followup(message: unknown): void
  cancel(cause: unknown): void
}

interface AgentRegistryLike {
  get(id: unknown): AgentLike | undefined
  list(): readonly AgentLike[]
}

function toEvent(raw: unknown): DshSessionEvent {
  // SessionEvent 全 JSON 可序列化；宽松透传（type/seq 由协议层校验）
  return raw as DshSessionEvent
}

export function createAdapter(ctx: Context): DshAdapter {
  const persistence = () => ctx.get('sessionPersistence') as PersistenceLike | undefined
  const agents = () => ctx.get('agents') as AgentRegistryLike | undefined
  const caps: AdapterCaps = {
    persistence: persistence() !== undefined,
    agents: agents() !== undefined,
    approval: ctx.get('approval') !== undefined,
    userQuestions: ctx.get('userQuestions') !== undefined,
  }

  const agentStatusById = (): Map<string, AgentStatusValue> => {
    const map = new Map<string, AgentStatusValue>()
    const registry = agents()
    if (registry) for (const agent of registry.list()) map.set(agent.id.toString(), agent.status)
    return map
  }

  // 手机连接期间经事件流观察到的各会话最近活动时间（id → time）
  const lastActivityById = new Map<string, number>()

  const eventTimeOf = (raw: unknown): number | undefined => {
    const t = (raw as { time?: unknown } | null)?.time
    return typeof t === 'number' && Number.isFinite(t) ? t : undefined
  }

  /** 从事件流提取语义标题：优先 session/title，回退首个 user/message 的 text。 */
  const extractTitle = (events: readonly unknown[]): string | null => {
    const clean = (s: string): string => s.replace(/\s+/g, ' ').trim()
    for (const raw of events) {
      const e = raw as { type?: string; data?: { title?: unknown } }
      if (e.type === 'session/title' && typeof e.data?.title === 'string') {
        const t = clean(e.data.title)
        if (t.length > 0) return t.slice(0, 80)
      }
    }
    for (const raw of events) {
      const e = raw as { type?: string; data?: { content?: unknown } }
      if (e.type === 'user/message' && Array.isArray(e.data?.content)) {
        const text = (e.data.content as { type?: string; text?: string }[])
          .filter((b) => b.type === 'text' && typeof b.text === 'string')
          .map((b) => b.text)
          .join(' ')
        const t = clean(text)
        if (t.length > 0) return t.slice(0, 80)
      }
    }
    return null
  }

  const toSummary = (id: string, createdAt: number, cwd: string | undefined, lastSeq: number, lastActivityAt?: number, title?: string | null): SessionSummary => {
    const status = agentStatusById().get(id)
    return {
      id,
      createdAt,
      lastActivityAt: lastActivityAt ?? createdAt,
      title: title ?? null,
      cwd: cwd ?? null,
      lastSeq,
      live: status !== undefined,
      agentStatus: status ?? null,
    }
  }

  return {
    caps,

    dshVersion() {
      // host.describe 目前是 placeholder；M1 先返回 null，后续接 apps/cli 版本注入
      return null
    },

    async listSessions() {
      const summaries = new Map<string, SessionSummary>()
      const per = persistence()
      if (per) {
        try {
          const headers = await per.list()
          for (const h of headers) {
            const id = h.id.toString()
            summaries.set(id, toSummary(id, h.createdAt, h.cwd, h.lastSeq ?? -1, lastActivityById.get(id)))
          }
        } catch {
          // 持久化后端不可用时仅返回 live
        }
      }
      const live = ctx.sessions.list() as readonly LiveSessionLike[]
      for (const s of live) {
        const id = s.id.toString()
        const tail = s.events[s.events.length - 1]
        summaries.set(id, toSummary(id, s.header.createdAt, s.header.cwd, s.seq - 1, lastActivityById.get(id) ?? eventTimeOf(tail), extractTitle(s.events)))
      }
      return [...summaries.values()].sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    },

    async permissionOptions() {
      const presets = ctx.get('permissionPresets') as
        | { names: readonly string[]; defaultPreset: string }
        | undefined
      if (presets === undefined) return { names: [], default: '' }
      return { names: presets.names, default: presets.defaultPreset }
    },

    async setPermission(sessionId, preset) {
      const presets = ctx.get('permissionPresets') as
        | { set(session: unknown, name: string): void }
        | undefined
      const session = ctx.sessions.get(sessionId as SessionId)
      if (presets === undefined || session === undefined) {
        throw new Error('权限服务不可用或会话不存在')
      }
      presets.set(session, preset)
    },

    async listCommands(sessionId) {
      const commands = ctx.get('commands') as
        | { list(agent: unknown): readonly { name: string; description: string }[] }
        | undefined
      const registry = agents()
      const agent = registry?.get(sessionId as SessionId)
      if (commands === undefined || agent === undefined) return []
      try {
        return commands.list(agent)
      } catch {
        return []
      }
    },

    async listModels(sessionId) {
      const llm = ctx.get('llm') as
        | {
            listProviders(): readonly { id: string; name?: string }[]
            listModels(provider: string): Promise<readonly ModelInfo[]>
          }
        | undefined
      const registry = agents()
      const agent = registry?.get(sessionId as SessionId) as { options?: { provider?: string; model?: string } } | undefined
      const current = agent?.options !== undefined && typeof agent.options.provider === 'string' && typeof agent.options.model === 'string'
        ? { provider: agent.options.provider, model: agent.options.model }
        : null
      if (llm === undefined) return { providers: [], current }
      try {
        // dsh 的 listProviders() 只返回 {id,name}，模型需按 provider 异步 listModels()
        const providers: { id: string; name?: string; models: readonly ModelInfo[] }[] = []
        for (const p of llm.listProviders()) {
          let models: readonly ModelInfo[] = []
          try {
            models = await llm.listModels(p.id)
          } catch {
            // 单个 provider 目录查询失败按空处理，不影响其它 provider
          }
          providers.push({ id: p.id, ...(p.name !== undefined ? { name: p.name } : {}), models })
        }
        return { providers, current }
      } catch {
        return { providers: [], current }
      }
    },

    async listPresets() {
      const presets = ctx.get('agentPresets') as
        | { list(): Promise<readonly { id: string; name?: string; description?: string; isDefault?: boolean }[]> }
        | undefined
      if (presets === undefined) return []
      try {
        const list = await presets.list()
        return list.map((entry) => ({
          id: entry.id,
          ...(entry.name !== undefined ? { name: entry.name } : {}),
          ...(entry.description !== undefined ? { description: entry.description } : {}),
          isDefault: entry.isDefault === true,
        }))
      } catch {
        return []
      }
    },

    async listWorkspaces() {
      const registry = ctx.get('workspaceRegistry') as
        | { list(): readonly { id: { toString(): string }; path: string; title: string }[] }
        | undefined
      if (registry === undefined) return []
      try {
        return registry.list().map((w) => ({ id: w.id.toString(), path: w.path, title: w.title }))
      } catch {
        return []
      }
    },

    async listDir(path) {
      const fs = ctx.get('fs') as
        | {
            resolve(p: string, opts?: { signal?: AbortSignal }): Promise<unknown>
            listDir(target: unknown, signal?: AbortSignal): Promise<readonly { name: string; type: 'file' | 'directory' | 'other'; target: unknown }[]>
            processPath(target: unknown): string
          }
        | undefined
      if (fs === undefined) return []
      try {
        const target = await fs.resolve(path)
        const entries = await fs.listDir(target)
        const base = path.endsWith('/') ? path.slice(0, -1) : path
        return entries
          .filter((e) => e.type === 'directory')
          // 展示用逻辑路径（用户浏览视角）；真实 realpath 由
          // workspaceRegistry.create 自行解析，避免 /tmp→/private/tmp 跳变
          .map((e) => ({ name: e.name, path: `${base}/${e.name}` }))
          .sort((a, b) => {
            const ah = a.name.startsWith('.')
            const bh = b.name.startsWith('.')
            if (ah !== bh) return ah ? 1 : -1
            return a.name.localeCompare(b.name)
          })
      } catch {
        return []
      }
    },

    homePath() {
      return homedir()
    },

    async addWorkspace(path) {
      const registry = ctx.get('workspaceRegistry') as
        | { list(): readonly { id: { toString(): string }; path: string; title: string }[]; create(path: string, title?: string): Promise<{ id: { toString(): string }; path: string; title: string }> }
        | undefined
      if (registry === undefined) return null
      try {
        const existing = registry.list().find((w) => w.path === path)
        if (existing !== undefined) {
          return { id: existing.id.toString(), path: existing.path, title: existing.title }
        }
        const created = await registry.create(path)
        return { id: created.id.toString(), path: created.path, title: created.title }
      } catch {
        return null
      }
    },

    async renameWorkspace(id, title) {
      const registry = ctx.get('workspaceRegistry') as
        | { list(): readonly { id: { toString(): string }; setTitle(title: string): Promise<void> }[] }
        | undefined
      if (registry === undefined) return false
      const ws = registry.list().find((w) => w.id.toString() === id)
      if (ws === undefined) return false
      try {
        await ws.setTitle(title)
        return true
      } catch {
        return false
      }
    },

    async deleteWorkspace(id) {
      const registry = ctx.get('workspaceRegistry') as
        | { delete(id: unknown): Promise<boolean> }
        | undefined
      if (registry === undefined) return false
      try {
        return await registry.delete(id)
      } catch {
        return false
      }
    },

    async listPlugins() {
      try {
        const plugins: { id: string; name: string; enabled: boolean }[] = []
        for (const entry of ctx.loader.entries()) {
          if (entry.options.group !== undefined) continue
          plugins.push({
            id: String((entry.id as { toString(): string })?.toString?.() ?? entry.id),
            name: entry.options.name,
            enabled: !entry.disabled,
          })
        }
        return plugins
      } catch {
        return []
      }
    },

    async sessionContext(sessionId) {
      try {
        const session = ctx.sessions.get(sessionId as SessionId)
        if (session === undefined) return null
        const proj = ctx.get('sessionProjections') as { snapshot(session: unknown): { values: Record<string, unknown> } } | undefined
        if (proj === undefined) return null
        const snap = proj.snapshot(session)
        const pressure = snap.values['contextPressure'] as { projectedTokens?: number; contextWindow?: number } | undefined
        const breakdown = snap.values['contextBreakdown'] as { systemTokens?: number; toolsTokens?: number; messageTokens?: number } | undefined
        return {
          projectedTokens: pressure?.projectedTokens ?? 0,
          contextWindow: pressure?.contextWindow ?? 0,
          systemTokens: breakdown?.systemTokens ?? 0,
          toolsTokens: breakdown?.toolsTokens ?? 0,
          messageTokens: breakdown?.messageTokens ?? 0,
        }
      } catch {
        return null
      }
    },

    async createSession(cwd, route, agentPreset) {
      const registry = agents()
      if (registry === undefined) throw new Error('no agent factory (dsh 未运行 agent loop)')
      const handle = await (registry as unknown as {
        create(options: {
          sessionId: string
          meta: { cwd: string; agentPreset?: string }
          agentOptions: { provider: string; model: string; reasoningEffort?: string }
        }): Promise<{ agent: { id: { toString(): string } } }>
      }).create({
        sessionId: randomUUID(),
        meta: agentPreset !== undefined ? { cwd, agentPreset } : { cwd },
        agentOptions: {
          provider: route.provider,
          model: route.model,
          ...(route.reasoningEffort !== undefined ? { reasoningEffort: route.reasoningEffort } : {}),
        },
      })
      return handle.agent.id.toString()
    },

    async forkSession(sessionId, route, boundary) {
      // fork 同步复制会话种子；随后 resume 挂上 live agent 才能对话
      const child = (ctx.sessions as unknown as {
        fork(source: string, boundary?: number, childSessionId?: string): { id: { toString(): string } }
      }).fork(sessionId, boundary)
      const childId = child.id.toString()
      const registry = agents()
      if (registry !== undefined) {
        await (registry as unknown as {
          resume(options: { resumeSessionId: string; agentOptions: { provider: string; model: string } }): Promise<unknown>
        }).resume({ resumeSessionId: childId, agentOptions: { provider: route.provider, model: route.model } })
      }
      return childId
    },

    async readSlice(id, fromSeq) {
      const live = ctx.sessions.get(id as SessionId) as LiveSessionLike | undefined
      if (live) {
        const slice = live.events.slice(Math.max(0, fromSeq)).map(toEvent)
        return { id, fromSeq: Math.max(0, fromSeq), toSeq: live.seq - 1, events: slice }
      }
      const per = persistence()
      if (!per) return null
      try {
        const { events } = await per.readFrom(id, fromSeq)
        const list = events.map(toEvent)
        const last = list[list.length - 1]
        return {
          id,
          fromSeq,
          toSeq: typeof last?.seq === 'number' ? last.seq : fromSeq - 1,
          events: list,
        }
      } catch {
        return null
      }
    },

    async openSession(id, route) {
      const registry = agents()
      if (registry === undefined) return
      // 已有 live agent 则跳过（命令目录/当前模型可直接查询）
      if (registry.get(id as SessionId) !== undefined) return
      // 拿 cwd（live session header 优先，否则持久化 meta）
      let cwd: string | undefined
      const live = ctx.sessions.get(id as SessionId) as LiveSessionLike | undefined
      if (live) cwd = live.header.cwd
      else {
        const per = persistence()
        if (per) {
          try {
            const { meta } = await per.readFrom(id, 0)
            const m = meta as { cwd?: string } | undefined
            cwd = m?.cwd
          } catch {
            // 忽略，无 cwd 也可挂 agent
          }
        }
      }
      // resume/挂 agent 到已有 session（agents.create 的 prepare 会加载已有 session）
      await (registry as unknown as {
        create(options: { sessionId: string; meta: { cwd?: string }; agentOptions: { provider: string; model: string } }): Promise<unknown>
      }).create({
        sessionId: id,
        meta: cwd !== undefined ? { cwd } : {},
        agentOptions: { provider: route.provider, model: route.model },
      })
    },

    async sendUserMessage(id, text, imageRefs) {
      const agent = agents()?.get(id as SessionId)
      if (!agent) throw new Error(`no live agent for session ${id}`)
      const imageBlocks = Array.isArray(imageRefs)
        ? imageRefs.map((ref) => ({ type: 'image', attachment: ref }))
        : []
      const hasText = text.trim().length > 0
      if (!hasText && imageBlocks.length === 0) throw new Error('empty message')
      const message = createUserMessage({
        content: (hasText
          ? [...imageBlocks, { type: 'text', text }]
          : imageBlocks) as never,
        source: { kind: 'user' },
      })
      agent.followup(message)
    },

    async uploadImage(dataB64, mediaType, name) {
      const store = ctx.get('attachments') as
        | { saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> }
        | undefined
      if (store === undefined) throw new Error('附件服务不可用')
      const bytes = Buffer.from(dataB64, 'base64')
      // mediaType 由 dsh 附加入口按解码字节校验（AttachmentError 拒绝非法格式），
      // 此处仅做静态收窄，真实合法性交给 attachments.saveImage 的 admission。
      return await store.saveImage({
        data: new Uint8Array(bytes),
        mediaType: mediaType as ImageMediaType,
        ...(name !== undefined ? { name } : {}),
      })
    },

    async stopTurn(id) {
      const agent = agents()?.get(id as SessionId)
      if (!agent) throw new Error(`no live agent for session ${id}`)
      agent.cancel({ kind: 'user' })
    },

    onEvent(handler) {
      const dispose = ctx.on('session/event', (session, event) => {
        const id = session.id.toString()
        const t = eventTimeOf(event)
        if (t !== undefined) lastActivityById.set(id, Math.max(lastActivityById.get(id) ?? 0, t))
        handler(id, toEvent(event))
      })
      return () => void dispose()
    },

    onSessionsChanged(handler) {
      const disposers = [
        ctx.on('session/created', () => handler()),
        ctx.on('session/disposed', () => handler()),
        ctx.on('agent/status', () => handler()),
      ]
      return () => disposers.forEach((d) => void d())
    },

    registerApprovalAsker(ask) {
      if (!ctx.get('approval')) return null
      const listener = async (
        req: unknown,
        next: () => Promise<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'>,
      ): Promise<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'> => {
        const r = req as {
          agent: { session?: { id: { toString(): string } }; id: { toString(): string } }
          toolName: string
          callId?: unknown
          reason?: unknown
        }
        const sessionId = r.agent.session?.id.toString() ?? r.agent.id.toString()
        const requestId = `ap_${String(r.callId ?? Math.random().toString(36).slice(2, 10))}`
        let release: ((decision: 'allow' | 'deny') => void) | null = null
        const decided = new Promise<'allow' | 'deny'>((resolve) => {
          release = resolve
        })
        ask({
          requestId,
          sessionId,
          toolName: r.toolName,
          summary: typeof r.reason === 'string' ? r.reason : `approve ${r.toolName}`,
          detail: null,
          decide: async (decision) => {
            if (decision === 'pass') return
            release?.(decision)
          },
        })
        // 手机 30 秒未决策（或无人应答 decide('pass')）→ 交还瀑布（web UI / fail-closed）
        const outcome = await Promise.race([
          decided,
          new Promise<'timeout'>((resolve) => setTimeout(resolve, 30_000, 'timeout')),
        ])
        if (outcome === 'timeout') return next()
        return outcome === 'allow' ? 'allowed-once' : 'rejected'
      }
      const dispose = ctx.on('approval/request' as never, listener as never)
      return () => void dispose()
    },

    registerQuestionAsker(ask) {
      const service = ctx.get('userQuestions') as
        | { registerProvider(p: { ask(r: unknown): Promise<unknown> }): () => void }
        | undefined
      if (!service) return null
      try {
        return service.registerProvider({
          async ask(request: unknown) {
            const r = request as {
              questions: readonly { question: string; options?: readonly string[] }[]
              agent?: { session?: { id: { toString(): string } }; id: { toString(): string } }
            }
            const first = r.questions[0]
            const sessionId = r.agent?.session?.id.toString() ?? r.agent?.id.toString() ?? ''
            const requestId = `q_${Math.random().toString(36).slice(2, 10)}`
            return await new Promise((resolve) => {
              ask({
                requestId,
                sessionId,
                question: first?.question ?? '',
                options: first?.options ? [...first.options] : [],
                answer: async (text) => resolve({ answer: text }),
              })
            })
          },
        })
      } catch {
        // 已有 provider（如 web UI）——本插件退位
        return null
      }
    },
  }
}
