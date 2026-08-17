/**
 * Gateway 运行配置（环境变量）。
 */
export interface GatewayConfig {
    readonly port: number;
    readonly hostname: string;
    /** PostgreSQL 连接串（gateway 自有库） */
    readonly databaseUrl: string;
    /** 终北认证内部校验端点，如 https://auth.zhongbei.tech/internal/session/verify */
    readonly authVerifyUrl: string;
    /** 调内部端点时附加的共享密钥（可选，视终北实现） */
    readonly authVerifyToken: string;
    /** Expo Push（iOS APNs 通道）；空则通知只投递给在线手机 */
    readonly expoAccessToken: string;
    readonly nodeEnv: string;
}
export declare function loadConfig(env?: NodeJS.ProcessEnv): GatewayConfig;
/**
 * 开发模式放行：AUTH_VERIFY_URL 未配置时，接受 `dev:<userId>` 形式的
 * 伪 token（仅 NODE_ENV=development），便于本地与 e2e。
 */
export declare function devAuthBypass(config: GatewayConfig, token: string): string | null;
