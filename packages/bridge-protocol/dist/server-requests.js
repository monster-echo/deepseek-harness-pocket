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
function asStringArray(value) {
    if (!Array.isArray(value))
        return undefined;
    if (!value.every((v) => typeof v === 'string'))
        return undefined;
    return value;
}
function parseOptions(value) {
    if (!Array.isArray(value))
        return undefined;
    const options = [];
    for (const raw of value) {
        if (typeof raw === 'string') {
            options.push({ label: raw });
            continue;
        }
        if (typeof raw !== 'object' || raw === null)
            return undefined;
        const o = raw;
        if (typeof o['label'] !== 'string')
            return undefined;
        options.push(typeof o['description'] === 'string'
            ? { label: o['label'], description: o['description'] }
            : { label: o['label'] });
    }
    return options;
}
function parseIntent(value) {
    if (typeof value !== 'object' || value === null)
        return undefined;
    const v = value;
    if (v['kind'] !== 'plan-review')
        return undefined;
    if (typeof v['approve'] !== 'string')
        return undefined;
    return { kind: 'plan-review', approve: v['approve'] };
}
function parseQuestions(value) {
    if (!Array.isArray(value))
        return undefined;
    const questions = [];
    for (const raw of value) {
        if (typeof raw !== 'object' || raw === null)
            return undefined;
        const q = raw;
        if (typeof q['id'] !== 'string' || typeof q['question'] !== 'string')
            return undefined;
        const options = parseOptions(q['options']);
        const intent = parseIntent(q['intent']);
        questions.push({
            id: q['id'],
            question: q['question'],
            ...(typeof q['detail'] === 'string' ? { detail: q['detail'] } : {}),
            ...(typeof q['header'] === 'string' ? { header: q['header'] } : {}),
            ...(options !== undefined ? { options } : {}),
            ...(q['multiSelect'] === true ? { multiSelect: true } : {}),
            ...(intent !== undefined ? { intent } : {}),
        });
    }
    return questions;
}
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
        const options = asStringArray(b.options);
        if (b.options !== undefined && options === undefined)
            return null;
        const questions = parseQuestions(b.questions);
        if (b.questions !== undefined && questions === undefined)
            return null;
        const body = {
            requestId: b.requestId,
            sessionId: b.sessionId,
            question: b.question,
            ...(options !== undefined ? { options } : {}),
            ...(questions !== undefined ? { questions } : {}),
        };
        return { kind: 'question', body };
    }
    return null;
}
/**
 * 归一化 `questions.respond` 的入参：
 *   - 新：`{ answers: [{ id, selected[], custom? }] }`
 *   - 旧：`{ answer: string }` → 包装成首题的自由输入
 * 返回 null 表示非法。
 */
export function normalizeQuestionAnswers(args) {
    const raw = args.answers;
    if (Array.isArray(raw)) {
        const answers = [];
        for (const entry of raw) {
            if (typeof entry !== 'object' || entry === null)
                return null;
            const e = entry;
            if (typeof e['id'] !== 'string')
                return null;
            const selected = e['selected'];
            if (!Array.isArray(selected) || !selected.every((s) => typeof s === 'string'))
                return null;
            answers.push({
                id: e['id'],
                selected: selected,
                ...(typeof e['custom'] === 'string' ? { custom: e['custom'] } : {}),
            });
        }
        return answers;
    }
    if (typeof args.answer === 'string') {
        return [{ id: '', selected: [], custom: args.answer }];
    }
    return null;
}
//# sourceMappingURL=server-requests.js.map