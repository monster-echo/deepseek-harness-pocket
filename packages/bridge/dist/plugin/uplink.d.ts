/**
 * uplink 模式：插件作为客户端反向连接 Gateway（outbound WSS，断线重连）。
 *
 * 帧协议见 protocol 包 relay.ts：worker-register / ping-pong / phone-frame /
 * pairing-challenge。手机帧经 gateway 的 phone-frame 转发进出 Hub（同一套路由）。
 */
import type { Context } from '@deepseek-ai/cordis';
import { type WorkerToGatewayFrame } from '@deepseek-harness-pocket/bridge-protocol';
import type { BridgeHub } from './hub.js';
export interface UplinkOptions {
    readonly url: string;
    readonly hostKey: string;
    readonly workerName: string;
    readonly fingerprint: string;
    readonly dshVersion: string | null;
    readonly hub: BridgeHub;
    readonly pairingCode: string;
    readonly reconnectMinMs: number;
    readonly reconnectMaxMs: number;
    readonly onNotify?: (signal: WorkerToGatewayFrame & {
        kind: 'notify';
    }) => void;
}
/** 启动 uplink（含重连循环）；dispose 后不再重连。 */
export declare function startUplink(ctx: Context, opts: UplinkOptions): () => void;
