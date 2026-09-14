import { describe, expect, it } from 'vitest'
import { BridgeHub, capsForLevel } from '../src/plugin/hub.js'
import type { ApprovalAsk, DshAdapter, QuestionAsk, SessionSlice, SessionSummary } from '../src/plugin/adapter-dsh.js'
import { generateBridgeState, verifyToken, loadBridgeState } from '../src/plugin/state.js'
import { PROTOCOL_VERSION, type QuestionAnswerItem } from '@deepseek-harness-pocket/bridge-protocol'
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
        { id: 's1', createdAt: 1, lastActivityAt: 1, cwd: '/tmp', lastSeq: 1, live: true, agentStatus: 'idle', parentSession: null, origin: null, delegationDepth: 0, agentPreset: null },
        { id: 's2', createdAt: 2, lastActivityAt: 2, cwd: null, lastSeq: -1, live: false, agentStatus: null, parentSession: null, origin: null, delegationDepth: 0, agentPreset: null },
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
    async listJobs(): Promise<never[]> {
      return []
    },
    async listFeedback(): Promise<never[]> {
      return []
    },
    async searchSessions(): Promise<never[]> {
      return []
    },
    async listSkills(): Promise<never[]> {
      return []
    },
    async describeSettings(): Promise<never[]> {
      return []
    },
    async listCredentials(): Promise<never[]> {
      return []
    },
    async updateSettings(ns: string) {
      return { updated: true as const, revision: ns === 'conv' ? 7 : 1 }
    },
    async setCredential(): Promise<boolean> {
      return false
    },
    async unsetCredential(): Promise<boolean> {
      return false
    },
    async putFeedback(): Promise<null> {
      return null
    },
    async deleteFeedback(): Promise<boolean> {
      return false
    },
    onJobsChanged(): () => void {
      return () => undefined
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
    expect(again.hostKey).toBe(state.hostKey)
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
    let answered: readonly QuestionAnswerItem[] | null = null
    const ask: QuestionAsk = {
      requestId: 'q_1',
      sessionId: 's1',
      question: '选哪个？',
      options: ['a', 'b'],
      questions: [
        { id: 'q1', question: '选哪个？', options: [{ label: 'a' }, { label: 'b' }] },
      ],
      answer: async (answers) => {
        answered = answers
      },
    }
    hub.registerQuestion(ask)
    const req = out.map((t) => JSON.parse(t)).find((f) => f.kind === 'server-request')
    expect(req.request.kind).toBe('question')
    // 完整题目随请求下发（旧字段 question/options 仍保留）
    expect(req.request.body.questions?.[0]?.id).toBe('q1')
    expect(req.request.body.options).toEqual(['a', 'b'])
    const res = await hub.dispatch({ id: 'q1', ns: 'questions', method: 'respond', args: { requestId: 'q_1', answers: [{ id: 'q1', selected: ['a'] }] } })
    expect(res.ok).toBe(true)
    expect(answered).toEqual([{ id: 'q1', selected: ['a'] }])
  })

  it('旧版单字符串回答仍可用（回填首题 id）', async () => {
    const hub = makeHub(makeAdapter(), 'm2')
    const out: string[] = []
    const conn = hub.attach({ send: (t) => out.push(t) })
    hub.handleFrame(conn, JSON.stringify({ kind: 'auth', token: 'pt_secret' }))
    let answered: readonly QuestionAnswerItem[] | null = null
    hub.registerQuestion({
      requestId: 'q_9',
      sessionId: 's1',
      question: '随便说',
      options: [],
      questions: [{ id: 'qq', question: '随便说' }],
      answer: async (answers) => { answered = answers },
    })
    const res = await hub.dispatch({ id: 'q9', ns: 'questions', method: 'respond', args: { requestId: 'q_9', answer: '自由文本' } })
    expect(res.ok).toBe(true)
    expect(answered).toEqual([{ id: 'qq', selected: [], custom: '自由文本' }])
  })

  it('计划评审题目随请求下发 intent', async () => {
    const hub = makeHub(makeAdapter(), 'm2')
    const out: string[] = []
    const conn = hub.attach({ send: (t) => out.push(t) })
    hub.handleFrame(conn, JSON.stringify({ kind: 'auth', token: 'pt_secret' }))
    hub.registerQuestion({
      requestId: 'q_plan',
      sessionId: 's1',
      question: '计划评审',
      options: ['批准', '拒绝'],
      questions: [{
        id: 'p1',
        question: '计划评审',
        detail: '# 计划正文',
        options: [{ label: '批准' }, { label: '拒绝' }],
        intent: { kind: 'plan-review', approve: '批准' },
      }],
      answer: async () => {},
    })
    const req = out.map((t) => JSON.parse(t)).find((f) => f.kind === 'server-request')
    expect(req.request.body.questions[0].intent).toEqual({ kind: 'plan-review', approve: '批准' })
    expect(req.request.body.questions[0].detail).toBe('# 计划正文')
  })

  it('后台任务下发与拉取', async () => {
    const base = makeAdapter()
    const adapter = {
      ...base,
      async listJobs(sessionId: string) {
        return sessionId === 's1'
          ? [{ id: 'j1', kind: 'bash', label: 'npm test', status: 'running' as const, startedAt: 10 }]
          : []
      },
    }
    const hub = makeHub(adapter, 'm3')
    const out: string[] = []
    const conn = hub.attach({ send: (t) => out.push(t) })
    hub.handleFrame(conn, JSON.stringify({ kind: 'auth', token: 'pt_secret' }))

    // 打开会话即补发一次基线
    await hub.dispatch({ id: 'o1', ns: 'sessions', method: 'open', args: { sessionId: 's1' } })
    const frame = out.map((t) => JSON.parse(t)).find((f) => f.kind === 'jobs')
    expect(frame?.sessionId).toBe('s1')
    expect(frame?.jobs?.[0]?.id).toBe('j1')

    // RPC 拉取
    const res = await hub.dispatch({ id: 'j1', ns: 'jobs', method: 'list', args: { sessionId: 's1' } })
    expect(res.ok).toBe(true)
    if (res.ok) expect((res.result as { jobs: unknown[] }).jobs).toHaveLength(1)
  })

  it('后台任务 RPC 在 m2 能力下可用、m1 拒绝', async () => {
    const m1 = makeHub(makeAdapter(), 'm1')
    const res = await m1.dispatch({ id: 'x', ns: 'jobs', method: 'list', args: { sessionId: 's1' } })
    expect(res.ok).toBe(false)
  })

  it('消息反馈：list 透传 / put 校验 rating / delete 需 version', async () => {
    const base = makeAdapter()
    const stored = {
      messageId: 'm1', rating: 'positive' as const, version: 'v1', createdAt: 1, updatedAt: 1,
    }
    const adapter = {
      ...base,
      async listFeedback() { return [stored] },
      async putFeedback(_s: string, _m: string, rating: string) {
        return rating === 'positive' ? stored : null
      },
      async deleteFeedback(_s: string, _m: string, version: string) { return version === 'v1' },
    }
    const hub = makeHub(adapter, 'm3')

    const list = await hub.dispatch({ id: 'f1', ns: 'feedback', method: 'list', args: { sessionId: 's1' } })
    expect(list.ok).toBe(true)
    if (list.ok) expect((list.result as { items: unknown[] }).items).toHaveLength(1)

    const bad = await hub.dispatch({ id: 'f2', ns: 'feedback', method: 'put', args: { sessionId: 's1', messageId: 'm1', rating: 'meh' } })
    expect(bad.ok).toBe(false)

    const ok = await hub.dispatch({ id: 'f3', ns: 'feedback', method: 'put', args: { sessionId: 's1', messageId: 'm1', rating: 'positive' } })
    expect(ok.ok).toBe(true)

    const del = await hub.dispatch({ id: 'f4', ns: 'feedback', method: 'delete', args: { sessionId: 's1', messageId: 'm1', version: 'v1' } })
    expect(del.ok).toBe(true)
    const stale = await hub.dispatch({ id: 'f5', ns: 'feedback', method: 'delete', args: { sessionId: 's1', messageId: 'm1', version: 'v0' } })
    expect(stale.ok).toBe(false)
  })

  it('会话内容搜索：query 校验 + limit 上限', async () => {
    let seen: { query: string; limit: number } | null = null
    const base = makeAdapter()
    const adapter = {
      ...base,
      async searchSessions(query: string, limit: number) {
        seen = { query, limit }
        return [{ sessionId: 's1', snippet: '命中', cwd: '/w', createdAt: 1, live: true }]
      },
    }
    const hub = makeHub(adapter, 'm3')

    const empty = await hub.dispatch({ id: 'q0', ns: 'sessions', method: 'search', args: { query: '   ' } })
    expect(empty.ok).toBe(false)

    const res = await hub.dispatch({ id: 'q1', ns: 'sessions', method: 'search', args: { query: ' 测试 ', limit: 999 } })
    expect(res.ok).toBe(true)
    if (res.ok) expect((res.result as { hits: unknown[] }).hits).toHaveLength(1)
    expect(seen).toEqual({ query: '测试', limit: 50 })
  })

  it('技能目录：按 cwd 透传，非法 cwd 丢弃', async () => {
    const seen: (string | undefined)[] = []
    const base = makeAdapter()
    const adapter = {
      ...base,
      async listSkills(cwd?: string) {
        seen.push(cwd)
        return [{ name: 'gsap', description: 'd', modelInvocable: true, userInvocable: true, provider: 'fs' }]
      },
    }
    const hub = makeHub(adapter, 'm3')
    const ok = await hub.dispatch({ id: 'k1', ns: 'skills', method: 'list', args: { cwd: '/ws/a' } })
    expect(ok.ok).toBe(true)
    if (ok.ok) expect((ok.result as { skills: unknown[] }).skills).toHaveLength(1)
    await hub.dispatch({ id: 'k2', ns: 'skills', method: 'list', args: { cwd: 'relative' } })
    expect(seen).toEqual(['/ws/a', undefined])
  })

  it('Worker 配置只读接口：sections + credentials 一起返回', async () => {
    const base = makeAdapter()
    const adapter = {
      ...base,
      async describeSettings() {
        return [{ ns: 'web-search', applies: 'restart', revision: 1, overridden: false, preview: '{}' }]
      },
      async listCredentials() {
        return [{ key: 'DEEPSEEK_API_KEY', kind: 'api-key' }]
      },
    }
    const hub = makeHub(adapter, 'm3')
    const res = await hub.dispatch({ id: 'w1', ns: 'settings', method: 'describe', args: {} })
    expect(res.ok).toBe(true)
    if (res.ok) {
      const result = res.result as { sections: unknown[]; credentials: unknown[] }
      expect(result.sections).toHaveLength(1)
      expect(result.credentials).toHaveLength(1)
    }
    // m1 无 turnControl：拒绝
    const denied = await makeHub(makeAdapter(), 'm1').dispatch({ id: 'w2', ns: 'settings', method: 'describe', args: {} })
    expect(denied.ok).toBe(false)
  })

  it('凭据写入：校验 ref/value，成功与失败路径', async () => {
    const writes: { ref: string; value: string }[] = []
    const base = makeAdapter()
    const adapter = {
      ...base,
      async setCredential(ref: string, value: string) {
        writes.push({ ref, value })
        return ref === 'ok/ref'
      },
      async unsetCredential(ref: string) {
        return ref === 'ok/ref'
      },
    }
    const hub = makeHub(adapter, 'm3')

    expect((await hub.dispatch({ id: 'c0', ns: 'credentials', method: 'set', args: { ref: '', value: 'v' } })).ok).toBe(false)
    expect((await hub.dispatch({ id: 'c1', ns: 'credentials', method: 'set', args: { ref: 'a/b', value: '' } })).ok).toBe(false)
    expect((await hub.dispatch({ id: 'c2', ns: 'credentials', method: 'set', args: { ref: 'a/b', value: 'x'.repeat(9000) } })).ok).toBe(false)

    const rejected = await hub.dispatch({ id: 'c3', ns: 'credentials', method: 'set', args: { ref: 'no/ref', value: 'sk-1' } })
    expect(rejected.ok).toBe(false)

    const ok = await hub.dispatch({ id: 'c4', ns: 'credentials', method: 'set', args: { ref: 'ok/ref', value: 'sk-1' } })
    expect(ok.ok).toBe(true)
    expect(writes).toEqual([{ ref: 'no/ref', value: 'sk-1' }, { ref: 'ok/ref', value: 'sk-1' }])

    expect((await hub.dispatch({ id: 'c5', ns: 'credentials', method: 'unset', args: { ref: 'no/ref' } })).ok).toBe(false)
    expect((await hub.dispatch({ id: 'c6', ns: 'credentials', method: 'unset', args: { ref: 'ok/ref' } })).ok).toBe(true)
  })

  it('凭据写入在 m1 下被拒绝', async () => {
    const res = await makeHub(makeAdapter(), 'm1').dispatch({ id: 'x', ns: 'credentials', method: 'set', args: { ref: 'a/b', value: 'v' } })
    expect(res.ok).toBe(false)
  })

  it('设置写入：校验 ns/patch，冲突结果原样回传', async () => {
    const base = makeAdapter()
    const adapter = {
      ...base,
      async updateSettings(ns: string, patch: Record<string, unknown>, expectedRevision?: number) {
        if (ns === 'conv') return { updated: false as const, conflict: true as const, actualRevision: 9 }
        if (expectedRevision !== 3) return { updated: false as const, conflict: true as const, actualRevision: 3 }
        return { updated: true as const, revision: 4 }
      },
    }
    const hub = makeHub(adapter, 'm3')

    expect((await hub.dispatch({ id: 's0', ns: 'settings', method: 'update', args: { ns: '', patch: {} } })).ok).toBe(false)
    expect((await hub.dispatch({ id: 's1', ns: 'settings', method: 'update', args: { ns: 'a', patch: [] } })).ok).toBe(false)

    const conflict = await hub.dispatch({ id: 's2', ns: 'settings', method: 'update', args: { ns: 'conv', patch: {}, expectedRevision: 1 } })
    expect(conflict.ok).toBe(true)
    if (conflict.ok) expect(conflict.result).toEqual({ updated: false, conflict: true, actualRevision: 9 })

    const stale = await hub.dispatch({ id: 's3', ns: 'settings', method: 'update', args: { ns: 'a', patch: {}, expectedRevision: 1 } })
    if (stale.ok) expect(stale.result).toEqual({ updated: false, conflict: true, actualRevision: 3 })

    const ok = await hub.dispatch({ id: 's4', ns: 'settings', method: 'update', args: { ns: 'a', patch: { x: 1 }, expectedRevision: 3 } })
    if (ok.ok) expect(ok.result).toEqual({ updated: true, revision: 4 })
  })

  it('capsForLevel 递增', () => {
    expect(capsForLevel('m1').turnControl).toBe(false)
    expect(capsForLevel('m2').turnControl).toBe(true)
    expect(capsForLevel('m3').sessionCreate).toBe(true)
  })
})

