import { describe, expect, it } from 'vitest'
import {
  isCompatibleVersion,
  PROTOCOL_VERSION,
  parseProtocolVersion,
} from '../src/version.js'
import { makeRpcId, methodKey, parseWireRequest, parseWireResponse, rpcFailure, rpcSuccess } from '../src/rpc.js'
import { parseMobileEvent } from '../src/events.js'
import { parseGatewayToPhoneFrame } from '../src/relay.js'
import { parsePhoneFrame, serializePhoneFrame } from '../src/ws.js'
import { normalizeQuestionAnswers, parseServerRequest } from '../src/server-requests.js'
import { isLiveJob, parseJobs } from '../src/jobs.js'
import { FEEDBACK_CATEGORIES, parseFeedbackItem, parseFeedbackItems } from '../src/feedback.js'
import { parseSessionSearchHits } from '../src/search.js'
import { parseSkills } from '../src/skills.js'
import { parseCredentialRecords, parseSettingsSections, parseSettingsUpdateOutcome } from '../src/settings.js'
import { parsePresets } from '../src/presets.js'

describe('version', () => {
  it('解析与比较协议版本', () => {
    expect(parseProtocolVersion('mobile/v1')).toEqual({ major: 1, minor: 0 })
    expect(parseProtocolVersion('mobile/v2.3')).toEqual({ major: 2, minor: 3 })
    expect(parseProtocolVersion('v1')).toBeNull()
    expect(parseProtocolVersion('mobile/x')).toBeNull()
    expect(isCompatibleVersion('mobile/v1', 'mobile/v1.4')).toBe(true)
    expect(isCompatibleVersion('mobile/v1', 'mobile/v2')).toBe(false)
    expect(isCompatibleVersion(PROTOCOL_VERSION, 'garbage')).toBe(false)
  })
})

describe('rpc envelope', () => {
  it('合法请求可通过解析', () => {
    const req = { id: makeRpcId(), ns: 'sessions', method: 'list', args: {} }
    expect(parseWireRequest(req)).toEqual(req)
  })

  it('非法请求被拒绝', () => {
    expect(parseWireRequest(null)).toBeNull()
    expect(parseWireRequest({ id: '', ns: 'sessions', method: 'list', args: {} })).toBeNull()
    expect(parseWireRequest({ id: 'x', ns: 'Sessions', method: 'list', args: {} })).toBeNull()
    expect(parseWireRequest({ id: 'x', ns: 'sessions', method: 'list', args: [1] })).toBeNull()
    expect(parseWireRequest({ id: 'x', ns: 'sessions', method: 'list' })).toBeNull()
  })

  it('成功/失败响应往返', () => {
    expect(parseWireResponse(rpcSuccess('a1', { ok: 1 }))).toEqual({ id: 'a1', ok: true, result: { ok: 1 } })
    expect(parseWireResponse(rpcFailure('a2', 'unauthorized', 'no token'))).toEqual({
      id: 'a2',
      ok: false,
      error: { code: 'unauthorized', message: 'no token' },
    })
    expect(parseWireResponse({ id: 'a3', ok: false, error: { code: 5 } })).toBeNull()
  })

  it('methodKey', () => {
    expect(methodKey('sessions', 'list')).toBe('sessions.list')
  })
})

describe('events', () => {
  it('MobileEvent 校验', () => {
    const good = {
      sessionId: 's1',
      seq: 3,
      event: { type: 'assistant/message', seq: 3, text: 'hi' },
    }
    expect(parseMobileEvent(good)?.event.type).toBe('assistant/message')
    expect(parseMobileEvent({ ...good, seq: -1 })).toBeNull()
    expect(parseMobileEvent({ ...good, event: { seq: 1 } })).toBeNull()
  })
})


describe('relay frames', () => {
  it('presence 帧解析', () => {
    const frame = {
      kind: 'presence',
      workers: [
        {
          workerId: 'w1',
          name: 'mac-mini',
          hostFingerprint: 'fp1',
          online: true,
          lastSeenAt: 123,
          capabilities: { dshVersion: null, protocolVersion: 'mobile/v1' },
        },
      ],
    }
    const parsed = parseGatewayToPhoneFrame(frame)
    expect(parsed?.kind).toBe('presence')
    if (parsed?.kind === 'presence') {
      expect(parsed.workers[0]?.name).toBe('mac-mini')
    }
  })

  it('未知帧返回 null', () => {
    expect(parseGatewayToPhoneFrame({ kind: 'mystery' })).toBeNull()
    expect(parseGatewayToPhoneFrame('x')).toBeNull()
  })
})

