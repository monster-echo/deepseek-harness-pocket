/**
 * ConnectionManager：App 与 Gateway 的手机连接（单例生命周期）。
 *
 * - 终北 session token 鉴权（phone-auth 帧）
 * - presence 维护（我的 Worker 在线列表）
 * - worker-open / worker-frame 隧道（DshClient 的 GatewayTunnel 走这里）
 * - REST（配对绑定 / push token）走 fetch
 */

import { parseGatewayToPhoneFrame, type WorkerPresence } from '@dsh-companion/bridge-protocol'
import { readSessionToken } from '../data/storage'
import { GatewayTunnel } from './channel'

export type GatewayStatus = 'idle' | 'connecting' | 'connected' | 'offline'

export interface GatewayCallbacks {
  onStatus(status: GatewayStatus): void
  onPresence(workers: readonly WorkerPresence[]): void
  onPush(title: string, body: string, sessionId?: string): void
  onTunnelFrame(workerId: string, inner: string): void
  onOpenResult(workerId: string, ok: boolean, reason?: string): void
}

function httpToWs(url: string): string {
  return url.replace(/^http/, 'ws').replace(/\/$/, '')
}

/**
 * 会话 token：优先终北真实 session；开发环境可用
 * EXPO_PUBLIC_DEV_SESSION_TOKEN（形如 dev:<userId>）走 gateway 的 dev 验票。
 */
async function readAuthSessionToken(): Promise<string | null> {
  const token = await readSessionToken()
  if (token !== null && token.length > 0) return token
  if (process.env.EXPO_PUBLIC_APP_ENVIRONMENT !== 'production') {
    const dev = process.env.EXPO_PUBLIC_DEV_SESSION_TOKEN
    if (dev !== undefined && dev.length > 0) return dev
  }
  return null
}

export function gatewayHttpBase(): string {
  const ws = process.env.EXPO_PUBLIC_GATEWAY_URL ?? 'ws://127.0.0.1:3781'
  return ws.replace(/^ws/, 'http').replace(/\/$/, '')
}

export class GatewayConnection {
  private ws: WebSocket | null = null
  private deviceKey = 'primary'
  private closedByUser = false
  private retryAttempt = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly callbacks: GatewayCallbacks) {}

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  connect(): void {
    this.closedByUser = false
    this.teardownSocket()
    const base = httpToWs(process.env.EXPO_PUBLIC_GATEWAY_URL ?? 'ws://127.0.0.1:3781')
    this.callbacks.onStatus('connecting')
    const ws = new WebSocket(`${base}/gw/phone`)
    this.ws = ws
    ws.onopen = () => {
      void this.authenticate()
    }
    ws.onclose = () => {
      this.callbacks.onStatus('offline')
      this.scheduleReconnect()
    }
    ws.onerror = () => {
      this.callbacks.onStatus('offline')
    }
    ws.onmessage = (event: WebSocketMessageEvent) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data))
      } catch {
        return
      }
      this.handleFrame(parseGatewayToPhoneFrame(parsed))
    }
  }

  private async authenticate(): Promise<void> {
    const token = await readAuthSessionToken()
    if (token === null || token.length === 0) {
      this.callbacks.onStatus('offline')
      return
    }
    this.ws?.send(
      JSON.stringify({ kind: 'phone-auth', authToken: token, deviceKey: this.deviceKey }),
    )
  }

  private handleFrame(frame: ReturnType<typeof parseGatewayToPhoneFrame>): void {
    if (frame === null) return
    switch (frame.kind) {
      case 'auth-ok':
        this.retryAttempt = 0
        this.callbacks.onStatus('connected')
        this.pingTimer = setInterval(() => {
          this.ws?.send(JSON.stringify({ kind: 'pong', nonce: Date.now() }))
        }, 25_000)
        return
      case 'auth-rejected':
        // 终北 session 失效：交给上层引导重新登录，这里停止重连
        this.closedByUser = true
        this.callbacks.onStatus('idle')
        this.ws?.close()
        return
      case 'presence':
        this.callbacks.onPresence(frame.workers)
        return
      case 'worker-open-result':
        this.callbacks.onOpenResult(frame.workerId, frame.ok, 'reason' in frame ? String(frame.reason) : undefined)
        return
      case 'worker-frame':
        this.callbacks.onTunnelFrame(frame.workerId, frame.inner)
        return
      case 'ping':
        this.ws?.send(JSON.stringify({ kind: 'pong', nonce: frame.nonce }))
        return
      case 'push':
        this.callbacks.onPush(frame.title, frame.body, 'sessionId' in frame ? (frame as { sessionId?: string }).sessionId : undefined)
        return
    }
  }

  openWorker(workerId: string): void {
    this.ws?.send(JSON.stringify({ kind: 'worker-open', workerId }))
  }

  closeWorker(workerId: string): void {
    this.ws?.send(JSON.stringify({ kind: 'worker-close', workerId }))
  }

  sendWorkerFrame(workerId: string, inner: string): void {
    this.ws?.send(JSON.stringify({ kind: 'worker-frame', workerId, inner }))
  }

  /** 为某个 Worker 创建隧道（DshClient 的 Channel）。 */
  makeTunnel(workerId: string, onInner: (inner: string) => void): GatewayTunnel {
    return new GatewayTunnel(
      {
        sendWorkerFrame: (id, inner) => this.sendWorkerFrame(id, inner),
        isConnected: () => this.isConnected,
        closeWorker: (id) => this.closeWorker(id),
      },
      workerId,
      onInner,
    )
  }

  disconnect(): void {
    this.closedByUser = true
    this.teardownSocket()
    this.callbacks.onStatus('idle')
  }

  private scheduleReconnect(): void {
    if (this.closedByUser || this.retryTimer !== null) return
    const delay = Math.min(1000 * 2 ** Math.min(this.retryAttempt, 5), 30_000)
    this.retryAttempt += 1
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.connect()
    }, delay)
  }

  private teardownSocket(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer)
    this.pingTimer = null
    if (this.retryTimer !== null) clearTimeout(this.retryTimer)
    this.retryTimer = null
    if (this.ws !== null) {
      const ws = this.ws
      this.ws = null
      ws.onclose = null
      ws.close()
    }
  }
}

// ---------- REST（配对 / push token） ----------

export async function restPost(path: string, body: unknown): Promise<unknown> {
  const token = await readAuthSessionToken()
  if (token === null) throw new Error('未登录')
  const response = await fetch(`${gatewayHttpBase()}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    throw new Error(typeof data['reason'] === 'string' ? data['reason'] : `HTTP ${response.status}`)
  }
  return data
}

export async function bindWorkerByCode(code: string, name?: string): Promise<{ workerId?: string }> {
  const result = (await restPost('/api/v1/pairing/bind', { code, name })) as { workerId?: string }
  return result
}

export async function registerPushToken(expoPushToken: string): Promise<void> {
  await restPost('/api/v1/devices/push-token', {
    deviceKey: 'primary',
    platform: 'ios',
    expoPushToken,
  })
}
