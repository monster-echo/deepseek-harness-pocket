/**
 * Gateway 运行配置（环境变量）。
 */
export function loadConfig(env = process.env) {
    const required = (key) => {
        const value = env[key];
        if (value === undefined || value.length === 0) {
            throw new Error(`缺少环境变量 ${key}`);
        }
        return value;
    };
    return {
        port: Number(env['PORT'] ?? 3781),
        hostname: env['HOSTNAME'] ?? '0.0.0.0',
        databaseUrl: required('DATABASE_URL'),
        authVerifyUrl: env['AUTH_VERIFY_URL'] ?? '',
        authVerifyToken: env['AUTH_VERIFY_TOKEN'] ?? '',
        expoAccessToken: env['EXPO_ACCESS_TOKEN'] ?? '',
        nodeEnv: env['NODE_ENV'] ?? 'development',
    };
}
/**
 * 开发模式放行：AUTH_VERIFY_URL 未配置时，接受 `dev:<userId>` 形式的
 * 伪 token（仅 NODE_ENV=development），便于本地与 e2e。
 */
export function devAuthBypass(config, token) {
    if (config.nodeEnv === 'development' && token.startsWith('dev:')) {
        return token.slice(4);
    }
    return null;
}
//# sourceMappingURL=config.js.map