describe('ws frames', () => {
  it('phone 帧往返', () => {
    const frame = { kind: 'rpc', request: { id: 'q1', ns: 'sessions', method: 'list', args: {} } }
    expect(parsePhoneFrame(serializePhoneFrame(frame))).toEqual(frame)
  })

  it('auth 与 pong', () => {
    expect(parsePhoneFrame('{"kind":"auth","token":"t"}')).toEqual({ kind: 'auth', token: 't' })
    expect(parsePhoneFrame('{"kind":"pong","nonce":7}')).toEqual({ kind: 'pong', nonce: 7 })
    expect(parsePhoneFrame('{bad')).toBeNull()
  })

  it('preview 帧解析', () => {
    expect(parsePhoneFrame('{"kind":"preview","requestId":"pv1","path":"/ws/a/snake.html"}'))
      .toEqual({ kind: 'preview', requestId: 'pv1', path: '/ws/a/snake.html' })
    expect(parsePhoneFrame('{"kind":"preview","requestId":"pv1"}')).toBeNull()
    expect(parsePhoneFrame('{"kind":"preview","requestId":"pv1","path":"relative"}')).toBeNull()
  })
})

describe('server requests', () => {
  it('审批与问题请求解析', () => {
    const perm = parseServerRequest({
      kind: 'permission',
      body: { requestId: 'r1', sessionId: 's1', summary: 'rm -rf /tmp/x' },
    })
    expect(perm?.kind).toBe('permission')

    const q = parseServerRequest({
      kind: 'question',
      body: { requestId: 'r2', sessionId: 's1', question: '用哪个分支？', options: ['main', 'dev'] },
    })
    expect(q?.kind).toBe('question')
    if (q?.kind === 'question') expect(q.body.options).toEqual(['main', 'dev'])

    expect(parseServerRequest({ kind: 'other', body: {} })).toBeNull()
  })
})

describe('user questions（完整契约）', () => {
  it('解析完整题目：detail/header/多选/选项描述', () => {
    const q = parseServerRequest({
      kind: 'question',
      body: {
        requestId: 'r3',
        sessionId: 's1',
        question: '先做哪个？',
        questions: [
          {
            id: 'q1',
            question: '先做哪个？',
            header: '排序',
            detail: '补充说明',
            multiSelect: true,
            options: [{ label: '登录', description: '先打通账号' }, { label: '支付' }],
          },
        ],
      },
    })
    expect(q?.kind).toBe('question')
    if (q?.kind !== 'question') return
    const item = q.body.questions?.[0]
    expect(item?.id).toBe('q1')
    expect(item?.header).toBe('排序')
    expect(item?.detail).toBe('补充说明')
    expect(item?.multiSelect).toBe(true)
    expect(item?.options?.[0]).toEqual({ label: '登录', description: '先打通账号' })
    expect(item?.options?.[1]).toEqual({ label: '支付' })
  })

  it('解析计划评审 intent', () => {
    const q = parseServerRequest({
      kind: 'question',
      body: {
        requestId: 'r4',
        sessionId: 's1',
        question: '计划评审',
        questions: [
          { id: 'p1', question: '计划评审', detail: '# 计划', options: [{ label: '批准' }, { label: '拒绝' }], intent: { kind: 'plan-review', approve: '批准' } },
        ],
      },
    })
    if (q?.kind !== 'question') throw new Error('expected question')
    expect(q.body.questions?.[0]?.intent).toEqual({ kind: 'plan-review', approve: '批准' })
  })

  it('未知 intent 退化为普通题目（丢弃 intent）', () => {
    const q = parseServerRequest({
      kind: 'question',
      body: { requestId: 'r5', sessionId: 's1', question: 'x', questions: [{ id: 'a', question: 'x', intent: { kind: 'future-thing', approve: 'x' } }] },
    })
    if (q?.kind !== 'question') throw new Error('expected question')
    expect(q.body.questions?.[0]?.intent).toBeUndefined()
  })

  it('非法 questions 载荷整体拒绝', () => {
    expect(parseServerRequest({ kind: 'question', body: { requestId: 'r', sessionId: 's', question: 'x', questions: [{ id: 1 }] } })).toBeNull()
  })

  it('旧客户端只带 question/options 仍可解析', () => {
    const q = parseServerRequest({ kind: 'question', body: { requestId: 'r', sessionId: 's', question: '选一个', options: ['a', 'b'] } })
    if (q?.kind !== 'question') throw new Error('expected question')
    expect(q.body.options).toEqual(['a', 'b'])
    expect(q.body.questions).toBeUndefined()
  })
})

