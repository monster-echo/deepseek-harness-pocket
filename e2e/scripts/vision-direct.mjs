// 端到端 vision 冒烟：上传截图 → vision-exp 模型会话 → 带图提问 → 验证描述了图片内容
import WebSocket from 'ws'
import { promises as fsp } from 'node:fs'
import { homedir } from 'node:os'

const IMG = process.argv[2] ?? '/tmp/snake-initial.png'
const MODEL = process.argv[3] ?? 'deepseek-v4-flash-vision-exp'
const PROMPT = '这张截图里是什么？简短描述界面元素和中间的文字。'

const imgB64 = (await fsp.readFile(IMG)).toString('base64')
const state = JSON.parse(await fsp.readFile(`${homedir()}/.deepseek-harness-pocket/bridge-state.json`, 'utf8'))
const ws = new WebSocket('ws://127.0.0.1:3780/mobile/ws')
const frames = []
const waiters = []
ws.on('message', (d) => { const f = JSON.parse(String(d)); frames.push(f); for (const w of [...waiters]) w(f) })
const next = (pred, label, timeoutMs = 30000) => new Promise((resolve, reject) => {
  const hit = frames.find(pred)
  if (hit) return resolve(hit)
  const waiter = (f) => { if (pred(f)) { const i = waiters.indexOf(waiter); if (i >= 0) waiters.splice(i, 1); clearTimeout(t); resolve(f) } }
  const t = setTimeout(() => { const i = waiters.indexOf(waiter); if (i >= 0) waiters.splice(i, 1); reject(new Error('timeout: ' + label)) }, timeoutMs)
  waiters.push(waiter)
})
let seq = 0
const rpc = (ns, method, args = {}) => {
  const id = `w${++seq}`
  ws.send(JSON.stringify({ kind: 'rpc', request: { id, ns, method, args } }))
  return next((f) => f.kind === 'rpc-result' && f.response?.id === id, `${ns}.${method}`).then((f) => f.response)
}
const ok = (r, label) => { if (r?.ok === false) { console.error(`✗ ${label}:`, JSON.stringify(r.error)); process.exit(1) } return r.result }

ws.on('open', async () => {
  try {
    ws.send(JSON.stringify({ kind: 'auth', token: state.pairingToken }))
    await next((f) => f.kind === 'auth-ok', 'auth-ok')

    const up = ok(await rpc('attachments', 'upload', { dataB64: imgB64, mediaType: 'image/png', name: 'screenshot.png' }), 'upload')
    console.log('[upload] ref:', JSON.stringify(up.ref).slice(0, 160))

    const models = ok(await rpc('models', 'list', {}), 'models')
    const vision = models.providers[0].models.filter((m) => (m.inputModalities ?? []).includes('image')).map((m) => m.id)
    console.log('[vision 模型]', vision.join(', '))
    if (!vision.includes(MODEL)) throw new Error(`目标模型 ${MODEL} 不在 vision 列表`)

    const created = ok(await rpc('sessions', 'create', { cwd: '/tmp', provider: 'deepseek-official', model: MODEL }), 'create')
    const sessionId = created.sessionId
    console.log('[session]', sessionId)
    ok(await rpc('sessions', 'open', { sessionId }), 'open')

    ok(await rpc('messages', 'send', { sessionId, text: PROMPT, images: [up.ref] }), 'send')
    console.log('[sent] 带图提问 →', MODEL)

    const deadline = Date.now() + 240_000
    outer: while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000))
      const list = ok(await rpc('sessions', 'list', {}), 'list')
      if (list.sessions.find((x) => x.id === sessionId)?.agentStatus === 'idle') break outer
    }
    // 快照取最后 assistant 文本
    const snap = await next((f) => f.kind === 'snapshot' && f.snapshot.sessionId === sessionId, 'snapshot', 20000)
    const events = snap.snapshot.events
    let answer = ''
    for (const e of events) {
      if (e.type === 'assistant/message') {
        for (const b of e.data?.message?.content ?? []) {
          if (b.type === 'text' && b.text) answer = b.text
        }
      }
    }
    console.log('--- assistant 回答 ---')
    console.log(answer.slice(0, 600) || '(无文本回复)')
    ws.close()
    process.exit(answer.length > 0 ? 0 : 1)
  } catch (e) {
    console.error('✗', e.message)
    process.exit(1)
  }
})
ws.on('error', (e) => { console.error('ws error:', e.message); process.exit(1) })
