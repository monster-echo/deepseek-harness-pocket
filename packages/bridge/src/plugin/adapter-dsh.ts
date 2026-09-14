/**
 * ★★ dsh 版本适配唯一收敛点。
 *
 * 所有对 dsh Cordis 服务（ctx.sessions / ctx.sessionPersistence / ctx.agents /
 * ctx.approval / ctx.userQuestions）的调用都在本文件；dsh breaking changes 只改这里。
 * Hub 与路由只依赖本文件导出的窄接口，可脱离 dsh 单测。
 */

import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef, ImageMediaType, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import type {
  DshSessionEvent,
  FeedbackCategory,
  FeedbackItem,
  FeedbackRating,
  JobSnapshot,
  QuestionAnswerItem,
  CredentialRecordInfo,
  AgentPresetInfo,
  SessionSearchHit,
  SettingsSectionInfo,
  SettingsUpdateOutcome,
  SkillInfo,
  UserQuestionItem,
} from '@deepseek-harness-pocket/bridge-protocol'
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
  readonly type: 'file' | 'directory'
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
  /** fork 来源会话（种子血缘）；无则 null */
  readonly parentSession: string | null
  /** 子代理会话标记（dsh SessionHeader.origin） */
  readonly origin: 'subagent' | null
  /** 委派深度：顶层为 0 */
  readonly delegationDepth: number
  /** 组合该会话的 agent preset id */
  readonly agentPreset: string | null
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
  /** 首题扁平镜像（兼容） */
  readonly question: string
  readonly options: readonly string[]
  /** 完整题目（多选 / 计划评审 / 题干补充说明） */
  readonly questions: readonly UserQuestionItem[]
  readonly answer: (answers: readonly QuestionAnswerItem[]) => Promise<void>
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
  /** 列目录（目录+文件，隐藏排后）；目录树浏览与产物列表共用 */
  listDir(path: string): Promise<readonly DirEntry[]>
  /** 目标元信息（不存在返回 null） */
  statFile(path: string): Promise<{ type: 'file' | 'directory' | 'other'; size?: number } | null>
  /** 读文件字节（maxBytes 由调用方策略限制；读失败/不存在返回 null） */
  readFile(path: string, maxBytes: number): Promise<Uint8Array | null>
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
  /** 该会话的后台任务（dsh ctx.jobs 注册表，按 ownerSession 过滤） */
  listJobs(sessionId: string): Promise<readonly JobSnapshot[]>
  /** 订阅任务变化（注册表不存在时返回 no-op 退订） */
  onJobsChanged(handler: () => void): () => void
  /** 会话内已提交的消息反馈（dsh ctx.messageFeedback） */
  listFeedback(sessionId: string): Promise<readonly FeedbackItem[]>
  /** 提交/覆盖一条消息反馈；失败返回 null */
  putFeedback(
    sessionId: string,
    messageId: string,
    rating: FeedbackRating,
    note?: string,
    category?: FeedbackCategory,
  ): Promise<FeedbackItem | null>
  /** 删除一条消息反馈（需 CAS version） */
  deleteFeedback(sessionId: string, messageId: string, version: string): Promise<boolean>
  /** 跨会话内容搜索（dsh ctx.sessionQuery；服务缺失返回空数组） */
  searchSessions(query: string, limit: number): Promise<readonly SessionSearchHit[]>
  /** 技能目录（dsh ctx.skills；按 cwd 解析分层；服务缺失返回空数组） */
  listSkills(cwd?: string): Promise<readonly SkillInfo[]>
  /** 设置命名空间概览（秘密字段打码，只读） */
  describeSettings(): Promise<readonly SettingsSectionInfo[]>
  /** 凭据记录元信息（只有 key/kind/配置状态，绝不含秘密值） */
  listCredentials(): Promise<readonly CredentialRecordInfo[]>
  /** 写回一个设置命名空间（CAS：expectedRevision 不匹配则返回冲突） */
  updateSettings(ns: string, patch: Record<string, unknown>, expectedRevision?: number): Promise<SettingsUpdateOutcome>
  /** 写入一条凭据（秘密值只在本次调用中存在，不落日志） */
  setCredential(ref: string, value: string): Promise<boolean>
  /** 删除一条凭据 */
  unsetCredential(ref: string): Promise<boolean>
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
  readonly header: {
    createdAt: number
    cwd?: string
    agentPreset?: string
    parentSession?: unknown
    origin?: unknown
    delegationDepth?: unknown
  }
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

