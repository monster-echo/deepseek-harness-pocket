/**
 * ServerRequest：插件要求手机端做出响应的请求（审批 / 用户问题）。
 *
 * 对应 dsh 的 permission seam 与 user-questions 工具。
 * 手机端以 `permissions.respond` / `questions.respond` RPC 回传决策。
 *
 * 用户问题对齐 dsh-user-questions 的完整契约：
 *   AskUserQuestionItem  { id, question, detail?, header?, options?, multiSelect?, intent? }
 *   AskUserQuestionAnswer { answers: [{ id, selected[], custom? }] }
 * 其中 `intent.kind === 'plan-review'` 表示这是一次计划评审，`intent.approve`
 * 指明「批准」对应的选项 label（其余选项即否决）。
 */

export type PermissionDecision = 'allow' | 'allow-always' | 'deny'

export interface PermissionRequestBody {
  readonly requestId: string
  readonly sessionId: string
  /** 触发审批的工具调用描述（工具名、命令摘要等） */
  readonly summary: string
  /** 结构化细节（工具入参等），由 reducer 按需渲染 */
  readonly detail?: Readonly<Record<string, unknown>>
}

/** 单个可选项（label 必填，description 为附加说明）。 */
export interface UserQuestionOption {
  readonly label: string
  readonly description?: string
}

/** 计划评审意图：`approve` 是「批准」对应的选项 label。 */
export interface UserQuestionIntent {
  readonly kind: 'plan-review'
  readonly approve: string
}

export interface UserQuestionItem {
  /** 调用方提供的稳定 id，回答时回传 */
  readonly id: string
  readonly question: string
  /** 与题干一起渲染、但不进选项 label 的补充说明（计划评审时是计划正文 Markdown） */
  readonly detail?: string
  readonly header?: string
  readonly options?: readonly UserQuestionOption[]
  readonly multiSelect?: boolean
  readonly intent?: UserQuestionIntent
}

export interface UserQuestionBody {
  readonly requestId: string
  readonly sessionId: string
  /** 首题的扁平镜像（兼容旧客户端；新客户端请用 questions） */
  readonly question: string
  /** 首题选项的扁平镜像（兼容旧客户端） */
  readonly options?: readonly string[]
  /** 完整题目列表（多选题 / 计划评审 / 题干补充说明） */
  readonly questions?: readonly UserQuestionItem[]
}

export type ServerRequest =
  | { readonly kind: 'permission'; readonly body: PermissionRequestBody }
  | { readonly kind: 'question'; readonly body: UserQuestionBody }

export interface PermissionRespondArgs {
  readonly requestId: string
  readonly decision: PermissionDecision
  /** deny 时的理由（可选） */
  readonly reason?: string
}

/** 单题答案。 */
export interface QuestionAnswerItem {
  readonly id: string
  /** 选中的选项 label（可多选）；自由输入时为空数组 */
  readonly selected: readonly string[]
  /** 「其他」自由输入 */
  readonly custom?: string
}

export interface QuestionRespondArgs {
  readonly requestId: string
  /** 旧字段：单题自由文本答案（兼容） */
  readonly answer?: string
  /** 新字段：结构化答案（多选题 / 计划评审） */
  readonly answers?: readonly QuestionAnswerItem[]
}

function asStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  if (!value.every((v) => typeof v === 'string')) return undefined
  return value as readonly string[]
}

function parseOptions(value: unknown): readonly UserQuestionOption[] | undefined {
  if (!Array.isArray(value)) return undefined
  const options: UserQuestionOption[] = []
  for (const raw of value) {
    if (typeof raw === 'string') {
      options.push({ label: raw })
      continue
    }
    if (typeof raw !== 'object' || raw === null) return undefined
    const o = raw as Record<string, unknown>
    if (typeof o['label'] !== 'string') return undefined
    options.push(
      typeof o['description'] === 'string'
        ? { label: o['label'], description: o['description'] }
        : { label: o['label'] },
    )
  }
  return options
}

function parseIntent(value: unknown): UserQuestionIntent | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const v = value as Record<string, unknown>
  if (v['kind'] !== 'plan-review') return undefined
  if (typeof v['approve'] !== 'string') return undefined
  return { kind: 'plan-review', approve: v['approve'] }
}

function parseQuestions(value: unknown): readonly UserQuestionItem[] | undefined {
  if (!Array.isArray(value)) return undefined
  const questions: UserQuestionItem[] = []
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return undefined
    const q = raw as Record<string, unknown>
    if (typeof q['id'] !== 'string' || typeof q['question'] !== 'string') return undefined
    const options = parseOptions(q['options'])
    const intent = parseIntent(q['intent'])
    questions.push({
      id: q['id'],
      question: q['question'],
      ...(typeof q['detail'] === 'string' ? { detail: q['detail'] } : {}),
      ...(typeof q['header'] === 'string' ? { header: q['header'] } : {}),
      ...(options !== undefined ? { options } : {}),
      ...(q['multiSelect'] === true ? { multiSelect: true } : {}),
      ...(intent !== undefined ? { intent } : {}),
    })
  }
  return questions
}

export function parseServerRequest(value: unknown): ServerRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  const body = v.body
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  if (typeof b.requestId !== 'string' || typeof b.sessionId !== 'string') return null
  if (v.kind === 'permission') {
    if (typeof b.summary !== 'string') return null
    const detail = b.detail
    if (detail !== undefined && (typeof detail !== 'object' || detail === null)) return null
    const body: PermissionRequestBody = detail === undefined
      ? { requestId: b.requestId, sessionId: b.sessionId, summary: b.summary }
      : {
          requestId: b.requestId,
          sessionId: b.sessionId,
          summary: b.summary,
          detail: detail as Record<string, unknown>,
        }
    return { kind: 'permission', body }
  }
  if (v.kind === 'question') {
    if (typeof b.question !== 'string') return null
    const options = asStringArray(b.options)
    if (b.options !== undefined && options === undefined) return null
    const questions = parseQuestions(b.questions)
    if (b.questions !== undefined && questions === undefined) return null
    const body: UserQuestionBody = {
      requestId: b.requestId,
      sessionId: b.sessionId,
      question: b.question,
      ...(options !== undefined ? { options } : {}),
      ...(questions !== undefined ? { questions } : {}),
    }
    return { kind: 'question', body }
  }
  return null
}

/**
 * 归一化 `questions.respond` 的入参：
 *   - 新：`{ answers: [{ id, selected[], custom? }] }`
 *   - 旧：`{ answer: string }` → 包装成首题的自由输入
 * 返回 null 表示非法。
 */
export function normalizeQuestionAnswers(args: {
  readonly answer?: unknown
  readonly answers?: unknown
}): readonly QuestionAnswerItem[] | null {
  const raw = args.answers
  if (Array.isArray(raw)) {
    const answers: QuestionAnswerItem[] = []
    for (const entry of raw) {
      if (typeof entry !== 'object' || entry === null) return null
      const e = entry as Record<string, unknown>
      if (typeof e['id'] !== 'string') return null
      const selected = e['selected']
      if (!Array.isArray(selected) || !selected.every((s) => typeof s === 'string')) return null
      answers.push({
        id: e['id'],
        selected: selected as readonly string[],
        ...(typeof e['custom'] === 'string' ? { custom: e['custom'] } : {}),
      })
    }
    return answers
  }
  if (typeof args.answer === 'string') {
    return [{ id: '', selected: [], custom: args.answer }]
  }
  return null
}
