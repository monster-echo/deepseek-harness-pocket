/**
 * 工具调用呈现层（批次 1 的纯逻辑部分）。
 *
 * 把 `tool/call` 的 name + arguments 归一成 UI 可直接渲染的描述符：
 * diff（edit/write）、待办清单（todo_write）、技能、交付文件、子代理/工作流等。
 * 纯函数、无 React 依赖，便于单测。
 */

export type ToolKind =
  | 'bash'
  | 'read'
  | 'write'
  | 'edit'
  | 'search'
  | 'web'
  | 'code'
  | 'todo'
  | 'skill'
  | 'present'
  | 'question'
  | 'subagent'
  | 'workflow'
  | 'cordis'
  | 'generic'

export type ToolVariantName = 'Bash' | 'Read' | 'Write' | 'Edit' | 'Search' | 'Code' | 'Tool'

export type DiffLineKind = 'context' | 'add' | 'del'

export interface DiffLine {
  readonly kind: DiffLineKind
  readonly text: string
}

export interface ToolDiff {
  readonly path: string
  readonly lines: readonly DiffLine[]
  readonly added: number
  readonly removed: number
  /** 变更过大时只给统计，不逐行渲染 */
  readonly truncated: boolean
}

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface TodoEntry {
  readonly text: string
  readonly status: TodoStatus
}

export interface ToolDescriptor {
  readonly kind: ToolKind
  readonly variant: ToolVariantName
  /** 工具名（用于未知工具的兜底展示） */
  readonly name: string
  readonly title: string
  readonly summary: string
  readonly diff?: ToolDiff
  readonly todos?: readonly TodoEntry[]
  readonly skill?: Readonly<{ name: string }>
  readonly files?: readonly string[]
}

type Args = Record<string, unknown>

const DIFF_LINE_CAP = 400

function parseArgs(argsJson: string): Args {
  if (argsJson.length === 0) return {}
  try {
    const parsed = JSON.parse(argsJson) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Args)
      : {}
  } catch {
    // arguments 流式聚合期间可能不是完整 JSON
    return {}
  }
}

function pickString(args: Args, ...keys: string[]): string {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return ''
}

/** 逐行 LCS diff；超出上限时退化为整块增删并标记 truncated。 */
export function diffLines(oldText: string, newText: string): Readonly<{ lines: readonly DiffLine[]; added: number; removed: number; truncated: boolean }> {
  const a = oldText.length === 0 ? [] : oldText.split('\n')
  const b = newText.length === 0 ? [] : newText.split('\n')
  if (a.length > DIFF_LINE_CAP || b.length > DIFF_LINE_CAP) {
    return {
      lines: [
        ...a.map((text): DiffLine => ({ kind: 'del', text })),
        ...b.map((text): DiffLine => ({ kind: 'add', text })),
      ],
      added: b.length,
      removed: a.length,
      truncated: true,
    }
  }

  // LCS 表
  const width = b.length + 1
  const table = new Uint32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = a[i] === b[j]
        ? table[(i + 1) * width + (j + 1)]! + 1
        : Math.max(table[(i + 1) * width + j]!, table[i * width + (j + 1)]!)
    }
  }

  const lines: DiffLine[] = []
  let added = 0
  let removed = 0
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: 'context', text: a[i]! })
      i += 1
      j += 1
    } else if (table[(i + 1) * width + j]! >= table[i * width + (j + 1)]!) {
      lines.push({ kind: 'del', text: a[i]! })
      removed += 1
      i += 1
    } else {
      lines.push({ kind: 'add', text: b[j]! })
      added += 1
      j += 1
    }
  }
  while (i < a.length) { lines.push({ kind: 'del', text: a[i]! }); removed += 1; i += 1 }
  while (j < b.length) { lines.push({ kind: 'add', text: b[j]! }); added += 1; j += 1 }
  return { lines, added, removed, truncated: false }
}

/** 上下文行压缩：只保留变更行前后各 N 行，其余折叠。 */
export function collapseContext(lines: readonly DiffLine[], context = 3): readonly DiffLine[] {
  const keep = new Set<number>()
  lines.forEach((line, index) => {
    if (line.kind === 'context') return
    for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k += 1) {
      keep.add(k)
    }
  })
  if (keep.size === lines.length) return lines
  const out: DiffLine[] = []
  let skipping = false
  lines.forEach((line, index) => {
    if (keep.has(index)) {
      skipping = false
      out.push(line)
    } else if (!skipping) {
      skipping = true
      out.push({ kind: 'context', text: '…' })
    }
  })
  return out
}

function asTodoStatus(raw: unknown): TodoStatus {
  if (raw === 'completed' || raw === 'done') return 'completed'
  if (raw === 'in_progress' || raw === 'in-progress' || raw === 'active') return 'in_progress'
  return 'pending'
}

