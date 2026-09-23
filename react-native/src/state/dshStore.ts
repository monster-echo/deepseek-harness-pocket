/**
 * dsh 全局状态（zustand）：gateway 连接、Worker presence、
 * 当前 Worker 的会话与对话视图、审批/问题。
 */

import { create } from 'zustand'
import type { AgentPresetInfo, CredentialRecordInfo, FeedbackCategory, FeedbackItem, FeedbackRating, JobSnapshot, ServerRequest, SessionSearchHit, SettingsSectionInfo, SkillInfo, WorkerPresence } from '@deepseek-harness-pocket/bridge-protocol'
import { GatewayConnection, type GatewayStatus } from '../dsh/connection'
import { DshClient, type HandshakeInfo } from '../dsh/client'
import { emptySessionView, projectSessionList, reduceSessionEvent, type SessionListItem, type SessionView } from '../features/conversation/reducer'

/** workspace 注册表条目（Worker 上的项目目录） */
export interface WorkspaceRow {
  id: string
  path: string
  title: string
}

interface DshState {
  gatewayStatus: GatewayStatus
  workers: readonly WorkerPresence[]
  activeWorkerId: string | null
  workerHandshake: HandshakeInfo | null
  sessions: readonly SessionListItem[]
  activeSessionId: string | null
  /** 已选中会话但快照未到（sidebar 切换后主区域显示加载态） */
  sessionLoading: boolean
  sessionView: SessionView
  /** 当前 Worker 的 workspace 注册表缓存：sidebar/新建会话首帧直接渲染，listWorkspaces 后台刷新 */
  workspaces: readonly WorkspaceRow[]
  serverRequests: readonly ServerRequest[]
  /** 当前会话的后台任务（jobs 帧推送 + jobs.list 拉取） */
  jobs: readonly JobSnapshot[]
  /** 当前会话的消息级反馈（messageId → 条目） */
  feedback: Readonly<Record<string, FeedbackItem>>
  /** 侧栏搜索的正文命中（跨会话） */
  contentHits: readonly SessionSearchHit[]
  /** 技能目录缓存（Composer 的 `/` 技能源） */
  skillCatalog: readonly SkillInfo[]
  /** Worker 设置命名空间概览（只读） */
  workerSections: readonly SettingsSectionInfo[]
  /** Worker 凭据记录元信息（无秘密值） */
  workerCredentials: readonly CredentialRecordInfo[]
  notice: string | null
  /** worker 模型目录缓存（Composer 的模型列表）；inputModalities 用于图片能力提示；provider 为所属路由 */
  modelCatalog: readonly { id: string; name?: string; provider?: string; inputModalities?: readonly ('text' | 'image')[] }[]

