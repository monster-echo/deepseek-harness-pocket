/**
 * 直连模式：自起 node:http + WebSocket（默认 0.0.0.0:3780）。
 *
 * 独立端口，与 dsh webServer 的 trust fence 完全隔离；
 * 鉴权（pairing token）由 Hub 在 WS 首帧 auth 中完成。
 */

import type { Context } from '@deepseek-ai/cordis'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'

/** ws 实例 + 运行时心跳标记（ws 官方模式）。 */
type AliveWebSocket = WebSocket & { isAlive: boolean }
import type { BridgeHub } from './hub.js'

export interface DirectServerOptions {
  readonly host: string
  readonly port: number
  readonly hub: BridgeHub
  readonly workerName: string
}

export interface RunningServer {
  readonly port: number
  dispose(): Promise<void>
}

const AUTH_TIMEOUT_MS = 10_000
const PING_INTERVAL_MS = 30_000

/** 启动直连 server；由插件通过 ctx.effect 挂接 dispose。 */
export function startDirectServer(ctx: Context, opts: DirectServerOptions): Promise<RunningServer> {
  const wss = new WebSocketServer({ noServer: true })
  const httpServer: Server = createServer((req, res) => {
    const url = req.url ?? '/'
    if (url === '/mobile/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, worker: opts.workerName, protocol: 'mobile/v1' }))
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found', hint: 'WS endpoint is /mobile/ws' }))
  })

  httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = req.url ?? ''
    if (url.split('?')[0] !== '/mobile/ws') {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req)
    })
  })

  wss.on('connection', (rawWs: WebSocket) => {
    const ws = rawWs as AliveWebSocket
    ws.isAlive = true
    const connId = opts.hub.attach({
      send: (text) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(text)
      },
    })
    const authTimer = setTimeout(() => {
      opts.hub.detach(connId)
      ws.terminate()
    }, AUTH_TIMEOUT_MS)
    ws.on('pong', () => {
      ws.isAlive = true
    })
    ws.on('close', () => {
      clearTimeout(authTimer)
      opts.hub.detach(connId)
    })
    ws.on('message', (data: unknown) => {
      const text = typeof data === 'string' ? data : String(data)
      const status = opts.hub.handleFrame(connId, text)
      if (status === 'authed') {
        clearTimeout(authTimer)
      } else if (status === 'reject') {
        // auth 失败时 Hub 已回 auth-rejected；等 200ms 让其落地再断开
        setTimeout(() => ws.terminate(), 200)
      }
    })
  })

  const pingTimer = setInterval(() => {
    for (const raw of wss.clients) {
      const ws = raw as AliveWebSocket
      if (!ws.isAlive) {
        ws.terminate()
        continue
      }
      ws.isAlive = false
      ws.ping()
    }
  }, PING_INTERVAL_MS)

  return new Promise((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(opts.port, opts.host, () => {
      const address = httpServer.address()
      const port = typeof address === 'object' && address !== null ? address.port : opts.port
      ctx.logger.info(`deepseek-harness-pocket bridge listening on ws://${opts.host}:${port}/mobile/ws`)
      resolve({
        port,
        async dispose() {
          clearInterval(pingTimer)
          for (const raw of wss.clients) raw.terminate()
          await new Promise<void>((done) => wss.close(() => done()))
          await new Promise<void>((done) => httpServer.close(() => done()))
        },
      })
    })
  })
}
