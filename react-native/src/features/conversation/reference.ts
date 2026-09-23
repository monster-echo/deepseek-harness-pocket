/**
 * @ 文件引用的纯逻辑（批次 3）。
 *
 * 复用 `fs.list` 在工作区内逐级浏览：过滤当前目录、生成面包屑、
 * 把绝对路径转成插入到输入框的相对引用路径。
 */

export interface MentionEntry {
  readonly name: string
  readonly path: string
  readonly type: 'file' | 'directory'
}

export interface MentionCrumb {
  readonly label: string
  readonly path: string
}

/** 绝对路径 → 相对工作区根的引用路径（不在根内时原样返回）。 */
export function relativeToRoot(abs: string, root: string | null): string {
  if (root === null) return abs
  return abs.startsWith(`${root}/`) ? abs.slice(root.length + 1) : abs
}

/** 含空格的路径按 Web 约定加引号：`@"path with spaces"`。 */
export function formatMentionRef(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path
}

/**
 * 在当前目录内按 @ 后的关键字过滤。
 * 关键字含 `/` 时只取最后一段（例如 `@src/comp` 按 `comp` 过滤当前目录）。
 */
export function filterMentionEntries(
  entries: readonly MentionEntry[],
  query: string,
): readonly MentionEntry[] {
  const needle = query.includes('/') ? query.slice(query.lastIndexOf('/') + 1) : query
  if (needle.length === 0) return entries
  const lower = needle.toLowerCase()
  return entries.filter((entry) => entry.name.toLowerCase().includes(lower))
}

/** 当前目录相对根的面包屑（在根目录时为空）。 */
export function mentionBreadcrumb(root: string | null, dir: string | null): readonly MentionCrumb[] {
  if (root === null || dir === null || dir === root) return []
  const rel = relativeToRoot(dir, root)
  const parts = rel.split('/').filter(Boolean)
  const crumbs: MentionCrumb[] = []
  let acc = root
  for (const part of parts) {
    acc = `${acc}/${part}`
    crumbs.push({ label: part, path: acc })
  }
  return crumbs
}
