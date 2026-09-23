import { describe, expect, it } from 'vitest';
import type { DshSessionEvent } from '@deepseek-harness-pocket/bridge-protocol';
import { emptySessionView, projectSessionList, reduceSessionEvent } from '../features/conversation/reducer';

function ev(seq: number, type: string, data: Record<string, unknown> = {}, time?: number): DshSessionEvent {
  return { type, seq, data, ...(time !== undefined ? { time } : {}) } as DshSessionEvent;
}

function reduceAll(events: readonly DshSessionEvent[]) {
  return events.reduce(reduceSessionEvent, emptySessionView);
}

describe('reduceSessionEvent — 工具描述符', () => {
  it('edit 工具卡带上 diff 描述符', () => {
    const view = reduceAll([
      ev(0, 'tool/call', {
        callId: 'c1',
        name: 'edit',
        arguments: JSON.stringify({ file_path: 'a.ts', old_string: 'const a = 1', new_string: 'const a = 2' }),
      }),
    ]);
    const item = view.items[0]!;
    expect(item.kind).toBe('tool');
    expect(item.descriptor?.kind).toBe('edit');
    expect(item.descriptor?.diff?.added).toBe(1);
    expect(item.descriptor?.diff?.removed).toBe(1);
  });

  it('todo_write 工具卡带上待办清单', () => {
    const view = reduceAll([
      ev(0, 'tool/call', {
        callId: 'c2',
        name: 'todo_write',
        arguments: JSON.stringify({ todos: [{ content: '写测试', status: 'in_progress' }] }),
      }),
    ]);
    expect(view.items[0]?.descriptor?.todos?.[0]).toEqual({ text: '写测试', status: 'in_progress' });
  });

  it('未知工具仍有 descriptor 兜底（不抛错）', () => {
    const view = reduceAll([ev(0, 'tool/call', { callId: 'c3', name: 'mystery', arguments: 'not-json' })]);
    expect(view.items[0]?.descriptor?.kind).toBe('generic');
  });
});

describe('reduceSessionEvent — 轨迹投影', () => {
  it('时间线之外同时折叠出轨迹步骤', () => {
    const view = reduceAll([
      ev(0, 'turn/start', {}, 1000),
      ev(1, 'user/message', { content: [{ type: 'text', text: '跑测试' }] }, 1000),
      ev(2, 'tool/call', { callId: 'c1', name: 'bash', arguments: '{"command":"npm test"}' }, 1100),
      ev(3, 'tool/result', { message: { source: { callId: 'c1' }, content: [{ content: [{ type: 'text', text: 'ok' }] }] } }, 1600),
      ev(4, 'turn/end', { reason: { kind: 'completed' } }, 1700),
    ]);
    expect(view.trajectory.map((s) => s.kind)).toEqual(['user', 'tool', 'turn-end']);
    const tool = view.trajectory.find((s) => s.kind === 'tool')!;
    expect(tool.durationMs).toBe(500);
    expect(tool.status).toBe('ok');
  });

  it('轨迹 fold 状态在多次 reduce 之间保持（turn 计数不丢）', () => {
    const first = reduceAll([ev(0, 'turn/start', {}, 0), ev(1, 'turn/start', {}, 0)]);
    const second = reduceSessionEvent(first, ev(2, 'user/message', { content: [{ type: 'text', text: 'x' }] }, 0));
    expect(second.trajectory.find((s) => s.kind === 'user')?.turn).toBe(2);
  });

  it('未知事件不产生轨迹步骤', () => {
    const view = reduceAll([ev(0, 'goal/activation-changed', { phase: 'active' })]);
    expect(view.trajectory).toHaveLength(0);
  });
});

describe('emptySessionView', () => {
  it('初始轨迹为空且 fold 可用', () => {
    expect(emptySessionView.trajectory).toEqual([]);
    expect(emptySessionView.trajectoryFold.steps).toEqual([]);
    expect(emptySessionView.trajectoryFold.turn).toBe(0);
  });
});

