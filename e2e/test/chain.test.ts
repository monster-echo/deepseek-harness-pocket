/**
 * e2e 链路测试：
 * 1. 直连链路：手机 WS → 直连 server → BridgeHub → 假 dsh adapter
 * 2. Gateway 链路：手机 WS → Gateway → uplink → 同一 BridgeHub（全隧道）
 * 3. 配对绑定（REST 挑战 + 6 位码）
 */

import { describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION, type DshSessionEvent } from '@deepseek-harness-pocket/bridge-protocol'
import { makeFakeDsh, startFakeWorker, startTestGateway, TestPhone, sleep } from './helpers'

function fixture(): { sessionId: string; events: DshSessionEvent[] }[] {
  return [
    {
      sessionId: 'sess-e2e-1',
      events: [
        { type: 'turn/start', seq: 0, data: {} },
        { type: 'user/message', seq: 1, data: { content: [{ type: 'text', text: '总结这个仓库' }] } },
        { type: 'assistant/chunk', seq: 2, data: { text: '这个仓库' } },
        { type: 'assistant/chunk', seq: 3, data: { text: '包含三个包。' } },
        { type: 'assistant/message', seq: 4, data: { content: [{ type: 'text', text: '这个仓库包含三个包。' }] } },
        { type: 'tool/call', seq: 5, data: { name: 'bash' } },
        { type: 'tool/result', seq: 6, data: { exitCode: 0 } },
        { type: 'turn/end', seq: 7, data: { reason: 'completed' } },
      ],
    },
  ]
}

describe('直连链路', () => {
  it('auth → handshake → list → open(快照) → send → 审批', async () => {
    const dsh = makeFakeDsh(fixture())
    const worker = await startFakeWorker(dsh, 1, '111222') // gatewayPort=1：uplink 会连失败但不影响直连
    try {
      const phone = new TestPhone(`ws://127.0.0.1:${worker.directPort}/mobile/ws`)
      await phone.opened
      phone.send({ kind: 'auth', token: 'pt_e2e_token' })
      expect((await phone.wait('auth-ok'))['kind']).toBe('auth-ok')

      phone.send({
        kind: 'rpc', request: { id: 'h1', ns: 'handshake', method: 'hello', args: { client: 'e2e', protocolVersion: PROTOCOL_VERSION } },
      })
      const handshake = await phone.wait('rpc-result', (f) => (f['response'] as { id: string }).id === 'h1')
      const host = (handshake['response'] as { result: { host: { name: string; capabilities: Record<string, boolean> } } }).result.host
      expect(host.name).toBe('e2e-worker')
      expect(host.capabilities['turnControl']).toBe(true)

      phone.send({ kind: 'rpc', request: { id: 'l1', ns: 'sessions', method: 'list', args: {} } })
      const list = await phone.wait('rpc-result', (f) => (f['response'] as { id: string }).id === 'l1')
      const sessions = (list['response'] as { result: { sessions: { id: string }[] } }).result.sessions
      expect(sessions.map((s) => s.id)).toContain('sess-e2e-1')

      phone.send({ kind: 'rpc', request: { id: 'o1', ns: 'sessions', method: 'open', args: { sessionId: 'sess-e2e-1' } } })
      const snapshot = await phone.wait('snapshot')
      const events = (snapshot['snapshot'] as { events: DshSessionEvent[] }).events
      expect(events.length).toBe(8) // assistant/chunk 保留（首 token 统计）
      expect(events[1]!.type).toBe('user/message')

      phone.send({ kind: 'rpc', request: { id: 's1', ns: 'messages', method: 'send', args: { sessionId: 'sess-e2e-1', text: '继续' } } })
      await phone.wait('rpc-result', (f) => (f['response'] as { id: string }).id === 's1')
      expect(dsh.sentMessages).toEqual([{ id: 'sess-e2e-1', text: '继续' }])

      // 审批：无手机在线时 pass 的路径在 hub 单测覆盖；这里手机在线
      // 直接调 hub（模拟 dsh approval/request 到达）
      void (async () => {
        await new Promise((r) => setTimeout(r, 50))
        dsh.hub.registerApproval({
          requestId: 'ap_e2e', sessionId: 'sess-e2e-1', toolName: 'bash',
          summary: 'rm -rf /tmp/x', detail: null,
          decide: async () => undefined,
        })
      })()
      const ask = await phone.wait('server-request')
      expect((ask['request'] as { kind: string }).kind).toBe('permission')
      phone.send({ kind: 'rpc', request: { id: 'p1', ns: 'permissions', method: 'respond', args: { requestId: 'ap_e2e', decision: 'allow' } } })
      await phone.wait('rpc-result', (f) => (f['response'] as { id: string }).id === 'p1')
      phone.close()
    } finally {
      await worker.closeAll()
    }
  })
})

