import { describe, expect, it } from 'vitest';
import type { DshSessionEvent } from '@deepseek-harness-pocket/bridge-protocol';
import { projectTrajectory, summarizeTrajectory } from '../features/conversation/trajectory';

function ev(seq: number, type: string, data: Record<string, unknown> = {}, time?: number): DshSessionEvent {
  return { type, seq, data, ...(time !== undefined ? { time } : {}) } as DshSessionEvent;
}

describe('projectTrajectory', () => {
  it('按回合折叠用户/模型/工具并计算工具耗时', () => {
    const steps = projectTrajectory([
      ev(0, 'turn/start', {}, 1000),
      ev(1, 'user/message', { content: [{ type: 'text', text: '跑测试' }] }, 1000),
      ev(2, 'tool/call', { callId: 'c1', name: 'bash', arguments: '{"command":"npm test"}' }, 1100),
      ev(3, 'tool/result', { message: { source: { callId: 'c1' }, content: [{ content: [{ type: 'text', text: 'ok' }] }] } }, 1600),
      ev(4, 'assistant/message', { usage: { inputTokens: 10, outputTokens: 5 } }, 1700),
      ev(5, 'turn/end', { reason: { kind: 'completed' } }, 1800),
    ]);

    expect(steps.map((s) => s.kind)).toEqual(['user', 'tool', 'assistant', 'turn-end']);
    const tool = steps.find((s) => s.kind === 'tool')!;
    expect(tool.toolName).toBe('bash');
    expect(tool.durationMs).toBe(500);
    expect(tool.status).toBe('ok');
    expect(tool.turn).toBe(1);
    const assistant = steps.find((s) => s.kind === 'assistant')!;
    expect(assistant.tokensIn).toBe(10);
    expect(assistant.tokensOut).toBe(5);
  });

  it('错误的工具结果标记 error', () => {
    const steps = projectTrajectory([
      ev(0, 'turn/start', {}, 0),
      ev(1, 'tool/call', { callId: 'c1', name: 'bash', arguments: '{}' }, 10),
      ev(2, 'tool/result', { message: { source: { callId: 'c1' }, content: [{ isError: true }] } }, 20),
    ]);
    expect(steps.find((s) => s.kind === 'tool')?.status).toBe('error');
  });

  it('未落回的工具调用保留 running', () => {
    const steps = projectTrajectory([
      ev(0, 'turn/start', {}, 0),
      ev(1, 'tool/call', { callId: 'c9', name: 'grep', arguments: '{}' }, 10),
    ]);
    const tool = steps.find((s) => s.kind === 'tool')!;
    expect(tool.status).toBe('running');
    expect(tool.durationMs).toBeNull();
  });

  it('turn 计数随 turn/start 递增', () => {
    const steps = projectTrajectory([
      ev(0, 'turn/start', {}, 0),
      ev(1, 'user/message', { content: [{ type: 'text', text: '一' }] }, 0),
      ev(2, 'turn/end', { reason: { kind: 'completed' } }, 0),
      ev(3, 'turn/start', {}, 0),
      ev(4, 'user/message', { content: [{ type: 'text', text: '二' }] }, 0),
    ]);
    expect(steps.filter((s) => s.kind === 'user').map((s) => s.turn)).toEqual([1, 2]);
  });

  it('忽略上下文注入与未知事件', () => {
    const steps = projectTrajectory([
      ev(0, 'user/message', { source: { kind: 'plugin' }, content: [{ type: 'text', text: '注入' }] }),
      ev(1, 'some/unknown/event', {}),
      ev(2, 'compaction/summary', { shadowedSeqs: [1, 2], shadowedTokenCount: 30 }),
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.kind).toBe('compaction');
    expect(steps[0]!.detail).toBe('2 条 · 30 tokens');
  });
});

describe('summarizeTrajectory', () => {
  it('统计回合数、工具数、工具耗时与错误数', () => {
    const steps = projectTrajectory([
      ev(0, 'turn/start', {}, 0),
      ev(1, 'tool/call', { callId: 'a', name: 'bash', arguments: '{}' }, 0),
      ev(2, 'tool/result', { message: { source: { callId: 'a' }, content: [{ isError: true }] } }, 300),
      ev(3, 'tool/call', { callId: 'b', name: 'read', arguments: '{}' }, 300),
      ev(4, 'tool/result', { message: { source: { callId: 'b' }, content: [] } }, 500),
    ]);
    expect(summarizeTrajectory(steps)).toEqual({ turns: 1, tools: 2, toolMs: 500, errors: 1 });
  });
});
