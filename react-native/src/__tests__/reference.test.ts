import { describe, expect, it } from 'vitest';
import {
  filterMentionEntries,
  formatMentionRef,
  mentionBreadcrumb,
  relativeToRoot,
  type MentionEntry,
} from '../features/conversation/reference';

const entries: readonly MentionEntry[] = [
  { name: 'src', path: '/ws/proj/src', type: 'directory' },
  { name: 'README.md', path: '/ws/proj/README.md', type: 'file' },
  { name: 'package.json', path: '/ws/proj/package.json', type: 'file' },
];

describe('relativeToRoot', () => {
  it('去掉工作区根前缀', () => {
    expect(relativeToRoot('/ws/proj/src/a.ts', '/ws/proj')).toBe('src/a.ts');
  });

  it('不在根内时原样返回', () => {
    expect(relativeToRoot('/other/a.ts', '/ws/proj')).toBe('/other/a.ts');
  });

  it('无根时原样返回', () => {
    expect(relativeToRoot('/ws/proj/src/a.ts', null)).toBe('/ws/proj/src/a.ts');
  });

  it('根自身不产生空串歧义', () => {
    expect(relativeToRoot('/ws/proj2/a', '/ws/proj')).toBe('/ws/proj2/a');
  });
});

describe('filterMentionEntries', () => {
  it('空关键字返回全部', () => {
    expect(filterMentionEntries(entries, '')).toHaveLength(3);
  });

  it('按名字子串过滤且大小写不敏感', () => {
    expect(filterMentionEntries(entries, 'read').map((e) => e.name)).toEqual(['README.md']);
    expect(filterMentionEntries(entries, 'PACKAGE').map((e) => e.name)).toEqual(['package.json']);
  });

  it('关键字含斜杠时只取最后一段（目录钻取场景）', () => {
    expect(filterMentionEntries(entries, 'src/read').map((e) => e.name)).toEqual(['README.md']);
  });

  it('无匹配返回空数组', () => {
    expect(filterMentionEntries(entries, 'zzz')).toEqual([]);
  });
});

describe('mentionBreadcrumb', () => {
  it('根目录无面包屑', () => {
    expect(mentionBreadcrumb('/ws/proj', '/ws/proj')).toEqual([]);
    expect(mentionBreadcrumb('/ws/proj', null)).toEqual([]);
  });

  it('逐级生成可点击路径', () => {
    expect(mentionBreadcrumb('/ws/proj', '/ws/proj/src/ui')).toEqual([
      { label: 'src', path: '/ws/proj/src' },
      { label: 'ui', path: '/ws/proj/src/ui' },
    ]);
  });

  it('无根时无面包屑', () => {
    expect(mentionBreadcrumb(null, '/ws/proj/src')).toEqual([]);
  });
});

describe('formatMentionRef', () => {
  it('无空格不加引号', () => {
    expect(formatMentionRef('src/a.ts')).toBe('src/a.ts');
  });

  it('含空格按 Web 约定加引号', () => {
    expect(formatMentionRef('src/my file.ts')).toBe('"src/my file.ts"');
  });
});
