/**
 * /mobile/ws 通道帧（直连模式手机↔插件；经 gateway 时作为 worker-frame/phone-frame 的 inner 透传）。
 *
 * 单条双工 WS：下行事件流 + ServerRequest；上行 RPC、应答与心跳。
 * （官方 web carrier 为 downlink-only 双 WS；手机场景多一条连接无收益，取双工单条。）
 */
export function serializePhoneFrame(frame) {
    return JSON.stringify(frame);
}
export function serializeWorkerFrame(frame) {
    return JSON.stringify(frame);
}
/** 宽松解析：未知结构返回 null，不抛错（连接层负责按 bad-request 处理）。 */
export function parsePhoneFrame(text) {
    let value;
    try {
        value = JSON.parse(text);
    }
    catch {
        return null;
    }
    if (typeof value !== 'object' || value === null)
        return null;
    const v = value;
    switch (v.kind) {
        case 'auth':
            return typeof v.token === 'string' ? { kind: 'auth', token: v.token } : null;
        case 'pong':
            return typeof v.nonce === 'number' ? { kind: 'pong', nonce: v.nonce } : null;
        case 'rpc': {
            const { request } = v;
            if (typeof request !== 'object' || request === null)
                return null;
            const r = request;
            if (typeof r.id !== 'string' || typeof r.ns !== 'string' || typeof r.method !== 'string')
                return null;
            if (typeof r.args !== 'object' || r.args === null)
                return null;
            return {
                kind: 'rpc',
                request: {
                    id: r.id,
                    ns: r.ns,
                    method: r.method,
                    args: r.args,
                },
            };
        }
        default:
            return null;
    }
}
//# sourceMappingURL=ws.js.map