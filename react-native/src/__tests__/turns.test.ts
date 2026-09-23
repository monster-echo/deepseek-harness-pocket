import { describe, expect, it } from 'vitest';
import { groupTurns, shouldFold } from '../features/conversation/turns';
import type { TimelineItem } from '../features/conversation/reducer';

function item(key: string, kind: TimelineItem['kind'], extra: Partial<TimelineItem> = {}): TimelineItem {
  return { key, kind, ...extra };
}

describe('groupTurns', () => {
  it('按用户消息切分回合，最后一条 assistant 常显', () => {
    const groups = groupTurns([
      item('u1', 'user', { text: '一' }),
      item('a1', 'assistant'),
      item('t1', 'tool'),
      item('a2', 'assistant'),
      item('e1', 'turnEnd'),
      item('u2', 'user', { text: '二' }),
      item('a3', 'assistant'),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.user?.text).toBe('一');
    expect(groups[0]?.process.map((i) => i.key)).toEqual(['a1', 't1']);
    expect(groups[0]?.result.map((i) => i.key)).toEqual(['a2', 'e1']);
    expect(groups[0]?.toolCount).toBe(1);
    expect(groups[1]?.process).toHaveLength(0);
    expect(groups[1]?.result.map((i) => i.key)).toEqual(['a3']);
  });

  it('没有 assistant 时 turnEnd 进 result，其余进 process', () => {
    const groups = groupTurns([
      item('u1', 'user'),
      item('t1', 'tool'),
      item('n1', 'notice'),
      item('e1', 'turnEnd'),
    ]);
    expect(groups[0]?.process.map((i) => i.key)).toEqual(['t1', 'n1']);
    expect(groups[0]?.result.map((i) => i.key)).toEqual(['e1']);
  });

  it('首项不是 user 也能成组', () => {
    const groups = groupTurns([item('n1', 'notice'), item('a1', 'assistant')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.user).toBeNull();
    expect(groups[0]?.result.map((i) => i.key)).toEqual(['a1']);
  });

  it('空输入返回空', () => {
    expect(groupTurns([])).toEqual([]);
  });

  it('回合内所有条目都会被分配，不丢项', () => {
    const items = [
      item('u1', 'user'), item('a1', 'assistant'), item('c1', 'compaction'),
      item('t1', 'tool'), item('a2', 'assistant'), item('e1', 'turnEnd'),
    ];
    const groups = groupTurns(items);
    const seen = new Set<string>();
    for (const g of groups) {
      if (g.user) seen.add(g.user.key);
      g.process.forEach((i) => seen.add(i.key));
      g.result.forEach((i) => seen.add(i.key));
    }
    expect(seen.size).toBe(items.length);
  });
});

describe('shouldFold', () => {
  it('过程项太少不折叠', () => {
    const groups = groupTurns([
      item('u1', 'user'), item('a1', 'assistant'), item('a2', 'assistant'),
    ]);
    expect(shouldFold(groups[0]!)).toBe(false);
  });

  it('过程项超过阈值才折叠', () => {
    const groups = groupTurns([
      item('u1', 'user'),
      item('a1', 'assistant'), item('t1', 'tool'), item('t2', 'tool'), item('n1', 'notice'),
      item('a2', 'assistant'),
    ]);
    expect(groups[0]?.process).toHaveLength(4);
    expect(shouldFold(groups[0]!)).toBe(true);
  });
});
