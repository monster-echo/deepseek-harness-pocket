/**
 * 手机连接 Hub：/mobile 协议的路由分发与推送扇出。
 *
 * 与传输解耦：直连 server 与 gateway uplink 都把「已认证的手机连接」注册到这里，
 * 共享同一套路由、订阅与审批逻辑。仅依赖 DshAdapter 窄接口，可脱离 dsh 单测。
 */
import { isCompatibleVersion, M1_CAPABILITIES, PROTOCOL_VERSION, parsePhoneFrame, } from '@dsh-companion/bridge-protocol';
import { makeRpcId, methodKey, parseWireRequest, rpcFailure, rpcSuccess } from '@dsh-companion/bridge-protocol';
export function capsForLevel(level) {
    if (level === 'm1')
        return M1_CAPABILITIES;
    if (level === 'm2') {
        return { ...M1_CAPABILITIES, turnControl: true, approvals: true };
    }
    return { ...M1_CAPABILITIES, turnControl: true, approvals: true, sessionCreate: true, artifacts: true };
}
let connSeq = 0;
export class BridgeHub {
    adapter;
    opts;
    conns = new Map();
    pendingAsks = new Map();
    disposer;
    capabilities;
    constructor(adapter, opts) {
        this.adapter = adapter;
        this.opts = opts;
        this.capabilities = capsForLevel(opts.capsLevel);
        this.disposer = adapter.onEvent((sessionId, event) => this.broadcastEvent(sessionId, event));
    }
    dispose() {
        this.disposer();
        for (const ask of this.pendingAsks.values()) {
            if ('decide' in ask)
                void ask.decide('pass');
        }
        this.pendingAsks.clear();
        this.conns.clear();
    }
    /** 已认证连接数（审批应答器据此决定是否接手）。 */
    connectedCount() {
        let n = 0;
        for (const c of this.conns.values())
            if (c.authed)
                n++;
        return n;
    }
    /** 注册一个新的物理连接；trusted=true（经 gateway）时立即完成认证。返回连接 id。 */
    attach(sender, options) {
        const id = `c${++connSeq}`;
        const trusted = options?.trusted === true;
        const conn = { id, sender, authed: trusted, trusted, subscribed: new Set() };
        this.conns.set(id, conn);
        if (trusted)
            this.sendTo(conn, { kind: 'auth-ok' });
        return id;
    }
    detach(connId) {
        this.conns.delete(connId);
    }
    /**
     * 处理一帧文本（来自直连 WS 或 gateway 转发）。
     * - 'authed'：本帧完成认证（调用方可取消认证超时）
     * - 'ok'：正常处理
     * - 'reject'：协议错误或认证失败，调用方应断开连接
     */
    handleFrame(connId, text) {
        const conn = this.conns.get(connId);
        if (!conn)
            return 'reject';
        const frame = parsePhoneFrame(text);
        if (frame === null)
            return 'reject';
        switch (frame.kind) {
            case 'auth': {
                if (conn.trusted || this.opts.verifyToken(this.opts.pairingToken, frame.token)) {
                    conn.authed = true;
                    this.sendTo(conn, { kind: 'auth-ok' });
                    return 'authed';
                }
                this.sendTo(conn, { kind: 'auth-rejected', reason: 'invalid pairing token' });
                return 'reject';
            }
            case 'pong':
                return 'ok';
            case 'rpc': {
                if (!conn.authed) {
                    const response = rpcFailure(frame.request.id, 'unauthorized', 'authenticate first');
                    this.sendTo(conn, { kind: 'rpc-result', response });
                    return 'ok';
                }
                void this.dispatch(frame.request)
                    .then((response) => this.sendTo(conn, { kind: 'rpc-result', response }))
                    .catch((error) => {
                    const response = rpcFailure(frame.request.id, 'internal', error instanceof Error ? error.message : String(error));
                    this.sendTo(conn, { kind: 'rpc-result', response });
                });
                return 'ok';
            }
        }
    }
    /** mobile/v1 白名单分发。 */
    async dispatch(request) {
        const req = parseWireRequest(request);
        if (req === null)
            return rpcFailure('?', 'bad-request', 'malformed wire request');
        const key = methodKey(req.ns, req.method);
        const fail = (code, message) => rpcFailure(req.id, code, message);
        const denyIf = (condition, code, message) => condition ? fail(code, message) : null;
        switch (key) {
            case 'handshake.hello': {
                const client = req.args['client'];
                const version = req.args['protocolVersion'];
                if (typeof client !== 'string' || typeof version !== 'string') {
                    return fail('bad-request', 'client and protocolVersion required');
                }
                if (!isCompatibleVersion(version, PROTOCOL_VERSION)) {
                    return fail('version-mismatch', `server ${PROTOCOL_VERSION}, client ${version}`);
                }
                return rpcSuccess(req.id, {
                    host: {
                        name: this.opts.workerName,
                        hostFingerprint: this.opts.fingerprint,
                        dshVersion: this.adapter.dshVersion(),
                        protocolVersion: PROTOCOL_VERSION,
                        capabilities: this.capabilities,
                    },
                    serverTime: (this.opts.now ?? Date.now)(),
                });
            }
            case 'sessions.list':
                return rpcSuccess(req.id, { sessions: await this.adapter.listSessions() });
            case 'sessions.open': {
                const sessionId = req.args['sessionId'];
                if (typeof sessionId !== 'string')
                    return fail('bad-request', 'sessionId required');
                const slice = await this.adapter.readSlice(sessionId, 0);
                if (slice === null)
                    return fail('not-found', `unknown session ${sessionId}`);
                for (const c of this.conns.values()) {
                    if (c.authed)
                        c.subscribed.add(sessionId);
                }
                this.broadcast(snapshotFrame(slice));
                return rpcSuccess(req.id, { fromSeq: slice.fromSeq, toSeq: slice.toSeq, count: slice.events.length });
            }
            case 'sessions.close': {
                const sessionId = req.args['sessionId'];
                if (typeof sessionId !== 'string')
                    return fail('bad-request', 'sessionId required');
                for (const c of this.conns.values())
                    c.subscribed.delete(sessionId);
                return rpcSuccess(req.id, { ok: true });
            }
            case 'sessions.resync': {
                const sessionId = req.args['sessionId'];
                const lastSeq = req.args['lastSeq'];
                if (typeof sessionId !== 'string' || typeof lastSeq !== 'number' || lastSeq < -1) {
                    return fail('bad-request', 'sessionId and lastSeq required');
                }
                const slice = await this.adapter.readSlice(sessionId, lastSeq + 1);
                if (slice === null)
                    return fail('not-found', `unknown session ${sessionId}`);
                this.broadcast(snapshotFrame(slice));
                return rpcSuccess(req.id, { fromSeq: slice.fromSeq, toSeq: slice.toSeq, count: slice.events.length });
            }
            case 'messages.send': {
                const denied = denyIf(!this.capabilities.turnControl, 'unavailable', 'turn control not enabled') ??
                    denyIf(this.opts.readOnly, 'forbidden', 'worker is read-only');
                if (denied)
                    return denied;
                const sessionId = req.args['sessionId'];
                const text = req.args['text'];
                if (typeof sessionId !== 'string' || typeof text !== 'string' || text.length === 0) {
                    return fail('bad-request', 'sessionId and text required');
                }
                await this.adapter.sendUserMessage(sessionId, text);
                return rpcSuccess(req.id, { ok: true });
            }
            case 'turn.stop': {
                const denied = denyIf(!this.capabilities.turnControl, 'unavailable', 'turn control not enabled') ??
                    denyIf(this.opts.readOnly, 'forbidden', 'worker is read-only');
                if (denied)
                    return denied;
                const sessionId = req.args['sessionId'];
                if (typeof sessionId !== 'string')
                    return fail('bad-request', 'sessionId required');
                await this.adapter.stopTurn(sessionId);
                return rpcSuccess(req.id, { ok: true });
            }
            case 'permissions.respond': {
                const denied = denyIf(!this.capabilities.approvals, 'unavailable', 'approvals not enabled');
                if (denied)
                    return denied;
                const requestId = req.args['requestId'];
                const decision = req.args['decision'];
                if (typeof requestId !== 'string' || (decision !== 'allow' && decision !== 'allow-always' && decision !== 'deny')) {
                    return fail('bad-request', 'requestId and decision required');
                }
                const ask = this.pendingAsks.get(requestId);
                if (!ask || !('decide' in ask))
                    return fail('not-found', `no pending approval ${requestId}`);
                this.pendingAsks.delete(requestId);
                await ask.decide(decision === 'deny' ? 'deny' : 'allow');
                return rpcSuccess(req.id, { ok: true });
            }
            case 'questions.respond': {
                const denied = denyIf(!this.capabilities.approvals, 'unavailable', 'approvals not enabled');
                if (denied)
                    return denied;
                const requestId = req.args['requestId'];
                const answer = req.args['answer'];
                if (typeof requestId !== 'string' || typeof answer !== 'string') {
                    return fail('bad-request', 'requestId and answer required');
                }
                const ask = this.pendingAsks.get(requestId);
                if (!ask || !('answer' in ask))
                    return fail('not-found', `no pending question ${requestId}`);
                this.pendingAsks.delete(requestId);
                await ask.answer(answer);
                return rpcSuccess(req.id, { ok: true });
            }
            default:
                return fail('not-found', `unknown method ${key}`);
        }
    }
    broadcastEvent(sessionId, event) {
        for (const c of this.conns.values()) {
            if (c.authed && c.subscribed.has(sessionId)) {
                this.sendTo(c, { kind: 'event', event: { sessionId, seq: event.seq, event } });
            }
        }
    }
    /** 审批/问题到达：无手机在线则立即放行（不阻塞 turn）。 */
    registerApproval(ask) {
        if (this.connectedCount() === 0) {
            void ask.decide('pass');
            return;
        }
        this.pendingAsks.set(ask.requestId, ask);
        this.broadcast({ kind: 'server-request', request: permissionRequestOf(ask) });
    }
    registerQuestion(ask) {
        if (this.connectedCount() === 0) {
            void ask.answer('');
            return;
        }
        this.pendingAsks.set(ask.requestId, ask);
        this.broadcast({
            kind: 'server-request',
            request: { kind: 'question', body: { requestId: ask.requestId, sessionId: ask.sessionId, question: ask.question, ...(ask.options.length > 0 ? { options: ask.options } : {}) } },
        });
    }
    broadcast(frame) {
        const text = JSON.stringify(frame);
        for (const c of this.conns.values()) {
            if (c.authed)
                c.sender.send(text);
        }
    }
    sendTo(conn, frame) {
        conn.sender.send(JSON.stringify(frame));
    }
}
function snapshotFrame(slice) {
    return {
        kind: 'snapshot',
        snapshot: { sessionId: slice.id, fromSeq: slice.fromSeq, toSeq: slice.toSeq, events: slice.events },
    };
}
function permissionRequestOf(ask) {
    return {
        kind: 'permission',
        body: { requestId: ask.requestId, sessionId: ask.sessionId, summary: ask.summary },
    };
}
export { makeRpcId };
//# sourceMappingURL=hub.js.map