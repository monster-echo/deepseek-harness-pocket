// 直连验证 preview：fs.list（含文件）→ preview 帧（begin/chunk/end）→ 与磁盘文件比对
// 帧收发用缓冲数组（先落地后匹配），避免 waiter 注册竞态。
import WebSocket from 'ws'
import { promises as fsp } from 'node:fs'
import { homedir } from 'node:os'

const DIR = '/Volumes/MacMiniDisk/workspace/snake-game'
const FILE = `${DIR}/snake.html`

const state = JSON.parse(await fsp.readFile(`${homedir()}/.deepseek-harness-pocket/bridge-state.json`, 'utf8'))
const ws = new WebSocket('ws://127.0.0.1:3780/mobile/ws')
const frames = []
const waiters = []
ws.on('message', (d) => {
  const f = JSON.parse(String(d))
  frames.push(f)
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
    reject(new Error('timeout: ' + label))
  }, timeoutMs)
  waiters.push(waiter)
})
let seq = 0
const rpc = (ns, method, args = {}) => {
  const id = `v${++seq}`
  ws.send(JSON.stringify({ kind: 'rpc', request: { id, ns, method, args } }))
  return next((f) => f.kind === 'rpc-result' && f.response?.id === id, `${ns}.${method}`).then((f) => f.response)
}

ws.on('open', async () => {
  try {
    ws.send(JSON.stringify({ kind: 'auth', token: state.pairingToken }))
    await next((f) => f.kind === 'auth-ok', 'auth-ok')

    const list = await rpc('fs', 'list', { path: DIR })
    const entries = list.result?.entries ?? []
    console.log('[fs.list] entries:', JSON.stringify(entries))
    if (!entries.some((e) => e.type === 'file' && e.name === 'snake.html')) throw new Error('snake.html 未出现在 entries')
    console.log('[fs.list] dirs 兼容字段:', JSON.stringify(list.result?.dirs ?? []))

    ws.send(JSON.stringify({ kind: 'preview', requestId: 'pv-test', path: FILE }))
    const begin = await next((f) => f.kind === 'preview-begin' && f.requestId === 'pv-test', 'preview-begin')
    console.log('[preview-begin]', begin.mime, begin.bytes, 'B')

    const terminal = await next(
      (x) => x.requestId === 'pv-test' && (x.kind === 'preview-end' || x.kind === 'preview-error'),
      'preview-end',
    )
    if (terminal.kind === 'preview-error') throw new Error(`preview-error ${terminal.code}: ${terminal.message}`)

    const chunks = frames.filter((f) => f.kind === 'preview-chunk' && f.requestId === 'pv-test')
    const received = Buffer.from(chunks.map((c) => c.dataBase64).join(''), 'base64')
    const onDisk = await fsp.readFile(FILE)
    const same = received.equals(onDisk)
    console.log(`[preview-end] chunks=${chunks.length} 收到 ${received.byteLength}B / 磁盘 ${onDisk.byteLength}B → ${same ? '一致 ✅' : '不一致 ❌'}`)
    ws.close()
    process.exit(same ? 0 : 1)
  } catch (e) {
    console.error('✗', e.message)
    process.exit(1)
  }
})
ws.on('error', (e) => { console.error('ws error:', e.message); process.exit(1) })
