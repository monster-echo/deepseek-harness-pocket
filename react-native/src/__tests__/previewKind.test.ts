import { describe, expect, it } from 'vitest';
import { previewKind } from '../lib/preview-kind';

describe('previewKind', () => {
  it('HTML 与 SVG 走 WebView（可运行/缩放）', () => {
    expect(previewKind('index.html', 'text/html; charset=utf-8')).toBe('html');
    expect(previewKind('logo.svg', 'image/svg+xml')).toBe('html');
  });

  it('图片按 mime 判定', () => {
    expect(previewKind('shot.png', 'image/png')).toBe('image');
    expect(previewKind('photo.webp', 'image/webp')).toBe('image');
  });

  it('Markdown 走原生渲染', () => {
    expect(previewKind('README.md', 'text/plain; charset=utf-8')).toBe('markdown');
    expect(previewKind('doc.markdown', 'text/markdown')).toBe('markdown');
  });

  it('常见源码走高亮', () => {
    for (const name of ['a.ts', 'a.tsx', 'a.js', 'a.json', 'a.py', 'a.go', 'a.rs', 'a.css', 'a.yml']) {
      expect(previewKind(name, 'text/plain; charset=utf-8')).toBe('code');
    }
  });

  it('txt/csv 等回落纯文本', () => {
    expect(previewKind('notes.txt', 'text/plain; charset=utf-8')).toBe('text');
    expect(previewKind('data.csv', 'text/csv; charset=utf-8')).toBe('text');
  });

  it('无扩展名不误解码为代码', () => {
    expect(previewKind('Makefile', 'text/plain')).toBe('text');
  });
});
