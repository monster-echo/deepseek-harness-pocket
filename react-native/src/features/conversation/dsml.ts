/**
 * DSML 文本协议防御解析。
 *
 * DeepSeek 模型在部分场景不吐标准 tool_calls，而是把工具调用以官方
 * DSML 文本标记写进 content（dsh 当前 rc 的 adapter 未解析，见
 * assistant/message 的 text 块）。这里在渲染层把：
 *
 *   前导正文<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="bash">
 *   <parameter name="command" string="true">…</｜｜DSML｜｜parameter>
 *   </｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>
 *
 * 拆为 { prose, calls[] }——正文照常渲染，工具调用显示为内联工具卡
 * （标注"未执行"）。分隔符为全角竖线 U+FF5C。
 */

const SEP = '｜｜' // ｜｜

export interface DsmlToolCall {
  readonly name: string
  readonly summary: string
  readonly raw: string
}

export interface DsmlSplit {
  readonly prose: string
  readonly calls: readonly DsmlToolCall[]
}

const TOOL_CALLS_OPEN = `<${SEP}DSML${SEP}tool_calls>`

function extractCalls(block: string): DsmlToolCall[] {
  const calls: DsmlToolCall[] = []
  const invokeRe = new RegExp(`<${SEP}DSML${SEP}invoke name="([^"]+)">([\\s\\S]*?)</${SEP}DSML${SEP}invoke>`, 'g')
  let match: RegExpExecArray | null
  while ((match = invokeRe.exec(block)) !== null) {
    const name = match[1] ?? 'tool'
    const body = match[2] ?? ''
    const params = new Map<string, string>()
    const paramRe = new RegExp(`<parameter name="([^"]+)"[^>]*>([\\s\\S]*?)</${SEP}DSML${SEP}parameter>`, 'g')
    let pm: RegExpExecArray | null
    while ((pm = paramRe.exec(body)) !== null) {
      params.set(pm[1] ?? '', (pm[2] ?? '').trim())
    }
    const summary = params.get('description') ?? params.get('command') ?? params.get('path') ?? params.get('query') ?? name
    calls.push({ name, summary: summary.replace(/\s+/g, ' ').slice(0, 120), raw: body.trim() })
  }
  return calls
}

/** 拆分文本：DSML tool_calls 段（可多段）→ 工具调用；其余 → 正文。 */
export function splitDsml(text: string): DsmlSplit {
  if (!text.includes('DSML')) return { prose: text, calls: [] }
  const calls: DsmlToolCall[] = []
  let prose = ''
  let cursor = 0
  const segmentRe = new RegExp(`${TOOL_CALLS_OPEN}([\\s\\S]*?)</${SEP}DSML${SEP}tool_calls>`, 'g')
  let seg: RegExpExecArray | null
  while ((seg = segmentRe.exec(text)) !== null) {
    const start = seg.index
    prose = `${prose}${text.slice(cursor, start)}`
    cursor = start + seg[0].length
    calls.push(...extractCalls(seg[1] ?? ''))
  }
  prose = `${prose}${text.slice(cursor)}`
  return { prose: prose.trim(), calls }
}

/** 流式文本中 DSML 起始后不再展示（标记逐字到达时避免闪原文）。 */
export function cutAtDsmlStart(text: string): string {
  const idx = text.indexOf(TOOL_CALLS_OPEN)
  return idx >= 0 ? text.slice(0, idx) : text
}
