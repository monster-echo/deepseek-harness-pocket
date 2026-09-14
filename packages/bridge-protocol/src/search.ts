/**
 * 会话内容搜索（对齐 Web 侧栏的正文搜索）。
 *
 * 宿主侧由 `ctx.sessionQuery.searchSessions` 提供跨会话全文检索，
 * 每个会话返回最强匹配事件的纯文本片段（snippet）。
 */

export interface SessionSearchHit {
  readonly sessionId: string
  /** 命中事件周围的纯文本片段 */
  readonly snippet: string
  readonly cwd: string | null
  readonly createdAt: number
  readonly live: boolean
}

/** 宽松解析搜索结果；整体非法返回 null。 */
export function parseSessionSearchHits(value: unknown): readonly SessionSearchHit[] | null {
  if (!Array.isArray(value)) return null
  const hits: SessionSearchHit[] = []
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return null
    const h = raw as Record<string, unknown>
    if (typeof h['sessionId'] !== 'string') return null
    hits.push({
      sessionId: h['sessionId'],
      snippet: typeof h['snippet'] === 'string' ? h['snippet'] : '',
      cwd: typeof h['cwd'] === 'string' ? h['cwd'] : null,
      createdAt: typeof h['createdAt'] === 'number' ? h['createdAt'] : 0,
      live: h['live'] === true,
    })
  }
  return hits
}
