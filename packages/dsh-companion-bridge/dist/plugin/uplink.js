/**
 * uplink 模式：插件作为客户端反向连接 Gateway（outbound WSS，断线重连）。
 *
 * 帧协议见 protocol 包 relay.ts：worker-register / ping-pong / phone-frame /
 * pairing-challenge。手机帧经 gateway 的 phone-frame 转发进出 Hub（同一套路由）。
 */
import { parseGatewayToWorkerFrame, } from '@dsh-companion/bridge-protocol';
import { WebSocket } from 'ws';
/** 启动 uplink（含重连循环）；dispose 后不再重连。 */
export function startUplink(ctx, opts) {
    let disposed = false;
    let attempt = 0;
    let ws = null;
    let reconnectTimer;
    let pingTimer;
    const scheduleReconnect = () => {
        if (disposed)
            return;
        const delay = Math.min(opts.reconnectMinMs * 2 ** Math.min(attempt, 5), opts.reconnectMaxMs);
        attempt += 1;
        reconnectTimer = setTimeout(connect, delay);
    };
    const send = (frame) => {
        if (ws !== null && ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify(frame));
    };
    const connect = () => {
        if (disposed)
            return;
        ctx.logger.info(`dsh-companion uplink connecting to ${opts.url}`);
        ws = new WebSocket(opts.url);
        ws.on('open', () => {
            attempt = 0;
            send({
                kind: 'worker-register',
                hostKey: opts.hostKey,
                protocolVersion: 'mobile/v1',
                name: opts.workerName,
                hostFingerprint: opts.fingerprint,
                dshVersion: opts.dshVersion,
                pairingCode: opts.pairingCode,
            });
            pingTimer = setInterval(() => {
                send({ kind: 'pong', nonce: Date.now() });
            }, 25_000);
        });
        ws.on('message', (data) => {
            const text = typeof data === 'string' ? data : String(data);
            const frame = parseGatewayToWorkerFrame(safeParse(text));
            if (frame === null)
                return;
            switch (frame.kind) {
                case 'register-ok':
                    ctx.logger.info(`dsh-companion uplink registered as worker ${frame.workerId}`);
                    break;
                case 'register-rejected':
                    ctx.logger.error(`dsh-companion uplink rejected: ${frame.reason}`);
                    ws?.close();
                    break;
                case 'ping':
                    send({ kind: 'pong', nonce: frame.nonce });
                    break;
                case 'phone-frame': {
                    // 手机帧经 gateway 抵达伪连接：复用 Hub 的认证/路由（auth 也在 inner 帧里）
                    opts.hub.handleFrame(uplinkConnId, frame.inner);
                    break;
                }
                case 'pairing-challenge': {
                    // gateway 转发的绑定挑战：核对 6 位配对码
                    const accepted = frame.code === opts.pairingCode;
                    send({ kind: 'pairing-answer', challengeId: frame.challengeId, accepted });
                    ctx.logger.info(`dsh-companion pairing challenge from ${frame.requestedBy}: ${accepted ? 'accepted' : 'rejected (code mismatch)'}`);
                    break;
                }
            }
        });
        ws.on('close', () => {
            if (pingTimer !== undefined)
                clearInterval(pingTimer);
            if (!disposed)
                scheduleReconnect();
        });
        ws.on('error', (error) => {
            ctx.logger.warn(`dsh-companion uplink error: ${error.message}`);
        });
    };
    // 经 gateway 的手机下行承载：单一伪连接（MVP 每 Worker 单活跃手机，gateway 负责替换旧手机）。
    // 手机的 auth 帧作为 inner 抵达 → handleFrame 完成 Hub 认证；此后 broadcast 的
    // 事件/快照/审批都经此连接以 phone-frame 发回 gateway，由其转发给当前活跃手机。
    const uplinkConnId = opts.hub.attach({
        send: (text) => {
            send({ kind: 'phone-frame', inner: text });
        },
    }, { trusted: true });
    connect();
    return () => {
        disposed = true;
        if (reconnectTimer !== undefined)
            clearTimeout(reconnectTimer);
        if (pingTimer !== undefined)
            clearInterval(pingTimer);
        opts.hub.detach(uplinkConnId);
        ws?.close();
    };
}
function safeParse(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=uplink.js.map