describe('Gateway 全链路', () => {
  it('worker uplink → REST 配对 → 手机经 gateway 打开 worker → /mobile 全协议', async () => {
    const gw = await startTestGateway()
    const dsh = makeFakeDsh(fixture())
    const worker = await startFakeWorker(dsh, gw.port, '654321')
    try {
      // 1. 配对（等 uplink 注册完成后重试）
      let bind: Awaited<ReturnType<typeof gw.gateway.bindByCode>> | undefined
      for (let i = 0; i < 20; i += 1) {
        bind = await gw.gateway.bindByCode('user_e2e', '654321', '我的 Mac')
          if (bind.ok) break
        await sleep(100)
      }
      expect(bind?.ok).toBe(true)

      // 2. 手机经 gateway
      const phone = new TestPhone(`ws://127.0.0.1:${gw.port}/gw/phone`)
      await phone.opened
      phone.send({ kind: 'phone-auth', authToken: 'dev:user_e2e', deviceKey: 'e2e-device' })
      await phone.wait('auth-ok')
      const presence = (await phone.wait('presence'))['workers'] as { workerId: string; online: boolean; name: string }[]
      expect(presence.length).toBe(1)
      expect(presence[0]!.online).toBe(true)
      expect(presence[0]!.name).toBe('e2e-worker') // 内存 store 不存配对命名，回退 worker 注册名

      // 3. 打开 worker（经配对校验）→ 隧道内跑 /mobile
      const workerId = presence[0]!.workerId
      phone.send({ kind: 'worker-open', workerId })
      const openResult = await phone.wait('worker-open-result')
      expect(((openResult)['ok'])).toBe(true)

      // worker 端 hub 的 uplink 伪连接是 trusted：auth 帧应通过
      phone.send({ kind: 'worker-frame', workerId, inner: JSON.stringify({ kind: 'auth', token: 'any' }) })

      phone.send({
        kind: 'worker-frame', workerId,
        inner: JSON.stringify({ kind: 'rpc', request: { id: 'g1', ns: 'handshake', method: 'hello', args: { client: 'e2e', protocolVersion: PROTOCOL_VERSION } } }),
      })
      const hs = await phone.wait('worker-frame', (f) => {
        const inner = f['inner'] as string
        return inner.includes('"g1"')
      })
      const inner = JSON.parse(hs['inner'] as string) as { response: { result: { host: { name: string } } } }
      expect(inner.response.result.host.name).toBe('e2e-worker')

      phone.send({
        kind: 'worker-frame', workerId,
        inner: JSON.stringify({ kind: 'rpc', request: { id: 'g2', ns: 'sessions', method: 'open', args: { sessionId: 'sess-e2e-1' } } }),
      })
      const snap = await phone.wait('worker-frame', (f) => (f['inner'] as string).includes('"snapshot"'))
      const snapInner = JSON.parse(snap['inner'] as string) as { snapshot: { events: DshSessionEvent[] } }
      expect(snapInner.snapshot.events.length).toBe(8) // 同上
      phone.close()
    } finally {
      await worker.closeAll()
      await gw.close()
    }
  })

  it('未配对用户打开 worker 被拒', async () => {
    const gw = await startTestGateway()
    const dsh = makeFakeDsh(fixture())
    const worker = await startFakeWorker(dsh, gw.port, '999111')
    try {
      const phone = new TestPhone(`ws://127.0.0.1:${gw.port}/gw/phone`)
      await phone.opened
      phone.send({ kind: 'phone-auth', authToken: 'dev:other_user', deviceKey: 'd' })
      await phone.wait('auth-ok')
      const anyWorker = (await phone.wait('presence'))['workers'] as { workerId: string }[]
      // other_user 未配对 → presence 为空；worker-open 任意 id 被拒
      expect(anyWorker.length).toBe(0)
      phone.send({ kind: 'worker-open', workerId: 'w_whatever' })
      const result = await phone.wait('worker-open-result')
      expect(result['ok']).toBe(false)
      phone.close()
    } finally {
      await worker.closeAll()
      await gw.close()
    }
  })
})
