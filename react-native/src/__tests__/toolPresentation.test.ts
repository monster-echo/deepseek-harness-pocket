import { describe, expect, it } from 'vitest';
import { collapseContext, describeTool, diffLines } from '../features/conversation/toolPresentation';

describe('diffLines', () => {
  it('标记新增、删除与上下文行', () => {
    const result = diffLines('a\nb\nc', 'a\nB\nc');
    expect(result.added).toBe(1);
    expect(result.removed).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.lines.map((l) => l.kind)).toEqual(['context', 'del', 'add', 'context']);
  });

  it('纯新增（write）没有删除行', () => {
    const result = diffLines('', 'x\ny');
    expect(result.removed).toBe(0);
    expect(result.added).toBe(2);
  });

  it('超长输入退化为整块增删并标记 truncated', () => {
    const big = Array.from({ length: 401 }, (_, i) => `line ${i}`).join('\n');
    const result = diffLines('', big);
    expect(result.truncated).toBe(true);
    expect(result.added).toBe(401);
  });
});

describe('collapseContext', () => {
  it('把远离变更的上下文折叠成省略号', () => {
    const lines = [
      ...Array.from({ length: 10 }, () => ({ kind: 'context' as const, text: 'same' })),
      { kind: 'add' as const, text: 'new' },
      ...Array.from({ length: 10 }, () => ({ kind: 'context' as const, text: 'same' })),
    ];
    const collapsed = collapseContext(lines, 2);
    expect(collapsed.some((l) => l.text === '…')).toBe(true);
    expect(collapsed.some((l) => l.text === 'new')).toBe(true);
    expect(collapsed.length).toBeLessThan(lines.length);
  });
});

describe('describeTool', () => {
  it('edit 生成 diff', () => {
    const d = describeTool('edit', JSON.stringify({
      file_path: 'src/a.ts', old_string: 'const a = 1', new_string: 'const a = 2',
    }));
    expect(d.kind).toBe('edit');
    expect(d.summary).toBe('src/a.ts');
    expect(d.diff?.added).toBe(1);
    expect(d.diff?.removed).toBe(1);
  });

  it('todo_write 解析待办清单与状态', () => {
    const d = describeTool('todo_write', JSON.stringify({
      todos: [
        { content: '写 reducer', status: 'completed' },
        { content: '接 UI', status: 'in_progress' },
        { content: '补测试', status: 'pending' },
      ],
    }));
    expect(d.kind).toBe('todo');
    expect(d.todos).toHaveLength(3);
    expect(d.todos?.[0]?.status).toBe('completed');
    expect(d.todos?.[1]?.status).toBe('in_progress');
    expect(d.summary).toBe('3 项');
  });

  it('present 解析交付文件', () => {
    const d = describeTool('present', JSON.stringify({ files: ['a.md', { path: 'b.png' }] }));
    expect(d.kind).toBe('present');
    expect(d.files).toEqual(['a.md', 'b.png']);
  });

  it('skill 提取技能名', () => {
    const d = describeTool('skill', JSON.stringify({ name: 'frontend-design' }));
    expect(d.kind).toBe('skill');
    expect(d.skill?.name).toBe('frontend-design');
  });

  it('未知工具与坏 JSON 不抛错', () => {
    const d = describeTool('mystery_tool', '{not json');
    expect(d.kind).toBe('generic');
    expect(d.title).toBe('mystery_tool');
  });

  it('bash 摘要优先取 description', () => {
    const d = describeTool('bash', JSON.stringify({ description: '跑测试', command: 'npm test' }));
    expect(d.variant).toBe('Bash');
    expect(d.summary).toBe('跑测试');
  });
});
