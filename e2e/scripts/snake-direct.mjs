// 直连驱动 dsh 写贪吃蛇：auth → workspace → session → open → send → 事件流 + 自动审批 → 验证产物
// 用法: node scripts/snake-direct.mjs [项目目录] （默认 ~/workspace/snake-game）
import WebSocket from 'ws'
import { promises as fsp } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DIR = process.argv[2] ?? join(homedir(), 'workspace', 'snake-game')
const PROMPT = `写一个贪吃蛇游戏，用单个 HTML 文件（内联 CSS/JS），保存到 ${DIR}/snake.html，功能完整（方向键控制、吃食物增长、撞墙/撞自己结束、分数显示、游戏结束重开）。完成后运行结束前不要询问我，自行完成全部工作。`

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
const ok = (r, label) => { if (r?.ok === false) { console.error(`✗ ${label}:`, JSON.stringify(r.error)); process.exit(1) } return r.result }

// 事件流观察 + 自动审批/答题（演示项目，全部放行）
const sawTools = new Set()
ws.on('message', (d) => {
  const f = JSON.parse(String(d))
  if (f.kind === 'event') {
    const e = f.event.event
    if (e.type === 'tool/call') { sawTools.add(String(e.data?.name)); console.log(`  [tool] ${e.data?.name}`) }
    else if (e.type === 'turn/end') console.log(`  [turn-end]`, JSON.stringify(e.data)?.slice(0, 160))
  } else if (f.kind === 'server-request') {
    const req = f.request
    console.log(`  [ask] ${req.kind}:`, JSON.stringify(req.body).slice(0, 160))
    if (req.kind === 'permission') void rpc('permissions', 'respond', { requestId: req.body.requestId, decision: 'allow-always' })
    else if (req.kind === 'question') void rpc('questions', 'respond', { requestId: req.body.requestId, answer: '' })
  }
})

ws.on('open', async () => {
  try {
    ws.send(JSON.stringify({ kind: 'auth', token: state.pairingToken }))
    await next((f) => f.kind === 'auth-ok', 'auth-ok')
    console.log('[auth-ok]')

    const wsAdded = ok(await rpc('workspaces', 'add', { path: DIR }), 'workspaces.add')
    console.log('[workspace]', JSON.stringify(wsAdded))

    const created = ok(await rpc('sessions', 'create', { cwd: DIR, provider: 'deepseek-official', model: 'deepseek-v4-flash' }), 'sessions.create')
    const sessionId = created.sessionId
    console.log('[session]', sessionId)

    ok(await rpc('sessions', 'open', { sessionId }), 'sessions.open')
    console.log('[open] 已订阅事件流')

    ok(await rpc('messages', 'send', { sessionId, text: PROMPT }), 'messages.send')
    console.log('[sent] 贪吃蛇需求 → deepseek-v4-flash\n--- 事件流 ---')

    const deadline = Date.now() + 300_000
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000))
      const list = ok(await rpc('sessions', 'list', {}), 'sessions.list')
      const s = list.sessions.find((x) => x.id === sessionId)
      if (s && s.agentStatus === 'idle') break
    }
    console.log('--- 事件流结束 ---')
    console.log('[tools used]', [...sawTools].join(', ') || '(无)')

    const files = ok(await rpc('fs', 'list', { path: DIR }), 'fs.list')
    console.log('[产物]', JSON.stringify(files))
    ws.close()
    process.exit(0)
  } catch (e) {
    console.error('✗', e.message)
    process.exit(1)
  }
})
ws.on('error', (e) => { console.error('ws error:', e.message); process.exit(1) })