describe('normalizeQuestionAnswers', () => {
  it('结构化 answers 原样归一', () => {
    const answers = normalizeQuestionAnswers({
      answers: [{ id: 'q1', selected: ['A', 'B'], custom: '补充' }, { id: 'q2', selected: [] }],
    })
    expect(answers).toEqual([
      { id: 'q1', selected: ['A', 'B'], custom: '补充' },
      { id: 'q2', selected: [] },
    ])
  })

  it('旧字段 answer 包成首题自由输入', () => {
    expect(normalizeQuestionAnswers({ answer: '随便' })).toEqual([{ id: '', selected: [], custom: '随便' }])
  })

  it('两者都缺或非法返回 null', () => {
    expect(normalizeQuestionAnswers({})).toBeNull()
    expect(normalizeQuestionAnswers({ answers: [{ id: 'q', selected: 'no' }] })).toBeNull()
    expect(normalizeQuestionAnswers({ answers: [{ selected: [] }] })).toBeNull()
  })

  it('answers 优先于 answer', () => {
    const answers = normalizeQuestionAnswers({ answer: '旧', answers: [{ id: 'q1', selected: ['X'] }] })
    expect(answers).toEqual([{ id: 'q1', selected: ['X'] }])
  })
})

describe('jobs', () => {
  it('解析任务快照', () => {
    const jobs = parseJobs([
      { id: 'j1', kind: 'bash', label: 'npm test', status: 'running', startedAt: 100 },
      { id: 'j2', kind: 'subagent', label: 'review', status: 'completed', startedAt: 1, finishedAt: 2, detail: 'ok' },
    ])
    expect(jobs).toHaveLength(2)
    expect(jobs?.[0]).toEqual({ id: 'j1', kind: 'bash', label: 'npm test', status: 'running', startedAt: 100 })
    expect(jobs?.[1]?.detail).toBe('ok')
    expect(jobs?.[1]?.finishedAt).toBe(2)
  })

  it('缺 kind 回落为 job', () => {
    expect(parseJobs([{ id: 'j', label: 'x', status: 'failed', startedAt: 0 }])?.[0]?.kind).toBe('job')
  })

  it('非法输入整体返回 null', () => {
    expect(parseJobs('nope')).toBeNull()
    expect(parseJobs([{ id: 'j', label: 'x', status: 'weird', startedAt: 0 }])).toBeNull()
    expect(parseJobs([{ id: 'j', label: 'x', status: 'running' }])).toBeNull()
    expect(parseJobs([null])).toBeNull()
  })

  it('isLiveJob 只认进行中与停止中', () => {
    const make = (status: string) => ({ id: 'j', kind: 'job', label: 'x', status, startedAt: 0 })
    expect(isLiveJob(make('running') as never)).toBe(true)
    expect(isLiveJob(make('stopping') as never)).toBe(true)
    expect(isLiveJob(make('completed') as never)).toBe(false)
    expect(isLiveJob(make('killed') as never)).toBe(false)
    expect(isLiveJob(make('failed') as never)).toBe(false)
  })
})

