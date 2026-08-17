/**
 * e2e 共用设施：内存 Store、假 dsh Adapter、假 Worker、假手机。
 * 直接 import 各包 TS 源码（vitest 转译），避免 dist 陈旧。
 */

import { createServer, type Server } from 'node:http'
import { EventEmitter } from 'node:events'
import { WebSocket, WebSocketServer } from 'ws'
import type { Store, WorkerRow } from '../../gateway/src/server/store'
import type { DshAdapter, SessionSlice, SessionSummary, ApprovalAsk, QuestionAsk } from '../../packages/dsh-companion-bridge/src/plugin/adapter-dsh'
import { BridgeHub } from '../../packages/dsh-companion-bridge/src/plugin/hub'
import { startDirectServer } from '../../packages/dsh-companion-bridge/src/plugin/server'
import { startUplink } from '../../packages/dsh-companion-bridge/src/plugin/uplink'
import type { GatewayConfig } from '../../gateway/src/server/config'
import { Gateway } from '../../gateway/src/server/gateway'
import type { DshSessionEvent } from '@dsh-companion/bridge-protocol'

// ---------- 内存 Store（gateway） ----------

export function makeMemoryStore(): Store & { pairingsByWorker: Map<string, Set<string>> } {
  const workers = new Map<string, WorkerRow>()
  const pairingsByWorker = new Map<string, Set<string>>()
  const store: Store & { pairingsByWorker: Map<string, Set<string>> } = {
    pairingsByWorker,
    pool: undefined as never,
    async upsertWorker(w) {
      const existing = [...workers.values()].find((r) => r.host_key === w.hostKey)
      const id = existing?.id ?? w.id
      workers.set(id, {
        id, host_key: w.hostKey, name: w.name, fingerprint: w.fingerprint,
        dsh_version: w.dshVersion, pairing_code: w.pairingCode, last_seen_at: new Date(),
      })
    },
    async getWorkerByHostKey(hostKey) {
      return [...workers.values()].find((r) => r.host_key === hostKey) ?? null
    },
    async getWorkerByPairingCode(code) {
      return [...workers.values()].find((r) => r.pairing_code === code) ?? null
    },
    async getWorkerById(id) {
      return workers.get(id) ?? null
    },
    async touchWorker() {},
    async pairWorker(userId, workerId) {
      if (!pairingsByWorker.has(workerId)) pairingsByWorker.set(workerId, new Set())
      pairingsByWorker.get(workerId)!.add(userId)
    },
    async unpairWorker(userId, workerId) {
      pairingsByWorker.get(workerId)?.delete(userId)
    },
    async listPairings(userId) {
      const rows = []
      for (const [workerId, users] of pairingsByWorker) {
        if (users.has(userId)) {
          rows.push({ user_id: userId, worker_id: workerId, name: null, created_at: new Date(), revoked_at: null })
        }
      }
      return rows
    },
    async listPairingsByWorker(workerId) {
      return [...(pairingsByWorker.get(workerId) ?? [])]
    },
    async isPaired(userId, workerId) {
      return pairingsByWorker.get(workerId)?.has(userId) ?? false
    },
    async upsertDevice() {},
    async listPushTokens() {
      return []
    },
    async recordUsage() {},
    async close() {},
  }
  return store
}

// ---------- 假 dsh Adapter（fixture 事件） ----------

export interface FakeDsh {
  adapter: DshAdapter
  hub: BridgeHub
  events: { sessionId: string; event: DshSessionEvent }[]
  sentMessages: { id: string; text: string }[]
  stopped: string[]
}

export function makeFakeDsh(fixture: { sessionId: string; events: DshSessionEvent[] }[]): FakeDsh {
  const events = fixture.flatMap((s) => s.events.map((e) => ({ sessionId: s.sessionId, event: e })))
  const sentMessages: { id: string; text: string }[] = []
  const stopped: string[] = []
  const adapter: DshAdapter = {
    caps: { persistence: true, agents: true, approval: true, userQuestions: true },
    dshVersion: () => '0.1.0-test',
    async listSessions(): Promise<SessionSummary[]> {
      return fixture.map((s) => {
        const lastSeq = s.events.length - 1
        return {
          id: s.sessionId, createdAt: 1000, cwd: '/tmp/proj', lastSeq,
          live: true, agentStatus: lastSeq >= 0 && s.events[s.events.length - 1]!.type === 'turn/end' ? 'idle' : 'running',
        }
      })
    },
    async readSlice(id: string, fromSeq: number): Promise<SessionSlice | null> {
      const s = fixture.find((f) => f.sessionId === id)
      if (s === undefined) return null
      const slice = s.events.filter((e) => e.seq >= fromSeq)
      return { id, fromSeq, toSeq: slice.length > 0 ? slice[slice.length - 1]!.seq : fromSeq - 1, events: slice }
    },
    async listWorkspaces() {
      return [{ id: 'ws-1', path: '/tmp/proj', title: 'proj' }]
    },
    async createSession(cwd: string) {
      return `new-session-${cwd}`
    },
    async sendUserMessage(id, text) {
      sentMessages.push({ id, text })
    },
    async stopTurn(id) {
      stopped.push(id)
    },
    onEvent() {
      return () => undefined
    },
    onSessionsChanged() {
      return () => undefined
    },
    registerApprovalAsker() {
      return () => undefined
    },
    registerQuestionAsker() {
      return () => undefined
    },
  }
  const hub = new BridgeHub(adapter, {
    workerName: 'e2e-worker',
    fingerprint: 'fp_e2e',
    capsLevel: 'm2',
    readOnly: false,
    pairingToken: 'pt_e2e_token',
    verifyToken: (expected, actual) => expected === actual,
  })
  return { adapter, hub, events, sentMessages, stopped }
}

