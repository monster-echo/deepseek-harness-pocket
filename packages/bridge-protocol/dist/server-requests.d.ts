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
export type PermissionDecision = 'allow' | 'allow-always' | 'deny';
export interface PermissionRequestBody {
    readonly requestId: string;
    readonly sessionId: string;
    /** 触发审批的工具调用描述（工具名、命令摘要等） */
    readonly summary: string;
    /** 结构化细节（工具入参等），由 reducer 按需渲染 */
    readonly detail?: Readonly<Record<string, unknown>>;
}
/** 单个可选项（label 必填，description 为附加说明）。 */
export interface UserQuestionOption {
    readonly label: string;
    readonly description?: string;
}
/** 计划评审意图：`approve` 是「批准」对应的选项 label。 */
export interface UserQuestionIntent {
    readonly kind: 'plan-review';
    readonly approve: string;
}
export interface UserQuestionItem {
    /** 调用方提供的稳定 id，回答时回传 */
    readonly id: string;
    readonly question: string;
    /** 与题干一起渲染、但不进选项 label 的补充说明（计划评审时是计划正文 Markdown） */
    readonly detail?: string;
    readonly header?: string;
    readonly options?: readonly UserQuestionOption[];
    readonly multiSelect?: boolean;
    readonly intent?: UserQuestionIntent;
}
export interface UserQuestionBody {
    readonly requestId: string;
    readonly sessionId: string;
    /** 首题的扁平镜像（兼容旧客户端；新客户端请用 questions） */
    readonly question: string;
    /** 首题选项的扁平镜像（兼容旧客户端） */
    readonly options?: readonly string[];
    /** 完整题目列表（多选题 / 计划评审 / 题干补充说明） */
    readonly questions?: readonly UserQuestionItem[];
}
export type ServerRequest = {
    readonly kind: 'permission';
    readonly body: PermissionRequestBody;
} | {
    readonly kind: 'question';
    readonly body: UserQuestionBody;
};
export interface PermissionRespondArgs {
    readonly requestId: string;
    readonly decision: PermissionDecision;
    /** deny 时的理由（可选） */
    readonly reason?: string;
}
/** 单题答案。 */
export interface QuestionAnswerItem {
    readonly id: string;
    /** 选中的选项 label（可多选）；自由输入时为空数组 */
    readonly selected: readonly string[];
    /** 「其他」自由输入 */
    readonly custom?: string;
}
export interface QuestionRespondArgs {
    readonly requestId: string;
    /** 旧字段：单题自由文本答案（兼容） */
    readonly answer?: string;
    /** 新字段：结构化答案（多选题 / 计划评审） */
    readonly answers?: readonly QuestionAnswerItem[];
}
export declare function parseServerRequest(value: unknown): ServerRequest | null;
/**
 * 归一化 `questions.respond` 的入参：
 *   - 新：`{ answers: [{ id, selected[], custom? }] }`
 *   - 旧：`{ answer: string }` → 包装成首题的自由输入
 * 返回 null 表示非法。
 */
export declare function normalizeQuestionAnswers(args: {
    readonly answer?: unknown;
    readonly answers?: unknown;
}): readonly QuestionAnswerItem[] | null;
