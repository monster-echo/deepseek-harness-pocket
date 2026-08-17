// fs.list 冒烟：验证目录树接口（经 gateway 隧道）
import WebSocket from 'ws'
const ws = new WebSocket('ws://127.0.0.1:3781/gw/phone')
const frames = []
const waiters = []
ws.on('message', (d) => { const f = JSON.parse(String(d)); frames.push(f); for (const w of [...waiters]) w(f) })
const next = (pred, ms = 15000) => new Promise((res, rej) => {
  const hit = frames.find(pred)
  if (hit) return res(hit)
  const waiter = (f) => { if (pred(f)) { const i = waiters.indexOf(waiter); if (i >= 0) waiters.splice(i, 1); clearTimeout(t); res(f) } }
  const t = setTimeout(() => { const i = waiters.indexOf(waiter); if (i >= 0) waiters.splice(i, 1); rej(new Error('timeout')) }, ms)
  waiters.push(waiter)
})
let seq = 0
const rpc = (workerId, ns, method, args) => {
  const id = `f${++seq}`
  ws.send(JSON.stringify({ kind: 'worker-frame', workerId, inner: JSON.stringify({ kind: 'rpc', request: { id, ns, method, args } }) }))
  return next((f) => f.kind === 'worker-frame' && f.inner.includes(`"${id}"`))
}
ws.on('open', async () => {
  try {
    ws.send(JSON.stringify({ kind: 'phone-auth', authToken: 'dev:smoke_user', deviceKey: 'fs' }))
    await next((f) => f.kind === 'auth-ok')
    const presence = await next((f) => f.kind === 'presence' && f.workers.some((w) => w.online))
    const workerId = presence.workers.find((w) => w.online).workerId
    ws.send(JSON.stringify({ kind: 'worker-open', workerId }))
    await next((f) => f.kind === 'worker-open-result' && f.ok)
    const home = await rpc(workerId, 'fs', 'home', {})
    const homePath = JSON.parse(home.inner).response.result.home
    console.log('✓ home:', homePath)
    const list = await rpc(workerId, 'fs', 'list', { path: homePath })
    const dirs = JSON.parse(list.inner).response.result.dirs
    console.log(`✓ ${homePath} 下 ${dirs.length} 个目录:`, dirs.slice(0, 8).map((d) => d.name).join(', '))
    const ws2 = await rpc(workerId, 'fs', 'list', { path: '/Volumes/MacMiniDisk/workspace' })
    const dirs2 = JSON.parse(ws2.inner).response.result.dirs
    console.log(`✓ workspace 下 ${dirs2.length} 个目录:`, dirs2.slice(0, 6).map((d) => d.name).join(', '), '…')
    console.log('=== 目录树接口通过 ===')
    process.exit(0)
  } catch (e) { console.error('✗', e.message); process.exit(1) }
})