/** dsh agentPresets 服务（preset 组合决定 agent 可见的工具与提示段）。 */
interface AgentPresetsLike {
  resolve(presetId?: string): Promise<{ id: string }>
  mount(agentCtx: unknown, presetId: string): Promise<void>
}

/** dsh 选项：字符串或 { label, description } 两种形态都接受。 */
function toQuestionOptions(value: unknown): readonly { label: string; description?: string }[] | undefined {
  if (!Array.isArray(value)) return undefined
  const options: { label: string; description?: string }[] = []
  for (const raw of value) {
    if (typeof raw === 'string') {
      options.push({ label: raw })
      continue
    }
    if (typeof raw !== 'object' || raw === null) continue
    const o = raw as Record<string, unknown>
    if (typeof o['label'] !== 'string') continue
    options.push(
      typeof o['description'] === 'string'
        ? { label: o['label'], description: o['description'] }
        : { label: o['label'] },
    )
  }
  return options.length > 0 ? options : undefined
}

/** 计划评审意图（未知 kind 丢弃，退化为普通选项列表渲染）。 */
function toQuestionIntent(value: unknown): { kind: 'plan-review'; approve: string } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const v = value as Record<string, unknown>
  if (v['kind'] !== 'plan-review' || typeof v['approve'] !== 'string') return undefined
  return { kind: 'plan-review', approve: v['approve'] }
}

/**
 * 审批详情：审批请求只带 toolName/callId，入参要用 callId 回查会话日志里的 tool/call。
 * 纯函数（只看 events），找不到返回 null（App 侧退回只显示摘要）。
 */
export function approvalDetailFromEvents(
  events: readonly unknown[],
  callId: unknown,
): Record<string, unknown> | null {
  if (typeof callId !== 'string' || callId.length === 0) return null
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i] as
      | { type?: unknown; data?: { callId?: unknown; name?: unknown; arguments?: unknown } }
      | undefined
    if (event?.type !== 'tool/call') continue
    if (event.data?.callId !== callId) continue
    const detail: Record<string, unknown> = {}
    if (typeof event.data.name === 'string') detail['name'] = event.data.name
    const args = event.data.arguments
    if (typeof args === 'string') {
      try {
        detail['arguments'] = JSON.parse(args) as unknown
      } catch {
        // 流式聚合未完成：保留原文截断
        detail['argumentsRaw'] = args.slice(0, 4000)
      }
    }
    return Object.keys(detail).length > 0 ? detail : null
  }
  return null
}

/** 从 ctx 取会话事件（持久/实时），失败返回空数组。 */
function sessionEventsOf(ctx: Context, sessionId: string): readonly unknown[] {
  try {
    const session = ctx.sessions.get(sessionId as never) as { events?: readonly unknown[] } | undefined
    return session?.events ?? []
  } catch {
    return []
  }
}

/** 审批单行摘要：优先 dsh 给的理由，否则用工具名 + 入参里的关键字段。 */
export function approvalSummary(toolName: string, reason: unknown, detail: Record<string, unknown> | null): string {
  if (typeof reason === 'string' && reason.length > 0) return reason
  const args = detail?.['arguments']
  if (typeof args === 'object' && args !== null) {
    const a = args as Record<string, unknown>
    for (const key of ['command', 'path', 'file_path', 'url', 'query']) {
      const value = a[key]
      if (typeof value === 'string' && value.length > 0) {
        return `${toolName}: ${value.length > 120 ? `${value.slice(0, 120)}…` : value}`
      }
    }
  }
  return `approve ${toolName}`
}

/** dsh ctx.jobs 注册表的窄投影（未装载 jobs 插件时为 undefined）。 */
interface JobRegistryLike {
  list(caller?: unknown): readonly unknown[]
  onJobsChanged?(listener: () => void): () => void
}

