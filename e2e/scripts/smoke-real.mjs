// 真实链路冒烟：假手机 → 直连插件(127.0.0.1:3780) → 真实 dsh
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import WebSocket from 'ws'

const state = JSON.parse(readFileSync(`${homedir()}/.deepseek-harness-pocket/bridge-state.json`, 'utf8'))
const ws = new WebSocket('ws://127.0.0.1:3780/mobile/ws')
const waiters = []
const frames = []
ws.on('message', (d) => {
  const f = JSON.parse(String(d))
  frames.push(f)
  waiters.splice(0).forEach((w) => w(f))
})
const next = (pred, label) => new Promise((resolve, reject) => {
  const hit = frames.find(pred)
  if (hit) return resolve(hit)
  const timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), 8000)
  waiters.push((f) => { if (pred(f)) { clearTimeout(timer); resolve(f) } })
})
const rpc = (id, ns, method, args) => ws.send(JSON.stringify({ kind: 'rpc', request: { id, ns, method, args } }))

ws.on('open', async () => {
  try {
    ws.send(JSON.stringify({ kind: 'auth', token: state.pairingToken }))
    await next((f) => f.kind === 'auth-ok', 'auth-ok')
    console.log('✓ auth-ok（真实 pairing token 常量时间校验通过）')

    rpc('h1', 'handshake', 'hello', { client: 'smoke', protocolVersion: 'mobile/v1' })
    const hs = await next((f) => f.kind === 'rpc-result' && f.response.id === 'h1', 'handshake')
    console.log('✓ handshake:', JSON.stringify(hs.response.result.host))

    rpc('l1', 'sessions', 'list', {})
    const list = await next((f) => f.kind === 'rpc-result' && f.response.id === 'l1', 'sessions.list')
    console.log('✓ sessions.list（真实 dsh ctx.sessions）:', JSON.stringify(list.response.result).slice(0, 200))

    console.log('\n=== 真实链路冒烟通过 ===')
    ws.close()
    process.exit(0)
  } catch (e) {
    console.error('✗', e.message)
    process.exit(1)
  }
})
