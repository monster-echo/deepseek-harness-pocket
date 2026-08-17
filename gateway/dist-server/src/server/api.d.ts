/**
 * REST /api/v1/*：由自定义 server 直接处理（不经 Next），与 WS 核心同一构建。
 *
 * POST   /api/v1/pairing/bind      { qr?: {payload}, code?, name? }
 * GET    /api/v1/workers           我的 Worker 列表（含在线状态）
 * DELETE /api/v1/workers?workerId= 解绑
 * POST   /api/v1/devices/push-token { deviceKey, platform, expoPushToken }
 * GET    /api/v1/health
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Store } from './store.js';
import type { Gateway } from './gateway.js';
import type { GatewayConfig } from './config.js';
export interface ApiDeps {
    readonly config: GatewayConfig;
    readonly store: Store;
    readonly gateway: Gateway;
}
export declare function createApiRouter(deps: ApiDeps): (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