  connectGateway(): void
  disconnectGateway(): void
  openWorker(workerId: string): void
  refreshSessions(): Promise<void>
  listWorkspaces(): Promise<readonly WorkspaceRow[]>
  listDir(path: string): Promise<readonly { name: string; path: string }[]>
  /** 列目录含文件（产物列表） */
  listEntries(path: string): Promise<readonly { name: string; path: string; type: 'file' | 'directory' }[]>
  /** 作品预览：分块拉取拼装（{mime, base64}） */
  previewFile(path: string): Promise<{ mime: string; base64: string }>
  fsHome(): Promise<string>
  addWorkspace(path: string): Promise<WorkspaceRow | null>
  renameWorkspace(id: string, title: string): Promise<boolean>
  deleteWorkspace(id: string): Promise<boolean>
  listPlugins(): Promise<readonly { id: string; name: string; enabled: boolean }[]>
  /** 主动刷新当前会话后台任务（打开面板时） */
  refreshJobs(): Promise<void>
  /** 拉取当前会话的消息反馈 */
  loadFeedback(): Promise<void>
  /** 提交/覆盖一条消息反馈 */
  rateMessage(messageId: string, rating: FeedbackRating, note?: string, category?: FeedbackCategory): Promise<void>
  /** 删除一条消息反馈 */
  removeFeedback(messageId: string): Promise<void>
  /** 侧栏正文搜索（空 query 清空结果） */
  searchContent(query: string): Promise<void>
  /** 拉取技能目录（按会话工作区分层） */
  listSkills(): Promise<void>
  /** 拉取 Worker 配置（只读） */
  loadWorkerConfig(): Promise<void>
  /** 写入/删除凭据（成功后自动刷新配置） */
  setCredential(ref: string, value: string): Promise<boolean>
  unsetCredential(ref: string): Promise<boolean>
  /** 写回设置命名空间；返回冲突时的当前修订号（成功为 null） */
  updateSetting(ns: string, patch: Record<string, unknown>, expectedRevision?: number): Promise<number | null | 'error'>
  sessionContext(sessionId: string): Promise<{ projectedTokens: number; contextWindow: number; systemTokens: number; toolsTokens: number; messageTokens: number } | null>
  createSession(cwd: string, opts?: { reasoningEffort?: string; permission?: string }): Promise<string | null>
  forkSession(sessionId: string, boundary?: number): Promise<string | null>
  openSession(sessionId: string): Promise<void>
  /** 开始新会话：清 activeSessionId，主区域显示新建会话首屏（Composer） */
  startNewSession(): void
  sendMessage(text: string, images?: readonly unknown[]): Promise<void>
  uploadImage(dataB64: string, mediaType: string, name?: string): Promise<unknown | null>
  stopTurn(): Promise<void>
  respondPermission(requestId: string, decision: 'allow' | 'deny'): Promise<void>
  permissionOptions(): Promise<{ names: string[]; default: string }>
  setPermission(preset: string): Promise<void>
  listCommands(): Promise<readonly { name: string; description: string }[]>
  listModels(): Promise<{ providers: readonly { id: string; name?: string; models: readonly { id: string; name?: string; inputModalities?: readonly ('text' | 'image')[] }[] }[]; current: { provider: string; model: string } | null }>
  listPresets(): Promise<readonly AgentPresetInfo[]>
  /** 新会话默认：模型路由与 agent preset（发起端记录） */
  newSessionDefaults: { provider: string; model: string } | null
  newSessionPreset: string
  /**
   * 新建会话页预选工作区（顶栏/侧边栏切换工作区时写入）。
   * Composer 挂载时优先于持久化的 lastWorkspace；消费后由 Composer 清空，
   * 避免下次进入新建页时用旧值覆盖用户后来手选的目录。
   */
  newSessionWorkspace: string | null
  setNewSessionWorkspace(path: string | null): void
  setNewSessionDefaults(route: { provider: string; model: string } | null, preset?: string): void
  /** 排队发送：turn 进行时允许输入并排队，turn 结束后自动发送 */
  queueSend: boolean
  setQueueSend(v: boolean): void
  /** 置顶会话（手动排序）；置顶的会话排在列表最前 */
  pinnedSessionIds: readonly string[]
  togglePinSession(id: string): void
  respondQuestion(requestId: string, answers: readonly { id: string; selected: readonly string[]; custom?: string }[]): Promise<void>
}

/** 模块级连接与客户端（非响应式部分不放 store）。 */
let gateway: GatewayConnection | null = null
let client: DshClient | null = null

/** 最近一次正文搜索词（防止快速输入时旧结果覆盖新结果）。 */
let latestContentQuery = ''

/** 通知条：写入后 8 秒自动清除，避免残留误导。 */
let noticeTimer: ReturnType<typeof setTimeout> | null = null
function setNotice(set: (partial: Partial<DshState>) => void, message: string): void {
  set({ notice: message })
  if (noticeTimer !== null) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => set({ notice: null }), 8000)
}

