/**
 * dsh 连接通道：直连（同 WiFi ws://worker:3780）与经 Gateway 的隧道。
 *
 * 两种通道对上层呈现同一接口：发送 /mobile 帧、以 inner 文本接收下行。
 * 帧解析统一在 DshClient.handleInner。
 */

import type { PhoneToWorkerFrame } from '@dsh-companion/bridge-protocol'

export interface Channel {
  /** 发送一帧 /mobile 协议；未连接时抛错 */
  send(frame: PhoneToWorkerFrame): void
  close(): void
  readonly isOpen: boolean
}

function httpToWs(url: string): string {
  return url.replace(/^http/, 'ws')
}

/** 直连通道：手机 ↔ Worker 插件（/mobile/ws）。 */
export class DirectChannel implements Channel {
  private ws: WebSocket
  private closed = false

  constructor(
    url: string,
    private readonly onInner: (inner: string) => void,
    private readonly onStatus: (open: boolean) => void,
  ) {
    this.ws = new WebSocket(httpToWs(url))
    this.ws.onopen = () => this.onStatus(true)
    this.ws.onclose = () => this.onStatus(false)
    this.ws.onerror = () => this.onStatus(false)
    this.ws.onmessage = (event: WebSocketMessageEvent) => {
      this.onInner(typeof event.data === 'string' ? event.data : String(event.data))
    }
  }

  get isOpen(): boolean {
    return this.ws.readyState === WebSocket.OPEN && !this.closed
  }

  send(frame: PhoneToWorkerFrame): void {
    if (!this.isOpen) throw new Error('direct channel not open')
    this.ws.send(JSON.stringify(frame))
  }

  close(): void {
    this.closed = true
    this.ws.close()
  }
}

/**
 * Gateway 隧道通道：把 /mobile 帧序列化为 worker-frame.inner 经手机连接转发。
 * 下行由 ConnectionManager 调 handleInner 注入。
 */
export class GatewayTunnel implements Channel {
  constructor(
    private readonly gateway: {
      sendWorkerFrame(workerId: string, inner: string): void
      isConnected(): boolean
      closeWorker(workerId: string): void
    },
    private readonly workerId: string,
    private readonly onInner: (inner: string) => void,
  ) {}

  get isOpen(): boolean {
    return this.gateway.isConnected()
  }

  handleInner(inner: string): void {
    this.onInner(inner)
  }

  send(frame: PhoneToWorkerFrame): void {
    if (!this.isOpen) throw new Error('gateway tunnel not open')
    this.gateway.sendWorkerFrame(this.workerId, JSON.stringify(frame))
  }

  close(): void {
    this.gateway.closeWorker(this.workerId)
  }
}