describe('message feedback', () => {
  it('解析反馈条目（含可选备注与分类）', () => {
    const item = parseFeedbackItem({
      messageId: 'm1',
      rating: 'negative',
      note: '跑偏了',
      category: 'instruction-following',
      version: 'v1',
      createdAt: 1,
      updatedAt: 2,
    })
    expect(item).toEqual({
      messageId: 'm1',
      rating: 'negative',
      note: '跑偏了',
      category: 'instruction-following',
      version: 'v1',
      createdAt: 1,
      updatedAt: 2,
    })
  })

  it('无备注/分类时省略字段', () => {
    const item = parseFeedbackItem({ messageId: 'm', rating: 'positive', version: 'v' })
    expect(item).toEqual({ messageId: 'm', rating: 'positive', version: 'v', createdAt: 0, updatedAt: 0 })
    expect(item?.note).toBeUndefined()
  })

  it('非法 rating/缺 version 返回 null', () => {
    expect(parseFeedbackItem({ messageId: 'm', rating: 'meh', version: 'v' })).toBeNull()
    expect(parseFeedbackItem({ messageId: 'm', rating: 'positive' })).toBeNull()
    expect(parseFeedbackItem(null)).toBeNull()
  })

  it('未知 category 被丢弃但条目仍可用', () => {
    const item = parseFeedbackItem({ messageId: 'm', rating: 'positive', version: 'v', category: 'nope' })
    expect(item?.category).toBeUndefined()
  })

  it('列表整体非法返回 null', () => {
    expect(parseFeedbackItems([{ messageId: 'm', rating: 'positive', version: 'v' }])).toHaveLength(1)
    expect(parseFeedbackItems([{ rating: 'positive' }])).toBeNull()
    expect(parseFeedbackItems('x')).toBeNull()
  })

  it('分类常量与 Web 的 7 个芯片一致', () => {
    expect(FEEDBACK_CATEGORIES).toHaveLength(7)
    expect(FEEDBACK_CATEGORIES[0]).toBe('task-result')
    expect(FEEDBACK_CATEGORIES[6]).toBe('other')
  })
})

describe('session search', () => {
  it('解析命中（含 cwd/live）', () => {
    const hits = parseSessionSearchHits([
      { sessionId: 's1', snippet: '…把测试跑绿…', cwd: '/ws/a', createdAt: 10, live: true },
      { sessionId: 's2', snippet: 'x' },
    ])
    expect(hits).toHaveLength(2)
    expect(hits?.[0]).toEqual({ sessionId: 's1', snippet: '…把测试跑绿…', cwd: '/ws/a', createdAt: 10, live: true })
    expect(hits?.[1]?.cwd).toBeNull()
    expect(hits?.[1]?.live).toBe(false)
  })

  it('缺 sessionId 或非数组整体返回 null', () => {
    expect(parseSessionSearchHits([{ snippet: 'x' }])).toBeNull()
    expect(parseSessionSearchHits('nope')).toBeNull()
  })

  it('空数组合法', () => {
    expect(parseSessionSearchHits([])).toEqual([])
  })
})

describe('skills', () => {
  it('解析技能并读取调用策略', () => {
    const skills = parseSkills([
      { name: 'frontend-design', description: '做界面', invocation: { modelInvocable: true, userInvocable: false }, provider: 'fs' },
      { name: 'gsap', description: '动效' },
    ])
    expect(skills).toHaveLength(2)
    expect(skills?.[0]?.userInvocable).toBe(false)
    expect(skills?.[0]?.provider).toBe('fs')
    // 缺 invocation 时默认两者都可调用
    expect(skills?.[1]?.modelInvocable).toBe(true)
    expect(skills?.[1]?.userInvocable).toBe(true)
  })

  it('whenToUse 为空串时省略', () => {
    const skills = parseSkills([{ name: 'a', whenToUse: '' }])
    expect(skills?.[0]?.whenToUse).toBeUndefined()
  })

  it('跳过无名条目，非数组整体 null', () => {
    expect(parseSkills([{ description: 'x' }, { name: 'ok' }])).toHaveLength(1)
    expect(parseSkills('nope')).toBeNull()
  })
})

