/**
 * /mobile/ws 通道帧（直连模式手机↔插件；经 gateway 时作为 worker-frame/phone-frame 的 inner 透传）。
 *
 * 单条双工 WS：下行事件流 + ServerRequest；上行 RPC、应答与心跳。
 * （官方 web carrier 为 downlink-only 双 WS；手机场景多一条连接无收益，取双工单条。）
 */
import type { WireRequest, WireResponse } from './rpc.js';
import type { ServerRequest } from './server-requests.js';
import type { MobileEvent, SessionSnapshot } from './events.js';
export type PhoneToWorkerFrame = {
    readonly kind: 'auth';
    readonly token: string;
} | {
    readonly kind: 'rpc';
    readonly request: WireRequest;
} | {
    readonly kind: 'pong';
    readonly nonce: number;
};
export type WorkerToPhoneFrame = {
    readonly kind: 'auth-ok';
} | {
    readonly kind: 'auth-rejected';
    readonly reason: string;
} | {
    readonly kind: 'rpc-result';
    readonly response: WireResponse;
} | {
    readonly kind: 'event';
    readonly event: MobileEvent;
} | {
    readonly kind: 'snapshot';
    readonly snapshot: SessionSnapshot;
} | {
    readonly kind: 'server-request';
    readonly request: ServerRequest;
} | {
    readonly kind: 'ping';
    readonly nonce: number;
} | {
    readonly kind: 'resync-needed';
    readonly sessionId: string;
    readonly reason: 'seq-gap' | 'unknown-session';
};
export declare function serializePhoneFrame(frame: PhoneToWorkerFrame): string;
export declare function serializeWorkerFrame(frame: WorkerToPhoneFrame): string;
/** 宽松解析：未知结构返回 null，不抛错（连接层负责按 bad-request 处理）。 */
export declare function parsePhoneFrame(text: string): PhoneToWorkerFrame | null;
