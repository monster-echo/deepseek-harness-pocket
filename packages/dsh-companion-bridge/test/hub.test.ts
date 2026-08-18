import { describe, expect, it } from 'vitest'
import { BridgeHub, capsForLevel } from '../src/plugin/hub.js'
import type { ApprovalAsk, DshAdapter, QuestionAsk, SessionSlice, SessionSummary } from '../src/plugin/adapter-dsh.js'
import { generateBridgeState, verifyToken, loadBridgeState, rotatePairing } from '../src/plugin/state.js'
import { PROTOCOL_VERSION } from '@dsh-companion/bridge-protocol'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function makeAdapter(events: { sessionId: string; event: { type: string; seq: number } }[] = []): DshAdapter & {
  sent: { id: string; text: string }[]
  stopped: string[]
} {
  const sent: { id: string; text: string }[] = []
  return {
    sent,
    stopped: [],
    caps: { persistence: true, agents: true, approval: true, userQuestions: true },
    dshVersion: () => null,
    async listSessions(): Promise<SessionSummary[]> {
      return [
        { id: 's1', createdAt: 1, lastActivityAt: 1, cwd: '/tmp', lastSeq: 1, live: true, agentStatus: 'idle' },
        { id: 's2', createdAt: 2, lastActivityAt: 2, cwd: null, lastSeq: -1, live: false, agentStatus: null },
      ]
    },
    async readSlice(id: string, fromSeq: number): Promise<SessionSlice | null> {
      if (id !== 's1') return null
      const all = events.filter((e) => e.sessionId === 's1').map((e) => e.event)
      const slice = all.filter((e) => e.seq >= fromSeq)
      return { id, fromSeq, toSeq: slice.length > 0 ? slice[slice.length - 1]!.seq : fromSeq - 1, events: slice as never }
    },
    async sendUserMessage(id: string, text: string): Promise<void> {
      sent.push({ id, text })
    },
    async stopTurn(id: string): Promise<void> {
      ;(this as { stopped: string[] }).stopped.push(id)
    },
    onEvent(): () => void {
      return () => undefined
    },
    onSessionsChanged(): () => void {
      return () => undefined
    },
    registerApprovalAsker(): (() => void) | null {
      return () => undefined
    },
    registerQuestionAsker(): (() => void) | null {
      return () => undefined
    },
  }
}

function makeHub(adapter: DshAdapter, level: 'm1' | 'm2' | 'm3' = 'm2', readOnly = false): BridgeHub {
  return new BridgeHub(adapter, {
    workerName: 'test-worker',
    fingerprint: 'fp_test',
    capsLevel: level,
    readOnly,
    pairingToken: 'pt_secret',
    verifyToken,
    now: () => 42,
  })
}

describe('state', () => {
  it('生成-落盘-读取往返', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dshc-state-'))
    const file = join(dir, 'state.json')
    const state = loadBridgeState(file)!
    expect(state.pairingCode).toMatch(/^\d{6}$/)
    expect(state.hostKey).toMatch(/^hk_/)
    const again = loadBridgeState(file)!
    expect(again.pairingToken).toBe(state.pairingToken)
    const rotated = rotatePairing(again, file)
    expect(rotated.pairingToken).not.toBe(state.pairingToken)
    expect(rotated.hostKey).toBe(state.hostKey)
    rmSync(dir, { recursive: true, force: true })
  })

  it('常量时间校验', () => {
    const s = generateBridgeState()
    expect(verifyToken(s.pairingToken, s.pairingToken)).toBe(true)
    expect(verifyToken(s.pairingToken, 'pt_wrong')).toBe(false)
  })
})

