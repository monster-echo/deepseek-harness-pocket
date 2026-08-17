/**
 * Gateway 运行配置（环境变量）。
 */

export interface GatewayConfig {
  readonly port: number
  readonly hostname: string
  /** PostgreSQL 连接串（gateway 自有库） */
  readonly databaseUrl: string
  /** 终北认证内部校验端点，如 https://auth.zhongbei.tech/internal/session/verify */
  readonly authVerifyUrl: string
  /** 调内部端点时附加的共享密钥（可选，视终北实现） */
  readonly authVerifyToken: string
  /** Expo Push（iOS APNs 通道）；空则通知只投递给在线手机 */
  readonly expoAccessToken: string
  readonly nodeEnv: string
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
    authVerifyUrl: env['AUTH_VERIFY_URL'] ?? '',
    authVerifyToken: env['AUTH_VERIFY_TOKEN'] ?? '',
    expoAccessToken: env['EXPO_ACCESS_TOKEN'] ?? '',
    nodeEnv: env['NODE_ENV'] ?? 'development',
  }
}

/**
 * 开发模式放行：AUTH_VERIFY_URL 未配置时，接受 `dev:<userId>` 形式的
 * 伪 token（仅 NODE_ENV=development），便于本地与 e2e。
 */
export function devAuthBypass(config: GatewayConfig, token: string): string | null {
  if (config.nodeEnv === 'development' && token.startsWith('dev:')) {
    return token.slice(4)
  }
  return null
}
