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
import type { DshSessionEvent } from '@dsh-companion/bridge-protocol'
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
  /** 模型目录（provider/模型列表）+ 会话当前选择 */
  listModels(sessionId: string): Promise<{ providers: readonly { id: string; models: readonly { id: string; name?: string }[] }[]; current: { provider: string; model: string } | null }>
  /** agent preset 目录（standard/code/minimal/…） */
  listPresets(): Promise<readonly { id: string; name?: string; description?: string; isDefault: boolean }[]>
  /** 列目录（仅目录，隐藏目录排后）；供手机端目录树浏览 */
  listDir(path: string): Promise<readonly DirEntry[]>
  /** Worker 端用户 home（目录树起点） */
  homePath(): string
  /** 添加 workspace（按绝对路径）；已存在时幂等返回既有记录 */
  addWorkspace(path: string): Promise<WorkspaceSummary | null>
  /** 在指定 cwd 创建新会话（M3）；返回 sessionId */
  createSession(cwd: string, route: { provider: string; model: string }, agentPreset?: string): Promise<string>
  /** 从既有会话分叉（dsh fork：取平衡的已完成回合前缀作种子）并挂 agent；返回新 sessionId */
  forkSession(sessionId: string, route: { provider: string; model: string }, boundary?: number): Promise<string>
  readSlice(id: string, fromSeq: number): Promise<SessionSlice | null>
  sendUserMessage(id: string, text: string): Promise<void>
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

  const toSummary = (id: string, createdAt: number, cwd: string | undefined, lastSeq: number): SessionSummary => {
    const status = agentStatusById().get(id)
    return {
      id,
      createdAt,
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
            summaries.set(id, toSummary(id, h.createdAt, h.cwd, h.lastSeq ?? -1))
          }
        } catch {
          // 持久化后端不可用时仅返回 live
        }
      }
      const live = ctx.sessions.list() as readonly LiveSessionLike[]
      for (const s of live) {
        const id = s.id.toString()
        summaries.set(id, toSummary(id, s.header.createdAt, s.header.cwd, s.seq - 1))
      }
      return [...summaries.values()].sort((a, b) => b.createdAt - a.createdAt)
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
        | { listProviders(): readonly { id: string; models: readonly { id: string; name?: string }[] }[] }
        | undefined
      const registry = agents()
      const agent = registry?.get(sessionId as SessionId) as { options?: { provider?: string; model?: string } } | undefined
      const current = agent?.options !== undefined && typeof agent.options.provider === 'string' && typeof agent.options.model === 'string'
        ? { provider: agent.options.provider, model: agent.options.model }
        : null
      if (llm === undefined) return { providers: [], current }
      try {
        return { providers: llm.listProviders(), current }
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

    async createSession(cwd, route, agentPreset) {
      const registry = agents()
      if (registry === undefined) throw new Error('no agent factory (dsh 未运行 agent loop)')
      const handle = await (registry as unknown as {
        create(options: {
          sessionId: string
          meta: { cwd: string; agentPreset?: string }
          agentOptions: { provider: string; model: string }
        }): Promise<{ agent: { id: { toString(): string } } }>
      }).create({
        sessionId: randomUUID(),
        meta: agentPreset !== undefined ? { cwd, agentPreset } : { cwd },
        agentOptions: { provider: route.provider, model: route.model },
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

    async sendUserMessage(id, text) {
      const agent = agents()?.get(id as SessionId)
      if (!agent) throw new Error(`no live agent for session ${id}`)
      const message = createUserMessage({
        content: [{ type: 'text', text }],
        // 正常用户消息（Web 端同款 source）；此前误用 plugin source，
        // 导致 Web UI 把手机消息归类为 Context Injection
        source: { kind: 'user' },
      })
      agent.followup(message)
    },

    async stopTurn(id) {
      const agent = agents()?.get(id as SessionId)
      if (!agent) throw new Error(`no live agent for session ${id}`)
      agent.cancel({ kind: 'user' })
    },

    onEvent(handler) {
      const dispose = ctx.on('session/event', (session, event) => {
        handler(session.id.toString(), toEvent(event))
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