describe('reduceSessionEvent — 待办与提示行', () => {
  it('todo_write 投影到 sessionView.todos', () => {
    const view = reduceAll([
      ev(0, 'tool/call', {
        callId: 'c1',
        name: 'todo_write',
        arguments: JSON.stringify({ todos: [{ content: 'A', status: 'completed' }, { content: 'B', status: 'pending' }] }),
      }),
    ]);
    expect(view.todos).toHaveLength(2);
    expect(view.todos[0]?.status).toBe('completed');
  });

  it('后续 todo_write 覆盖前一版清单', () => {
    const first = reduceAll([
      ev(0, 'tool/call', { callId: 'c1', name: 'todo_write', arguments: JSON.stringify({ todos: [{ content: 'A', status: 'pending' }] }) }),
    ]);
    const second = reduceSessionEvent(first, ev(1, 'tool/call', {
      callId: 'c2',
      name: 'todo_write',
      arguments: JSON.stringify({ todos: [{ content: 'A', status: 'completed' }, { content: 'B', status: 'in_progress' }] }),
    }));
    expect(second.todos).toHaveLength(2);
    expect(second.todos[1]?.status).toBe('in_progress');
  });

  it('llm/retry 产生可见提示行', () => {
    const view = reduceAll([ev(0, 'llm/retry', { attempt: 2, delayMs: 800 })]);
    expect(view.items[0]?.kind).toBe('notice');
    expect(view.items[0]?.text).toContain('模型重试');
    expect(view.items[0]?.text).toContain('#2');
  });

  it('system/message 产生可见提示行', () => {
    const view = reduceAll([ev(0, 'system/message', { content: [{ type: 'text', text: '会话已恢复' }] })]);
    expect(view.items[0]?.kind).toBe('notice');
    expect(view.items[0]?.text).toBe('会话已恢复');
  });

  it('空 system/message 不产生条目', () => {
    const view = reduceAll([ev(0, 'system/message', { content: [] })]);
    expect(view.items).toHaveLength(0);
  });

  it('emptySessionView 的待办为空且不被污染', () => {
    reduceAll([ev(0, 'tool/call', { callId: 'c1', name: 'todo_write', arguments: JSON.stringify({ todos: [{ content: 'X', status: 'pending' }] }) })]);
    expect(emptySessionView.todos).toEqual([]);
  });
});

describe('reduceSessionEvent — 目标投影', () => {
  const create = ev(0, 'goal/change', {
    kind: 'goal/change',
    version: 1,
    operation: 'create',
    goal: { id: 'g1', revision: 1, objective: '把测试跑绿', phase: 'active', maxGoalRounds: 25 },
    roundsStarted: 0,
    createdAt: 1,
    updatedAt: 1,
  });

  it('create 建立当前目标', () => {
    const view = reduceAll([create]);
    expect(view.goal?.objective).toBe('把测试跑绿');
    expect(view.goal?.phase).toBe('active');
    expect(view.goal?.maxGoalRounds).toBe(25);
  });

  it('pause 更新阶段并保留 roundsStarted', () => {
    const started = reduceSessionEvent(reduceAll([create]), ev(1, 'goal/change', {
      operation: 'pause',
      goal: { id: 'g1', revision: 2, objective: '把测试跑绿', phase: 'paused', maxGoalRounds: 25 },
      roundsStarted: 3,
    }));
    expect(started.goal?.phase).toBe('paused');
    expect(started.goal?.roundsStarted).toBe(3);
  });

  it('blocked 携带原因', () => {
    const view = reduceSessionEvent(reduceAll([create]), ev(1, 'goal/change', {
      operation: 'block',
      goal: { id: 'g1', revision: 2, objective: 'x', phase: 'blocked', blockedReason: { code: 'needs-input', message: '需要你确认' }, maxGoalRounds: 10 },
      roundsStarted: 1,
    }));
    expect(view.goal?.phase).toBe('blocked');
    expect(view.goal?.blockedReason?.message).toBe('需要你确认');
  });

  it('clear 墓碑清空目标', () => {
    const view = reduceSessionEvent(reduceAll([create]), ev(1, 'goal/change', { operation: 'clear', cleared: { id: 'g1', revision: 3 } }));
    expect(view.goal).toBeNull();
  });

  it('activation-changed 只更新匹配目标的 activation', () => {
    const armed = reduceSessionEvent(reduceAll([create]), ev(1, 'goal/activation-changed', { goal: { id: 'g1', revision: 1, activation: 'armed' } }));
    expect(armed.goal?.activation).toBe('armed');
    const other = reduceSessionEvent(armed, ev(2, 'goal/activation-changed', { goal: { id: 'other', revision: 1, activation: 'disarmed' } }));
    expect(other.goal?.activation).toBe('armed');
  });

  it('emptySessionView.goal 保持 null', () => {
    reduceAll([create]);
    expect(emptySessionView.goal).toBeNull();
  });
});

describe('reduceSessionEvent — 计划模式', () => {
  it('plan/mode { active: true } 打开计划模式', () => {
    const view = reduceAll([ev(0, 'plan/mode', { active: true })]);
    expect(view.planActive).toBe(true);
  });

  it('后续 plan/mode 覆盖为关闭', () => {
    const on = reduceAll([ev(0, 'plan/mode', { active: true })]);
    const off = reduceSessionEvent(on, ev(1, 'plan/mode', { active: false }));
    expect(off.planActive).toBe(false);
  });

  it('非法载荷被忽略且不改状态', () => {
    const view = reduceAll([ev(0, 'plan/mode', { active: 'yes' })]);
    expect(view.planActive).toBe(false);
  });
});

