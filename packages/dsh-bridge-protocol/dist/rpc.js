/**
 * RPC envelope：对齐官方 connection.rpc.call('/api', '<ns>/<method>', { args }) 形态。
 *
 * 官方 HTTP carrier 为 `POST /api/<namespace>/<method>`，payload 只有具名 `args` 对象。
 * 我们复用同一形态（`POST /mobile/api/<ns>/<method>`），便于未来迁移官方 carrier。
 */
export function makeRpcId() {
    return `r${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}
export function rpcSuccess(id, result) {
    return { id, ok: true, result };
}
export function rpcFailure(id, code, message) {
    return { id, ok: false, error: { code, message } };
}
/** 解析未知对象为 WireRequest；不合法返回 null（调用方应答 bad-request）。 */
export function parseWireRequest(value) {
    if (typeof value !== 'object' || value === null)
        return null;
    const v = value;
    const { id, ns, method, args } = v;
    if (typeof id !== 'string' || id.length === 0 || id.length > 64)
        return null;
    if (typeof ns !== 'string' || !/^[a-z][a-z0-9-]*$/.test(ns))
        return null;
    if (typeof method !== 'string' || !/^[a-z][a-zA-Z0-9.-]*$/.test(method))
        return null;
    if (typeof args !== 'object' || args === null || Array.isArray(args))
        return null;
    return { id, ns, method, args: args };
}
/** 解析未知对象为 WireResponse。 */
export function parseWireResponse(value) {
    if (typeof value !== 'object' || value === null)
        return null;
    const v = value;
    const { id, ok } = v;
    if (typeof id !== 'string' || id.length === 0)
        return null;
    if (ok === true)
        return { id, ok: true, result: v.result };
    const err = v.error;
    if (typeof err !== 'object' || err === null)
        return null;
    const e = err;
    if (typeof e.code !== 'string' || typeof e.message !== 'string')
        return null;
    return { id, ok: false, error: { code: e.code, message: e.message } };
}
/** ns/method 白名单键，如 `sessions.list`。 */
export function methodKey(ns, method) {
    return `${ns}.${method}`;
}
//# sourceMappingURL=rpc.js.map