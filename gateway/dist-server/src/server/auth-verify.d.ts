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
import { type GatewayConfig } from './config.js';
export interface VerifiedUser {
    readonly userId: string;
    readonly appId: string | null;
}
export declare function createAuthVerifier(config: GatewayConfig): (token: string) => Promise<VerifiedUser | null>;
