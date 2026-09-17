/**
 * REST /api/v1/*：由自定义 server 直接处理（不经 Next），与 WS 核心同一构建。
 *
 * GET    /api/v1/workers           我的 Worker 列表（含在线状态）
 * POST   /api/v1/workers/bind      { hostKey } 账号登录绑定（桌面端，免扫码）
 * DELETE /api/v1/workers?workerId= 解绑
 * POST   /api/v1/devices/push-token { deviceKey, platform, expoPushToken }
 * POST   /api/v1/devices/link/start   { hostKey, name, platform } → { code, secret, … }
 * POST   /api/v1/devices/link/preview { code }（手机 Bearer）→ 设备信息（确认弹窗用）
 * POST   /api/v1/devices/link/approve { code, email }（手机 Bearer）→ 绑定 Worker
 * POST   /api/v1/devices/link/poll    { code, secret } → 取回账号身份与设备凭据
 * POST   /api/v1/devices/link/revoke  { code, secret } → 解绑并作废凭据
 * GET    /api/v1/health
 *
 * 鉴权两种形态（见 authUser）：
 * - 手机/浏览器：auth 签发的 RS256 JWT（JWKS 离线验签）；
 * - 桌面端扫码登录后：gateway 侧设备凭据 `dshl_<code>.<secret>`（本文件签发/校验）。
 */

