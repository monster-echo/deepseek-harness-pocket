/**
 * 消息级反馈（对齐 dsh-message-feedback）。
 *
 * 宿主侧由 `ctx.messageFeedback` 持有：list / put / delete 三个操作，
 * 以 assistant 消息的 `messageId` 为键，`version` 作 compare-and-set。
 */
export type FeedbackRating = 'positive' | 'negative';
export type FeedbackCategory = 'task-result' | 'instruction-following' | 'product-interaction' | 'service-stability' | 'resource-cost' | 'security-privacy-permission' | 'other';
/** 顺序与 Web 反馈对话框的 7 个分类芯片一致。 */
export declare const FEEDBACK_CATEGORIES: readonly FeedbackCategory[];
export declare const FEEDBACK_CATEGORY_LABELS: Readonly<Record<FeedbackCategory, string>>;
export interface FeedbackItem {
    readonly messageId: string;
    readonly rating: FeedbackRating;
    readonly note?: string;
    readonly category?: FeedbackCategory;
    /** 不透明 CAS token；delete 必带 */
    readonly version: string;
    readonly createdAt: number;
    readonly updatedAt: number;
}
/** 宽松解析单条反馈；结构不合法返回 null。 */
export declare function parseFeedbackItem(value: unknown): FeedbackItem | null;
/** 宽松解析反馈列表；整体非法返回 null。 */
export declare function parseFeedbackItems(value: unknown): readonly FeedbackItem[] | null;