function jobsRegistry(ctx: Context): JobRegistryLike | undefined {
  try {
    return ctx.get('jobs') as JobRegistryLike | undefined
  } catch {
    return undefined
  }
}

/** dsh JobSnapshot → 协议快照（只取 UI 需要的字段）。 */
function toJobSnapshot(raw: unknown): JobSnapshot {
  const j = raw as {
    id?: { toString(): string }
    kind?: unknown
    label?: unknown
    status?: unknown
    detail?: unknown
    startedAt?: unknown
    finishedAt?: unknown
  }
  const status = j.status
  return {
    id: j.id !== undefined ? j.id.toString() : 'job',
    kind: typeof j.kind === 'string' ? j.kind : 'job',
    label: typeof j.label === 'string' ? j.label : 'job',
    status: status === 'stopping' || status === 'completed' || status === 'killed' || status === 'failed'
      ? status
      : 'running',
    ...(typeof j.detail === 'string' ? { detail: j.detail } : {}),
    startedAt: typeof j.startedAt === 'number' ? j.startedAt : 0,
    ...(typeof j.finishedAt === 'number' ? { finishedAt: j.finishedAt } : {}),
  }
}

/** dsh ctx.messageFeedback 的窄投影（未装载时为 undefined）。 */
interface MessageFeedbackLike {
  list(request: unknown): Promise<{ ok: boolean; value?: unknown }>
  put(request: unknown): Promise<{ ok: boolean; value?: unknown }>
  delete(request: unknown): Promise<{ ok: boolean; value?: unknown }>
}

function feedbackService(ctx: Context): MessageFeedbackLike | undefined {
  try {
    return ctx.get('messageFeedback') as MessageFeedbackLike | undefined
  } catch {
    return undefined
  }
}

/** dsh MessageFeedbackItem → 协议条目（只取 UI 需要的字段）。 */
function toFeedbackItem(raw: unknown): FeedbackItem | null {
  if (typeof raw !== 'object' || raw === null) return null
  const v = raw as Record<string, unknown>
  const messageId = v['messageId']
  const rating = v['rating']
  const version = v['version']
  if (typeof messageId !== 'string' && !(messageId !== null && typeof messageId === 'object')) return null
  if (rating !== 'positive' && rating !== 'negative') return null
  if (typeof version !== 'string') return null
  const category = v['category']
  return {
    messageId: typeof messageId === 'string' ? messageId : String(messageId),
    rating,
    ...(typeof v['note'] === 'string' && v['note'].length > 0 ? { note: v['note'] } : {}),
    ...(typeof category === 'string' ? { category: category as FeedbackCategory } : {}),
    version,
    createdAt: typeof v['createdAt'] === 'number' ? v['createdAt'] : 0,
    updatedAt: typeof v['updatedAt'] === 'number' ? v['updatedAt'] : 0,
  }
}

/** dsh SessionSearchHit → 协议命中（只取 UI 需要的字段）。 */
function toSearchHit(raw: unknown): SessionSearchHit | null {
  if (typeof raw !== 'object' || raw === null) return null
  const h = raw as {
    header?: { id?: { toString(): string }; cwd?: unknown; createdAt?: unknown }
    live?: unknown
    bestMatch?: { snippet?: unknown }
  }
  const id = h.header?.id
  if (id === undefined) return null
  return {
    sessionId: id.toString(),
    snippet: typeof h.bestMatch?.snippet === 'string' ? h.bestMatch.snippet : '',
    cwd: typeof h.header?.cwd === 'string' ? h.header.cwd : null,
    createdAt: typeof h.header?.createdAt === 'number' ? h.header.createdAt : 0,
    live: h.live === true,
  }
}

