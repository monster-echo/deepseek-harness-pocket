/**
 * dsh 全局状态（zustand）：gateway 连接、Worker presence、
 * 当前 Worker 的会话与对话视图、审批/问题。
 */

import { create } from 'zustand'
import type { ServerRequest, WorkerPresence } from '@dsh-companion/bridge-protocol'
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

  connectGateway(): void
  disconnectGateway(): void
  openWorker(workerId: string): void
  refreshSessions(): Promise<void>
  listWorkspaces(): Promise<readonly { id: string; path: string; title: string }[]>
  createSession(cwd: string): Promise<string | null>
  openSession(sessionId: string): Promise<void>
  sendMessage(text: string): Promise<void>
  stopTurn(): Promise<void>
  respondPermission(requestId: string, decision: 'allow' | 'deny'): Promise<void>
  respondQuestion(requestId: string, answer: string): Promise<void>
}

/** 模块级连接与客户端（非响应式部分不放 store）。 */
let gateway: GatewayConnection | null = null
let client: DshClient | null = null

export const useDshStore = create<DshState>((set, get) => {
  const ensureGateway = (): GatewayConnection => {
    if (gateway !== null) return gateway
    gateway = new GatewayConnection({
      onStatus: (status) => set({ gatewayStatus: status }),
      onPresence: (workers) => set({ workers }),
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

    connectGateway() {
      ensureGateway()
    },

    disconnectGateway() {
      gateway?.disconnect()
      gateway = null
      client?.dispose()
      client = null
      set({ gatewayStatus: 'idle', activeWorkerId: null, sessions: [], activeSessionId: null, sessionView: emptySessionView })
    },

    openWorker(workerId) {
      const g = ensureGateway()
      client?.dispose()
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
        set({ notice: error instanceof Error ? error.message : String(error) })
      }
    },

    async listWorkspaces() {
      if (client === null) return []
      try {
        return await client.listWorkspaces()
      } catch (error) {
        set({ notice: error instanceof Error ? error.message : String(error) })
        return []
      }
    },

    async createSession(cwd) {
      if (client === null) return null
      try {
        const sessionId = await client.createSession(cwd)
        await get().refreshSessions()
        await get().openSession(sessionId)
        return sessionId
      } catch (error) {
        set({ notice: error instanceof Error ? error.message : String(error) })
        return null
      }
    },

    async openSession(sessionId) {
      if (client === null) return
      set({ activeSessionId: sessionId, sessionView: emptySessionView })
      try {
        await client.openSession(sessionId)
      } catch (error) {
        set({ notice: error instanceof Error ? error.message : String(error) })
      }
    },

    async sendMessage(text) {
      const sessionId = get().activeSessionId
      if (client === null || sessionId === null) return
      try {
        await client.sendMessage(sessionId, text)
      } catch (error) {
        set({ notice: error instanceof Error ? error.message : String(error) })
      }
    },

    async stopTurn() {
      const sessionId = get().activeSessionId
      if (client === null || sessionId === null) return
      try {
        await client.stopTurn(sessionId)
      } catch (error) {
        set({ notice: error instanceof Error ? error.message : String(error) })
      }
    },

    async respondPermission(requestId, decision) {
      if (client === null) return
      try {
        await client.respondPermission(requestId, decision)
        set({ serverRequests: get().serverRequests.filter((r) => r.body.requestId !== requestId) })
      } catch (error) {
        set({ notice: error instanceof Error ? error.message : String(error) })
      }
    },

    async respondQuestion(requestId, answer) {
      if (client === null) return
      try {
        await client.respondQuestion(requestId, answer)
        set({ serverRequests: get().serverRequests.filter((r) => r.body.requestId !== requestId) })
      } catch (error) {
        set({ notice: error instanceof Error ? error.message : String(error) })
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
        set({ notice: 'Worker 连接断开' })
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
    set({ notice: error instanceof Error ? error.message : String(error) })
  }
}
