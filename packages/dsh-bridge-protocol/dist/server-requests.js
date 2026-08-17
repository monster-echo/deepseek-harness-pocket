/**
 * ServerRequest：插件要求手机端做出响应的请求（审批 / 用户问题）。
 *
 * 对应 dsh 的 permission seam 与 user-questions 工具。
 * 手机端以 `permissions.respond` / `questions.respond` RPC 回传决策。
 */
export function parseServerRequest(value) {
    if (typeof value !== 'object' || value === null)
        return null;
    const v = value;
    const body = v.body;
    if (typeof body !== 'object' || body === null)
        return null;
    const b = body;
    if (typeof b.requestId !== 'string' || typeof b.sessionId !== 'string')
        return null;
    if (v.kind === 'permission') {
        if (typeof b.summary !== 'string')
            return null;
        const detail = b.detail;
        if (detail !== undefined && (typeof detail !== 'object' || detail === null))
            return null;
        const body = detail === undefined
            ? { requestId: b.requestId, sessionId: b.sessionId, summary: b.summary }
            : {
                requestId: b.requestId,
                sessionId: b.sessionId,
                summary: b.summary,
                detail: detail,
            };
        return { kind: 'permission', body };
    }
    if (v.kind === 'question') {
        if (typeof b.question !== 'string')
            return null;
        let options;
        if (Array.isArray(b.options)) {
            if (!b.options.every((o) => typeof o === 'string'))
                return null;
            options = b.options;
        }
        const body = options === undefined
            ? { requestId: b.requestId, sessionId: b.sessionId, question: b.question }
            : { requestId: b.requestId, sessionId: b.sessionId, question: b.question, options };
        return { kind: 'question', body };
    }
    return null;
}
//# sourceMappingURL=server-requests.js.map