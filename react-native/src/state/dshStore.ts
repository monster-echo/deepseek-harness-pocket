/**
 * dsh 全局状态（zustand）：gateway 连接、Worker presence、
 * 当前 Worker 的会话与对话视图、审批/问题。
 */

import { create } from 'zustand'
import type { ServerRequest, WorkerPresence } from '@deepseek-harness-pocket/bridge-protocol'
import { GatewayConnection, type GatewayStatus } from '../dsh/connection'
import { DshClient, type HandshakeInfo } from '../dsh/client'
import { emptySessionView, projectSessionList, reduceSessionEvent, type SessionListItem, type SessionView } from '../features/conversation/reducer'

interface DshState {
  gatewayStatus: GatewayStatus
  workers: readonly WorkerPresence[]
  activeWorkerId: string | null
  workerHandshake: HandshakeInfo | null
  sessions: readonly SessionListItem[]
  activeSessionId: string | null
  sessionView: SessionView
  serverRequests: readonly ServerRequest[]
  notice: string | null
  /** worker 模型目录缓存（NewSessionComposer 的模型列表） */
  modelCatalog: readonly { id: string; name?: string }[]

  connectGateway(): void
  disconnectGateway(): void
  openWorker(workerId: string): void
  refreshSessions(): Promise<void>
  listWorkspaces(): Promise<readonly { id: string; path: string; title: string }[]>
  listDir(path: string): Promise<readonly { name: string; path: string }[]>
  fsHome(): Promise<string>
  addWorkspace(path: string): Promise<{ id: string; path: string; title: string } | null>
  renameWorkspace(id: string, title: string): Promise<boolean>
  deleteWorkspace(id: string): Promise<boolean>
  createSession(cwd: string, opts?: { reasoningEffort?: string; permission?: string }): Promise<string | null>
  forkSession(sessionId: string, boundary?: number): Promise<string | null>
  openSession(sessionId: string): Promise<void>
  sendMessage(text: string, images?: readonly unknown[]): Promise<void>
  uploadImage(dataB64: string, mediaType: string, name?: string): Promise<unknown | null>
  stopTurn(): Promise<void>
  respondPermission(requestId: string, decision: 'allow' | 'deny'): Promise<void>
  permissionOptions(): Promise<{ names: string[]; default: string }>
  setPermission(preset: string): Promise<void>
  listCommands(): Promise<readonly { name: string; description: string }[]>
  listModels(): Promise<{ providers: readonly { id: string; models: readonly { id: string; name?: string }[] }[]; current: { provider: string; model: string } | null }>
  listPresets(): Promise<readonly { id: string; name?: string; description?: string; isDefault: boolean }[]>
  /** 新会话默认：模型路由与 agent preset（发起端记录） */
  newSessionDefaults: { provider: string; model: string } | null
  newSessionPreset: string
  setNewSessionDefaults(route: { provider: string; model: string } | null, preset?: string): void
  /** 排队发送：turn 进行时允许输入并排队，turn 结束后自动发送 */
  queueSend: boolean
  setQueueSend(v: boolean): void
  /** 置顶会话（手动排序）；置顶的会话排在列表最前 */
  pinnedSessionIds: readonly string[]
  togglePinSession(id: string): void
  respondQuestion(requestId: string, answer: string): Promise<void>
}

/** 模块级连接与客户端（非响应式部分不放 store）。 */
let gateway: GatewayConnection | null = null
let client: DshClient | null = null

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
    gateway.connect()
    return gateway
  }

  return {
    gatewayStatus: 'idle',
    workers: [],
    activeWorkerId: null,
    workerHandshake: null,
    sessions: [],
    activeSessionId: null,
    sessionView: emptySessionView,
    serverRequests: [],
    notice: null,
    modelCatalog: [],
    newSessionDefaults: null,
    newSessionPreset: '',
    queueSend: false,
    pinnedSessionIds: [],

    connectGateway() {
      ensureGateway()
    },

    disconnectGateway() {
      gateway?.disconnect()
      gateway = null
      client?.dispose(true)
      client = null
      set({ gatewayStatus: 'idle', activeWorkerId: null, sessions: [], activeSessionId: null, sessionView: emptySessionView })
    },

    openWorker(workerId) {
      const g = ensureGateway()
      client?.dispose(true)
      client = null
      set({ activeWorkerId: workerId, sessions: [], activeSessionId: null, sessionView: emptySessionView, serverRequests: [] })
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
        return await client.listWorkspaces()
      } catch (error) {
        setNotice(set, error instanceof Error ? error.message : String(error))
        return []
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
        return await client.addWorkspace(path)
      } catch (error) {
        setNotice(set, error instanceof Error ? error.message : String(error))
        return null
      }
    },

    async renameWorkspace(id, title) {
      if (client === null) return false
      try {
        return await client.renameWorkspace(id, title)
      } catch (error) {
        setNotice(set, error instanceof Error ? error.message : String(error))
        return false
      }
    },

    async deleteWorkspace(id) {
      if (client === null) return false
      try {
        return await client.deleteWorkspace(id)
      } catch (error) {
        setNotice(set, error instanceof Error ? error.message : String(error))
        return false
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
      set({ activeSessionId: sessionId, sessionView: emptySessionView })
      try {
        await client.openSession(sessionId)
      } catch (error) {
        setNotice(set, error instanceof Error ? error.message : String(error))
      }
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
        const catalog = result.providers[0]?.models ?? []
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

    async respondQuestion(requestId, answer) {
      if (client === null) return
      try {
        await client.respondQuestion(requestId, answer)
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
        set({ sessionView: view })
      },
      onServerRequest: (request) => {
        set({ serverRequests: [...get().serverRequests, request] })
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
    // 默认打开最新会话
    const first = projectSessionList(raw)[0]
    if (first !== undefined) await get().openSession(first.id)
  } catch (error) {
    setNotice(set, error instanceof Error ? error.message : String(error))
  }
}
