/**
 * 终北 session 校验：调用 auth.zhongbei.tech 内部校验端点。
 *
 * 端点契约（M2 前由 auth 侧提供）：
 *   POST <AUTH_VERIFY_URL>
 *   Authorization: Bearer <AUTH_VERIFY_TOKEN>   （可选共享密钥）
 *   { "token": "<终北 session token>" }
 *   → 200 { "userId": "...", "appId": "..." } | 401
 *
 * 端点未上线期间的策略见 config.devAuthBypass（仅 development）。
 */

import { devAuthBypass, type GatewayConfig } from './config.js'

export interface VerifiedUser {
  readonly userId: string
  readonly appId: string | null
}

export function createAuthVerifier(config: GatewayConfig): (token: string) => Promise<VerifiedUser | null> {
  return async (token: string): Promise<VerifiedUser | null> => {
    const bypass = devAuthBypass(config, token)
    if (bypass !== null) return { userId: bypass, appId: null }
    if (config.authVerifyUrl.length === 0) {
      return null // 生产未配置端点 = 拒绝
    }
    try {
      const response = await fetch(config.authVerifyUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.authVerifyToken.length > 0
            ? { authorization: `Bearer ${config.authVerifyToken}` }
            : {}),
        },
        body: JSON.stringify({ token }),
        signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) return null
      const data = (await response.json()) as { userId?: unknown; appId?: unknown }
      if (typeof data.userId !== 'string' || data.userId.length === 0) return null
      return {
        userId: data.userId,
        appId: typeof data.appId === 'string' ? data.appId : null,
      }
    } catch {
      return null
    }
  }
}