describe('reduceSessionEvent — 交付文件挂回合', () => {
  it('present 工具交付的文件挂到 turn/end 条目', () => {
    const view = reduceAll([
      ev(0, 'turn/start', {}, 0),
      ev(1, 'tool/call', { callId: 'c1', name: 'present', arguments: JSON.stringify({ files: ['a.md', 'b.png'] }) }, 10),
      ev(2, 'turn/end', { reason: { kind: 'completed' } }, 20),
    ]);
    const end = view.items.find((i) => i.kind === 'turnEnd')!;
    expect(end.files).toEqual(['a.md', 'b.png']);
  });

  it('没有 present 的回合不带 files 字段', () => {
    const view = reduceAll([
      ev(0, 'turn/start', {}, 0),
      ev(1, 'turn/end', { reason: { kind: 'completed' } }, 20),
    ]);
    expect(view.items.find((i) => i.kind === 'turnEnd')!.files).toBeUndefined();
  });

  it('新回合不继承上一回合的交付文件', () => {
    const first = reduceAll([
      ev(0, 'turn/start', {}, 0),
      ev(1, 'tool/call', { callId: 'c1', name: 'present', arguments: JSON.stringify({ files: ['a.md'] }) }, 10),
      ev(2, 'turn/end', { reason: { kind: 'completed' } }, 20),
    ]);
    const second = reduceSessionEvent(first, ev(3, 'turn/start', {}, 30));
    const after = reduceSessionEvent(second, ev(4, 'turn/end', { reason: { kind: 'completed' } }, 40));
    const ends = after.items.filter((i) => i.kind === 'turnEnd');
    expect(ends[0]?.files).toEqual(['a.md']);
    expect(ends[1]?.files).toBeUndefined();
  });
});

describe('reduceSessionEvent — 消息 id（反馈 CAS 键）', () => {
  it('assistant/message 保留 message.id', () => {
    const view = reduceAll([
      ev(0, 'assistant/message', {
        message: { id: 'm_1', content: [{ type: 'text', text: 'hi' }] },
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    ]);
    const item = view.items.find((i) => i.kind === 'assistant')!;
    expect(item.messageId).toBe('m_1');
  });

  it('branded id 对象也能转成字符串', () => {
    const branded = { toString: () => 'm_2' };
    const view = reduceAll([
      ev(0, 'assistant/message', { message: { id: branded, content: [{ type: 'text', text: 'x' }] } }),
    ]);
    expect(view.items.find((i) => i.kind === 'assistant')?.messageId).toBe('m_2');
  });

  it('缺少 id 时不写 messageId 字段', () => {
    const view = reduceAll([
      ev(0, 'assistant/message', { message: { content: [{ type: 'text', text: 'x' }] } }),
    ]);
    expect(view.items.find((i) => i.kind === 'assistant')?.messageId).toBeUndefined();
  });
});

describe('projectSessionList — 血缘与子代理字段', () => {
  it('解析 parentSession / origin / delegationDepth', () => {
    const items = projectSessionList([
      { id: 'p', createdAt: 1, cwd: '/w', title: '父', parentSession: null, origin: null, delegationDepth: 0 },
      { id: 'c', createdAt: 2, cwd: '/w', title: '子', parentSession: 'p', origin: 'subagent', delegationDepth: 1 },
    ]);
    const child = items.find((i) => i.id === 'c')!;
    expect(child.parentSession).toBe('p');
    expect(child.origin).toBe('subagent');
    expect(child.delegationDepth).toBe(1);
    const parent = items.find((i) => i.id === 'p')!;
    expect(parent.parentSession).toBeNull();
    expect(parent.origin).toBeNull();
    expect(parent.delegationDepth).toBe(0);
  });

  it('branded parentSession 对象转成字符串', () => {
    const items = projectSessionList([
      { id: 'c', createdAt: 1, parentSession: { toString: () => 'p9' } },
    ]);
    expect(items[0]?.parentSession).toBe('p9');
  });

  it('缺失字段时回落安全默认值', () => {
    const items = projectSessionList([{ id: 'x', createdAt: 1 }]);
    expect(items[0]?.parentSession).toBeNull();
    expect(items[0]?.origin).toBeNull();
    expect(items[0]?.delegationDepth).toBe(0);
  });

  it('未知 origin 不被当作子代理', () => {
    const items = projectSessionList([{ id: 'x', createdAt: 1, origin: 'something' }]);
    expect(items[0]?.origin).toBeNull();
  });
});
