/**
 * Gateway 核心：Worker uplink 与手机接入的 WS 处理、配对挑战、presence、通知分发。
 *
 * 手机↔Worker 是纯隧道（phone-frame/worker-frame 互转，不解析 /mobile 协议）。
 * 账号归属（pairings）与设备/用量持久化在 Store；内存态只保留在线表。
 */

import { randomUUID } from 'node:crypto'
import {
  parseGatewayToPhoneFrame,
  type PairingQrPayload,
  type WorkerPresence,
} from '@deepseek-harness-pocket/bridge-protocol'
import type { GatewayToPhoneFrame, GatewayToWorkerFrame, WorkerToGatewayFrame } from '@deepseek-harness-pocket/bridge-protocol'
import { WebSocket } from 'ws'
import type { Store } from './store.js'
import type { GatewayConfig } from './config.js'

type AuthVerify = (token: string) => Promise<{ userId: string; appId: string | null } | null>

interface WorkerConn {
  readonly ws: WebSocket
  workerId: string
  hostKey: string
  name: string
  fingerprint: string
  dshVersion: string | null
  pairingCode: string
  alive: boolean
}

interface PhoneConn {
  readonly ws: WebSocket
  userId: string | null
  deviceKey: string
  openWorkerId: string | null
  authed: boolean
  alive: boolean
  /** 简单限速：每秒帧数 */
  frameBudget: number
  /** 作品预览令牌桶（bytes；每秒补充速率上限，允许 1 秒突发） */
  previewTokens: number
  /** 速率不足时排队的预览帧（worker 同步倾倒分块时削峰） */
  previewQueue: { inner: string; bytes: number }[]
}

export interface PairingResult {
  readonly ok: boolean
  readonly reason?: string
  readonly workerId?: string
  readonly name?: string
}

const MAX_FRAMES_PER_SECOND = 120

/** preview-chunk 内帧前缀（我们的序列化 kind 恒在首位；前缀不匹配零成本跳过） */
const PREVIEW_CHUNK_PREFIX = '{"kind":"preview-chunk"'
/** preview 请求内帧前缀（phone→worker 方向拦截用） */
const PREVIEW_REQUEST_PREFIX = '{"kind":"preview"'
/** 预览排队上限（超出按洪泛处理断开，防内存堆积） */
const PREVIEW_QUEUE_LIMIT = 128

/** 内帧是 preview-chunk 时返回其原始字节数（base64 → 3/4），否则 0。 */
function previewChunkBytes(inner: string): number {
  if (!inner.startsWith(PREVIEW_CHUNK_PREFIX)) return 0
  try {
    const parsed = JSON.parse(inner) as { kind?: string; dataBase64?: string }
    if (parsed.kind !== 'preview-chunk' || typeof parsed.dataBase64 !== 'string') return 0
    return Math.floor((parsed.dataBase64.length * 3) / 4)
  } catch {
    return 0
  }
}

export class Gateway {
  private readonly workers = new Map<string, WorkerConn>()
  private readonly workerByHostKey = new Map<string, string>()
  private readonly phones = new Map<string, PhoneConn>()
  private readonly challenges = new Map<string, (accepted: boolean) => void>()
  private seq = 0
  /** 今日已中转预览字节（userId → bytes；跨日清零，60s 批量落库） */
  private readonly previewUsedToday = new Map<string, number>()
  private previewDay = ''
  private previewFlushAt = 0

  constructor(
    private readonly config: GatewayConfig,
    private readonly store: Store,
    private readonly verify: AuthVerify,
    private readonly sendPush: (userId: string, title: string, body: string, sessionId?: string) => Promise<void>,
  ) {}

  // ---------- Worker uplink ----------

  attachWorker(ws: WebSocket): void {
    const conn: WorkerConn = {
      ws,
      workerId: '',
      hostKey: '',
      name: '',
      fingerprint: '',
      dshVersion: null,
      pairingCode: '',
      alive: true,
    }
    const id = `wk${++this.seq}`
    this.workers.set(id, conn)
    ws.on('error', (error: Error) => {
      console.warn(`[gw] worker ws error (${id}): ${(error as Error & { code?: string }).code ?? ''} ${error.message}`)
    })
    const authTimer = setTimeout(() => {
      if (conn.workerId === '') this.dropWorker(id)
    }, 10_000)

    ws.on('pong', () => {
      conn.alive = true
    })
    ws.on('close', () => {
      clearTimeout(authTimer)
      this.dropWorker(id)
    })
    ws.on('message', (data: unknown) => {
      const text = typeof data === 'string' ? data : String(data)
      void this.handleWorkerFrame(id, conn, text)
    })
  }

