/**
 * 协议版本：mobile/v1。
 *
 * 协议版本独立于 dsh 版本演进；dsh 侧适配（SessionEvent 新事件类型等）
 * 收敛在插件的 adapter-dsh.ts，不改变本包 wire 契约。
 *
 * 协商规则：双方 major 必须一致（`mobile/v1` ↔ `mobile/v1`）；
 * minor 差异通过 handshake capabilities 降级处理。
 */
export declare const PROTOCOL_VERSION: "mobile/v1";
export declare function parseProtocolVersion(version: string): {
    major: number;
    minor: number;
} | null;
export declare function isCompatibleVersion(client: string, server: string): boolean;