describe('worker config（只读）', () => {
  it('解析设置命名空间：值截断 + 覆盖标记', () => {
    const sections = parseSettingsSections([
      { ns: 'web-search', applies: 'restart', revision: 3, value: { maxSearches: 5 }, user: { maxSearches: 5 } },
      { ns: 'agent-loop', value: { parallel: true } },
    ])
    expect(sections?.[0]).toMatchObject({ ns: 'web-search', applies: 'restart', revision: 3, overridden: true })
    expect(sections?.[0]?.preview).toBe('{"maxSearches":5}')
    expect(sections?.[1]?.overridden).toBe(false)
  })

  it('超长值预览被截断', () => {
    const big = { text: 'x'.repeat(2000) }
    const sections = parseSettingsSections([{ ns: 'a', value: big }])
    expect(sections?.[0]?.preview.length).toBeLessThan(900)
    expect(sections?.[0]?.preview.endsWith('…')).toBe(true)
  })

  it('跳过无 ns 条目，非数组整体 null', () => {
    expect(parseSettingsSections([{ value: 1 }, { ns: 'ok' }])).toHaveLength(1)
    expect(parseSettingsSections('nope')).toBeNull()
  })

  it('凭据记录只保留 key/kind', () => {
    const records = parseCredentialRecords([
      { key: 'DEEPSEEK_API_KEY', kind: 'api-key', key_value: 'sk-secret', configured: true, source: 'file', writable: true },
    ])
    expect(records).toEqual([
      { key: 'DEEPSEEK_API_KEY', kind: 'api-key', configured: true, source: 'file', writable: true },
    ])
    // 秘密字段不会出现在结果里
    expect(JSON.stringify(records)).not.toContain('sk-secret')
  })

  it('branded key 对象转字符串，缺 key 跳过', () => {
    const records = parseCredentialRecords([{ key: { toString: () => 'K' }, kind: 'api-key' }, { kind: 'x' }])
    expect(records).toEqual([{ key: 'K', kind: 'api-key', configured: false, writable: false }])
  })
})

describe('credential write metadata', () => {
  it('未配置且不可写时标为 false', () => {
    const records = parseCredentialRecords([{ key: 'a/b', kind: 'api-key' }])
    expect(records?.[0]).toEqual({ key: 'a/b', kind: 'api-key', configured: false, writable: false })
    expect(records?.[0]?.source).toBeUndefined()
  })
})

describe('settings update（CAS）', () => {
  it('无秘密字段的命名空间可编辑并带完整值', () => {
    const sections = parseSettingsSections([{ ns: 'web-search', value: { maxSearches: 5 } }])
    expect(sections?.[0]?.editable).toBe(true)
    expect(sections?.[0]?.valueJson).toContain('"maxSearches": 5')
  })

  it('声明了秘密字段的命名空间不可编辑且不下发完整值', () => {
    const sections = parseSettingsSections([
      { ns: 'llm', value: { apiKey: '<redacted>' }, secrets: [{ path: 'apiKey' }] },
    ])
    expect(sections?.[0]?.editable).toBe(false)
    expect(sections?.[0]?.valueJson).toBeUndefined()
  })

  it('写入结果解析：成功/冲突/非法', () => {
    expect(parseSettingsUpdateOutcome({ updated: true, revision: 4 })).toEqual({ updated: true, revision: 4 })
    expect(parseSettingsUpdateOutcome({ updated: false, conflict: true, actualRevision: 9 }))
      .toEqual({ updated: false, conflict: true, actualRevision: 9 })
    expect(parseSettingsUpdateOutcome({ updated: true })).toBeNull()
    expect(parseSettingsUpdateOutcome(null)).toBeNull()
  })
})

describe('agent presets', () => {
  it('解析 preset 元信息与组成正文', () => {
    const presets = parsePresets([
      { id: 'standard', name: '标准', description: 'd', isDefault: true, trust: 'system', composition: 'agent:\n  tools: []' },
      { id: 'mine', trust: 'user' },
    ])
    expect(presets).toHaveLength(2)
    expect(presets?.[0]).toMatchObject({ id: 'standard', isDefault: true, trust: 'system' })
    expect(presets?.[0]?.composition).toContain('tools')
    expect(presets?.[1]?.trust).toBe('user')
    expect(presets?.[1]?.isDefault).toBe(false)
  })

  it('broken 与空字符串字段处理', () => {
    const presets = parsePresets([{ id: 'x', broken: '缺少模块', name: '', description: '' }])
    expect(presets?.[0]?.broken).toBe('缺少模块')
    expect(presets?.[0]?.name).toBeUndefined()
    expect(presets?.[0]?.description).toBeUndefined()
  })

  it('未知 trust 归类为 system，跳过无 id 条目', () => {
    const presets = parsePresets([{ name: 'no-id' }, { id: 'ok', trust: 'weird' }])
    expect(presets).toHaveLength(1)
    expect(presets?.[0]?.trust).toBe('system')
  })

  it('非数组返回 null', () => {
    expect(parsePresets({})).toBeNull()
  })
})
