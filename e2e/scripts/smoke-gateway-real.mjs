// 真实全链路冒烟：REST 配对 → 手机经 gateway → 隧道内 /mobile 全协议
// 前置：gateway(dev, :3781) + dsh companion profile(uplink) 已启动
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import WebSocket from 'ws'

const GATEWAY_HTTP = process.env.GATEWAY_HTTP ?? 'http://127.0.0.1:3781'
const GATEWAY_WS = GATEWAY_HTTP.replace(/^http/, 'ws')
const CODE = process.env.PAIRING_CODE ?? JSON.parse(readFileSync(`${homedir()}/.dsh-companion/bridge-state.json`, 'utf8')).pairingCode

const fail = (msg) => { console.error('✗', msg); process.exit(1) }

// 1. REST 配对（dev token）
const bindRes = await fetch(`${GATEWAY_HTTP}/api/v1/pairing/bind`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'Bearer dev:smoke_user' },
  body: JSON.stringify({ code: CODE, name: '冒烟 Mac' }),
})
const bind = await bindRes.json()
if (!bindRes.ok) fail(`bind 失败: ${JSON.stringify(bind)}`)
console.log('✓ REST 配对（挑战→Worker 比对配对码→写库）:', JSON.stringify(bind))

// 2. 手机 WS
const ws = new WebSocket(`${GATEWAY_WS}/gw/phone`)
const frames = []
const waiters = []
ws.on('message', (d) => {
  const f = JSON.parse(String(d))
  frames.push(f)
  waiters.splice(0).forEach((w) => w(f))
})
const next = (pred, label) => new Promise((resolve, reject) => {
  const hit = frames.find(pred)
  if (hit) return resolve(hit)
  const t = setTimeout(() => reject(new Error(`timeout: ${label}`)), 10000)
  waiters.push((f) => { if (pred(f)) { clearTimeout(t); resolve(f) } })
})
const rpcInner = (workerId, id, ns, method, args) =>
  ws.send(JSON.stringify({ kind: 'worker-frame', workerId, inner: JSON.stringify({ kind: 'rpc', request: { id, ns, method, args } }) }))

ws.on('open', async () => {
  try {
    ws.send(JSON.stringify({ kind: 'phone-auth', authToken: 'dev:smoke_user', deviceKey: 'smoke-device' }))
    await next((f) => f.kind === 'auth-ok', 'auth-ok')
    console.log('✓ phone-auth（dev 伪终北 token）')

    const presence = await next((f) => f.kind === 'presence', 'presence')
    const worker = presence.workers[0]
    if (!worker?.online) fail(`presence 异常: ${JSON.stringify(presence)}`)
    console.log(`✓ presence: ${worker.name} 在线 (${worker.workerId})`)

    // REST workers 列表一致性
    const workersRes = await fetch(`${GATEWAY_HTTP}/api/v1/workers`, { headers: { authorization: 'Bearer dev:smoke_user' } })
    const workers = await workersRes.json()
    console.log(`✓ REST /workers: ${workers.workers.length} 台, name=${workers.workers[0]?.name}`)

    ws.send(JSON.stringify({ kind: 'worker-open', workerId: worker.workerId }))
    const opened = await next((f) => f.kind === 'worker-open-result', 'worker-open-result')
    if (!opened.ok) fail(`worker-open 被拒: ${JSON.stringify(opened)}`)
    console.log('✓ worker-open（配对校验通过，隧道建立）')

    rpcInner(worker.workerId, 'h1', 'handshake', 'hello', { client: 'smoke-real', protocolVersion: 'mobile/v1' })
    const hs = await next((f) => f.kind === 'worker-frame' && f.inner.includes('"h1"'), 'handshake')
    const host = JSON.parse(hs.inner).response.result.host
    console.log(`✓ 隧道内 handshake: worker=${host.name} caps=${JSON.stringify(host.capabilities)}`)

    rpcInner(worker.workerId, 'l1', 'sessions', 'list', {})
    const list = await next((f) => f.kind === 'worker-frame' && f.inner.includes('"l1"'), 'sessions.list')
    const sessions = JSON.parse(list.inner).response.result.sessions
    console.log(`✓ 隧道内 sessions.list（真实 dsh）: ${sessions.length} 个会话, 示例=${sessions[0]?.cwd ?? '无'}`)

    console.log('\n=== 真实 gateway 全链路冒烟通过 ===')
    ws.close()
    process.exit(0)
  } catch (e) {
    fail(e.message)
  }
})
ws.on('error', (e) => fail(`WS error: ${e.message}`))