/** dsh SkillSummary → 协议技能信息。 */
function toSkillInfo(raw: unknown): SkillInfo | null {
  if (typeof raw !== 'object' || raw === null) return null
  const s = raw as {
    name?: unknown
    description?: unknown
    whenToUse?: unknown
    invocation?: { modelInvocable?: unknown; userInvocable?: unknown }
    provider?: unknown
  }
  if (typeof s.name !== 'string' || s.name.length === 0) return null
  return {
    name: s.name,
    description: typeof s.description === 'string' ? s.description : '',
    ...(typeof s.whenToUse === 'string' && s.whenToUse.length > 0 ? { whenToUse: s.whenToUse } : {}),
    modelInvocable: s.invocation?.modelInvocable !== false,
    userInvocable: s.invocation?.userInvocable !== false,
    provider: typeof s.provider === 'string' ? s.provider : '',
  }
}

/** dsh SettingsDescriptor → 只读概览（值截断，秘密已由宿主打码）。 */
function toSettingsSection(raw: unknown): SettingsSectionInfo | null {
  if (typeof raw !== 'object' || raw === null) return null
  const s = raw as {
    ns?: unknown
    applies?: unknown
    revision?: unknown
    value?: unknown
    user?: unknown
  }
  if (typeof s.ns !== 'string') return null
  let preview = '—'
  try {
    const json = JSON.stringify(s.value ?? null)
    if (json !== undefined) preview = json.length > 800 ? `${json.slice(0, 800)}…` : json
  } catch {
    preview = '—'
  }
  const secrets = (raw as { secrets?: unknown }).secrets
  const hasSecrets = Array.isArray(secrets) && secrets.length > 0
  let valueJson: string | undefined
  if (!hasSecrets) {
    try {
      valueJson = JSON.stringify(s.value ?? null, null, 2)
    } catch {
      valueJson = undefined
    }
  }
  return {
    ns: s.ns,
    applies: typeof s.applies === 'string' ? s.applies : 'unknown',
    revision: typeof s.revision === 'number' ? s.revision : 0,
    overridden: s.user !== undefined && s.user !== null,
    preview,
    editable: !hasSecrets,
    ...(valueJson !== undefined ? { valueJson } : {}),
  }
}

/** dsh 凭据记录 → 元信息（只取地址与类型，丢弃任何秘密值）。 */
function toCredentialRecord(raw: unknown): CredentialRecordInfo | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as { key?: unknown; kind?: unknown; keyName?: unknown }
  if (r.key === undefined || r.key === null) return null
  return {
    key: typeof r.key === 'string' ? r.key : String(r.key),
    kind: typeof r.kind === 'string' ? r.kind : 'unknown',
    // describe() 拿到之前先给保守默认值（后续 listCredentials 会补齐）
    configured: false,
    writable: false,
  }
}

function toEvent(raw: unknown): DshSessionEvent {
  // SessionEvent 全 JSON 可序列化；宽松透传（type/seq 由协议层校验）
  return raw as DshSessionEvent
}

