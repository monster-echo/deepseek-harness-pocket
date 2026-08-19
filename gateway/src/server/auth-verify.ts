/**
 * 掌鲸 DSH Pocket session 校验：jose 本地验签 RS256 JWT。
 *
 * auth 只签发、经 JWKS 端点分发公钥；gateway 拉取公钥后离线验签，
 * 不依赖 auth 在线（auth 宕机不影响已签发会话）。密钥轮换由
 * createRemoteJWKSet 自动处理（按 kid 匹配 + 定期刷新缓存）。
 *
 * 开发模式放行策略见 config.devAuthBypass（仅 development）。
 */

import { createRemoteJWKSet, jwtVerify } from 'jose'
import { devAuthBypass, type GatewayConfig } from './config.js'

export interface VerifiedUser {
  readonly userId: string
  readonly appId: string | null
}

export function createAuthVerifier(config: GatewayConfig): (token: string) => Promise<VerifiedUser | null> {
  const jwks = config.authJwksUrl.length > 0
    ? createRemoteJWKSet(new URL(config.authJwksUrl))
    : null
  return async (token: string): Promise<VerifiedUser | null> => {
    const bypass = devAuthBypass(config, token)
    if (bypass !== null) return { userId: bypass, appId: null }
    if (jwks === null) return null // 生产未配置 JWKS = 拒绝
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: config.authIssuer,
        audience: config.authAudience,
      })
      const userId = payload.sub
      if (typeof userId !== 'string' || userId.length === 0) return null
      return {
        userId,
        appId: typeof payload.app_id === 'string' ? payload.app_id : null,
      }
    } catch {
      return null
    }
  }
}
