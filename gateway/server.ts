/**
 * Gateway 入口：自定义 server 统一承载
 *   - /api/v1/*   REST（配对/Worker 列表/push token/健康检查）
 *   - /gw/worker  Worker uplink（WS upgrade）
 *   - /gw/phone   手机接入（WS upgrade）
 *   - 其余        Next.js（管理面 UI，未来控制台）
 *
 * 部署：Docker 自托管（不能 Vercel——需要持久 WS）；TLS 由前置反代/平台负责。
 */

import createNextServerRaw from 'next/dist/server/next.js'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket, WebSocketServer } from 'ws'
import { loadConfig } from './src/server/config.js'
import { createAuthVerifier } from './src/server/auth-verify.js'
import { createPushSender } from './src/server/notify.js'
import { createStore } from './src/server/store.js'
import { Gateway } from './src/server/gateway.js'
import { createApiRouter } from './src/server/api.js'
import { runMigrations } from './src/server/migrate.js'

/** Next 16 程序化 server 的最小接口（类型出口解析异常，这里收窄）。 */
interface NextApp {
  getRequestHandler(): (req: IncomingMessage, res: ServerResponse) => Promise<void>
  prepare(): Promise<void>
  close(): Promise<void>
}
const createNextServer = createNextServerRaw as unknown as (options: {
  dev: boolean
  hostname: string
  port: number
}) => NextApp

const here = dirname(fileURLToPath(import.meta.url))
const dev = process.env['NODE_ENV'] !== 'production'

async function main(): Promise<void> {
  const config = loadConfig()
  await runMigrations(config.databaseUrl, join(here, 'migrations'))

  const store = createStore(config.databaseUrl)
  const gateway = new Gateway(config, store, createAuthVerifier(config), createPushSender(config, store))
  const api = createApiRouter({ config, store, gateway })

  const app = createNextServer({ dev, hostname: config.hostname, port: config.port })
  const handle = app.getRequestHandler()
  await app.prepare()

  const server = createServer((req, res) => {
    void api(req, res).then((handled) => {
      if (!handled) void handle(req, res)
    })
  })

  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 })
  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const path = (req.url ?? '').split('?')[0]
    if (path === '/gw/worker' || path === '/gw/phone') {
      wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
        if (path === '/gw/worker') gateway.attachWorker(ws)
        else gateway.attachPhone(ws)
      })
      return
    }
    socket.destroy()
  })

  const heartbeat = setInterval(() => gateway.heartbeat(), 25_000)

  server.listen(config.port, config.hostname, () => {
    console.log(`deepseek-harness-pocket gateway on http://${config.hostname}:${config.port} (ws: /gw/worker, /gw/phone)`)
  })

  const shutdown = (): void => {
    clearInterval(heartbeat)
    for (const client of wss.clients) client.terminate()
    server.close()
    void store.close()
    setTimeout(() => process.exit(0), 3000)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

void main().catch((error: unknown) => {
  console.error(`gateway: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
