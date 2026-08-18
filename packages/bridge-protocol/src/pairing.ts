/**
 * 配对：Worker 与用户账号的绑定。
 *
 * 两种绑定方式（均经 gateway 向 Worker 挑战确认）：
 * 1. 二维码 payload（dshc 在终端打印 ASCII QR）
 * 2. 6 位配对码（扫码失败的手输兜底）
 */

/** 二维码内容（JSON）。`v` 为 payload 版本，向前兼容。 */
export interface PairingQrPayload {
  readonly v: 1
  /** gateway WebSocket 基地址（wss://… 或 ws://…） */
  readonly gatewayUrl: string
  /** 同网段直连地址（可选，app 优先尝试） */
  readonly lanUrl?: string
  /** Worker 注册凭证（gateway 路由用，非用户凭证） */
  readonly hostKey: string
  /** 端到端配对令牌（仅本次绑定有效，可 rotate） */
  readonly token: string
  /** Worker 指纹（首次绑定时 app 展示给用户核对） */
  readonly fingerprint: string
  /** 6 位配对码（与二维码同源，手输兜底） */
  readonly code: string
}

export function parsePairingQrPayload(text: string): PairingQrPayload | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const v = parsed as Record<string, unknown>
  if (v.v !== 1) return null
  if (typeof v.gatewayUrl !== 'string' || !/^wss?:\/\//.test(v.gatewayUrl)) return null
  if (typeof v.hostKey !== 'string' || v.hostKey.length === 0) return null
  if (typeof v.token !== 'string' || v.token.length === 0) return null
  if (typeof v.fingerprint !== 'string' || v.fingerprint.length === 0) return null
  if (typeof v.code !== 'string' || !/^\d{6}$/.test(v.code)) return null
  const lanUrl = v.lanUrl
  if (lanUrl !== undefined && (typeof lanUrl !== 'string' || !/^ws?:\/\//.test(lanUrl))) return null
  if (lanUrl === undefined) {
    return {
      v: 1,
      gatewayUrl: v.gatewayUrl,
      hostKey: v.hostKey,
      token: v.token,
      fingerprint: v.fingerprint,
      code: v.code,
    }
  }
  return {
    v: 1,
    gatewayUrl: v.gatewayUrl,
    lanUrl,
    hostKey: v.hostKey,
    token: v.token,
    fingerprint: v.fingerprint,
    code: v.code,
  }
}

/** 配对码格式校验（手输路径）。 */
export function isValidPairingCode(code: string): boolean {
  return /^\d{6}$/.test(code)
}

/** app → gateway：发起配对绑定（携带掌鲸 DSH Pocket session，由 HTTP 层附加）。 */
export interface PairingBindArgs {
  /** 二选一 */
  readonly qr?: PairingQrPayload
  readonly code?: string
  /** 用户为 Worker 命名（可选） */
  readonly name?: string
}

/** gateway → Worker（uplink）：挑战确认（防止 hostKey 泄露后被冒名绑定）。 */
export interface PairingChallenge {
  readonly challengeId: string
  readonly code: string
  readonly requestedBy: string
}

export interface PairingChallengeResponse {
  readonly challengeId: string
  readonly accepted: boolean
  readonly fingerprint: string
}
