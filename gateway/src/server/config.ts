/**
 * Gateway 运行配置（环境变量）。
 */

export interface GatewayConfig {
  readonly port: number
  readonly hostname: string
  /** PostgreSQL 连接串（gateway 自有库） */
  readonly databaseUrl: string
  /** auth 的 JWKS 端点（GET 返回 { keys: [...] }），如 https://auth.zhongbei.tech/api/v1/auth/jwks */
  readonly authJwksUrl: string
  /** JWT issuer 校验值（须与 auth 签发时一致） */
  readonly authIssuer: string
  /** JWT audience 校验值（须与 auth 签发时一致） */
  readonly authAudience: string
  /** Expo Push（iOS APNs 通道）；空则通知只投递给在线手机 */
  readonly expoAccessToken: string
  readonly nodeEnv: string
  /** 作品预览：单用户每日中转字节配额（默认 50MB，保护小水管） */
  readonly previewDailyQuotaBytes: number
  /** 作品预览：单手机速率上限 bytes/s（默认 256KB/s ≈ 2Mbps） */
  readonly previewRateBytesPerSecond: number
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const required = (key: string): string => {
    const value = env[key]
    if (value === undefined || value.length === 0) {
      throw new Error(`缺少环境变量 ${key}`)
    }
    return value
  }
  return {
    port: Number(env['PORT'] ?? 3781),
    hostname: env['HOSTNAME'] ?? '0.0.0.0',
    databaseUrl: required('DATABASE_URL'),
    authJwksUrl: env['AUTH_JWKS_URL'] ?? '',
    authIssuer: env['AUTH_ISSUER'] ?? 'https://auth.zhongbei.tech',
    authAudience: env['AUTH_AUDIENCE'] ?? 'dsh-pocket',
    expoAccessToken: env['EXPO_ACCESS_TOKEN'] ?? '',
    nodeEnv: env['NODE_ENV'] ?? 'development',
    previewDailyQuotaBytes: Number(env['PREVIEW_DAILY_QUOTA_BYTES'] ?? 50 * 1024 * 1024),
    previewRateBytesPerSecond: Number(env['PREVIEW_RATE_BPS'] ?? 256 * 1024),
  }
}

/**
 * 开发模式放行：AUTH_JWKS_URL 未配置时，接受 `dev:<userId>` 形式的
 * 伪 token（仅 NODE_ENV=development），便于本地与 e2e。
 */
export function devAuthBypass(config: GatewayConfig, token: string): string | null {
  if (config.nodeEnv === 'development' && token.startsWith('dev:')) {
    return token.slice(4)
  }
  return null
}