  private dropWorker(id: string): void {
    const conn = this.workers.get(id)
    this.workers.delete(id)
    if (conn !== undefined && conn.workerId !== '') {
      this.workerByHostKey.delete(conn.hostKey)
      void this.store.recordUsage({ userId: null, workerId: conn.workerId, kind: 'worker-offline' })
      void this.broadcastPresence()
    }
    // 打开着台 Worker 的手机收到 worker-frame 断连由手机侧重连逻辑处理
  }

  private async handleWorkerFrame(id: string, conn: WorkerConn, text: string): Promise<void> {
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      return
    }
    const frame = value as WorkerToGatewayFrame
    switch (frame.kind) {
      case 'worker-register': {
        const existing = await this.store.getWorkerByHostKey(frame.hostKey)
        const workerId = existing?.id ?? `w_${randomUUID().slice(0, 12)}`
        await this.store.upsertWorker({
          id: workerId,
          hostKey: frame.hostKey,
          name: frame.name,
          fingerprint: frame.hostFingerprint,
          dshVersion: frame.dshVersion,
          pairingCode: frame.pairingCode,
        })
        conn.workerId = workerId
        conn.hostKey = frame.hostKey
        conn.name = frame.name
        conn.fingerprint = frame.hostFingerprint
        conn.dshVersion = frame.dshVersion
        conn.pairingCode = frame.pairingCode
        this.workerByHostKey.set(frame.hostKey, id)
        this.sendToWorkerConn(conn, { kind: 'register-ok', workerId })
        await this.store.recordUsage({ userId: null, workerId, kind: 'worker-online' })
        await this.broadcastPresence()
        break
      }
      case 'pong':
        break
      case 'phone-frame': {
        // Worker → 手机下行：转发给当前打开该 Worker 的手机（MVP 单活跃）。
        // preview-chunk 走计量 + 速率令牌桶（保护小水管），其余帧直接透传。
        if (conn.workerId === '') return
        for (const [phoneId, phone] of this.phones) {
          if (phone.authed && phone.openWorkerId === conn.workerId) {
            const bytes = previewChunkBytes(frame.inner)
            if (bytes === 0) {
              this.sendToPhoneConn(phone, { kind: 'worker-frame', workerId: conn.workerId, inner: frame.inner })
            } else {
              this.deliverPreview(phoneId, phone, conn.workerId, frame.inner, bytes)
            }
          }
        }
        break
      }
      case 'pairing-answer': {
        const resolve = this.challenges.get(frame.challengeId)
        if (resolve !== undefined) {
          this.challenges.delete(frame.challengeId)
          resolve(frame.accepted)
        }
        break
      }
      case 'notify': {
        // Worker 通知信号 → 推给该 Worker 配对用户的在线手机 + 系统 push
        if (conn.workerId === '') return
        const pairings = await this.store.listPairingsByWorker(conn.workerId)
        for (const userId of pairings) {
          this.sendToUser(userId, {
            kind: 'push',
            title: frame.title,
            body: frame.body,
            ...(frame.sessionId !== undefined ? { sessionId: frame.sessionId } : {}),
          })
          await this.sendPush(userId, frame.title, frame.body, frame.sessionId)
        }
        break
      }
    }
  }

  private sendToWorkerConn(conn: WorkerConn, frame: GatewayToWorkerFrame): void {
    if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify(frame))
  }

  // ---------- 手机 ----------

  attachPhone(ws: WebSocket): void {
    const conn: PhoneConn = {
      ws,
      userId: null,
      deviceKey: '',
      openWorkerId: null,
      authed: false,
      alive: true,
      frameBudget: MAX_FRAMES_PER_SECOND,
      previewTokens: this.config.previewRateBytesPerSecond,
      previewQueue: [],
    }
    const id = `ph${++this.seq}`
    this.phones.set(id, conn)
    ws.on('error', (error: Error) => {
      console.warn(`[gw] phone ws error (${id}): ${(error as Error & { code?: string }).code ?? ''} ${error.message}`)
    })
    const authTimer = setTimeout(() => {
      if (!conn.authed) this.dropPhone(id)
    }, 10_000)
    // 简单限速：每秒重置预算 + 补充预览令牌并排空排队帧
    const budgetTimer = setInterval(() => {
      conn.frameBudget = MAX_FRAMES_PER_SECOND
      conn.previewTokens = Math.min(this.config.previewRateBytesPerSecond, conn.previewTokens + this.config.previewRateBytesPerSecond)
      this.drainPreviewQueue(conn)
    }, 1000)

    ws.on('pong', () => {
      conn.alive = true
    })
    ws.on('close', () => {
      clearTimeout(authTimer)
      clearInterval(budgetTimer)
      this.dropPhone(id)
    })
    ws.on('message', (data: unknown) => {
      if (conn.frameBudget <= 0) {
        this.dropPhone(id)
        return
      }
      conn.frameBudget -= 1
      const text = typeof data === 'string' ? data : String(data)
      void this.handlePhoneFrame(id, conn, text)
    })
  }

  private dropPhone(id: string): void {
    const conn = this.phones.get(id)
    this.phones.delete(id)
    if (conn !== undefined && conn.openWorkerId !== null && conn.userId !== null) {
      void this.store.recordUsage({ userId: conn.userId, workerId: conn.openWorkerId, kind: 'phone-session-end' })
    }
    conn?.ws.terminate()
  }

  private async handlePhoneFrame(id: string, conn: PhoneConn, text: string): Promise<void> {
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      return
    }
    const frame = value as { kind: string; [k: string]: unknown }
    if (frame.kind === 'phone-auth') {
      const authToken = frame['authToken']
      const deviceKey = frame['deviceKey']
      if (typeof authToken !== 'string' || typeof deviceKey !== 'string') {
        this.sendToPhoneConn(conn, { kind: 'auth-rejected', reason: 'malformed auth' })
        this.dropPhone(id)
        return
      }
      const user = await this.verify(authToken)
      if (user === null) {
        this.sendToPhoneConn(conn, { kind: 'auth-rejected', reason: 'invalid session' })
        this.dropPhone(id)
        return
      }
      conn.userId = user.userId
      conn.deviceKey = deviceKey
      conn.authed = true
      this.sendToPhoneConn(conn, { kind: 'auth-ok', userId: user.userId })
      await this.store.upsertDevice({ userId: user.userId, deviceKey, platform: 'app', expoPushToken: null })
      await this.sendPresenceTo(conn)
      return
    }
    if (!conn.authed || conn.userId === null) return

    switch (frame.kind) {
      case 'pong':
        return
      case 'worker-open': {
        const workerId = frame['workerId']
        if (typeof workerId !== 'string') return
        if (!(await this.store.isPaired(conn.userId, workerId))) {
          this.sendToPhoneConn(conn, { kind: 'worker-open-result', workerId, ok: false, reason: 'not paired' })
          return
        }
        const workerOnline = this.findWorkerConnByWorkerId(workerId) !== undefined
        if (!workerOnline) {
          this.sendToPhoneConn(conn, { kind: 'worker-open-result', workerId, ok: false, reason: 'worker offline' })
          return
        }
        // MVP 单活跃手机：踢掉同 Worker 的旧手机
        for (const [pid, phone] of this.phones) {
          if (pid !== id && phone.openWorkerId === workerId) {
            phone.openWorkerId = null
            this.sendToPhoneConn(phone, { kind: 'worker-open-result', workerId, ok: false, reason: 'superseded by another device' })
          }
        }
        conn.openWorkerId = workerId
        this.sendToPhoneConn(conn, { kind: 'worker-open-result', workerId, ok: true })
        await this.store.recordUsage({ userId: conn.userId, workerId, kind: 'phone-session-start' })
        return
      }
      case 'worker-close': {
        conn.openWorkerId = null
        return
      }
      case 'worker-frame': {
        const workerId = frame['workerId']
        const inner = frame['inner']
        if (typeof workerId !== 'string' || typeof inner !== 'string') return
        if (conn.openWorkerId !== workerId) return // 未打开或越权
        const workerConn = this.findWorkerConnByWorkerId(workerId)
        if (workerConn === undefined) return
        // 作品预览请求：过日配额闸（超限直接回 preview-error，不进隧道）
        if (inner.startsWith(PREVIEW_REQUEST_PREFIX)) {
          void this.gatePreview(id, conn, workerId, inner)
          return
        }
        this.sendToWorkerConn(workerConn, { kind: 'phone-frame', phoneId: id, inner })
        return
      }
    }
  }

  // ---------- 作品预览配额（计量 / 限速 / 日配额） ----------

  /** preview 请求闸：配额内转发给 worker，超限合成 preview-error 回手机。 */
  private async gatePreview(id: string, conn: PhoneConn, workerId: string, inner: string): Promise<void> {
    let requestId = ''
    try {
      const parsed = JSON.parse(inner) as { requestId?: unknown }
      if (typeof parsed.requestId === 'string') requestId = parsed.requestId
    } catch {
      return
    }
    const userId = conn.userId
    if (userId === null) return
    this.rollPreviewDayIfNeeded()
    const used = (this.previewUsedToday.get(userId) ?? 0) + await this.store.previewBytesToday(userId)
    if (used < this.config.previewDailyQuotaBytes) {
      const workerConn = this.findWorkerConnByWorkerId(workerId)
      if (workerConn !== undefined) this.sendToWorkerConn(workerConn, { kind: 'phone-frame', phoneId: id, inner })
      return
    }
    this.sendToPhoneConn(conn, {
      kind: 'worker-frame',
      workerId,
      inner: JSON.stringify({
        kind: 'preview-error',
        requestId,
        code: 'unavailable',
        message: `预览流量日配额（${Math.floor(this.config.previewDailyQuotaBytes / (1024 * 1024))}MB）已用完，明日重置`,
      }),
    })
  }

  /** 令牌桶投递预览帧；速率不足排队（每秒预算 tick 排空）。 */
  private deliverPreview(phoneId: string, phone: PhoneConn, workerId: string, inner: string, bytes: number): void {
    if (phone.previewQueue.length >= PREVIEW_QUEUE_LIMIT) {
      console.warn(`[gw] phone ${phoneId} preview queue overflow, dropping`)
      this.dropPhone(phoneId)
      return
    }
    if (phone.previewQueue.length === 0 && phone.previewTokens >= bytes) {
      phone.previewTokens -= bytes
      this.sendToPhoneConn(phone, { kind: 'worker-frame', workerId, inner })
      this.meterPreview(phone.userId, workerId, bytes)
      return
    }
    phone.previewQueue.push({ inner, bytes })
  }

  private drainPreviewQueue(phone: PhoneConn): void {
    while (phone.previewQueue.length > 0) {
      const head = phone.previewQueue[0]!
      if (phone.previewTokens < head.bytes) return
      phone.previewTokens -= head.bytes
      phone.previewQueue.shift()
      if (phone.openWorkerId !== null) {
        this.sendToPhoneConn(phone, { kind: 'worker-frame', workerId: phone.openWorkerId, inner: head.inner })
        this.meterPreview(phone.userId, phone.openWorkerId, head.bytes)
      }
    }
  }

  /** 计量（内存聚合，60s 批量落库 kind='preview-bytes'）。 */
  private meterPreview(userId: string | null, workerId: string, bytes: number): void {
    if (userId === null) return
    this.rollPreviewDayIfNeeded()
    this.previewUsedToday.set(userId, (this.previewUsedToday.get(userId) ?? 0) + bytes)
    const now = Date.now()
    if (now - this.previewFlushAt < 60_000) return
    this.previewFlushAt = now
    for (const [uid, total] of this.previewUsedToday) {
      void this.store.recordUsage({ userId: uid, workerId, kind: 'preview-bytes', meta: { bytes: total } })
    }
    this.previewUsedToday.clear()
  }

  /** 跨日清零内存计数（落库行按 at 聚合今日，双轨一致）。 */
  private rollPreviewDayIfNeeded(): void {
    const day = new Date().toISOString().slice(0, 10)
    if (day === this.previewDay) return
    for (const [uid, total] of this.previewUsedToday) {
      void this.store.recordUsage({ userId: uid, workerId: null, kind: 'preview-bytes', meta: { bytes: total } })
    }
    this.previewUsedToday.clear()
    this.previewDay = day
  }

  private findWorkerConnByWorkerId(workerId: string): WorkerConn | undefined {
    for (const conn of this.workers.values()) {
      if (conn.workerId === workerId) return conn
    }
    return undefined
  }

  private sendToPhoneConn(conn: PhoneConn, frame: GatewayToPhoneFrame): void {
    if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify(frame))
  }

  private sendToUser(userId: string, frame: GatewayToPhoneFrame): void {
    for (const phone of this.phones.values()) {
      if (phone.authed && phone.userId === userId) this.sendToPhoneConn(phone, frame)
    }
  }

  // ---------- presence ----------

  private async presenceFor(userId: string): Promise<WorkerPresence[]> {
    const pairings = await this.store.listPairings(userId)
    const result: WorkerPresence[] = []
    for (const pairing of pairings) {
      const row = await this.store.getWorkerById(pairing.worker_id)
      if (row === null) continue
      const conn = this.findWorkerConnByWorkerId(pairing.worker_id)
      result.push({
        workerId: pairing.worker_id,
        name: pairing.name ?? row.name,
        hostFingerprint: row.fingerprint,
        online: conn !== undefined,
        lastSeenAt: row.last_seen_at.getTime(),
        capabilities:
          conn !== undefined
            ? { dshVersion: conn.dshVersion, protocolVersion: 'mobile/v1' }
            : null,
      })
    }
    return result.sort((a, b) => Number(b.online) - Number(a.online) || b.lastSeenAt - a.lastSeenAt)
  }

  private async sendPresenceTo(conn: PhoneConn): Promise<void> {
    if (conn.userId === null) return
    const workers = await this.presenceFor(conn.userId)
    this.sendToPhoneConn(conn, { kind: 'presence', workers })
  }

  private async broadcastPresence(): Promise<void> {
    const seen = new Set<string>()
    for (const phone of this.phones.values()) {
      if (!phone.authed || phone.userId === null || seen.has(phone.userId)) continue
      seen.add(phone.userId)
      await this.sendPresenceTo(phone)
    }
  }

  // ---------- 配对（REST 调用） ----------

  async bindByQr(userId: string, payload: PairingQrPayload, name: string | null): Promise<PairingResult> {
    const connId = this.workerByHostKey.get(payload.hostKey)
    const workerConn = connId !== undefined ? this.workers.get(connId) : undefined
    if (workerConn === undefined || workerConn.workerId === '') {
      return { ok: false, reason: 'worker 不在线（请先在电脑上启动 dshc）' }
    }
    return this.challengeAndPair(userId, workerConn, payload.code, payload.fingerprint, name)
  }

  async bindByCode(userId: string, code: string, name: string | null): Promise<PairingResult> {
    for (const conn of this.workers.values()) {
      if (conn.pairingCode === code && conn.workerId !== '') {
        return this.challengeAndPair(userId, conn, code, conn.fingerprint, name)
      }
    }
    return { ok: false, reason: '配对码无效或 Worker 不在线' }
  }

  private async challengeAndPair(
    userId: string,
    conn: WorkerConn,
    code: string,
    fingerprint: string,
    name: string | null,
  ): Promise<PairingResult> {
    const challengeId = `ch_${randomUUID().slice(0, 12)}`
    const decided = new Promise<boolean>((resolve) => {
      this.challenges.set(challengeId, resolve)
      setTimeout(() => {
        if (this.challenges.has(challengeId)) {
          this.challenges.delete(challengeId)
          resolve(false)
        }
      }, 15_000)
    })
    this.sendToWorkerConn(conn, { kind: 'pairing-challenge', challengeId, code, requestedBy: userId })
    const accepted = await decided
    if (!accepted) return { ok: false, reason: 'Worker 拒绝了配对（配对码不匹配）' }
    await this.store.pairWorker(userId, conn.workerId, name)
    await this.store.recordUsage({ userId, workerId: conn.workerId, kind: 'pairing-bound', meta: { fingerprint } })
    await this.broadcastPresence()
    return { ok: true, workerId: conn.workerId, name: name ?? conn.name }
  }

  /** REST：列出我的 Worker（含在线状态）。 */
  async listWorkers(userId: string): Promise<WorkerPresence[]> {
    return this.presenceFor(userId)
  }

  async unpair(userId: string, workerId: string): Promise<void> {
    await this.store.unpairWorker(userId, workerId)
    await this.broadcastPresence()
  }

  /** 心跳（server.ts 定时调用）。 */
  heartbeat(): void {
    for (const [id, conn] of this.workers) {
      if (!conn.alive) {
        conn.ws.terminate()
        this.dropWorker(id)
        continue
      }
      conn.alive = false
      conn.ws.ping()
      if (conn.workerId !== '') void this.store.touchWorker(conn.workerId)
    }
    for (const [id, conn] of this.phones) {
      if (!conn.alive) {
        this.dropPhone(id)
        continue
      }
      conn.alive = false
      conn.ws.ping()
    }
  }
}