export function createAdapter(ctx: Context): DshAdapter {
  const persistence = () => ctx.get('sessionPersistence') as PersistenceLike | undefined
  const agents = () => ctx.get('agents') as AgentRegistryLike | undefined
  const presets = () => ctx.get('agentPresets') as AgentPresetsLike | undefined

  /**
   * 解析 preset 并产出 setup 钩子（镜像 dsh-host-apiproxy 的 composeAgent）：
   * 工具 schema 与提示段由 preset 组合提供，agent 必须在 setup 阶段挂载 preset，
   * 否则模型拿不到任何工具（toolsTokens=0，模型会把工具调用当文本输出）。
   * id 必须在 session 边界快照 meta 之前解析完成，才能落入 header。
   */
  const composePreset = async (requested?: string): Promise<{
    agentPreset?: string
    setup?: (agentCtx: unknown) => Promise<void>
  }> => {
    const service = presets()
    if (service === undefined) return {}
    const resolvedId = (await service.resolve(requested)).id
    return {
      agentPreset: resolvedId,
      setup: async (agentCtx: unknown) => {
        await service.mount(agentCtx, resolvedId)
      },
    }
  }

  /** 读取会话当前 preset：live header 优先，否则持久化 meta，最后扫 agent-preset/selected 事件。 */
  const presetOfSession = async (id: string): Promise<string | undefined> => {
    const live = ctx.sessions.get(id as SessionId) as LiveSessionLike | undefined
    if (live !== undefined) {
      if (live.header.agentPreset !== undefined) return live.header.agentPreset
      for (let i = live.events.length - 1; i >= 0; i -= 1) {
        const e = live.events[i] as { type?: string; data?: { agentPreset?: string } }
        if (e.type === 'agent-preset/selected' && typeof e.data?.agentPreset === 'string') return e.data.agentPreset
      }
      return undefined
    }
    const per = persistence()
    if (per) {
      try {
        const { meta, events } = await per.readFrom(id, 0)
        const fromMeta = (meta as { agentPreset?: string } | undefined)?.agentPreset
        if (fromMeta !== undefined) return fromMeta
        for (let i = events.length - 1; i >= 0; i -= 1) {
          const e = events[i] as { type?: string; data?: { agentPreset?: string } }
          if (e.type === 'agent-preset/selected' && typeof e.data?.agentPreset === 'string') return e.data.agentPreset
        }
      } catch {
        // 读不到就回退默认 preset
      }
    }
    return undefined
  }
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

  const toSummary = (
    id: string,
    createdAt: number,
    cwd: string | undefined,
    lastSeq: number,
    lastActivityAt?: number,
    title?: string | null,
    meta?: {
      parentSession?: unknown
      origin?: unknown
      delegationDepth?: unknown
      agentPreset?: unknown
    },
  ): SessionSummary => {
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
      parentSession: typeof meta?.parentSession === 'string'
        ? meta.parentSession
        : meta?.parentSession !== undefined && meta?.parentSession !== null
          ? String(meta.parentSession)
          : null,
      origin: meta?.origin === 'subagent' ? 'subagent' : null,
      delegationDepth: typeof meta?.delegationDepth === 'number' ? meta.delegationDepth : 0,
      agentPreset: typeof meta?.agentPreset === 'string' ? meta.agentPreset : null,
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
            summaries.set(id, toSummary(
              id,
              h.createdAt,
              h.cwd,
              h.lastSeq ?? -1,
              lastActivityById.get(id),
              null,
              {
                parentSession: (h as { parentSession?: unknown }).parentSession,
                origin: (h as { origin?: unknown }).origin,
                delegationDepth: (h as { delegationDepth?: unknown }).delegationDepth,
                agentPreset: (h as { agentPreset?: unknown }).agentPreset,
              },
            ))
          }
        } catch {
          // 持久化后端不可用时仅返回 live
        }
      }
      const live = ctx.sessions.list() as readonly LiveSessionLike[]
      for (const s of live) {
        const id = s.id.toString()
        const tail = s.events[s.events.length - 1]
        summaries.set(id, toSummary(
          id,
          s.header.createdAt,
          s.header.cwd,
          s.seq - 1,
          lastActivityById.get(id) ?? eventTimeOf(tail),
          extractTitle(s.events),
          s.header,
        ))
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
        | {
          defaultId?: string
          list(): Promise<readonly {
            id: string
            name?: string
            description?: string
            path?: string
            trust?: unknown
            broken?: unknown
          }[]>
        }
        | undefined
      if (presets === undefined) return []
      try {
        const defaultId = presets.defaultId
        const list = await presets.list()
        return await Promise.all(list.map(async (entry): Promise<AgentPresetInfo> => {
          // 组成文件正文（只读、截断）：Web 的 preset 卡「查看」等价物
          let composition: string | undefined
          if (typeof entry.path === 'string' && entry.path.length > 0) {
            try {
              const text = await readFile(entry.path, 'utf8')
              composition = text.length > 4000 ? `${text.slice(0, 4000)}\n…（已截断）` : text
            } catch {
              composition = undefined
            }
          }
          return {
            id: entry.id,
            ...(entry.name !== undefined ? { name: entry.name } : {}),
            ...(entry.description !== undefined ? { description: entry.description } : {}),
            isDefault: defaultId !== undefined ? entry.id === defaultId : false,
            trust: entry.trust === 'user' ? 'user' : 'system',
            ...(typeof entry.broken === 'string' && entry.broken.length > 0 ? { broken: entry.broken } : {}),
            ...(composition !== undefined ? { composition } : {}),
          }
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
          .filter((e) => e.type === 'directory' || e.type === 'file')
          // 展示用逻辑路径（用户浏览视角）；真实 realpath 由
          // workspaceRegistry.create 自行解析，避免 /tmp→/private/tmp 跳变
          .map((e) => ({ name: e.name, path: `${base}/${e.name}`, type: e.type as 'file' | 'directory' }))
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

    async statFile(path) {
      const fs = ctx.get('fs') as
        | {
            resolve(p: string, opts?: { signal?: AbortSignal }): Promise<unknown>
            stat(target: unknown, signal?: AbortSignal): Promise<{ type: 'file' | 'directory' | 'other'; size?: number } | undefined>
          }
        | undefined
      if (fs === undefined) return null
      try {
        return (await fs.stat(await fs.resolve(path))) ?? null
      } catch {
        return null
      }
    },

    async readFile(path, maxBytes) {
      const fs = ctx.get('fs') as
        | {
            resolve(p: string, opts?: { signal?: AbortSignal }): Promise<unknown>
            readBytes(target: unknown, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>
          }
        | undefined
      if (fs === undefined) return null
      try {
        return await fs.readBytes(await fs.resolve(path), undefined, maxBytes)
      } catch {
        return null
      }
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

    async describeSettings() {
      const provider = ctx.get('settings') as
        | {
          writable?: boolean
          describe(options?: { redactSecrets?: boolean }): readonly unknown[]
        }
        | undefined
      if (provider === undefined) return []
      try {
        // redactSecrets 是关键：schema 声明的秘密位置由宿主打码后再下发
        const list = provider.describe({ redactSecrets: true })
        return list.flatMap((raw) => {
          const section = toSettingsSection(raw)
          return section === null ? [] : [section]
        })
      } catch {
        return []
      }
    },

    async setCredential(ref, value) {
      const provider = ctx.get('credentials') as
        | { set(ref: unknown, value: string): Promise<void> }
        | undefined
      if (provider === undefined) return false
      try {
        await provider.set(ref, value)
        return true
      } catch {
        return false
      }
    },

    async unsetCredential(ref) {
      const provider = ctx.get('credentials') as
        | { unset(ref: unknown): Promise<void> }
        | undefined
      if (provider === undefined) return false
      try {
        await provider.unset(ref)
        return true
      } catch {
        return false
      }
    },

    async updateSettings(ns, patch, expectedRevision) {
      const provider = ctx.get('settings') as
        | {
          writable?: boolean
          update(ns: string, patch: object, expectedRevision?: number): Promise<void>
          describe(options?: { redactSecrets?: boolean }): readonly unknown[]
        }
        | undefined
      if (provider === undefined) throw new Error('settings 服务不可用')
      if (provider.writable === false) throw new Error('配置为只读，无法写回')
      try {
        await provider.update(ns, patch, expectedRevision)
      } catch (error) {
        // 版本冲突：把当前修订号回给客户端，便于提示后重试
        const code = (error as { code?: unknown }).code
        if (code === 'SETTINGS_CONFLICT') {
          const descriptor = provider.describe({ redactSecrets: true }).find(
            (raw) => typeof raw === 'object' && raw !== null && (raw as { ns?: unknown }).ns === ns,
          )
          const actual = (descriptor as { revision?: unknown } | undefined)?.revision
          return {
            updated: false,
            conflict: true,
            actualRevision: typeof actual === 'number' ? actual : 0,
          }
        }
        throw error
      }
      const descriptor = provider.describe({ redactSecrets: true }).find(
        (raw) => typeof raw === 'object' && raw !== null && (raw as { ns?: unknown }).ns === ns,
      )
      const revision = (descriptor as { revision?: unknown } | undefined)?.revision
      return { updated: true, revision: typeof revision === 'number' ? revision : 0 }
    },

    async listCredentials() {
      const provider = ctx.get('credentials') as
        | {
          listRecords?: () => Promise<readonly unknown[]>
          describe?: (ref: unknown) => Promise<{ configured?: unknown; source?: unknown; writable?: unknown }>
        }
        | undefined
      if (provider?.listRecords === undefined) return []
      try {
        const records = await provider.listRecords()
        const infos = await Promise.all(records.map(async (raw) => {
          const record = toCredentialRecord(raw)
          if (record === null) return null
          // describe 只返回 {configured, source, writable}，不含秘密
          try {
            const info = await provider.describe?.(record.key)
            return {
              ...record,
              configured: info?.configured === true,
              ...(typeof info?.source === 'string' ? { source: info.source } : {}),
              writable: info?.writable === true,
            }
          } catch {
            return { ...record, configured: false, writable: false }
          }
        }))
        return infos.flatMap((info) => (info === null ? [] : [info]))
      } catch {
        return []
      }
    },

    async listSkills(cwd) {
      const registry = ctx.get('skills') as
        | { list(options?: { cwd?: string }): Promise<readonly unknown[]> }
        | undefined
      if (registry === undefined) return []
      try {
        const list = await registry.list(cwd !== undefined ? { cwd } : undefined)
        return list.flatMap((raw) => {
          const skill = toSkillInfo(raw)
          return skill === null ? [] : [skill]
        })
      } catch {
        return []
      }
    },

    async searchSessions(query, limit) {
      const engine = ctx.get('sessionQuery') as
        | { searchSessions(req: { query: string; limit?: number }): Promise<{ items?: unknown }> }
        | undefined
      if (engine === undefined) return []
      try {
        const page = await engine.searchSessions({ query, limit })
        const items = page?.items
        if (!Array.isArray(items)) return []
        return items.flatMap((raw) => {
          const hit = toSearchHit(raw)
          return hit === null ? [] : [hit]
        })
      } catch {
        // 搜索未启用/索引失败：静默降级为空结果
        return []
      }
    },

    async listFeedback(sessionId) {
      const service = feedbackService(ctx)
      if (service === undefined) return []
      try {
        const result = await service.list({ sessionId })
        if (result?.ok !== true) return []
        const items = (result.value as { items?: unknown } | undefined)?.items
        return Array.isArray(items) ? items.flatMap((raw) => {
          const item = toFeedbackItem(raw)
          return item === null ? [] : [item]
        }) : []
      } catch {
        return []
      }
    },

    async putFeedback(sessionId, messageId, rating, note, category) {
      const service = feedbackService(ctx)
      if (service === undefined) return null
      try {
        const result = await service.put({
          sessionId,
          messageId,
          rating,
          ...(note !== undefined && note.length > 0 ? { note } : {}),
          ...(category !== undefined ? { category } : {}),
          ifVersion: null,
        })
        if (result?.ok !== true) return null
        return toFeedbackItem(result.value)
      } catch {
        return null
      }
    },

    async deleteFeedback(sessionId, messageId, version) {
      const service = feedbackService(ctx)
      if (service === undefined) return false
      try {
        const result = await service.delete({ sessionId, messageId, ifVersion: version })
        return result?.ok === true
      } catch {
        return false
      }
    },

    async listJobs(sessionId) {
      const registry = jobsRegistry(ctx)
      if (registry === undefined) return []
      try {
        const all = registry.list() ?? []
        return all.flatMap((job) => {
          if (job === null || typeof job !== 'object') return []
          const owner = (job as { ownerSession?: { toString(): string } }).ownerSession
          if (owner === undefined || owner === null) return []
          if (owner.toString() !== sessionId) return []
          return [toJobSnapshot(job)]
        })
      } catch {
        return []
      }
    },

    onJobsChanged(handler) {
      const registry = jobsRegistry(ctx)
      if (registry?.onJobsChanged === undefined) return () => {}
      try {
        return registry.onJobsChanged(() => handler())
      } catch {
        return () => {}
      }
    },

    async createSession(cwd, route, agentPreset) {
      const registry = agents()
      if (registry === undefined) throw new Error('no agent factory (dsh 未运行 agent loop)')
      const composed = await composePreset(agentPreset)
      const handle = await (registry as unknown as {
        create(options: {
          sessionId: string
          meta: { cwd: string; agentPreset?: string }
          agentOptions: { provider: string; model: string; reasoningEffort?: string }
          setup?: (agentCtx: unknown) => Promise<void>
        }): Promise<{ agent: { id: { toString(): string } } }>
      }).create({
        sessionId: `session-${randomUUID()}`,
        meta: composed.agentPreset !== undefined ? { cwd, agentPreset: composed.agentPreset } : { cwd },
        agentOptions: {
          provider: route.provider,
          model: route.model,
          ...(route.reasoningEffort !== undefined ? { reasoningEffort: route.reasoningEffort } : {}),
        },
        ...(composed.setup !== undefined ? { setup: composed.setup } : {}),
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
        // fork 的子会话继承源 preset（官方路径按 resolveSessionPreset 取源值）
        const composed = await composePreset(await presetOfSession(sessionId))
        await (registry as unknown as {
          resume(options: {
            resumeSessionId: string
            agentOptions: { provider: string; model: string }
            setup?: (agentCtx: unknown) => Promise<void>
          }): Promise<unknown>
        }).resume({
          resumeSessionId: childId,
          agentOptions: { provider: route.provider, model: route.model },
          ...(composed.setup !== undefined ? { setup: composed.setup } : {}),
        })
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
      // 拿 cwd 与 preset（live session header 优先，否则持久化 meta）
      let cwd: string | undefined
      const live = ctx.sessions.get(id as SessionId) as LiveSessionLike | undefined
      if (live) cwd = live.header.cwd
      const agentPreset = await presetOfSession(id)
      const composed = await composePreset(agentPreset)
      // resume/挂 agent 到已有 session（agents.create 的 prepare 会加载已有 session）
      await (registry as unknown as {
        create(options: {
          sessionId: string
          meta: { cwd?: string; agentPreset?: string }
          agentOptions: { provider: string; model: string }
          setup?: (agentCtx: unknown) => Promise<void>
        }): Promise<unknown>
      }).create({
        sessionId: id,
        meta: cwd !== undefined ? { cwd } : {},
        agentOptions: { provider: route.provider, model: route.model },
        ...(composed.setup !== undefined ? { setup: composed.setup } : {}),
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
        const detail = approvalDetailFromEvents(sessionEventsOf(ctx, sessionId), r.callId)
        ask({
          requestId,
          sessionId,
          toolName: r.toolName,
          summary: approvalSummary(r.toolName, r.reason, detail),
          detail,
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
              questions: readonly {
                id?: unknown
                question?: unknown
                detail?: unknown
                header?: unknown
                options?: readonly unknown[]
                multiSelect?: unknown
                intent?: unknown
              }[]
              agent?: { session?: { id: { toString(): string } }; id: { toString(): string } }
            }
            const questions: UserQuestionItem[] = (r.questions ?? []).flatMap((q, index) => {
              if (typeof q.question !== 'string') return []
              const options = toQuestionOptions(q.options)
              const intent = toQuestionIntent(q.intent)
              return [{
                id: typeof q.id === 'string' ? q.id : `q${index}`,
                question: q.question,
                ...(typeof q.detail === 'string' ? { detail: q.detail } : {}),
                ...(typeof q.header === 'string' ? { header: q.header } : {}),
                ...(options !== undefined ? { options } : {}),
                ...(q.multiSelect === true ? { multiSelect: true } : {}),
                ...(intent !== undefined ? { intent } : {}),
              }]
            })
            const first = questions[0]
            const sessionId = r.agent?.session?.id.toString() ?? r.agent?.id.toString() ?? ''
            const requestId = `q_${Math.random().toString(36).slice(2, 10)}`
            return await new Promise((resolve) => {
              ask({
                requestId,
                sessionId,
                question: first?.question ?? '',
                options: first?.options?.map((o) => o.label) ?? [],
                questions,
                // dsh 的 AskUserQuestionAnswer 是结构化的 { answers: [...] }
                answer: async (answers) => resolve({ answers: [...answers] }),
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
