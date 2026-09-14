/**
 * uplink 模式：插件作为客户端反向连接 Gateway（outbound WSS，断线重连）。
 *
 * 帧协议见 protocol 包 relay.ts：worker-register / ping-pong / phone-frame /
 * pairing-challenge。手机帧经 gateway 的 phone-frame 转发进出 Hub（同一套路由）。
 * 连接时若账号会话文件可用（桌面端登录写入），随 worker-register 上送
 * accountToken，由 gateway 验签后自动绑定账号（同账号手机端免扫码）。
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  parseGatewayToWorkerFrame,
  type GatewayToWorkerFrame,
  type WorkerToGatewayFrame,
} from '@deepseek-harness-pocket/bridge-protocol'
import { WebSocket } from 'ws'
import type { BridgeHub } from './hub.js'

export interface UplinkOptions {
  readonly url: string
  readonly hostKey: string
  readonly workerName: string
  readonly fingerprint: string
  readonly dshVersion: string | null
  readonly hub: BridgeHub
  readonly pairingCode: string
  readonly reconnectMinMs: number
  readonly reconnectMaxMs: number
  /** 账号会话文件（空 = 关闭账号自动绑定路径） */
  readonly accountSessionFile?: string
  readonly onNotify?: (signal: WorkerToGatewayFrame & { kind: 'notify' }) => void
}

/** 读取账号 session token（每次连接调用，保持桌面端刷新后取到新值）；不可用返回 null。 */
export function readAccountToken(file: string | undefined): string | null {
  if (file === undefined || file.length === 0) return null
  const path = resolve(file.replace(/^~(?=\/|$)/, homedir()))
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { token?: unknown }
    return typeof parsed.token === 'string' && parsed.token.length > 0 ? parsed.token : null
  } catch {
    return null
  }
}

/** 启动 uplink（含重连循环）；dispose 后不再重连。 */
export function startUplink(ctx: Context, opts: UplinkOptions): () => void {
  let disposed = false
  let attempt = 0
  let ws: WebSocket | null = null
  let reconnectTimer: NodeJS.Timeout | undefined
  let pingTimer: NodeJS.Timeout | undefined

  const scheduleReconnect = (): void => {
    if (disposed) return
    const delay = Math.min(opts.reconnectMinMs * 2 ** Math.min(attempt, 5), opts.reconnectMaxMs)
    attempt += 1
    reconnectTimer = setTimeout(connect, delay)
  }

  const send = (frame: WorkerToGatewayFrame): void => {
    if (ws !== null && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame))
  }

  const connect = (): void => {
    if (disposed) return
    ctx.logger.info(`deepseek-harness-pocket uplink connecting to ${opts.url}`)
    ws = new WebSocket(opts.url)

    ws.on('open', () => {
      attempt = 0
      // 每次连接现读会话文件：桌面端 refresh token 后无需重启即可带上新凭证
      const accountToken = readAccountToken(opts.accountSessionFile)
      send({
        kind: 'worker-register',
        hostKey: opts.hostKey,
        protocolVersion: 'mobile/v1',
        name: opts.workerName,
        hostFingerprint: opts.fingerprint,
        dshVersion: opts.dshVersion,
        pairingCode: opts.pairingCode,
        ...(accountToken !== null ? { accountToken } : {}),
      })
      pingTimer = setInterval(() => {
        send({ kind: 'pong', nonce: Date.now() })
      }, 25_000)
    })

    ws.on('message', (data: unknown) => {
      const text = typeof data === 'string' ? data : String(data)
      const frame: GatewayToWorkerFrame | null = parseGatewayToWorkerFrame(safeParse(text))
      if (frame === null) return
      switch (frame.kind) {
        case 'register-ok':
          ctx.logger.info(
            `deepseek-harness-pocket uplink registered as worker ${frame.workerId}`
              + (frame.boundUserId ? ` (account ${frame.boundUserId})` : ''),
          )
          break
        case 'register-rejected':
          ctx.logger.error(`deepseek-harness-pocket uplink rejected: ${frame.reason}`)
          ws?.close()
          break
        case 'ping':
          send({ kind: 'pong', nonce: frame.nonce })
          break
        case 'phone-frame': {
          // 手机帧经 gateway 抵达伪连接：复用 Hub 的认证/路由（auth 也在 inner 帧里）
          opts.hub.handleFrame(uplinkConnId, frame.inner)
          break
        }
        case 'pairing-challenge': {
          // gateway 转发的绑定挑战：核对 6 位配对码
          const accepted = frame.code === opts.pairingCode
          send({ kind: 'pairing-answer', challengeId: frame.challengeId, accepted })
          ctx.logger.info(
            `deepseek-harness-pocket pairing challenge from ${frame.requestedBy}: ${accepted ? 'accepted' : 'rejected (code mismatch)'}`,
          )
          break
        }
      }
    })

    ws.on('close', () => {
      if (pingTimer !== undefined) clearInterval(pingTimer)
      if (!disposed) scheduleReconnect()
    })

    ws.on('error', (error: Error) => {
      ctx.logger.warn(`deepseek-harness-pocket uplink error: ${error.message}`)
    })
  }

  // 经 gateway 的手机下行承载：单一伪连接（MVP 每 Worker 单活跃手机，gateway 负责替换旧手机）。
  // 手机的 auth 帧作为 inner 抵达 → handleFrame 完成 Hub 认证；此后 broadcast 的
  // 事件/快照/审批都经此连接以 phone-frame 发回 gateway，由其转发给当前活跃手机。
  const uplinkConnId = opts.hub.attach(
    {
      send: (text) => {
        send({ kind: 'phone-frame', inner: text })
      },
    },
    { trusted: true },
  )

  connect()

  return () => {
    disposed = true
    if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
    if (pingTimer !== undefined) clearInterval(pingTimer)
    opts.hub.detach(uplinkConnId)
    ws?.close()
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
