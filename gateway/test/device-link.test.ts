/**
 * 扫码登录（device link）REST 流程：桌面端 start/poll + 手机 approve。
 *
 * 覆盖点：
 * - 未确认时 poll = pending，且 poll 需要正确 secret（错 secret 拿不到）；
 * - 手机 approve（Bearer 会话）→ 绑定 Worker → poll 返回账号身份与设备凭据；
 * - 设备凭据可作为 Bearer 调 /api/v1/workers（gateway 认它，见 api.ts authUser）；
 * - revoke 解绑并作废凭据；
 * - 过期链接 approve 返回 410。
 */

import { describe, expect, it } from 'vitest'
import { createApiRouter } from '../src/server/api.js'
import type { DeviceLinkRow, Store } from '../src/server/store.js'
import type { Gateway } from '../src/server/gateway.js'
import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

function makeConfig() {
  return {
    port: 3781,
    hostname: '0.0.0.0',
    databaseUrl: 'postgres://unused',
    authJwksUrl: '',
    authIssuer: 'https://auth.zhongbei.tech',
    authAudience: 'dsh-pocket',
    expoAccessToken: '',
    previewDailyQuotaBytes: 50 * 1024 * 1024,
    previewRateBytesPerSecond: 256 * 1024,
    nodeEnv: 'development',
  }
}

/** 内存版 Store：只实现 device link + 绑定相关，够本流程用。 */
function makeStore(): Store & {
  links: Map<string, DeviceLinkRow>
  bound: Set<string> // `${userId}:${hostKey}`
  workers: Map<string, { id: string; host_key: string; name: string; fingerprint: string }>
} {
  const links = new Map<string, DeviceLinkRow>()
  const bound = new Set<string>()
  const workers = new Map<string, { id: string; host_key: string; name: string; fingerprint: string }>()
  const sha = (v: string): string => createHash('sha256').update(v).digest('hex')
  const store = {
    links,
    bound,
    workers,
    pool: undefined as never,
    async getWorkerByHostKey(hostKey: string) {
      const w = [...workers.values()].find((r) => r.host_key === hostKey)
      if (w === undefined) return null
      return { ...w, dsh_version: null, pairing_code: '', last_seen_at: new Date() }
    },
    async createDeviceLink(l: {
      code: string
      secretHash: string
      hostKey: string
      name: string
      platform: string
      startIp: string
      ttlMs: number
    }) {
      links.set(l.code, {
        code: l.code,
        secret_hash: l.secretHash,
        host_key: l.hostKey,
        name: l.name,
        platform: l.platform,
        status: 'pending',
        user_id: null,
        email: null,
        worker_id: null,
        start_ip: l.startIp,
        created_at: new Date(),
        expires_at: new Date(Date.now() + l.ttlMs),
        approved_at: null,
      })
    },
    async getDeviceLink(code: string) {
      return links.get(code) ?? null
    },
    async getDeviceLinkBySecretHash(secretHash: string) {
      const row = [...links.values()].find(
        (r) => r.secret_hash === secretHash && r.status === 'approved' && r.expires_at.getTime() > Date.now(),
      )
      return row ?? null
    },
    async approveDeviceLink(o: {
      code: string
      userId: string
      email: string | null
      workerId: string
      ttlMs: number
    }) {
      const row = links.get(o.code)!
      links.set(o.code, {
        ...row,
        status: 'approved',
        user_id: o.userId,
        email: o.email,
        worker_id: o.workerId,
        approved_at: new Date(),
        expires_at: new Date(Date.now() + o.ttlMs),
      })
    },
    async deleteDeviceLink(code: string) {
      links.delete(code)
    },
    async purgeExpiredDeviceLinks() {
      let n = 0
      for (const [code, row] of links) {
        if (row.expires_at.getTime() < Date.now()) {
          links.delete(code)
          n += 1
        }
      }
      return n
    },
    // 绑定相关（api 路由只用到 workers 列表与 unpair → gateway）
    async listPairings() {
      return []
    },
    async upsertDevice() {},
    async listPushTokens() {
      return []
    },
    async recordUsage() {},
    async previewBytesToday() {
      return 0
    },
    async close() {},
  } as unknown as Store & {
    links: Map<string, DeviceLinkRow>
    bound: Set<string>
    workers: Map<string, { id: string; host_key: string; name: string; fingerprint: string }>
  }
  // 供断言用：secret 校验走真实 sha256，这里暴露给测试构造行
  ;(store as unknown as { sha: (v: string) => string }).sha = sha
  return store
}

