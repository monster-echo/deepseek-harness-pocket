/**
 * 配对：Worker 与用户账号的绑定。
 *
 * 两种绑定方式（均经 gateway 向 Worker 挑战确认）：
 * 1. 二维码 payload（dshc 在终端打印 ASCII QR）
 * 2. 6 位配对码（扫码失败的手输兜底）
 */
/** 二维码内容（JSON）。`v` 为 payload 版本，向前兼容。 */
export interface PairingQrPayload {
    readonly v: 1;
    /** gateway WebSocket 基地址（wss://… 或 ws://…） */
    readonly gatewayUrl: string;
    /** 同网段直连地址（可选，app 优先尝试） */
    readonly lanUrl?: string;
    /** Worker 注册凭证（gateway 路由用，非用户凭证） */
    readonly hostKey: string;
    /** 端到端配对令牌（仅本次绑定有效，可 rotate） */
    readonly token: string;
    /** Worker 指纹（首次绑定时 app 展示给用户核对） */
    readonly fingerprint: string;
    /** 6 位配对码（与二维码同源，手输兜底） */
    readonly code: string;
}
export declare function parsePairingQrPayload(text: string): PairingQrPayload | null;
/** 配对码格式校验（手输路径）。 */
export declare function isValidPairingCode(code: string): boolean;
/** app → gateway：发起配对绑定（携带掌鲸 DSH Pocket session，由 HTTP 层附加）。 */
export interface PairingBindArgs {
    /** 二选一 */
    readonly qr?: PairingQrPayload;
    readonly code?: string;
    /** 用户为 Worker 命名（可选） */
    readonly name?: string;
}
/** gateway → Worker（uplink）：挑战确认（防止 hostKey 泄露后被冒名绑定）。 */
export interface PairingChallenge {
    readonly challengeId: string;
    readonly code: string;
    readonly requestedBy: string;
}
export interface PairingChallengeResponse {
    readonly challengeId: string;
    readonly accepted: boolean;
    readonly fingerprint: string;
}
