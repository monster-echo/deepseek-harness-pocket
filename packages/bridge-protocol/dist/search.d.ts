/**
 * 会话内容搜索（对齐 Web 侧栏的正文搜索）。
 *
 * 宿主侧由 `ctx.sessionQuery.searchSessions` 提供跨会话全文检索，
 * 每个会话返回最强匹配事件的纯文本片段（snippet）。
 */
export interface SessionSearchHit {
    readonly sessionId: string;
    /** 命中事件周围的纯文本片段 */
    readonly snippet: string;
    readonly cwd: string | null;
    readonly createdAt: number;
    readonly live: boolean;
}
/** 宽松解析搜索结果；整体非法返回 null。 */
export declare function parseSessionSearchHits(value: unknown): readonly SessionSearchHit[] | null;