/** 假 gateway：bindByHostKey 按 hostKey 直接绑定；unpair 记录调用。 */
function makeGateway(store: Store & { bound: Set<string> }): Gateway & { unpaired: string[] } {
  const unpaired: string[] = []
  const gateway = {
    unpaired,
    async bindByHostKey(userId: string, hostKey: string) {
      if (hostKey === 'hk_missing') return { ok: false, reason: 'Worker 不存在（请先在电脑上启动一次 Worker）' }
      store.bound.add(`${userId}:${hostKey}`)
      return { ok: true, workerId: 'w_1', name: 'Mac mini' }
    },
    async unpair(userId: string, workerId: string) {
      unpaired.push(`${userId}:${workerId}`)
    },
    async listWorkers(userId: string) {
      return [...store.bound]
        .filter((k) => k.startsWith(`${userId}:`))
        .map((k) => ({ workerId: 'w_1', hostFingerprint: 'fp1', hostKey: k.split(':')[1]! }))
    },
  } as unknown as Gateway & { unpaired: string[] }
  return gateway
}

/** 最小 req/res：把 body 塞进一个 async iterable，收集响应 JSON。 */
async function call(
  router: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>,
  method: string,
  url: string,
  body?: unknown,
  bearer?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = {
    method,
    url,
    headers: bearer === undefined ? {} : { authorization: `Bearer ${bearer}` },
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c
    },
  } as unknown as IncomingMessage
  let status = 0
  let payload = ''
  const res = {
    writeHead(code: number) {
      status = code
    },
    end(text: string) {
      payload = text
    },
  } as unknown as ServerResponse
  await router(req, res)
  return { status, body: payload.length === 0 ? {} : (JSON.parse(payload) as Record<string, unknown>) }
}

function setup(): {
  router: ReturnType<typeof createApiRouter>
  store: ReturnType<typeof makeStore>
  gateway: ReturnType<typeof makeGateway>
} {
  const store = makeStore()
  const gateway = makeGateway(store)
  const router = createApiRouter({ config: makeConfig(), store, gateway })
  return { router, store, gateway }
}