export const useDshStore = create<DshState>((set, get) => {
  const ensureGateway = (): GatewayConnection => {
    if (gateway !== null) return gateway
    gateway = new GatewayConnection({
      onStatus: (status) => set({ gatewayStatus: status }),
      onPresence: (workers) => {
        set({ workers })
        const state = get()
        const online = workers.filter((w) => w.online)
        // gateway 重启/断线恢复后：自动恢复此前活跃 Worker 的隧道
        if (
          state.activeWorkerId !== null
          && state.workerHandshake !== null
          && online.some((w) => w.workerId === state.activeWorkerId)
        ) {
          gateway!.openWorker(state.activeWorkerId)
          return
        }
        // 首次连上且只有一个在线 Worker：走 store.openWorker 自动打开（它会 set activeWorkerId，
        // 否则 onTunnelFrame 因 activeWorkerId 为 null 丢弃所有回帧 → handshake 超时 → 会话/工作区全空）
        if (state.activeWorkerId === null && online.length === 1) {
          state.openWorker(online[0]!.workerId)
        }
      },
      onPush: (title) => set({ notice: title }),
      onTunnelFrame: (workerId, inner) => {
        if (client !== null && workerId === get().activeWorkerId) client.handleInner(inner)
      },
      onOpenResult: (workerId, ok, reason) => {
        if (!ok) {
          set({ activeWorkerId: null, notice: reason ?? '无法连接该 Worker' })
          return
        }
        void startClient(workerId, set, get)
      },
    })
    return gateway
  }

  return {
    gatewayStatus: 'idle',
    workers: [],
    activeWorkerId: null,
    workerHandshake: null,
    sessions: [],
    activeSessionId: null,
    sessionLoading: false,
    sessionView: emptySessionView,
    workspaces: [],
    serverRequests: [],
    jobs: [],
    feedback: {},
    contentHits: [],
    skillCatalog: [],
    workerSections: [],
    workerCredentials: [],
    notice: null,
    modelCatalog: [],
    newSessionDefaults: null,
    newSessionPreset: '',
    newSessionWorkspace: null,
    queueSend: false,
    pinnedSessionIds: [],

    connectGateway() {
      // 显式 connect()：既是首连，也是 offline 后的「重试」（connect 内部会拆掉旧 socket）
      ensureGateway().connect()
    },

    disconnectGateway() {
      gateway?.disconnect()
      gateway = null
      client?.dispose(true)
      client = null
      set({ gatewayStatus: 'idle', activeWorkerId: null, sessions: [], activeSessionId: null, sessionLoading: false, sessionView: emptySessionView, jobs: [], feedback: {}, workspaces: [] })
    },

    openWorker(workerId) {
      const g = ensureGateway()
      client?.dispose(true)
      client = null
      set({ activeWorkerId: workerId, sessions: [], activeSessionId: null, sessionLoading: false, sessionView: emptySessionView, serverRequests: [], jobs: [], feedback: {}, workspaces: [] })
      g.openWorker(workerId)
    },

    async refreshSessions() {
      if (client === null) return
      try {
        const raw = await client.listSessions()
        set({ sessions: projectSessionList(raw) })
      } catch (error) {
        setNotice(set, error instanceof Error ? error.message : String(error))
      }
    },

    async listWorkspaces() {
      if (client === null) return []
      try {
        const list = await client.listWorkspaces()
        set({ workspaces: list })
        return list
      } catch (error) {
        setNotice(set, error instanceof Error ? error.message : String(error))
        return get().workspaces
      }
    },

    async listDir(path) {
      if (client === null) return []
      try {
        return await client.fsList(path)
      } catch (error) {
        setNotice(set, error instanceof Error ? error.message : String(error))
        return []
      }
    },

    async listEntries(path) {
      if (client === null) return []
      try {
        return await client.fsEntries(path)
      } catch (error) {
        setNotice(set, error instanceof Error ? error.message : String(error))
        return []
      }
    },

    async previewFile(path) {
      if (client === null) throw new Error('未连接 Worker')
      return await client.previewFile(path)
    },

    async fsHome() {
      if (client === null) return '/'
      try {
        return await client.fsHome()
      } catch {
        return '/'
      }
    },

    async addWorkspace(path) {
      if (client === null) return null
      try {
        const w = await client.addWorkspace(path)
        // 合并进缓存（按 id 去重）：sidebar / 新建会话首屏立即见到新目录
        if (w !== null) {
          set({ workspaces: [...get().workspaces.filter((x) => x.id !== w.id), w] })
        }
        return w
      } catch (error) {
        setNotice(set, error instanceof Error ? error.message : String(error))
        return null
      }
    },

    async renameWorkspace(id, title) {
      if (client === null) return false
      try {
        const ok = await client.renameWorkspace(id, title)
        if (ok) {
          set({ workspaces: get().workspaces.map((w) => (w.id === id ? { ...w, title } : w)) })
        }
        return ok
      } catch (error) {
        setNotice(set, error instanceof Error ? error.message : String(error))
        return false
      }
    },

    async deleteWorkspace(id) {
      if (client === null) return false
      try {
        const ok = await client.deleteWorkspace(id)
        if (ok) {
          set({ workspaces: get().workspaces.filter((w) => w.id !== id) })
        }
        return ok
      } catch (error) {
        setNotice(set, error instanceof Error ? error.message : String(error))
        return false
      }
    },

    async setCredential(ref, value) {
      if (client === null) return false
      try {
        await client.setCredential(ref, value)
        setNotice(set, '密钥已保存到电脑')
        await get().loadWorkerConfig()
        return true
      } catch (error) {
        setNotice(set, error instanceof Error ? error.message : String(error))
        return false
      }
    },

    async unsetCredential(ref) {
      if (client === null) return false
      try {
        await client.unsetCredential(ref)
        setNotice(set, '密钥已删除')
        await get().loadWorkerConfig()
        return true
      } catch (error) {
        setNotice(set, error instanceof Error ? error.message : String(error))
        return false
      }
    },

    async updateSetting(ns, patch, expectedRevision) {
      if (client === null) return 'error'
      try {
        const outcome = await client.updateSetting(ns, patch, expectedRevision)
        // 冲突：把当前修订号交给 UI 提示后重试
        if (!outcome.updated) return outcome.actualRevision
        setNotice(set, '配置已写回电脑')
        await get().loadWorkerConfig()
        return null
      } catch (error) {
        setNotice(set, error instanceof Error ? error.message : String(error))
        return 'error'
      }
    },

    async loadWorkerConfig() {
      if (client === null) return
      try {
        const config = await client.workerConfig()
        set({ workerSections: [...config.sections], workerCredentials: [...config.credentials] })
      } catch (error) {
        setNotice(set, error instanceof Error ? error.message : String(error))
      }
    },

    async listSkills() {
      if (client === null) return
      const sessionId = get().activeSessionId
      const cwd = sessionId !== null
        ? get().sessions.find((x) => x.id === sessionId)?.cwd ?? undefined
        : get().newSessionWorkspace ?? undefined
      try {
        const skills = await client.listSkills(cwd ?? undefined)
        set({ skillCatalog: [...skills] })
      } catch {
        // 技能目录不可用：`/` 只显示命令
      }
    },

    async searchContent(query) {
      const trimmed = query.trim()
      latestContentQuery = trimmed
      if (trimmed.length === 0 || client === null) {
        set({ contentHits: [] })
        return
      }
      try {
        const hits = await client.searchSessions(trimmed, 20)
        // 只接受最后一次查询的结果（快速输入时避免乱序覆盖）
        if (latestContentQuery !== trimmed) return
        set({ contentHits: [...hits] })
      } catch {
        // 搜索不可用：静默降级（标题过滤仍在）
        set({ contentHits: [] })
      }
    },

    async loadFeedback() {
      if (client === null) return
      const sessionId = get().activeSessionId
      if (sessionId === null) {
        set({ feedback: {} })
        return
      }
      try {
        const items = await client.listFeedback(sessionId)
        if (sessionId !== get().activeSessionId) return
        const map: Record<string, FeedbackItem> = {}
        for (const item of items) map[item.messageId] = item
        set({ feedback: map })
      } catch {
        // 只读降级：拉取失败不打扰用户
      }
    },

    async rateMessage(messageId, rating, note, category) {
      const sessionId = get().activeSessionId
      if (client === null || sessionId === null) return
      try {
        const item = await client.putFeedback(sessionId, messageId, rating, note, category)
        if (item === null) {
          setNotice(set, '反馈未保存')
          return
        }
        set({ feedback: { ...get().feedback, [item.messageId]: item } })
        setNotice(set, rating === 'positive' ? '感谢反馈' : '已记录，感谢反馈')
      } catch (error) {
        setNotice(set, error instanceof Error ? error.message : String(error))
      }
    },

    async removeFeedback(messageId) {
      const sessionId = get().activeSessionId
      const existing = get().feedback[messageId]
      if (client === null || sessionId === null || existing === undefined) return
      try {
        const ok = await client.deleteFeedback(sessionId, messageId, existing.version)
        if (!ok) {
          setNotice(set, '反馈删除失败')
          return
        }
        const next = { ...get().feedback }
        delete next[messageId]
        set({ feedback: next })
      } catch (error) {
        setNotice(set, error instanceof Error ? error.message : String(error))
      }
    },

    async refreshJobs() {
      if (client === null) return
      const sessionId = get().activeSessionId
      if (sessionId === null) {
        set({ jobs: [] })
        return
      }
      try {
        const jobs = await client.listJobs(sessionId)
        if (sessionId !== get().activeSessionId) return
        set({ jobs: [...jobs] })
      } catch (error) {
        setNotice(set, error instanceof Error ? error.message : String(error))
      }
    },

    async listPlugins() {
      if (client === null) return []
      try {
        return await client.listPlugins()
      } catch {
        return []
      }
    },

    async sessionContext(sessionId) {
      if (client === null) return null
      try {
        return await client.sessionContext(sessionId)
      } catch {
        return null
      }
    },

    async createSession(cwd, opts) {
      if (client === null) return null
      const state = get()
      try {
        const reasoningEffort = opts?.reasoningEffort
        const sessionId = state.newSessionDefaults !== null
          ? await client.createSessionWithRoute(cwd, state.newSessionDefaults.provider, state.newSessionDefaults.model, state.newSessionPreset.length > 0 ? state.newSessionPreset : undefined, reasoningEffort)
          : await client.createSession(cwd)
        await get().refreshSessions()
        await get().openSession(sessionId)
        // 新建会话显式选的权限：创建后立即应用（默认档 workspace-write 跳过，避免每次弹提示）
        if (opts?.permission !== undefined && opts.permission.length > 0 && opts.permission !== 'workspace-write') {
          await get().setPermission(opts.permission)
        }
        return sessionId
      } catch (error) {
        setNotice(set, error instanceof Error ? error.message : String(error))
        return null
      }
    },

    async forkSession(sessionId, boundary) {
      if (client === null) return null
      try {
        const childId = await client.forkSession(sessionId, boundary)
        await get().refreshSessions()
        await get().openSession(childId)
        setNotice(set, '已从该消息分叉新会话')
        return childId
      } catch (error) {
        setNotice(set, error instanceof Error ? error.message : String(error))
        return null
      }
    },

    async openSession(sessionId) {
      if (client === null) return
      // 退订旧会话：停掉旧会话的事件流（agent 流式输出时 delta 会持续抢占隧道带宽，
      // 拖慢新会话快照传输）；失败不影响切换
      const prevId = get().activeSessionId
      if (prevId !== null && prevId !== sessionId) {
        void client.closeSession(prevId).catch(() => {})
      }
      set({ activeSessionId: sessionId, sessionLoading: true, sessionView: emptySessionView, jobs: [], feedback: {} })
      try {
        await client.openSession(sessionId)
      } catch (error) {
        setNotice(set, error instanceof Error ? error.message : String(error))
      } finally {
        // 快照通常先于 rpc-result 到达（onSnapshot 已清 loading）；此处兜底清除。
        // 仅当仍是本会话时清：快速连点时旧请求返回不能覆盖新会话的加载态
        if (get().activeSessionId === sessionId) set({ sessionLoading: false })
      }
    },

    startNewSession() {
      set({ activeSessionId: null, sessionLoading: false, sessionView: emptySessionView, jobs: [], feedback: {} })
    },

    async sendMessage(text, images) {
      const sessionId = get().activeSessionId
      if (client === null || sessionId === null) return
      try {
        await client.sendMessage(sessionId, text, images)
      } catch (error) {
        setNotice(set, error instanceof Error ? error.message : String(error))
      }
    },

    async uploadImage(dataB64, mediaType, name) {
      if (client === null) return null
      try {
        return await client.uploadImage(dataB64, mediaType, name)
      } catch (error) {
        setNotice(set, error instanceof Error ? error.message : String(error))
        return null
      }
    },

    async stopTurn() {
      const sessionId = get().activeSessionId
      if (client === null || sessionId === null) return
      try {
        await client.stopTurn(sessionId)
      } catch (error) {
        setNotice(set, error instanceof Error ? error.message : String(error))
      }
    },

    async permissionOptions() {
      if (client === null) return { names: [], default: '' }
      try {
        return await client.permissionOptions()
      } catch (error) {
        setNotice(set, error instanceof Error ? error.message : String(error))
        return { names: [], default: '' }
      }
    },

    async setPermission(preset) {
      const sessionId = get().activeSessionId
      if (client === null || sessionId === null) return
      try {
        await client.setPermission(sessionId, preset)
        setNotice(set, `权限已切换为 ${preset}`)
      } catch (error) {
        setNotice(set, error instanceof Error ? error.message : String(error))
      }
    },

    async listCommands() {
      const sessionId = get().activeSessionId
      if (client === null) return []
      try {
        return await client.listCommands(sessionId ?? '')
      } catch {
        return []
      }
    },

    async listModels() {
      if (client === null) return { providers: [], current: null }
      try {
        const result = await client.listModels(get().activeSessionId ?? '')
        // 目录合并所有 provider 的模型并带上所属路由：
        // 只取 providers[0] 会让自定义路由（glm / ali-codingplan 等）的模型在手机端永远选不到
        const catalog = result.providers.flatMap((p) => p.models.map((m) => ({ ...m, provider: p.id })))
        if (catalog.length > 0 && get().modelCatalog.length === 0) {
          set({ modelCatalog: catalog })
        }
        return result
      } catch {
        return { providers: [], current: null }
      }
    },

    async listPresets() {
      if (client === null) return []
      try {
        return await client.listPresets()
      } catch {
        return []
      }
    },

    setNewSessionWorkspace(path) {
      set({ newSessionWorkspace: path })
    },

    setNewSessionDefaults(route, preset) {
      set({
        newSessionDefaults: route,
        ...(preset !== undefined ? { newSessionPreset: preset } : {}),
      })
    },

    setQueueSend(v) {
      set({ queueSend: v })
    },

    togglePinSession(id) {
      const cur = get().pinnedSessionIds
      set({
        pinnedSessionIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
      })
    },

    async respondPermission(requestId, decision) {
      if (client === null) return
      try {
        await client.respondPermission(requestId, decision)
        set({ serverRequests: get().serverRequests.filter((r) => r.body.requestId !== requestId) })
      } catch (error) {
        setNotice(set, error instanceof Error ? error.message : String(error))
      }
    },

    async respondQuestion(requestId, answers) {
      if (client === null) return
      try {
        await client.respondQuestion(requestId, answers)
        set({ serverRequests: get().serverRequests.filter((r) => r.body.requestId !== requestId) })
      } catch (error) {
        setNotice(set, error instanceof Error ? error.message : String(error))
      }
    },
  }
})

