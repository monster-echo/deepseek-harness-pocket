/**
 * ServerRequest：插件要求手机端做出响应的请求（审批 / 用户问题）。
 *
 * 对应 dsh 的 permission seam 与 user-questions 工具。
 * 手机端以 `permissions.respond` / `questions.respond` RPC 回传决策。
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

export interface UserQuestionBody {
  readonly requestId: string
  readonly sessionId: string
  readonly question: string
  /** 预设选项（可空 = 自由输入） */
  readonly options?: readonly string[]
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

export interface QuestionRespondArgs {
  readonly requestId: string
  readonly answer: string
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
    let options: readonly string[] | undefined
    if (Array.isArray(b.options)) {
      if (!b.options.every((o) => typeof o === 'string')) return null
      options = b.options as string[]
    }
    const body: UserQuestionBody = options === undefined
      ? { requestId: b.requestId, sessionId: b.sessionId, question: b.question }
      : { requestId: b.requestId, sessionId: b.sessionId, question: b.question, options }
    return { kind: 'question', body }
  }
  return null
}
