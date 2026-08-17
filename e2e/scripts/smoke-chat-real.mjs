// 真实 DeepSeek 对话冒烟：手机模拟 → 创建 workspace/会话 → 发消息 → 流式事件 → 审批
// 前置：gateway(:3781) + dshc --caps m3（DEEPSEEK_API_KEY 已注入）
import WebSocket from 'ws'

const DIRECT = process.env.DIRECT === '1'
const GATEWAY_WS = 'ws://127.0.0.1:3781'
const fail = (msg) => { console.error('✗', msg); process.exit(1) }

const ws = new WebSocket(DIRECT ? 'ws://127.0.0.1:3780/mobile/ws' : `${GATEWAY_WS}/gw/phone`)
const frames = []
const waiters = []
ws.on('message', (d) => {
  const f = JSON.parse(String(d))
  frames.push(f)
  // 快照与 rpc-result 常在同一 tick 连发：不匹配的 waiter 必须留在队列里
  for (const w of [...waiters]) w(f)
})
const next = (pred, label, timeoutMs = 15000) => new Promise((resolve, reject) => {
  const hit = frames.find(pred)
  if (hit) return resolve(hit)
  const waiter = (f) => {
    if (pred(f)) {
      const i = waiters.indexOf(waiter)
      if (i >= 0) waiters.splice(i, 1)
      clearTimeout(t)
      resolve(f)
    }
  }
  const t = setTimeout(() => {
    const i = waiters.indexOf(waiter)
    if (i >= 0) waiters.splice(i, 1)
    reject(new Error(`timeout: ${label}`))
  }, timeoutMs)
  waiters.push(waiter)
})
let rpcSeq = 0
const wrap = (inner) => JSON.stringify(DIRECT ? inner : { kind: 'worker-frame', workerId, inner: JSON.stringify(inner) })
const unwrap = (f) => (DIRECT ? f : (f.kind === 'worker-frame' ? JSON.parse(f.inner) : null))
const rpc = (workerId_, ns, method, args) => {
  const id = `r${++rpcSeq}`
  ws.send(wrap({ kind: 'rpc', request: { id, ns, method, args } }))
  return next((f) => { const u = unwrap(f); return u !== null && u.kind === 'rpc-result' && u.response.id === id }, `${ns}.${method}`)
}

let workerId = null
const eventStats = {}
let assistantText = ''

ws.on('open', async () => {
  try {
    if (DIRECT) {
      const { promises: fsp } = await import('node:fs')
      const { homedir } = await import('node:os')
      const state = JSON.parse(await fsp.readFile(`${homedir()}/.dsh-companion/bridge-state.json`, 'utf8'))
      ws.send(JSON.stringify({ kind: 'auth', token: state.pairingToken }))
    } else {
      ws.send(JSON.stringify({ kind: 'phone-auth', authToken: 'dev:smoke_user', deviceKey: 'chat-smoke' }))
    }
    await next((f) => f.kind === 'auth-ok', 'auth-ok')
    if (DIRECT) {
      await next((f) => f.kind === 'auth-ok', 'direct auth-ok')
      console.log('✓ 直连 auth-ok')
    } else {
      const presence = await next((f) => f.kind === 'presence' && f.workers.some((w) => w.online), 'presence online', 20000)
      workerId = presence.workers.find((w) => w.online).workerId
      console.log('✓ worker 在线:', workerId)
      ws.send(JSON.stringify({ kind: 'worker-open', workerId }))
      const opened = await next((f) => f.kind === 'worker-open-result' && f.workerId === workerId, 'worker-open')
      if (!opened.ok) fail(`worker-open: ${JSON.stringify(opened)}`)
      console.log('✓ worker-open')
    }

    // handshake 验证 m3
    const hs = await rpc(workerId, 'handshake', 'hello', { client: 'chat-smoke', protocolVersion: 'mobile/v1' })
    const host = unwrap(hs).response.result.host
    if (!host.capabilities.sessionCreate) fail(`caps 非 m3: ${JSON.stringify(host.capabilities)}`)
    console.log('✓ handshake caps=m3')

    // 添加 workspace（幂等）
    const wsAdd = await rpc(workerId, 'workspaces', 'add', { path: '/tmp/dsh-demo-project' })
    const workspace = unwrap(wsAdd).response.result.workspace
    console.log('✓ workspace:', workspace.path)

    // 创建会话
    const created = await rpc(workerId, 'sessions', 'create', { cwd: workspace.path })
    const sessionId = unwrap(created).response.result.sessionId
    console.log('✓ 新会话:', sessionId)

    // 打开 + 发消息
    await rpc(workerId, 'sessions', 'open', { sessionId })
    // 监听事件帧
    const onInner = (f) => {
      const inner = unwrap(f)
      if (inner === null) return
      if (inner.kind === 'event') {
        const e = inner.event.event
        eventStats[e.type] = (eventStats[e.type] ?? 0) + 1
        if (e.type === 'assistant/chunk' && typeof e.data?.text === 'string') assistantText += e.data.text
        if (e.type === 'assistant/message') {
          const c = Array.isArray(e.data?.content) ? e.data.content.filter((b) => b.type === 'text').map((b) => b.text).join('') : ''
          if (c.length > 0) assistantText = c
        }
      }
      if (inner.kind === 'server-request') {
        const req = inner.request
        console.log(`⚠ 审批请求到达: ${req.kind === 'permission' ? req.body.summary : req.body.question}`)
        ws.send(wrap({ kind: 'rpc', request: { id: `ap${++rpcSeq}`, ns: req.kind === 'permission' ? 'permissions' : 'questions', method: 'respond', args: req.kind === 'permission' ? { requestId: req.body.requestId, decision: 'allow' } : { requestId: req.body.requestId, answer: '继续' } } }))
      }
    }
    waiters.push(onInner) // 常驻帧监听

    console.log('→ 发送消息（真实 DeepSeek 调用）…')
    const sendResult = await rpc(workerId, 'messages', 'send', { sessionId, text: '请用一句话说明这个项目是做什么的，然后运行 node -e "console.log(require(\'./util\').greet(\'dsh\'))" 并告诉我输出。' })
    if (!unwrap(sendResult).response.ok) fail('send 失败')
    console.log('✓ 消息已入队')

    // 等 turn/end（真实模型，给足时间）
    const turnEnd = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('等待 turn/end 超时（120s）')), 120_000)
      const poll = setInterval(() => {
        if ((eventStats['turn/end'] ?? 0) > 0) {
          clearTimeout(t)
          clearInterval(poll)
          resolve()
        }
      }, 300)
    })
    console.log('✓ 回合完成')
    console.log('\n事件统计:', JSON.stringify(eventStats))
    console.log('\nassistant 回复:', assistantText.slice(0, 600))
    console.log('\n=== 真实 DeepSeek 对话链路通过 ===')
    ws.close()
    process.exit(0)
  } catch (e) {
    fail(e.message)
  }
})
ws.on('error', (e) => fail(`WS: ${e.message}`))
