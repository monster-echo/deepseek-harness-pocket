import WebSocket from 'ws'
import { promises as fsp } from 'node:fs'
import { homedir } from 'node:os'
const SESSION = 'session-55faa895-e8b7-4f65-8f80-7de42f053ba1'
const state = JSON.parse(await fsp.readFile(`${homedir()}/.deepseek-harness-pocket/bridge-state.json`, 'utf8'))
const ws = new WebSocket('ws://127.0.0.1:3780/mobile/ws')
const waiters = []
ws.on('message', (d) => { for (const w of [...waiters]) w(JSON.parse(String(d))) })
const next = (pred, label, timeoutMs = 30000) => new Promise((resolve, reject) => {
  const waiter = (f) => { if (pred(f)) { const i = waiters.indexOf(waiter); if (i >= 0) waiters.splice(i, 1); clearTimeout(t); resolve(f) } }
  const t = setTimeout(() => { const i = waiters.indexOf(waiter); if (i >= 0) waiters.splice(i, 1); reject(new Error('timeout: ' + label)) }, timeoutMs)
  waiters.push(waiter)
})
let seq = 0
const rpc = (ns, method, args = {}) => {
  const id = `s${++seq}`
  ws.send(JSON.stringify({ kind: 'rpc', request: { id, ns, method, args } }))
  return next((f) => f.kind === 'rpc-result' && f.response?.id === id, `${ns}.${method}`).then((f) => f.response)
}
ws.on('open', async () => {
  ws.send(JSON.stringify({ kind: 'auth', token: state.pairingToken }))
  await next((f) => f.kind === 'auth-ok', 'auth-ok')
  await rpc('sessions', 'open', { sessionId: SESSION })
  await rpc('messages', 'send', { sessionId: SESSION, text: '用一句话说说你刚才给贪吃蛇加了什么音效和动效?' })
  console.log('[sent]')
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000))
    const list = await rpc('sessions', 'list', {})
    const s = list.result.sessions.find((x) => x.id === SESSION)
    if (s && s.agentStatus === 'idle') break
  }
  console.log('[done]')
  ws.close(); process.exit(0)
})