import { createHash, randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { buildDeviceLinkCredential, DEVICE_LINK_ALPHABET, DEVICE_LINK_CODE_LENGTH, isDeviceLinkCode, parseDeviceLinkCredential } from '@deepseek-harness-pocket/bridge-protocol'
import type { Store } from './store.js'
import type { Gateway } from './gateway.js'
import { createAuthVerifier, type VerifiedUser } from './auth-verify.js'
import type { GatewayConfig } from './config.js'

export interface ApiDeps {
  readonly config: GatewayConfig
  readonly store: Store
  readonly gateway: Gateway
}

/** 待确认链接码有效期：5 分钟（扫码+确认足够，泄露窗口小）。 */
const LINK_PENDING_TTL_MS = 5 * 60 * 1000
/** 设备凭据有效期：180 天（桌面端「已登录」状态；过期需重新扫码）。 */
const LINK_CREDENTIAL_TTL_MS = 180 * 24 * 60 * 60 * 1000
/** 桌面端轮询间隔建议值。 */
const LINK_POLL_INTERVAL_MS = 2000

export function createApiRouter(deps: ApiDeps): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const verify = createAuthVerifier(deps.config)

  const json = (res: ServerResponse, status: number, body: unknown): void => {
    const payload = JSON.stringify(body)
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(payload)
  }

  const readBody = async (req: IncomingMessage): Promise<unknown> => {
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(chunk as Buffer)
      if (chunks.reduce((n, c) => n + c.length, 0) > 1024 * 1024) throw new Error('body too large')
    }
    const text = Buffer.concat(chunks).toString('utf8')
    return text.length === 0 ? {} : JSON.parse(text)
  }

  const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

  /** 取请求来源 IP：优先反代写入的 x-forwarded-for 首跳，其次 socket。 */
  const clientIp = (req: IncomingMessage): string => {
    const forwarded = req.headers['x-forwarded-for']
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded
    if (typeof raw === 'string' && raw.length > 0) {
      const first = raw.split(',')[0]!.trim()
      if (first.length > 0) return first.slice(0, 64)
    }
    const socket = req.socket?.remoteAddress ?? ''
    return socket.replace(/^::ffff:/, '').slice(0, 64)
  }

  /** 生成不易混淆的链接码（去掉 I/O/0/1，必要时可手输）。 */
  const newLinkCode = (): string => {
    const bytes = randomBytes(DEVICE_LINK_CODE_LENGTH)
    let code = ''
    for (let i = 0; i < DEVICE_LINK_CODE_LENGTH; i += 1) {
      code += DEVICE_LINK_ALPHABET[bytes[i]! % DEVICE_LINK_ALPHABET.length]
    }
    return code
  }

  /**
   * 桌面端设备凭据 → 账号。凭据 = `dshl_<code>.<secret>`，只存 secret 的 sha256；
   * 必须是已确认（approved）且未过期的链接。
   */
  const deviceUser = async (token: string): Promise<VerifiedUser | null> => {
    const parsed = parseDeviceLinkCredential(token)
    if (parsed === null) return null
    const row = await deps.store.getDeviceLinkBySecretHash(sha256(parsed.secret))
    if (row === null || row.code !== parsed.code || row.user_id === null) return null
    return { userId: row.user_id, appId: null }
  }

  const authUser = async (req: IncomingMessage): Promise<VerifiedUser | null> => {
    const header = req.headers['authorization']
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null
    const token = header.slice('Bearer '.length)
    const viaSession = await verify(token)
    if (viaSession !== null) return viaSession
    return deviceUser(token)
  }

  return async (req, res): Promise<boolean> => {
    const url = (req.url ?? '').split('?')[0]
    if (url === undefined || !url.startsWith('/api/v1/')) return false

    if (url === '/api/v1/health' && req.method === 'GET') {
      json(res, 200, { ok: true, service: 'deepseek-harness-pocket-gateway', protocol: 'mobile/v1' })
      return true
    }

    if (url === '/api/v1/workers' && req.method === 'GET') {
      const user = await authUser(req)
      if (user === null) {
        json(res, 401, { error: 'unauthorized' })
        return true
      }
      json(res, 200, { workers: await deps.gateway.listWorkers(user.userId) })
      return true
    }

    if (url === '/api/v1/workers/bind' && req.method === 'POST') {
      // 账号登录绑定：桌面端登录后按 hostKey 主动绑定（无需扫码/配对码）
      const user = await authUser(req)
      if (user === null) {
        json(res, 401, { error: 'unauthorized' })
        return true
      }
      let body: { hostKey?: string }
      try {
        body = (await readBody(req)) as typeof body
      } catch {
        json(res, 400, { error: 'bad request' })
        return true
      }
      if (typeof body.hostKey !== 'string' || !body.hostKey.startsWith('hk_')) {
        json(res, 400, { error: 'hostKey required' })
        return true
      }
      const result = await deps.gateway.bindByHostKey(user.userId, body.hostKey)
      json(res, result.ok ? 200 : 422, result)
      return true
    }

    if (url === '/api/v1/workers' && req.method === 'DELETE') {
      const user = await authUser(req)
      if (user === null) {
        json(res, 401, { error: 'unauthorized' })
        return true
      }
      const workerId = new URL(req.url ?? '', 'http://localhost').searchParams.get('workerId')
      if (workerId === null || workerId.length === 0) {
        json(res, 400, { error: 'workerId required' })
        return true
      }
      await deps.gateway.unpair(user.userId, workerId)
      json(res, 200, { ok: true })
      return true
    }

    if (url === '/api/v1/devices/push-token' && req.method === 'POST') {
      const user = await authUser(req)
      if (user === null) {
        json(res, 401, { error: 'unauthorized' })
        return true
      }
      let body: { deviceKey?: string; platform?: string; expoPushToken?: string | null }
      try {
        body = (await readBody(req)) as typeof body
      } catch {
        json(res, 400, { error: 'bad request' })
        return true
      }
      if (typeof body.deviceKey !== 'string' || body.deviceKey.length === 0) {
        json(res, 400, { error: 'deviceKey required' })
        return true
      }
      await deps.store.upsertDevice({
        userId: user.userId,
        deviceKey: body.deviceKey,
        platform: typeof body.platform === 'string' ? body.platform : 'ios',
        expoPushToken: typeof body.expoPushToken === 'string' ? body.expoPushToken : null,
      })
      json(res, 200, { ok: true })
      return true
    }

    // ---------- 桌面端「手机扫码授权登录」 ----------

    if (url === '/api/v1/devices/link/start' && req.method === 'POST') {
      // 桌面端未登录时申请一次性链接码：无需鉴权（桌面端此时还没有身份），
      // 但必须带 hostKey 以便手机确认后直接绑定这台电脑。
      let body: { hostKey?: string; name?: string; platform?: string }
      try {
        body = (await readBody(req)) as typeof body
      } catch {
        json(res, 400, { error: 'bad request' })
        return true
      }
      if (typeof body.hostKey !== 'string' || !body.hostKey.startsWith('hk_')) {
        json(res, 400, { error: 'hostKey required' })
        return true
      }
      await deps.store.purgeExpiredDeviceLinks()
      const code = newLinkCode()
      const secret = randomBytes(32).toString('hex')
      await deps.store.createDeviceLink({
        code,
        secretHash: sha256(secret),
        hostKey: body.hostKey,
        name: typeof body.name === 'string' ? body.name.slice(0, 64) : '',
        platform: typeof body.platform === 'string' ? body.platform.slice(0, 32) : '',
        startIp: clientIp(req),
        ttlMs: LINK_PENDING_TTL_MS,
      })
      json(res, 200, {
        code,
        secret,
        expiresAt: Date.now() + LINK_PENDING_TTL_MS,
        intervalMs: LINK_POLL_INTERVAL_MS,
      })
      return true
    }

    if (url === '/api/v1/devices/link/preview' && req.method === 'POST') {
      // 手机扫到码后、确认前先看「这是哪台电脑」：像 Telegram 那样，
      // 弹窗里的设备信息必须来自服务端（而不是二维码自称），否则伪造二维码
      // 就能让弹窗显示任意电脑名。电脑名优先取 gateway 侧已注册的 Worker 名。
      const user = await authUser(req)
      if (user === null) {
        json(res, 401, { error: 'unauthorized' })
        return true
      }
      let body: { code?: string }
      try {
        body = (await readBody(req)) as typeof body
      } catch {
        json(res, 400, { error: 'bad request' })
        return true
      }
      const code = typeof body.code === 'string' ? body.code.toUpperCase() : ''
      if (!isDeviceLinkCode(code)) {
        json(res, 400, { error: '链接码格式不正确' })
        return true
      }
      const link = await deps.store.getDeviceLink(code)
      if (link === null) {
        json(res, 404, { error: '二维码已失效，请在电脑上刷新后重新扫描' })
        return true
      }
      if (link.expires_at.getTime() < Date.now()) {
        await deps.store.deleteDeviceLink(code)
        json(res, 410, { error: '二维码已过期，请在电脑上刷新后重新扫描' })
        return true
      }
      if (link.status === 'approved' && link.user_id !== user.userId) {
        json(res, 409, { error: '该二维码已被其他账号使用' })
        return true
      }
      const worker = await deps.store.getWorkerByHostKey(link.host_key)
      json(res, 200, {
        ok: true,
        // 已注册过就以 Worker 自己的名字为准（权威）；没注册则回落到申请方填的名字
        name: worker?.name && worker.name.length > 0 ? worker.name : link.name,
        platform: link.platform,
        hostKey: link.host_key,
        ip: link.start_ip,
        expiresAt: link.expires_at.getTime(),
        workerKnown: worker !== null,
        alreadyBound: link.status === 'approved',
      })
      return true
    }

    if (url === '/api/v1/devices/link/approve' && req.method === 'POST') {
      // 手机（已登录）确认授权：绑定该电脑到手机账号，并把链接置为 approved
      const user = await authUser(req)
      if (user === null) {
        json(res, 401, { error: 'unauthorized' })
        return true
      }
      let body: { code?: string; email?: string }
      try {
        body = (await readBody(req)) as typeof body
      } catch {
        json(res, 400, { error: 'bad request' })
        return true
      }
      const code = typeof body.code === 'string' ? body.code.toUpperCase() : ''
      if (!isDeviceLinkCode(code)) {
        json(res, 400, { error: '链接码格式不正确' })
        return true
      }
      const link = await deps.store.getDeviceLink(code)
      if (link === null) {
        json(res, 404, { error: '二维码已失效，请在电脑上刷新后重新扫描' })
        return true
      }
      if (link.expires_at.getTime() < Date.now()) {
        await deps.store.deleteDeviceLink(code)
        json(res, 410, { error: '二维码已过期，请在电脑上刷新后重新扫描' })
        return true
      }
      if (link.status === 'approved' && link.user_id !== user.userId) {
        json(res, 409, { error: '该二维码已被其他账号使用' })
        return true
      }
      const result = await deps.gateway.bindByHostKey(user.userId, link.host_key)
      if (!result.ok || result.workerId === undefined) {
        // 电脑还没连上 gateway（服务没启动/网络不通）：告诉手机具体原因
        json(res, 422, { ok: false, reason: result.reason ?? '绑定失败' })
        return true
      }
      const workerId = result.workerId
      if (link.status !== 'approved') {
        await deps.store.approveDeviceLink({
          code,
          userId: user.userId,
          email: typeof body.email === 'string' && body.email.length > 0 ? body.email.slice(0, 200) : null,
          workerId,
          ttlMs: LINK_CREDENTIAL_TTL_MS,
        })
      }
      json(res, 200, {
        ok: true,
        workerId,
        workerName: result.name ?? link.name,
        alreadyBound: link.status === 'approved',
      })
      return true
    }

    if (url === '/api/v1/devices/link/poll' && req.method === 'POST') {
      // 桌面端轮询（凭 secret 证明是发起方）；approved 后返回账号身份与设备凭据
      let body: { code?: string; secret?: string }
      try {
        body = (await readBody(req)) as typeof body
      } catch {
        json(res, 400, { error: 'bad request' })
        return true
      }
      const code = typeof body.code === 'string' ? body.code.toUpperCase() : ''
      const secret = typeof body.secret === 'string' ? body.secret : ''
      if (!isDeviceLinkCode(code) || secret.length === 0) {
        json(res, 400, { error: 'code/secret required' })
        return true
      }
      const link = await deps.store.getDeviceLink(code)
      if (link === null || link.secret_hash !== sha256(secret)) {
        json(res, 404, { status: 'unknown' })
        return true
      }
      if (link.expires_at.getTime() < Date.now()) {
        await deps.store.deleteDeviceLink(code)
        json(res, 200, { status: 'expired' })
        return true
      }
      if (link.status !== 'approved' || link.user_id === null) {
        json(res, 200, { status: 'pending', intervalMs: LINK_POLL_INTERVAL_MS })
        return true
      }
      json(res, 200, {
        status: 'approved',
        account: { userId: link.user_id, email: link.email ?? '' },
        workerId: link.worker_id ?? '',
        credential: buildDeviceLinkCredential(code, secret),
      })
      return true
    }

    if (url === '/api/v1/devices/link/revoke' && req.method === 'POST') {
      // 桌面端「退出登录」：解绑这台电脑并作废设备凭据
      let body: { code?: string; secret?: string }
      try {
        body = (await readBody(req)) as typeof body
      } catch {
        json(res, 400, { error: 'bad request' })
        return true
      }
      const code = typeof body.code === 'string' ? body.code.toUpperCase() : ''
      const secret = typeof body.secret === 'string' ? body.secret : ''
      const link = isDeviceLinkCode(code) && secret.length > 0
        ? await deps.store.getDeviceLink(code)
        : null
      if (link === null || link.secret_hash !== sha256(secret)) {
        json(res, 404, { error: 'not found' })
        return true
      }
      if (link.user_id !== null && link.worker_id !== null) {
        await deps.gateway.unpair(link.user_id, link.worker_id)
      }
      await deps.store.deleteDeviceLink(code)
      json(res, 200, { ok: true })
      return true
    }

    json(res, 404, { error: 'not found' })
    return true
  }
}
