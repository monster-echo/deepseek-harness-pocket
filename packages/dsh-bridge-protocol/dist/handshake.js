/**
 * Handshake 与能力声明。
 *
 * 连接建立（直连或经 gateway）后第一个 RPC 必须是 `handshake.hello`；
 * major 版本不匹配时服务端应答 version-mismatch 并关闭连接。
 */
import { PROTOCOL_VERSION } from './version.js';
export const M1_CAPABILITIES = {
    sessionsReadonly: true,
    turnControl: false,
    approvals: false,
    sessionCreate: false,
    artifacts: false,
};
export function handshakeArgs(client) {
    return { client, protocolVersion: PROTOCOL_VERSION };
}
export function parseHandshakeArgs(value) {
    if (typeof value !== 'object' || value === null)
        return null;
    const v = value;
    if (typeof v.client !== 'string' || v.client.length === 0)
        return null;
    if (typeof v.protocolVersion !== 'string')
        return null;
    return { client: v.client, protocolVersion: v.protocolVersion };
}
//# sourceMappingURL=handshake.js.map