// ---------- mock cordis Context ----------

export function mockCtx(): { logger: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void }; effect(fn: () => unknown): () => void } {
  return {
    logger: {
      info: (m) => console.log(`[hub] ${m}`),
      warn: (m) => console.warn(`[hub] ${m}`),
      error: (m) => console.error(`[hub] ${m}`),
    },
    effect(fn) {
      return () => void fn()
    },
  }
}

// ---------- 起一个 Gateway（http + ws，不经 Next） ----------

export interface RunningGateway {
  server: Server
  port: number
  gateway: Gateway
  close(): Promise<void>
}

export async function startTestGateway(): Promise<RunningGateway> {
  const config: GatewayConfig = {
    port: 0, hostname: '127.0.0.1', databaseUrl: 'unused',
    authVerifyUrl: '', authVerifyToken: '', expoAccessToken: '', nodeEnv: 'development',
  }
  const store = makeMemoryStore()
  const gateway = new Gateway(
    config, store,
    async (token) => (token.startsWith('dev:') ? { userId: token.slice(4), appId: null } : null),
    async () => {},
  )
  const server = createServer()
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    const path = (req.url ?? '').split('?')[0]
    if (path !== '/gw/worker' && path !== '/gw/phone') {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (path === '/gw/worker') gateway.attachWorker(ws as WebSocket)
      else gateway.attachPhone(ws as WebSocket)
    })
  })
  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address !== null ? address.port : 0)
    })
  })
  return {
    server, port, gateway,
    async close() {
      for (const c of wss.clients) c.terminate()
      await new Promise<void>((done) => server.close(() => done()))
    },
  }
}

/** 启动假 Worker：BridgeHub + 直连 server + uplink 到 gateway。 */
export async function startFakeWorker(dsh: FakeDsh, gatewayPort: number, pairingCode: string): Promise<{
  directPort: number
  closeAll(): Promise<void>
}> {
  const ctx = mockCtx()
  const direct = await startDirectServer(ctx as never, {
    host: '127.0.0.1', port: 0, hub: dsh.hub, workerName: 'e2e-worker',
  })
  const stopUplink = startUplink(ctx as never, {
    url: `ws://127.0.0.1:${gatewayPort}/gw/worker`,
    hostKey: 'hk_e2e',
    workerName: 'e2e-worker',
    fingerprint: 'fp_e2e',
    dshVersion: '0.1.0-test',
    hub: dsh.hub,
    pairingCode,
    reconnectMinMs: 100,
    reconnectMaxMs: 1000,
  })
  return {
    directPort: direct.port,
    async closeAll() {
      stopUplink()
      await direct.dispose()
    },
  }
}

// ---------- 假手机（直连 WS + 帧收发） ----------

export class TestPhone {
  private ws: WebSocket
  private emitter = new EventEmitter()
  /** 已到达未消费的帧（消除 wait 注册前的丢帧竞态） */
  private buffer: Record<string, unknown>[] = []

  constructor(url: string) {
    this.ws = new WebSocket(url)
    this.ws.on('message', (data: unknown) => {
      const text = typeof data === 'string' ? data : String(data)
      const frame = JSON.parse(text) as Record<string, unknown>
      this.buffer.push(frame)
      this.emitter.emit('frame', frame)
      this.emitter.emit(String(frame['kind']), frame)
    })
  }

  get opened(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once('open', resolve)
      this.ws.once('error', reject)
    })
  }

  send(frame: unknown): void {
    this.ws.send(JSON.stringify(frame))
  }

  /** 等待满足谓词的帧；先查已到达未消费的缓冲（匹配即消费，不重复匹配）。 */
  wait(kind: string, predicate: (frame: Record<string, unknown>) => boolean = () => true): Promise<Record<string, unknown>> {
    const idx = this.buffer.findIndex((f) => f['kind'] === kind && predicate(f))
    if (idx >= 0) {
      const [hit] = this.buffer.splice(idx, 1)
      return Promise.resolve(hit as Record<string, unknown>)
    }
    return new Promise((resolve) => {
      const onFrame = (f: Record<string, unknown>): void => {
        if (f['kind'] === kind && predicate(f)) {
          this.emitter.off('frame', onFrame)
          const i = this.buffer.indexOf(f)
          if (i >= 0) this.buffer.splice(i, 1)
          resolve(f)
        }
      }
      this.emitter.on('frame', onFrame)
    })
  }

  close(): void {
    this.ws.close()
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
