import { describe, expect, it } from 'vitest'
import { approvalDetailFromEvents, approvalSummary } from '../src/plugin/adapter-dsh.js'

function event(type: string, data: Record<string, unknown>): unknown {
  return { type, seq: 1, data }
}

describe('approvalDetailFromEvents', () => {
  it('按 callId 回查工具入参（最新一条优先）', () => {
    const events = [
      event('tool/call', { callId: 'c1', name: 'bash', arguments: '{"command":"ls"}' }),
      event('tool/result', { message: { source: { callId: 'c1' } } }),
      event('tool/call', { callId: 'c2', name: 'edit', arguments: '{"file_path":"a.ts","old_string":"x","new_string":"y"}' }),
    ]
    expect(approvalDetailFromEvents(events, 'c1')).toEqual({ name: 'bash', arguments: { command: 'ls' } })
    expect(approvalDetailFromEvents(events, 'c2')).toEqual({
      name: 'edit',
      arguments: { file_path: 'a.ts', old_string: 'x', new_string: 'y' },
    })
  })

  it('未完成的 JSON 参数走 argumentsRaw', () => {
    const events = [event('tool/call', { callId: 'c3', name: 'write', arguments: '{"content":"半截' })]
    expect(approvalDetailFromEvents(events, 'c3')).toEqual({ name: 'write', argumentsRaw: '{"content":"半截' })
  })

  it('找不到 callId 或 callId 非法时返回 null', () => {
    expect(approvalDetailFromEvents([], 'x')).toBeNull()
    expect(approvalDetailFromEvents([event('tool/call', { callId: 'a', name: 'bash' })], 'b')).toBeNull()
    expect(approvalDetailFromEvents([event('tool/call', { callId: 'a', name: 'bash' })], undefined)).toBeNull()
  })

  it('忽略非 tool/call 事件', () => {
    const events = [event('user/message', { callId: 'c9' }), event('assistant/message', { callId: 'c9' })]
    expect(approvalDetailFromEvents(events, 'c9')).toBeNull()
  })
})

describe('approvalSummary', () => {
  it('优先使用 dsh 给的理由', () => {
    expect(approvalSummary('bash', '需要删除临时目录', null)).toBe('需要删除临时目录')
  })

  it('没有理由时用工具名 + 关键入参', () => {
    const detail = { name: 'bash', arguments: { command: 'rm -rf /tmp/x' } }
    expect(approvalSummary('bash', undefined, detail)).toBe('bash: rm -rf /tmp/x')
  })

  it('超长入参截断，无入参时回落工具名', () => {
    const long = 'a'.repeat(200)
    expect(approvalSummary('bash', undefined, { arguments: { command: long } }).endsWith('…')).toBe(true)
    expect(approvalSummary('bash', undefined, null)).toBe('approve bash')
  })
})