describe('hub', () => {
  it('未认证 RPC 被拒', async () => {
    const hub = makeHub(makeAdapter())
    const out: string[] = []
    const conn = hub.attach({ send: (t) => out.push(t) })
    hub.handleFrame(conn, JSON.stringify({ kind: 'rpc', request: { id: 'r1', ns: 'sessions', method: 'list', args: {} } }))
    const frame = JSON.parse(out[out.length - 1]!)
    expect(frame.kind).toBe('rpc-result')
    expect(frame.response.error.code).toBe('unauthorized')
  })

  it('认证 → handshake → 会话列表 → open 快照', async () => {
    const adapter = makeAdapter([
      { sessionId: 's1', event: { type: 'turn/start', seq: 0 } },
      { sessionId: 's1', event: { type: 'user/message', seq: 1 } },
    ])
    const hub = makeHub(adapter)
    const out: string[] = []
    const conn = hub.attach({ send: (t) => out.push(t) })
    expect(hub.handleFrame(conn, JSON.stringify({ kind: 'auth', token: 'pt_secret' }))).toBe('authed')
    await new Promise((r) => setTimeout(r))
    expect(JSON.parse(out[0]!).kind).toBe('auth-ok')

    const response = await hub.dispatch({ id: 'h1', ns: 'handshake', method: 'hello', args: { client: 'fake-phone', protocolVersion: PROTOCOL_VERSION } })
    expect(response).toEqual({
      id: 'h1',
      ok: true,
      result: {
        host: expect.objectContaining({ name: 'test-worker', hostFingerprint: 'fp_test', capabilities: expect.anything() }),
        serverTime: 42,
      },
    })

    const list = await hub.dispatch({ id: 'l1', ns: 'sessions', method: 'list', args: {} })
    expect(list.ok && (list.result as { sessions: unknown[] }).sessions.length).toBe(2)

    const open = await hub.dispatch({ id: 'o1', ns: 'sessions', method: 'open', args: { sessionId: 's1' } })
    expect(open.ok).toBe(true)
    const snapshot = out.map((t) => JSON.parse(t)).find((f) => f.kind === 'snapshot')
    expect(snapshot.snapshot.events.length).toBe(2)

    const resync = await hub.dispatch({ id: 'r2', ns: 'sessions', method: 'resync', args: { sessionId: 's1', lastSeq: 0 } })
    expect(resync.ok && (resync.result as { count: number }).count).toBe(1)
  })

  it('版本不匹配被拒 + 未知方法 404', async () => {
    const hub = makeHub(makeAdapter())
    const bad = await hub.dispatch({ id: 'v1', ns: 'handshake', method: 'hello', args: { client: 'x', protocolVersion: 'mobile/v9' } })
    expect(bad.ok === false && bad.error.code).toBe('version-mismatch')
    const unknown = await hub.dispatch({ id: 'u1', ns: 'sessions', method: 'drop', args: {} })
    expect(unknown.ok === false && unknown.error.code).toBe('not-found')
  })

  it('M1 关闭写操作；M2 可发消息与停止', async () => {
    const adapter = makeAdapter()
    const m1 = makeHub(adapter, 'm1')
    const denied = await m1.dispatch({ id: 's1', ns: 'messages', method: 'send', args: { sessionId: 's1', text: 'hi' } })
    expect(denied.ok === false && denied.error.code).toBe('unavailable')

    const m2 = makeHub(adapter, 'm2')
    const sent = await m2.dispatch({ id: 's2', ns: 'messages', method: 'send', args: { sessionId: 's1', text: 'hi' } })
    expect(sent.ok).toBe(true)
    expect(adapter.sent[0]).toEqual({ id: 's1', text: 'hi' })
    const stop = await m2.dispatch({ id: 's3', ns: 'turn', method: 'stop', args: { sessionId: 's1' } })
    expect(stop.ok).toBe(true)

    const ro = makeHub(adapter, 'm2', true)
    const roDenied = await ro.dispatch({ id: 's4', ns: 'messages', method: 'send', args: { sessionId: 's1', text: 'hi' } })
    expect(roDenied.ok === false && roDenied.error.code).toBe('forbidden')
  })

  it('事件只广播给已订阅会话的已认证连接', () => {
    const hub = makeHub(makeAdapter())
    const a: string[] = []
    const b: string[] = []
    const connA = hub.attach({ send: (t) => a.push(t) })
    const connB = hub.attach({ send: (t) => b.push(t) })
    hub.handleFrame(connA, JSON.stringify({ kind: 'auth', token: 'pt_secret' }))
    // B 未认证
    hub.broadcastEvent('s1', { type: 'assistant/chunk', seq: 5 })
    expect(a.length).toBeGreaterThan(0)
    expect(b.length).toBe(0)
  })

  it('无手机在线时审批直接放行（不阻塞 turn）', async () => {
    const hub = makeHub(makeAdapter(), 'm2')
    let decided: string | null = null
    const ask: ApprovalAsk = {
      requestId: 'ap_1',
      sessionId: 's1',
      toolName: 'bash',
      summary: 'run rm',
      detail: null,
      decide: async (d) => {
        decided = d
      },
    }
    hub.registerApproval(ask)
    expect(decided).toBe('pass')
  })

  it('手机在线时审批下发并可通过 respond 决策', async () => {
    const hub = makeHub(makeAdapter(), 'm2')
    const out: string[] = []
    const conn = hub.attach({ send: (t) => out.push(t) })
    hub.handleFrame(conn, JSON.stringify({ kind: 'auth', token: 'pt_secret' }))

    let decided: 'allow' | 'deny' | 'pass' | null = null
    hub.registerApproval({
      requestId: 'ap_2',
      sessionId: 's1',
      toolName: 'bash',
      summary: 'run make',
      detail: null,
      decide: async (d) => {
        decided = d
      },
    })
    const req = out.map((t) => JSON.parse(t)).find((f) => f.kind === 'server-request')
    expect(req.request.kind).toBe('permission')

    const res = await hub.dispatch({ id: 'p1', ns: 'permissions', method: 'respond', args: { requestId: 'ap_2', decision: 'allow' } })
    expect(res.ok).toBe(true)
    expect(decided).toBe('allow')
  })

  it('用户问题下发与应答', async () => {
    const hub = makeHub(makeAdapter(), 'm2')
    const out: string[] = []
    const conn = hub.attach({ send: (t) => out.push(t) })
    hub.handleFrame(conn, JSON.stringify({ kind: 'auth', token: 'pt_secret' }))
    let answered: string | null = null
    const ask: QuestionAsk = {
      requestId: 'q_1',
      sessionId: 's1',
      question: '选哪个？',
      options: ['a', 'b'],
      answer: async (text) => {
        answered = text
      },
    }
    hub.registerQuestion(ask)
    const req = out.map((t) => JSON.parse(t)).find((f) => f.kind === 'server-request')
    expect(req.request.kind).toBe('question')
    const res = await hub.dispatch({ id: 'q1', ns: 'questions', method: 'respond', args: { requestId: 'q_1', answer: 'a' } })
    expect(res.ok).toBe(true)
    expect(answered).toBe('a')
  })

  it('capsForLevel 递增', () => {
    expect(capsForLevel('m1').turnControl).toBe(false)
    expect(capsForLevel('m2').turnControl).toBe(true)
    expect(capsForLevel('m3').sessionCreate).toBe(true)
  })
})
