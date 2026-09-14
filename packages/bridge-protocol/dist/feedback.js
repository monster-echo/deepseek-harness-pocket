/**
 * 消息级反馈（对齐 dsh-message-feedback）。
 *
 * 宿主侧由 `ctx.messageFeedback` 持有：list / put / delete 三个操作，
 * 以 assistant 消息的 `messageId` 为键，`version` 作 compare-and-set。
 */
/** 顺序与 Web 反馈对话框的 7 个分类芯片一致。 */
export const FEEDBACK_CATEGORIES = [
    'task-result',
    'instruction-following',
    'product-interaction',
    'service-stability',
    'resource-cost',
    'security-privacy-permission',
    'other',
];
export const FEEDBACK_CATEGORY_LABELS = {
    'task-result': '任务结果',
    'instruction-following': '指令遵循',
    'product-interaction': '产品交互',
    'service-stability': '服务稳定性',
    'resource-cost': '资源与耗时',
    'security-privacy-permission': '安全与权限',
    other: '其他',
};
function asCategory(value) {
    return typeof value === 'string' && FEEDBACK_CATEGORIES.includes(value)
        ? value
        : undefined;
}
/** 宽松解析单条反馈；结构不合法返回 null。 */
export function parseFeedbackItem(value) {
    if (typeof value !== 'object' || value === null)
        return null;
    const v = value;
    if (typeof v['messageId'] !== 'string')
        return null;
    if (v['rating'] !== 'positive' && v['rating'] !== 'negative')
        return null;
    if (typeof v['version'] !== 'string')
        return null;
    const category = asCategory(v['category']);
    return {
        messageId: v['messageId'],
        rating: v['rating'],
        ...(typeof v['note'] === 'string' && v['note'].length > 0 ? { note: v['note'] } : {}),
        ...(category !== undefined ? { category } : {}),
        version: v['version'],
        createdAt: typeof v['createdAt'] === 'number' ? v['createdAt'] : 0,
        updatedAt: typeof v['updatedAt'] === 'number' ? v['updatedAt'] : 0,
    };
}
/** 宽松解析反馈列表；整体非法返回 null。 */
export function parseFeedbackItems(value) {
    if (!Array.isArray(value))
        return null;
    const items = [];
    for (const raw of value) {
        const item = parseFeedbackItem(raw);
        if (item === null)
            return null;
        items.push(item);
    }
    return items;
}
//# sourceMappingURL=feedback.js.map