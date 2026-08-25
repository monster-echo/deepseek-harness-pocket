/**
 * 预览文件策略：扩展名白名单 → MIME，与路径合法性检查。
 * 白名单外的扩展名一律拒绝（不该让手机把 worker 当任意文件服务器）。
 */

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  wasm: 'application/wasm',
}

/** 扩展名 → MIME；白名单外返回 undefined。 */
export function mimeOfPath(path: string): string | undefined {
  const dot = path.lastIndexOf('.')
  const slash = path.lastIndexOf('/')
  if (dot <= slash + 1) return undefined // 无扩展名或点号在目录段
  return MIME_BY_EXT[path.slice(dot + 1).toLowerCase()]
}

/**
 * 逻辑路径合法性：绝对路径、无 '..' 段（防穿越）。
 * workspace 根匹配由 hub 调用方完成（这里只做句法检查）。
 */
export function isSafePreviewPath(path: string): boolean {
  if (!path.startsWith('/') || path.includes('\0')) return false
  const segments = path.split('/')
  return !segments.some((s) => s === '..' || s === '.')
}

/** 判断 child 逻辑路径是否位于 root 内（含等于 root）。 */
export function isUnderRoot(root: string, child: string): boolean {
  if (root === child) return true
  return child.startsWith(root.endsWith('/') ? root : `${root}/`)
}