describe('preview', () => {
  function makePreviewAdapter(files: Record<string, { content: Buffer; size?: number }>, roots: string[] = ['/ws/proj']): DshAdapter {
    const base = makeAdapter()
    return {
      ...base,
      async listWorkspaces() {
        return roots.map((p, i) => ({ id: `w${i}`, path: p, title: p }))
      },
      async statFile(path: string) {
        const f = files[path]
        if (f === undefined) return null
        return { type: 'file', size: f.size ?? f.content.byteLength }
      },
      async readFile(path: string) {
        return files[path]?.content ?? null
      },
    }
  }

  const authedConn = (hub: BridgeHub): { conn: string; out: unknown[] } => {
    const out: unknown[] = []
    const conn = hub.attach({ send: (t) => out.push(JSON.parse(t)) })
    hub.handleFrame(conn, JSON.stringify({ kind: 'auth', token: 'pt_secret' }))
    return { conn, out }
  }
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0))
  }

  it('成功：begin → chunk×N → end', async () => {
    const big = Buffer.alloc(100_000, 7) // > 2 个 chunk（48KB）
    const hub = makeHub(makePreviewAdapter({ '/ws/proj/snake.html': { content: big } }), 'm3')
    const { conn, out } = authedConn(hub)
    hub.handleFrame(conn, JSON.stringify({ kind: 'preview', requestId: 'pv1', path: '/ws/proj/snake.html' }))
    await settle()
    const kinds = (out as { kind: string }[]).map((f) => f.kind)
    expect(kinds).toContain('preview-begin')
    expect(kinds.filter((k) => k === 'preview-chunk')).toHaveLength(3)
    expect(kinds).toContain('preview-end')
    const begin = (out as { kind: string; mime?: string; bytes?: number }[]).find((f) => f.kind === 'preview-begin')!
    expect(begin.mime).toContain('text/html')
    expect(begin.bytes).toBe(100_000)
    const chunks = (out as { kind: string; dataBase64?: string }[]).filter((f) => f.kind === 'preview-chunk')
    const reassembled = Buffer.from(chunks.map((c) => c.dataBase64!).join(''), 'base64')
    expect(reassembled.equals(big)).toBe(true)
  })

  it('workspace 外路径拒绝 forbidden-path', async () => {
    const hub = makeHub(makePreviewAdapter({ '/etc/evil.html': { content: Buffer.from('x') } }), 'm3')
    const { conn, out } = authedConn(hub)
    hub.handleFrame(conn, JSON.stringify({ kind: 'preview', requestId: 'pv2', path: '/etc/evil.html' }))
    await settle()
    const err = (out as { kind: string; code?: string }[]).find((f) => f.kind === 'preview-error')!
    expect(err.code).toBe('forbidden-path')
  })

  it('路径穿越拒绝', async () => {
    const hub = makeHub(makePreviewAdapter({}), 'm3')
    const { conn, out } = authedConn(hub)
    hub.handleFrame(conn, JSON.stringify({ kind: 'preview', requestId: 'pv3', path: '/ws/proj/../secret.html' }))
    await settle()
    const err = (out as { kind: string; code?: string }[]).find((f) => f.kind === 'preview-error')!
    expect(err.code).toBe('forbidden-path')
  })

  it('非白名单扩展名拒绝 unsupported-type', async () => {
    const hub = makeHub(makePreviewAdapter({ '/ws/proj/app.zip': { content: Buffer.from('x') } }), 'm3')
    const { conn, out } = authedConn(hub)
    hub.handleFrame(conn, JSON.stringify({ kind: 'preview', requestId: 'pv4', path: '/ws/proj/app.zip' }))
    await settle()
    const err = (out as { kind: string; code?: string }[]).find((f) => f.kind === 'preview-error')!
    expect(err.code).toBe('unsupported-type')
  })

  it('超过 2MB 拒绝 too-large', async () => {
    const hub = makeHub(makePreviewAdapter({ '/ws/proj/big.png': { content: Buffer.alloc(1), size: 3 * 1024 * 1024 } }), 'm3')
    const { conn, out } = authedConn(hub)
    hub.handleFrame(conn, JSON.stringify({ kind: 'preview', requestId: 'pv5', path: '/ws/proj/big.png' }))
    await settle()
    const err = (out as { kind: string; code?: string }[]).find((f) => f.kind === 'preview-error')!
    expect(err.code).toBe('too-large')
  })

  it('m2 能力下拒绝 unavailable', async () => {
    const hub = makeHub(makePreviewAdapter({ '/ws/proj/a.html': { content: Buffer.from('<p/>') } }), 'm2')
    const { conn, out } = authedConn(hub)
    hub.handleFrame(conn, JSON.stringify({ kind: 'preview', requestId: 'pv6', path: '/ws/proj/a.html' }))
    await settle()
    const err = (out as { kind: string; code?: string }[]).find((f) => f.kind === 'preview-error')!
    expect(err.code).toBe('unavailable')
  })

  it('连接断开后停止发送', async () => {
    let readCount = 0
    const base = makePreviewAdapter({ '/ws/proj/a.html': { content: Buffer.alloc(48 * 1024 * 5, 1) } })
    const slow: DshAdapter = {
      ...base,
      async readFile(path: string, maxBytes: number) {
        readCount += 1
        await new Promise((r) => setTimeout(r, 5))
        return base.readFile(path, maxBytes)
      },
    }
    const hub = makeHub(slow, 'm3')
    const { conn, out } = authedConn(hub)
    hub.handleFrame(conn, JSON.stringify({ kind: 'preview', requestId: 'pv7', path: '/ws/proj/a.html' }))
    await settle()
    hub.detach(conn)
    const framesAfterDetach = out.length
    await settle()
    expect(out.length).toBe(framesAfterDetach)
    expect(readCount).toBe(1)
  })
})
