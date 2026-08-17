/**
 * Gateway 核心：Worker uplink 与手机接入的 WS 处理、配对挑战、presence、通知分发。
 *
 * 手机↔Worker 是纯隧道（phone-frame/worker-frame 互转，不解析 /mobile 协议）。
 * 账号归属（pairings）与设备/用量持久化在 Store；内存态只保留在线表。
 */
import { type PairingQrPayload, type WorkerPresence } from '@dsh-companion/bridge-protocol';
import { WebSocket } from 'ws';
import type { Store } from './store.js';
import type { GatewayConfig } from './config.js';
type AuthVerify = (token: string) => Promise<{
    userId: string;
    appId: string | null;
} | null>;
export interface PairingResult {
    readonly ok: boolean;
    readonly reason?: string;
    readonly workerId?: string;
    readonly name?: string;
}
export declare class Gateway {
    private readonly config;
    private readonly store;
    private readonly verify;
    private readonly sendPush;
    private readonly workers;
    private readonly workerByHostKey;
    private readonly phones;
    private readonly challenges;
    private seq;
    constructor(config: GatewayConfig, store: Store, verify: AuthVerify, sendPush: (userId: string, title: string, body: string, sessionId?: string) => Promise<void>);
    attachWorker(ws: WebSocket): void;
    private dropWorker;
    private handleWorkerFrame;
    private sendToWorkerConn;
    attachPhone(ws: WebSocket): void;
    private dropPhone;
    private handlePhoneFrame;
    private findWorkerConnByWorkerId;
    private sendToPhoneConn;
    private sendToUser;
    private presenceFor;
    private sendPresenceTo;
    private broadcastPresence;
    bindByQr(userId: string, payload: PairingQrPayload, name: string | null): Promise<PairingResult>;
    bindByCode(userId: string, code: string, name: string | null): Promise<PairingResult>;
    private challengeAndPair;
    /** REST：列出我的 Worker（含在线状态）。 */
    listWorkers(userId: string): Promise<WorkerPresence[]>;
    unpair(userId: string, workerId: string): Promise<void>;
    /** 心跳（server.ts 定时调用）。 */
    heartbeat(): void;
}
export {};
