/**
 * Gateway 帧：Worker↔Gateway uplink 与 手机↔Gateway 两条 WebSocket 的信封。
 *
 * Gateway 是隧道：`phone-frame` / `worker-frame` 只按 workerId 路由，
 * 不解析内层 /mobile 协议内容（内层仍是本包 rpc/events 的 JSON 文本）。
 */
import type { DshSessionEvent } from './events.js';
export interface WorkerRegisterFrame {
    readonly kind: 'worker-register';
    readonly hostKey: string;
    readonly protocolVersion: string;
    readonly name: string;
    readonly hostFingerprint: string;
    readonly dshVersion: string | null;
    /** 当前 6 位配对码（手动绑定路径：gateway 按码找 worker） */
    readonly pairingCode: string;
}
export interface PairingAnswerFrame {
    readonly kind: 'pairing-answer';
    readonly challengeId: string;
    readonly accepted: boolean;
}
export type WorkerToGatewayFrame = WorkerRegisterFrame | PairingAnswerFrame | {
    readonly kind: 'pong';
    readonly nonce: number;
}
/** 发往当前已接入手机的内层 /mobile 帧（文本 JSON） */
 | {
    readonly kind: 'phone-frame';
    readonly inner: string;
}
/** 通知信号（带外）：待审批 / agent 空闲 / turn 完成 */
 | {
    readonly kind: 'notify';
    readonly signal: 'approval-pending' | 'agent-idle' | 'turn-complete' | 'worker-online' | 'worker-offline';
    readonly sessionId?: string;
    readonly title: string;
    readonly body: string;
};
export type GatewayToWorkerFrame = {
    readonly kind: 'register-ok';
    readonly workerId: string;
} | {
    readonly kind: 'register-rejected';
    readonly reason: string;
} | {
    readonly kind: 'ping';
    readonly nonce: number;
}
/** 来自手机的内层 /mobile 帧（文本 JSON） */
 | {
    readonly kind: 'phone-frame';
    readonly phoneId: string;
    readonly inner: string;
}
/** 配对挑战（gateway 转发手机发起的绑定请求） */
 | {
    readonly kind: 'pairing-challenge';
    readonly challengeId: string;
    readonly code: string;
    readonly requestedBy: string;
};
export interface PhoneAuthFrame {
    readonly kind: 'phone-auth';
    /** 终北 session token（Bearer）；gateway 调内部校验端点验真 */
    readonly authToken: string;
    /** 设备推送标识（expo push token，可后续注册） */
    readonly deviceKey: string;
}
export type PhoneToGatewayFrame = PhoneAuthFrame | {
    readonly kind: 'pong';
    readonly nonce: number;
}
/** 打开/关闭与某 Worker 的转发通道 */
 | {
    readonly kind: 'worker-open';
    readonly workerId: string;
} | {
    readonly kind: 'worker-close';
    readonly workerId: string;
}
/** 发往 Worker 的内层 /mobile 帧（文本 JSON） */
 | {
    readonly kind: 'worker-frame';
    readonly workerId: string;
    readonly inner: string;
};
export interface GatewayToPhoneFrame$Presence {
    readonly kind: 'presence';
    readonly workers: readonly WorkerPresence[];
}
export interface WorkerPresence {
    readonly workerId: string;
    readonly name: string;
    readonly hostFingerprint: string;
    readonly online: boolean;
    readonly lastSeenAt: number;
    /** Worker 端能力（缓存自最近一次注册；离线时为 null） */
    readonly capabilities: {
        readonly dshVersion: string | null;
        readonly protocolVersion: string;
    } | null;
}
export type GatewayToPhoneFrame = GatewayToPhoneFrame$Presence | {
    readonly kind: 'auth-ok';
    readonly userId: string;
} | {
    readonly kind: 'auth-rejected';
    readonly reason: string;
} | {
    readonly kind: 'ping';
    readonly nonce: number;
} | {
    readonly kind: 'worker-open-result';
    readonly workerId: string;
    readonly ok: boolean;
    readonly reason?: string;
} | {
    readonly kind: 'worker-frame';
    readonly workerId: string;
    readonly inner: string;
} | {
    readonly kind: 'push';
    readonly title: string;
    readonly body: string;
    readonly sessionId?: string;
};
/** 解析 gateway → phone 帧（app 侧使用）。 */
export declare function parseGatewayToPhoneFrame(value: unknown): GatewayToPhoneFrame | null;
/** 解析 gateway → worker 帧（插件侧使用）。 */
export declare function parseGatewayToWorkerFrame(value: unknown): GatewayToWorkerFrame | null;
export interface NotifySignalInput {
    readonly signal: 'approval-pending' | 'agent-idle' | 'turn-complete';
    readonly sessionId?: string;
    readonly title: string;
    readonly body: string;
}
export declare function makeNotifyFrame(input: NotifySignalInput): Extract<WorkerToGatewayFrame, {
    kind: 'notify';
}>;
/** 内层事件帧序列化辅助（插件下发 /mobile 事件给手机）。 */
export declare function makePhoneEventInner(sessionId: string, event: DshSessionEvent): string;
