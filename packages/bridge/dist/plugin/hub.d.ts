/**
 * 手机连接 Hub：/mobile 协议的路由分发与推送扇出。
 *
 * 与传输解耦：直连 server 与 gateway uplink 都把「已认证的手机连接」注册到这里，
 * 共享同一套路由、订阅与审批逻辑。仅依赖 DshAdapter 窄接口，可脱离 dsh 单测。
 */
import { type BridgeCapabilities, type DshSessionEvent, type WireRequest, type WireResponse } from '@deepseek-harness-pocket/bridge-protocol';
import { makeRpcId } from '@deepseek-harness-pocket/bridge-protocol';
import type { ApprovalAsk, DshAdapter, QuestionAsk } from './adapter-dsh.js';
export interface PhoneSender {
    send(text: string): void;
}
export interface HubOptions {
    readonly workerName: string;
    readonly fingerprint: string;
    readonly capsLevel: 'm1' | 'm2' | 'm3';
    readonly readOnly: boolean;
    readonly pairingToken: string;
    readonly verifyToken: (expected: string, actual: string) => boolean;
    readonly now?: () => number;
}
export declare function capsForLevel(level: 'm1' | 'm2' | 'm3'): BridgeCapabilities;
export declare class BridgeHub {
    private readonly adapter;
    private readonly opts;
    private readonly conns;
    private readonly pendingAsks;
    private readonly disposer;
    readonly capabilities: BridgeCapabilities;
    constructor(adapter: DshAdapter, opts: HubOptions);
    dispose(): void;
    /** 已认证连接数（审批应答器据此决定是否接手）。 */
    connectedCount(): number;
    /** 注册一个新的物理连接；trusted=true（经 gateway）时立即完成认证。返回连接 id。 */
    attach(sender: PhoneSender, options?: {
        trusted?: boolean;
    }): string;
    detach(connId: string): void;
    /**
     * 处理一帧文本（来自直连 WS 或 gateway 转发）。
     * - 'authed'：本帧完成认证（调用方可取消认证超时）
     * - 'ok'：正常处理
     * - 'reject'：协议错误或认证失败，调用方应断开连接
     */
    handleFrame(connId: string, text: string): 'authed' | 'ok' | 'reject';
    /** mobile/v1 白名单分发。 */
    dispatch(request: unknown): Promise<WireResponse>;
    broadcastEvent(sessionId: string, event: DshSessionEvent): void;
    /** 审批/问题到达：无手机在线则立即放行（不阻塞 turn）。 */
    registerApproval(ask: ApprovalAsk): void;
    registerQuestion(ask: QuestionAsk): void;
    private broadcast;
    private sendTo;
}
export { makeRpcId };
export type { WireRequest };
