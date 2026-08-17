import { describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { Gateway } from '../src/server/gateway.js'
import type { Store, WorkerRow } from '../src/server/store.js'
import type { GatewayConfig } from '../src/server/config.js'

/** 最小假 WS：记录 send 的帧，可注入收帧。 */
class FakeWs extends EventEmitter {
  readonly sent: string[] = []
  readyState = 1 // OPEN
  isAlive = true
  send(text: string): void {
    this.sent.push(text)
  }
  ping(): void {}
  terminate(): void {
    this.emit('close')
  }
  receive(text: string): void {
    this.emit('message', text)
  }
  lastFrame(): { kind: string } & Record<string, unknown> {
    return JSON.parse(this.sent[this.sent.length - 1]!) as { kind: string }
  }
}

function makeConfig(): GatewayConfig {
  return {
    port: 3781,
    hostname: '0.0.0.0',
    databaseUrl: 'postgres://unused',
    authVerifyUrl: '',
    authVerifyToken: '',
    expoAccessToken: '',
    nodeEnv: 'development',
  }
}

function makeStore(): Store & { workers: Map<string, WorkerRow>; pairings: Map<string, Set<string>>; usage: string[] } {
  const workers = new Map<string, WorkerRow>()
  const pairings = new Map<string, Set<string>>() // workerId -> userIds
  const usage: string[] = []
  const store: Store & { workers: Map<string, WorkerRow>; pairings: Map<string, Set<string>>; usage: string[] } = {
    workers,
    pairings,
    usage,
    pool: undefined as never,
    async upsertWorker(w) {
      const existing = [...workers.values()].find((r) => r.host_key === w.hostKey)
      const id = existing?.id ?? w.id
      workers.set(id, {
        id,
        host_key: w.hostKey,
        name: w.name,
        fingerprint: w.fingerprint,
        dsh_version: w.dshVersion,
        pairing_code: w.pairingCode,
        last_seen_at: new Date(),
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
      if (!pairings.has(workerId)) pairings.set(workerId, new Set())
      pairings.get(workerId)!.add(userId)
    },
    async unpairWorker(userId, workerId) {
      pairings.get(workerId)?.delete(userId)
    },
    async listPairings(userId) {
      const rows = []
      for (const [workerId, users] of pairings) {
        if (users.has(userId)) {
          rows.push({ user_id: userId, worker_id: workerId, name: null, created_at: new Date(), revoked_at: null })
        }
      }
      return rows
    },
    async listPairingsByWorker(workerId) {
      return [...(pairings.get(workerId) ?? [])]
    },
    async isPaired(userId, workerId) {
      return pairings.get(workerId)?.has(userId) ?? false
    },
    async upsertDevice() {},
    async listPushTokens() {
      return []
    },
    async recordUsage(e) {
      usage.push(e.kind)
    },
    async close() {},
  }
  return store
}

function makeGateway(): { gateway: Gateway; store: ReturnType<typeof makeStore> } {
  const store = makeStore()
  const gateway = new Gateway(
    makeConfig(),
    store,
    async (token) => (token.startsWith('dev:') ? { userId: token.slice(4), appId: null } : null),
    async () => {},
  )
  return { gateway, store }
}

describe('gateway 配对与转发', () => {
  it('worker 注册 → register-ok；配对码绑定 → 挑战 → 成功', async () => {
    const { gateway } = makeGateway()
    const workerWs = new FakeWs()
    gateway.attachWorker(workerWs as never)
    workerWs.receive(
      JSON.stringify({
        kind: 'worker-register',
        hostKey: 'hk_1',
        protocolVersion: 'mobile/v1',
        name: 'mac-mini',
        hostFingerprint: 'fp1',
        dshVersion: null,
        pairingCode: '123456',
      }),
    )
    await new Promise((r) => setTimeout(r))
    expect(workerWs.lastFrame().kind).toBe('register-ok')
    const workerId = (workerWs.lastFrame() as unknown as { workerId: string }).workerId

    // 配对码绑定（challenge 应答 accept）
    const bindPromise = gateway.bindByCode('user_a', '123456', null)
    await new Promise((r) => setTimeout(r))
    expect(workerWs.lastFrame().kind).toBe('pairing-challenge')
    workerWs.receive(JSON.stringify({ kind: 'pairing-answer', challengeId: (workerWs.lastFrame() as unknown as { challengeId: string }).challengeId, accepted: true }))
    const result = await bindPromise
    expect(result.ok).toBe(true)
    expect(result.workerId).toBe(workerId)
  })

  it('配对码错误 → Worker 拒绝 → 绑定失败', async () => {
    const { gateway } = makeGateway()
    const workerWs = new FakeWs()
    gateway.attachWorker(workerWs as never)
    workerWs.receive(
      JSON.stringify({
        kind: 'worker-register',
        hostKey: 'hk_2',
        protocolVersion: 'mobile/v1',
        name: 'pc',
        hostFingerprint: 'fp2',
        dshVersion: null,
        pairingCode: '111222',
      }),
    )
    await new Promise((r) => setTimeout(r))
    const bindPromise = gateway.bindByCode('user_b', '111222', null)
    await new Promise((r) => setTimeout(r))
    workerWs.receive(JSON.stringify({ kind: 'pairing-answer', challengeId: (workerWs.lastFrame() as unknown as { challengeId: string }).challengeId, accepted: false }))
    const result = await bindPromise
    expect(result.ok).toBe(false)
  })

  it('手机认证 → worker-open（未配对拒绝）→ 配对后打开 → 帧转发', async () => {
    const { gateway } = makeGateway()
    const workerWs = new FakeWs()
    gateway.attachWorker(workerWs as never)
    workerWs.receive(
      JSON.stringify({
        kind: 'worker-register',
        hostKey: 'hk_3',
        protocolVersion: 'mobile/v1',
        name: 'mbp',
        hostFingerprint: 'fp3',
        dshVersion: null,
        pairingCode: '333444',
      }),
    )
    await new Promise((r) => setTimeout(r))
    const workerId = (workerWs.lastFrame() as unknown as { workerId: string }).workerId

    // 完成一次配对（挑战应答 accept）
    const bindPromise = gateway.bindByCode('user_c', '333444', null)
    await new Promise((r) => setTimeout(r))
    workerWs.receive(
      JSON.stringify({
        kind: 'pairing-answer',
        challengeId: (workerWs.lastFrame() as unknown as { challengeId: string }).challengeId,
        accepted: true,
      }),
    )
    expect((await bindPromise).ok).toBe(true)

    const phoneWs = new FakeWs()
    gateway.attachPhone(phoneWs as never)
    phoneWs.receive(JSON.stringify({ kind: 'phone-auth', authToken: 'dev:user_c', deviceKey: 'd1' }))
    await new Promise((r) => setTimeout(r))
    const frames = () => phoneWs.sent.map((t) => JSON.parse(t) as { kind: string } & Record<string, unknown>)
    expect(frames().some((f) => f.kind === 'auth-ok')).toBe(true)
    expect(frames().some((f) => f.kind === 'presence')).toBe(true)

    // 未配对 worker → 拒绝
    phoneWs.receive(JSON.stringify({ kind: 'worker-open', workerId: 'w_unknown' }))
    await new Promise((r) => setTimeout(r))
    expect((phoneWs.lastFrame() as unknown as { ok: boolean }).ok).toBe(false)

    // 已配对 → 打开成功 → 上行帧转发到 worker，下行帧回手机
    phoneWs.receive(JSON.stringify({ kind: 'worker-open', workerId }))
    await new Promise((r) => setTimeout(r))
    expect((phoneWs.lastFrame() as unknown as { ok: boolean }).ok).toBe(true)

    phoneWs.receive(JSON.stringify({ kind: 'worker-frame', workerId, inner: '{"kind":"auth","token":"pt_x"}' }))
    await new Promise((r) => setTimeout(r))
    const toWorker = workerWs.sent.map((t) => JSON.parse(t)).find((f) => f.kind === 'phone-frame')
    expect(toWorker.inner).toBe('{"kind":"auth","token":"pt_x"}')

    workerWs.receive(JSON.stringify({ kind: 'phone-frame', inner: '{"kind":"auth-ok"}' }))
    await new Promise((r) => setTimeout(r))
    const toPhone = phoneWs.sent.map((t) => JSON.parse(t)).find((f) => f.kind === 'worker-frame')
    expect(toPhone.inner).toBe('{"kind":"auth-ok"}')
  })
})
