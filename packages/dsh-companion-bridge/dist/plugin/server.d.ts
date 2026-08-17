/**
 * 直连模式：自起 node:http + WebSocket（默认 0.0.0.0:3780）。
 *
 * 独立端口，与 dsh webServer 的 trust fence 完全隔离；
 * 鉴权（pairing token）由 Hub 在 WS 首帧 auth 中完成。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { BridgeHub } from './hub.js';
export interface DirectServerOptions {
    readonly host: string;
    readonly port: number;
    readonly hub: BridgeHub;
    readonly workerName: string;
}
export interface RunningServer {
    readonly port: number;
    dispose(): Promise<void>;
}
/** 启动直连 server；由插件通过 ctx.effect 挂接 dispose。 */
export declare function startDirectServer(ctx: Context, opts: DirectServerOptions): Promise<RunningServer>;
