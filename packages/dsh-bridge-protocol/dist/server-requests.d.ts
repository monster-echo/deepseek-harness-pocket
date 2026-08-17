/**
 * ServerRequest：插件要求手机端做出响应的请求（审批 / 用户问题）。
 *
 * 对应 dsh 的 permission seam 与 user-questions 工具。
 * 手机端以 `permissions.respond` / `questions.respond` RPC 回传决策。
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
export interface UserQuestionBody {
    readonly requestId: string;
    readonly sessionId: string;
    readonly question: string;
    /** 预设选项（可空 = 自由输入） */
    readonly options?: readonly string[];
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
export interface QuestionRespondArgs {
    readonly requestId: string;
    readonly answer: string;
}
export declare function parseServerRequest(value: unknown): ServerRequest | null;