describe('扫码登录（device link）', () => {
  it('start → pending → approve → poll 拿到账号与设备凭据', async () => {
    const { router } = setup()

    const started = await call(router, 'POST', '/api/v1/devices/link/start', {
      hostKey: 'hk_1',
      name: 'Mac mini',
      platform: 'darwin',
    })
    expect(started.status).toBe(200)
    const code = started.body['code'] as string
    const secret = started.body['secret'] as string
    expect(code).toHaveLength(8)
    expect(secret).toHaveLength(64)

    // 手机还没确认
    const pending = await call(router, 'POST', '/api/v1/devices/link/poll', { code, secret })
    expect(pending.body['status']).toBe('pending')

    // 手机确认（Bearer 会话 token；dev: 前缀走开发放行）
    const approved = await call(
      router,
      'POST',
      '/api/v1/devices/link/approve',
      { code, email: 'me@example.com' },
      'dev:user_a',
    )
    expect(approved.status).toBe(200)
    expect(approved.body['ok']).toBe(true)
    expect(approved.body['workerName']).toBe('Mac mini')

    // 桌面端轮询拿到身份 + 凭据
    const done = await call(router, 'POST', '/api/v1/devices/link/poll', { code, secret })
    expect(done.body['status']).toBe('approved')
    expect(done.body['account']).toEqual({ userId: 'user_a', email: 'me@example.com' })
    expect(done.body['credential']).toBe(`dshl_${code}.${secret}`)
  })

  it('preview 返回服务端权威设备信息（已注册 Worker 名优先，而不是二维码自称）', async () => {
    const { router, store } = setup()
    const started = await call(router, 'POST', '/api/v1/devices/link/start', {
      hostKey: 'hk_1',
      name: '自称的名字',
      platform: 'darwin',
    })
    const code = started.body['code'] as string

    // 该电脑后来连上 gateway 注册（真实场景：Worker uplink），名字与二维码自称不同
    store.workers.set('w_1', { id: 'w_1', host_key: 'hk_1', name: 'Mac mini', fingerprint: 'fp1' })

    const preview = await call(router, 'POST', '/api/v1/devices/link/preview', { code }, 'dev:user_a')
    expect(preview.status).toBe(200)
    expect(preview.body['ok']).toBe(true)
    expect(preview.body['name']).toBe('Mac mini')
    expect(preview.body['workerKnown']).toBe(true)
    expect(preview.body['platform']).toBe('darwin')
    expect(typeof preview.body['ip']).toBe('string')
    expect(preview.body['alreadyBound']).toBe(false)

    // 未登录不给看设备信息
    const anon = await call(router, 'POST', '/api/v1/devices/link/preview', { code })
    expect(anon.status).toBe(401)

    // 未知码 404
    expect((await call(router, 'POST', '/api/v1/devices/link/preview', { code: 'ABCD2345' }, 'dev:user_a')).status).toBe(404)
  })

  it('已被 A 账号使用的码：B 账号 preview/approve 都被拒（409）', async () => {
    const { router } = setup()
    const started = await call(router, 'POST', '/api/v1/devices/link/start', { hostKey: 'hk_1' })
    const code = started.body['code'] as string
    await call(router, 'POST', '/api/v1/devices/link/approve', { code }, 'dev:user_a')

    const preview = await call(router, 'POST', '/api/v1/devices/link/preview', { code }, 'dev:user_b')
    expect(preview.status).toBe(409)
    const approved = await call(router, 'POST', '/api/v1/devices/link/approve', { code }, 'dev:user_b')
    expect(approved.status).toBe(409)
  })

  it('错误的 secret 拿不到链接状态', async () => {
    const { router } = setup()
    const started = await call(router, 'POST', '/api/v1/devices/link/start', { hostKey: 'hk_1' })
    const code = started.body['code'] as string
    const wrong = await call(router, 'POST', '/api/v1/devices/link/poll', {
      code,
      secret: 'f'.repeat(64),
    })
    expect(wrong.status).toBe(404)
    expect(wrong.body['status']).toBe('unknown')
  })

  it('设备凭据可作为 Bearer 调 workers（扫码登录后的桌面端身份）', async () => {
    const { router } = setup()
    const started = await call(router, 'POST', '/api/v1/devices/link/start', { hostKey: 'hk_1' })
    const code = started.body['code'] as string
    const secret = started.body['secret'] as string
    await call(router, 'POST', '/api/v1/devices/link/approve', { code }, 'dev:user_a')
    const done = await call(router, 'POST', '/api/v1/devices/link/poll', { code, secret })
    const credential = done.body['credential'] as string

    const workers = await call(router, 'GET', '/api/v1/workers', undefined, credential)
    expect(workers.status).toBe(200)
    expect((workers.body['workers'] as unknown[]).length).toBe(1)

    // 未确认的链接 / 伪造凭据 → 401
    const forged = await call(router, 'GET', '/api/v1/workers', undefined, `dshl_${code}.${'a'.repeat(64)}`)
    expect(forged.status).toBe(401)
  })

  it('approve 时电脑未注册 → 422 并带原因', async () => {
    const { router } = setup()
    const started = await call(router, 'POST', '/api/v1/devices/link/start', { hostKey: 'hk_missing' })
    const code = started.body['code'] as string
    const approved = await call(router, 'POST', '/api/v1/devices/link/approve', { code }, 'dev:user_a')
    expect(approved.status).toBe(422)
    expect(String(approved.body['reason'])).toContain('Worker 不存在')
  })

  it('链接过期 → approve 410、poll expired', async () => {
    const { router, store } = setup()
    const started = await call(router, 'POST', '/api/v1/devices/link/start', { hostKey: 'hk_1' })
    const code = started.body['code'] as string
    const secret = started.body['secret'] as string
    // 手动把有效期改到过去
    const row = store.links.get(code)!
    store.links.set(code, { ...row, expires_at: new Date(Date.now() - 1000) })

    const approved = await call(router, 'POST', '/api/v1/devices/link/approve', { code }, 'dev:user_a')
    expect(approved.status).toBe(410)

    const started2 = await call(router, 'POST', '/api/v1/devices/link/start', { hostKey: 'hk_1' })
    const code2 = started2.body['code'] as string
    const secret2 = started2.body['secret'] as string
    const row2 = store.links.get(code2)!
    store.links.set(code2, { ...row2, expires_at: new Date(Date.now() - 1000) })
    const polled = await call(router, 'POST', '/api/v1/devices/link/poll', { code: code2, secret: secret2 })
    expect(polled.body['status']).toBe('expired')
  })

  it('revoke 解绑并作废凭据', async () => {
    const { router, gateway } = setup()
    const started = await call(router, 'POST', '/api/v1/devices/link/start', { hostKey: 'hk_1' })
    const code = started.body['code'] as string
    const secret = started.body['secret'] as string
    await call(router, 'POST', '/api/v1/devices/link/approve', { code }, 'dev:user_a')
    await call(router, 'POST', '/api/v1/devices/link/poll', { code, secret })

    const revoked = await call(router, 'POST', '/api/v1/devices/link/revoke', { code, secret })
    expect(revoked.status).toBe(200)
    expect(gateway.unpaired).toEqual(['user_a:w_1'])

    // 凭据随之失效
    const workers = await call(router, 'GET', '/api/v1/workers', undefined, `dshl_${code}.${secret}`)
    expect(workers.status).toBe(401)
  })

  it('链接码格式非法 / 缺 hostKey → 400', async () => {
    const { router } = setup()
    const bad = await call(router, 'POST', '/api/v1/devices/link/start', { hostKey: 'nope' })
    expect(bad.status).toBe(400)
    const badCode = await call(router, 'POST', '/api/v1/devices/link/approve', { code: 'abc' }, 'dev:user_a')
    expect(badCode.status).toBe(400)
  })
})