function pickTodos(args: Args): readonly TodoEntry[] | undefined {
  const raw = args['todos']
  if (!Array.isArray(raw)) return undefined
  const todos: TodoEntry[] = []
  for (const entry of raw) {
    if (typeof entry === 'string') {
      todos.push({ text: entry, status: 'pending' })
      continue
    }
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Args
    const text = pickString(e, 'content', 'text', 'title', 'task')
    if (text.length === 0) continue
    todos.push({ text, status: asTodoStatus(e['status']) })
  }
  return todos.length > 0 ? todos : undefined
}

function pickFiles(args: Args): readonly string[] | undefined {
  const raw = args['files']
  if (!Array.isArray(raw)) return undefined
  const files: string[] = []
  for (const entry of raw) {
    if (typeof entry === 'string' && entry.length > 0) files.push(entry)
    else if (typeof entry === 'object' && entry !== null) {
      const path = pickString(entry as Args, 'path', 'file', 'name')
      if (path.length > 0) files.push(path)
    }
  }
  return files.length > 0 ? files : undefined
}

/** 归一化工具调用为可渲染描述符。 */
export function describeTool(name: string, argsJson: string): ToolDescriptor {
  const args = parseArgs(argsJson)
  const path = pickString(args, 'path', 'file_path', 'filePath', 'file')

  switch (name) {
    case 'bash':
    case 'pwsh':
      return {
        kind: 'bash', variant: 'Bash', name,
        title: '终端',
        summary: pickString(args, 'description', 'command') || argsJson.slice(0, 80),
      }

    case 'read':
    case 'read_image':
      return { kind: 'read', variant: 'Read', name, title: '读取', summary: path }

    case 'web_fetch':
      return { kind: 'web', variant: 'Read', name, title: '抓取网页', summary: pickString(args, 'url') }

    case 'web_search':
      return { kind: 'web', variant: 'Search', name, title: '网页搜索', summary: pickString(args, 'query') }

    case 'grep':
    case 'glob':
      return { kind: 'search', variant: 'Search', name, title: '检索', summary: pickString(args, 'pattern', 'query') }

    case 'edit': {
      const oldText = pickString(args, 'old_string', 'old_str', 'oldText')
      const newText = pickString(args, 'new_string', 'new_str', 'newText')
      const diff = oldText.length > 0 || newText.length > 0
        ? { path, ...diffLines(oldText, newText) }
        : undefined
      return { kind: 'edit', variant: 'Edit', name, title: '编辑', summary: path, diff }
    }

    case 'write': {
      const content = pickString(args, 'content', 'text')
      const diff = content.length > 0
        ? { path, ...diffLines('', content), truncated: content.split('\n').length > DIFF_LINE_CAP }
        : undefined
      return { kind: 'write', variant: 'Write', name, title: '写入', summary: path, diff }
    }

    case 'str_replace_editor':
    case 'str_replace_based_edit_tool': {
      const command = pickString(args, 'command')
      const oldText = pickString(args, 'old_str', 'old_string')
      const newText = pickString(args, 'new_str', 'new_string')
      const diff = command === 'str_replace' || oldText.length > 0
        ? { path, ...diffLines(oldText, newText) }
        : undefined
      return { kind: 'edit', variant: 'Edit', name, title: '编辑', summary: path || command, diff }
    }

    case 'run_code':
      return { kind: 'code', variant: 'Code', name, title: '运行代码', summary: pickString(args, 'language', 'description') }

    case 'todo_write':
      return { kind: 'todo', variant: 'Tool', name, title: '待办', summary: pickTodos(args)?.length ? `${pickTodos(args)!.length} 项` : '', todos: pickTodos(args) }

    case 'skill':
      return { kind: 'skill', variant: 'Tool', name, title: '技能', summary: pickString(args, 'name', 'skill'), skill: { name: pickString(args, 'name', 'skill') } }

    case 'present':
      return { kind: 'present', variant: 'Tool', name, title: '交付文件', summary: pickFiles(args)?.length ? `${pickFiles(args)!.length} 个文件` : '', files: pickFiles(args) }

    case 'ask_user_question':
      return { kind: 'question', variant: 'Tool', name, title: '提问', summary: pickString(args, 'question') }

    case 'subagent':
    case 'task':
      return { kind: 'subagent', variant: 'Tool', name, title: '子代理', summary: pickString(args, 'description', 'prompt').slice(0, 80) }

    case 'workflow':
      return { kind: 'workflow', variant: 'Tool', name, title: '工作流', summary: pickString(args, 'name', 'description') }

    case 'cordis_define':
    case 'cordis_run':
    case 'cordis_stop':
    case 'cordis_undefine':
      return { kind: 'cordis', variant: 'Tool', name, title: 'Cordis 插件', summary: name }

    default:
      return {
        kind: 'generic', variant: 'Tool', name,
        title: name,
        summary: argsJson.length > 0 ? argsJson.slice(0, 80) : '',
      }
  }
}
