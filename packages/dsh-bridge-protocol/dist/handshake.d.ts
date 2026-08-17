/**
 * Handshake 与能力声明。
 *
 * 连接建立（直连或经 gateway）后第一个 RPC 必须是 `handshake.hello`；
 * major 版本不匹配时服务端应答 version-mismatch 并关闭连接。
 */
/** mobile/v1 能力面：按里程碑递增；客户端按 presence 降级。 */
export interface BridgeCapabilities {
    /** 会话只读流（M1） */
    readonly sessionsReadonly: boolean;
    /** 发消息 / 停止 turn（M2） */
    readonly turnControl: boolean;
    /** 审批 / 用户问题应答（M2） */
    readonly approvals: boolean;
    /** 创建会话 / workspace 选择（M3） */
    readonly sessionCreate: boolean;
    /** artifacts 查看（M3） */
    readonly artifacts: boolean;
}
export declare const M1_CAPABILITIES: BridgeCapabilities;
export interface HandshakeArgs {
    readonly client: 'dsh-companion-app' | 'fake-phone' | string;
    readonly protocolVersion: string;
}
export interface HostDescription {
    readonly name: string;
    /** 电脑主机名或用户命名 */
    readonly hostFingerprint: string;
    readonly dshVersion: string | null;
    readonly protocolVersion: string;
    readonly capabilities: BridgeCapabilities;
}
export interface HandshakeResult {
    readonly host: HostDescription;
    /** 服务端时间（ms epoch），用于时钟漂移诊断 */
    readonly serverTime: number;
}
export declare function handshakeArgs(client: string): HandshakeArgs;
export declare function parseHandshakeArgs(value: unknown): HandshakeArgs | null;
