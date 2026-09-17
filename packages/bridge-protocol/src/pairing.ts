/**
 * Worker 配对二维码（`dshc qr` 打印，手机扫码）。
 *
 * 一个二维码要同时支持两条路径：
 *   1. **同网直连**：手机与电脑在同一 WiFi 时，扫码后可直接用 `host:port`
 *      走 `/mobile/ws`（pairingToken 鉴权），不依赖外网网关。
 *   2. **账号绑定**：扫码后手机用 `code` 调 gateway 的 `pairing/bind`，
 *      把该 Worker 绑到当前账号（之后 presence 里就能看到它）。
 *
 * 负载形态（URI，便于相机/系统分享一并识别）：
 *   dshp://pair?code=123456&name=mac-mini&host=192.168.1.5&port=3780&token=pt_xxx&gw=wss%3A%2F%2F...
 *
 * `token` 可选：带 token 时手机可跳过 6 位码直接直连；`gw` 可选：非默认网关地址。
 *
 * 本包是**零 Node/DOM API** 的纯 TS（与全系统共享协议层一致），
 * 所以这里不依赖 `URL` / `URLSearchParams`，自己解析这一个小 URI。
 */

export const PAIR_QR_SCHEME = 'dshp'
export const PAIR_QR_HOST = 'pair'

export interface PairQrPayload {
  /** 6 位配对码（gateway pairing/bind 用） */
  readonly code: string
  /** Worker 展示名 */
  readonly name?: string
  /** 同网直连主机（局域网 IP 或 mDNS 名） */
  readonly host?: string
  /** 直连端口（默认 3780） */
  readonly port?: number
  /** 直连鉴权 token（bridge-state 的 pairingToken） */
  readonly token?: string
  /** 非默认 gateway 地址（wss://...） */
  readonly gatewayUrl?: string
}

/** 组装二维码负载（Worker 侧使用）。 */
export function encodePairQr(payload: PairQrPayload): string {
  const parts: string[] = [`code=${encodeURIComponent(payload.code)}`]
  if (payload.name !== undefined && payload.name.length > 0) {
    parts.push(`name=${encodeURIComponent(payload.name)}`)
  }
  if (payload.host !== undefined && payload.host.length > 0) {
    parts.push(`host=${encodeURIComponent(payload.host)}`)
  }
  if (payload.port !== undefined) parts.push(`port=${payload.port}`)
  if (payload.token !== undefined && payload.token.length > 0) {
    parts.push(`token=${encodeURIComponent(payload.token)}`)
  }
  if (payload.gatewayUrl !== undefined && payload.gatewayUrl.length > 0) {
    parts.push(`gw=${encodeURIComponent(payload.gatewayUrl)}`)
  }
  return `${PAIR_QR_SCHEME}://${PAIR_QR_HOST}?${parts.join('&')}`
}

function decodeQuery(query: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const chunk of query.split('&')) {
    if (chunk.length === 0) continue
    const eq = chunk.indexOf('=')
    const rawKey = eq >= 0 ? chunk.slice(0, eq) : chunk
    const rawValue = eq >= 0 ? chunk.slice(eq + 1) : ''
    const key = safeDecode(rawKey)
    if (key.length === 0 || out.has(key)) continue
    out.set(key, safeDecode(rawValue))
  }
  return out
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value
  }
}

/** 解析扫码结果；不是配对二维码时返回 null（调用方忽略即可）。 */
export function parsePairQr(text: string): PairQrPayload | null {
  const raw = text.trim()
  if (raw.length === 0) return null
  const prefix = `${PAIR_QR_SCHEME}://`
  if (!raw.startsWith(prefix)) {
    // 兼容 dshp:pair?... 这种省略斜杠的写法
    const alt = `${PAIR_QR_SCHEME}:`
    if (!raw.startsWith(alt)) return null
    const rest = raw.slice(alt.length)
    const withoutSlashes = rest.replace(/^\/+/, '')
    if (!withoutSlashes.startsWith(`${PAIR_QR_HOST}?`)) return null
    return fromQuery(withoutSlashes.slice(PAIR_QR_HOST.length + 1))
  }
  const rest = raw.slice(prefix.length)
  const q = rest.indexOf('?')
  if (q < 0) return null
  const hostPart = rest.slice(0, q).replace(/\/+$/, '')
  if (hostPart !== PAIR_QR_HOST) return null
  return fromQuery(rest.slice(q + 1))
}

function fromQuery(query: string): PairQrPayload | null {
  const params = decodeQuery(query)
  const code = params.get('code') ?? ''
  // 6 位数字码是 gateway 绑定的最低要求；host/token 只是直连增强，可缺失
  if (!/^\d{6}$/.test(code)) return null
  const payload: {
    code: string
    name?: string
    host?: string
    port?: number
    token?: string
    gatewayUrl?: string
  } = { code }
  const name = params.get('name')
  if (name !== undefined && name.length > 0) payload.name = name
  const host = params.get('host')
  if (host !== undefined && host.length > 0) payload.host = host
  const port = Number.parseInt(params.get('port') ?? '', 10)
  if (Number.isFinite(port) && port > 0 && port < 65536) payload.port = port
  const token = params.get('token')
  if (token !== undefined && token.length > 0) payload.token = token
  const gw = params.get('gw')
  if (gw !== undefined && gw.length > 0) payload.gatewayUrl = gw
  return payload
}

/** 直连 WebSocket 地址（同网路径）；host 缺失时为 null。 */
export function pairDirectWsUrl(payload: PairQrPayload): string | null {
  if (payload.host === undefined) return null
  return `ws://${payload.host}:${payload.port ?? 3780}/mobile/ws`
}
