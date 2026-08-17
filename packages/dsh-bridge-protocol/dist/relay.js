/**
 * Gateway 帧：Worker↔Gateway uplink 与 手机↔Gateway 两条 WebSocket 的信封。
 *
 * Gateway 是隧道：`phone-frame` / `worker-frame` 只按 workerId 路由，
 * 不解析内层 /mobile 协议内容（内层仍是本包 rpc/events 的 JSON 文本）。
 */
// ---------- 解析器 ----------
function asRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : null;
}
function parsePresence(value) {
    const v = asRecord(value);
    if (!v)
        return null;
    if (typeof v.workerId !== 'string' || typeof v.name !== 'string')
        return null;
    if (typeof v.hostFingerprint !== 'string' || typeof v.online !== 'boolean')
        return null;
    if (typeof v.lastSeenAt !== 'number')
        return null;
    let capabilities = null;
    const c = asRecord(v.capabilities);
    if (c && typeof c.protocolVersion === 'string') {
        capabilities = {
            dshVersion: typeof c.dshVersion === 'string' ? c.dshVersion : null,
            protocolVersion: c.protocolVersion,
        };
    }
    return {
        workerId: v.workerId,
        name: v.name,
        hostFingerprint: v.hostFingerprint,
        online: v.online,
        lastSeenAt: v.lastSeenAt,
        capabilities,
    };
}
/** 解析 gateway → phone 帧（app 侧使用）。 */
export function parseGatewayToPhoneFrame(value) {
    const v = asRecord(value);
    if (!v || typeof v.kind !== 'string')
        return null;
    switch (v.kind) {
        case 'presence': {
            const workers = Array.isArray(v.workers) ? v.workers.map(parsePresence) : [];
            if (workers.some((w) => w === null))
                return null;
            return { kind: 'presence', workers: workers };
        }
        case 'auth-ok':
            return typeof v.userId === 'string' ? { kind: 'auth-ok', userId: v.userId } : null;
        case 'auth-rejected':
            return typeof v.reason === 'string' ? { kind: 'auth-rejected', reason: v.reason } : null;
        case 'ping':
            return typeof v.nonce === 'number' ? { kind: 'ping', nonce: v.nonce } : null;
        case 'worker-open-result':
            return typeof v.workerId === 'string' && typeof v.ok === 'boolean'
                ? { kind: 'worker-open-result', workerId: v.workerId, ok: v.ok }
                : null;
        case 'worker-frame':
            return typeof v.workerId === 'string' && typeof v.inner === 'string'
                ? { kind: 'worker-frame', workerId: v.workerId, inner: v.inner }
                : null;
        case 'push':
            return typeof v.title === 'string' && typeof v.body === 'string'
                ? { kind: 'push', title: v.title, body: v.body }
                : null;
        default:
            return null;
    }
}
/** 解析 gateway → worker 帧（插件侧使用）。 */
export function parseGatewayToWorkerFrame(value) {
    const v = asRecord(value);
    if (!v || typeof v.kind !== 'string')
        return null;
    switch (v.kind) {
        case 'register-ok':
            return typeof v.workerId === 'string' ? { kind: 'register-ok', workerId: v.workerId } : null;
        case 'register-rejected':
            return typeof v.reason === 'string' ? { kind: 'register-rejected', reason: v.reason } : null;
        case 'ping':
            return typeof v.nonce === 'number' ? { kind: 'ping', nonce: v.nonce } : null;
        case 'phone-frame':
            return typeof v.phoneId === 'string' && typeof v.inner === 'string'
                ? { kind: 'phone-frame', phoneId: v.phoneId, inner: v.inner }
                : null;
        case 'pairing-challenge':
            return typeof v.challengeId === 'string' && typeof v.code === 'string' && typeof v.requestedBy === 'string'
                ? { kind: 'pairing-challenge', challengeId: v.challengeId, code: v.code, requestedBy: v.requestedBy }
                : null;
        default:
            return null;
    }
}
export function makeNotifyFrame(input) {
    return { kind: 'notify', ...input };
}
/** 内层事件帧序列化辅助（插件下发 /mobile 事件给手机）。 */
export function makePhoneEventInner(sessionId, event) {
    return JSON.stringify({ kind: 'event', sessionId, seq: event.seq, event });
}
//# sourceMappingURL=relay.js.map