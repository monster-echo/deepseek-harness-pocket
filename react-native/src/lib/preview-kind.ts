/**
 * 文档预览的类型选择（纯函数）。
 *
 * 对齐 Web 的 "Open with" 渲染器菜单：文本 / Markdown / 代码 / HTML / 图片。
 * 抽成纯函数便于单测，也避免组件文件被测试环境导入 react-native。
 */

export type PreviewKind = 'html' | 'image' | 'markdown' | 'code' | 'text';

const CODE_EXT = new Set([
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'json', 'css', 'scss', 'less',
  'yml', 'yaml', 'toml', 'xml', 'sh', 'bash', 'zsh', 'py', 'rb', 'go', 'rs',
  'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sql', 'ini', 'env',
]);

/** 命中 HTML/SVG 走 WebView（可运行/可缩放），图片同理。 */
export function previewKind(name: string, mime: string): PreviewKind {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  if (ext === 'html' || ext === 'htm' || ext === 'svg' || mime.includes('html') || mime.includes('svg')) {
    return 'html';
  }
  if (mime.startsWith('image/')) return 'image';
  if (ext === 'md' || ext === 'markdown' || mime.includes('markdown')) return 'markdown';
  if (CODE_EXT.has(ext)) return 'code';
  return 'text';
}
