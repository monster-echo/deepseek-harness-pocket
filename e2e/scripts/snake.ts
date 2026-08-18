/**
 * 端到端：新建 workspace → 创建 session → 让 dsh 写贪吃蛇游戏。
 * 打印事件流关键节点（user/message、tool/call、assistant/message、turn/end）。
 */
import { PROTOCOL_VERSION } from '@deepseek-harness-pocket/bridge-protocol'
import { TestPhone } from '../test/helpers'

async function main() {
  const phone = new TestPhone('ws://127.0.0.1:3781/gw/phone')
  await phone.opened
  phone.send({ kind: 'phone-auth', authToken: 'dev:smoke_user', deviceKey: 'snake' })
  await phone.wait('auth-ok')
  const presence = (await phone.wait('presence'))['workers'] as { workerId: string; online: boolean }[]
  const workerId = presence.find((w) => w.online)!.workerId
  phone.send({ kind: 'worker-open', workerId })
  await phone.wait('worker-open-result')
  console.log('[ok] worker opened', workerId)

  const rpc = async (ns: string, method: string, args: Record<string, unknown> = {}) => {
    const id = `r-${ns}.${method}`
    phone.send({ kind: 'worker-frame', workerId, inner: JSON.stringify({ kind: 'rpc', request: { id, ns, method, args } }) })
    const frame = await phone.wait('worker-frame', (f) => (f['inner'] as string).includes(`"${id}"`))
    return JSON.parse(frame['inner'] as string)
  }

  // 1. 新建 workspace（干净目录）
  const ws = await rpc('workspaces', 'add', { path: '/tmp/snake-demo' })
  console.log('[ws]', JSON.stringify(ws.response))

  // 2. 创建 session（挂 agent）
  const created = await rpc('sessions', 'create', { cwd: '/tmp/snake-demo', provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  const sessionId = (created.response as { result: { sessionId: string } }).result.sessionId
  console.log('[session] created', sessionId)

  // 3. 监听事件流（订阅）
  const sawTool = new Set<string>()
  phone.wait('worker-frame', (f) => {
    const inner = f['inner'] as string
    if (!inner.includes('"event"')) return false
    const ev = JSON.parse(inner) as { event: { event: { type: string; seq: number; data?: Record<string, unknown> } } }
    const e = ev.event.event
    if (e.type === 'user/message') {
      console.log('[user]', JSON.stringify(e.data?.content))
    } else if (e.type === 'tool/call') {
      const d = e.data ?? {}
      console.log('[tool]', d['name'], d['arguments'] ? String(d['arguments']).slice(0, 120) : '')
      sawTool.add(String(d['name']))
    } else if (e.type === 'tool/result') {
      const d = e.data ?? {}
      console.log('[tool-result]', JSON.stringify(d).slice(0, 120))
    } else if (e.type === 'assistant/message') {
      const content = e.data?.content
      if (Array.isArray(content)) {
        for (const b of content as { type?: string; text?: string }[]) {
          if (b.type === 'text' && b.text) console.log('[assistant]', b.text.slice(0, 200))
        }
      }
    } else if (e.type === 'turn/end') {
      console.log('[turn-end]', JSON.stringify(e.data))
    }
    return false
  }).catch(() => undefined)

  // 4. 发送贪吃蛇需求
  const msg = '写一个贪吃蛇游戏，用单个 HTML 文件（内联 CSS/JS），保存到 /tmp/snake-demo/snake.html，功能完整（方向键控制、吃食物增长、撞墙/撞自己结束、分数显示）。'
  await rpc('messages', 'send', { sessionId, text: msg })
  console.log('[sent] 贪吃蛇需求')

  // 5. 等待 turn 结束（最多 180s）
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000))
    const list = await rpc('sessions', 'list', {})
    const sessions = (list.response as { result: { sessions: { id: string; agentStatus: string | null }[] } }).result.sessions
    const s = sessions.find((x) => x.id === sessionId)
    if (s && s.agentStatus === 'idle') break
  }
  console.log('[done] turn 结束，工具调用:', [...sawTool].join(', '))

  // 6. 验证文件是否生成
  const fs = await rpc('fs', 'list', { path: '/tmp/snake-demo' })
  console.log('[fs]', JSON.stringify(fs.response))
  phone.close()
  process.exit(0)
}

void main()