type Set = (partial: Partial<DshState>) => void
type Get = () => DshState

/** worker-open 成功后：建隧道 + DshClient + handshake + 拉会话列表。 */
async function startClient(workerId: string, set: Set, get: Get): Promise<void> {
  if (gateway === null) return
  const state = get()
  if (state.activeWorkerId !== workerId) return
  client = new DshClient(
    gateway.makeTunnel(workerId, (inner) => client?.handleInner(inner)),
    'pairing-token-via-gateway', // 经 gateway 时由 worker 端 hub 校验的 token 占位：直连模式才需要真 token
    {
      onEvent: (sessionId, event) => {
        const s = get()
        if (sessionId !== s.activeSessionId) return
        set({ sessionView: reduceSessionEvent(s.sessionView, event) })
      },
      onSnapshot: (snapshot) => {
        const s = get()
        if (snapshot.sessionId !== s.activeSessionId) return
        let view = emptySessionView
        for (const event of snapshot.events) view = reduceSessionEvent(view, event)
        set({ sessionView: view, sessionLoading: false })
      },
      onServerRequest: (request) => {
        set({ serverRequests: [...get().serverRequests, request] })
      },
      onJobs: (sessionId, jobs) => {
        // worker 会为所有已订阅连接广播；只接受当前会话的
        if (sessionId !== get().activeSessionId) return
        set({ jobs: [...jobs] })
      },
      onAuthResult: (ok) => {
        if (!ok) set({ notice: 'Worker 鉴权失败', activeWorkerId: null })
      },
      onDisconnect: () => {
        setNotice(set, 'Worker 连接断开（正在自动恢复…）')
        // 真实断线：触发网关侧重连（presence 会带回自动 openWorker）
        get().connectGateway()
      },
    },
  )
  try {
    const info = await client.handshake()
    set({ workerHandshake: info })
    const raw = await client.listSessions()
    set({ sessions: projectSessionList(raw) })
    // 预热 workspace 缓存：打开 sidebar / 新建会话首帧即有分组，不用现拉
    try {
      set({ workspaces: await client.listWorkspaces() })
    } catch {
      // 失败不打扰：使用方打开时 listWorkspaces 会再拉
    }
    // 不自动打开会话：选择 worker 后停在新建会话首屏，发送首条消息才创建 session
  } catch (error) {
    setNotice(set, error instanceof Error ? error.message : String(error))
  }
}
