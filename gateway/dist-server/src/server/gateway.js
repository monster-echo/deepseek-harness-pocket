/**
 * Gateway 核心：Worker uplink 与手机接入的 WS 处理、配对挑战、presence、通知分发。
 *
 * 手机↔Worker 是纯隧道（phone-frame/worker-frame 互转，不解析 /mobile 协议）。
 * 账号归属（pairings）与设备/用量持久化在 Store；内存态只保留在线表。
 */
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
const MAX_FRAMES_PER_SECOND = 120;
export class Gateway {
    config;
    store;
    verify;
    sendPush;
    workers = new Map();
    workerByHostKey = new Map();
    phones = new Map();
    challenges = new Map();
    seq = 0;
    constructor(config, store, verify, sendPush) {
        this.config = config;
        this.store = store;
        this.verify = verify;
        this.sendPush = sendPush;
    }
    // ---------- Worker uplink ----------
    attachWorker(ws) {
        const conn = {
            ws,
            workerId: '',
            hostKey: '',
            name: '',
            fingerprint: '',
            dshVersion: null,
            pairingCode: '',
            alive: true,
        };
        const id = `wk${++this.seq}`;
        this.workers.set(id, conn);
        const authTimer = setTimeout(() => {
            if (conn.workerId === '')
                this.dropWorker(id);
        }, 10_000);
        ws.on('pong', () => {
            conn.alive = true;
        });
        ws.on('close', () => {
            clearTimeout(authTimer);
            this.dropWorker(id);
        });
        ws.on('message', (data) => {
            const text = typeof data === 'string' ? data : String(data);
            void this.handleWorkerFrame(id, conn, text);
        });
    }
    dropWorker(id) {
        const conn = this.workers.get(id);
        this.workers.delete(id);
        if (conn !== undefined && conn.workerId !== '') {
            this.workerByHostKey.delete(conn.hostKey);
            void this.store.recordUsage({ userId: null, workerId: conn.workerId, kind: 'worker-offline' });
            void this.broadcastPresence();
        }
        // 打开着台 Worker 的手机收到 worker-frame 断连由手机侧重连逻辑处理
    }
    async handleWorkerFrame(id, conn, text) {
        let value;
        try {
            value = JSON.parse(text);
        }
        catch {
            return;
        }
        const frame = value;
        switch (frame.kind) {
            case 'worker-register': {
                const existing = await this.store.getWorkerByHostKey(frame.hostKey);
                const workerId = existing?.id ?? `w_${randomUUID().slice(0, 12)}`;
                await this.store.upsertWorker({
                    id: workerId,
                    hostKey: frame.hostKey,
                    name: frame.name,
                    fingerprint: frame.hostFingerprint,
                    dshVersion: frame.dshVersion,
                    pairingCode: frame.pairingCode,
                });
                conn.workerId = workerId;
                conn.hostKey = frame.hostKey;
                conn.name = frame.name;
                conn.fingerprint = frame.hostFingerprint;
                conn.dshVersion = frame.dshVersion;
                conn.pairingCode = frame.pairingCode;
                this.workerByHostKey.set(frame.hostKey, id);
                this.sendToWorkerConn(conn, { kind: 'register-ok', workerId });
                await this.store.recordUsage({ userId: null, workerId, kind: 'worker-online' });
                await this.broadcastPresence();
                break;
            }
            case 'pong':
                break;
            case 'phone-frame': {
                // Worker → 手机下行：转发给当前打开该 Worker 的手机（MVP 单活跃）
                if (conn.workerId === '')
                    return;
                for (const phone of this.phones.values()) {
                    if (phone.authed && phone.openWorkerId === conn.workerId) {
                        this.sendToPhoneConn(phone, { kind: 'worker-frame', workerId: conn.workerId, inner: frame.inner });
                    }
                }
                break;
            }
            case 'pairing-answer': {
                const resolve = this.challenges.get(frame.challengeId);
                if (resolve !== undefined) {
                    this.challenges.delete(frame.challengeId);
                    resolve(frame.accepted);
                }
                break;
            }
            case 'notify': {
                // Worker 通知信号 → 推给该 Worker 配对用户的在线手机 + 系统 push
                if (conn.workerId === '')
                    return;
                const pairings = await this.store.listPairingsByWorker(conn.workerId);
                for (const userId of pairings) {
                    this.sendToUser(userId, {
                        kind: 'push',
                        title: frame.title,
                        body: frame.body,
                        ...(frame.sessionId !== undefined ? { sessionId: frame.sessionId } : {}),
                    });
                    await this.sendPush(userId, frame.title, frame.body, frame.sessionId);
                }
                break;
            }
        }
    }
    sendToWorkerConn(conn, frame) {
        if (conn.ws.readyState === WebSocket.OPEN)
            conn.ws.send(JSON.stringify(frame));
    }
    // ---------- 手机 ----------
    attachPhone(ws) {
        const conn = {
            ws,
            userId: null,
            deviceKey: '',
            openWorkerId: null,
            authed: false,
            alive: true,
            frameBudget: MAX_FRAMES_PER_SECOND,
        };
        const id = `ph${++this.seq}`;
        this.phones.set(id, conn);
        const authTimer = setTimeout(() => {
            if (!conn.authed)
                this.dropPhone(id);
        }, 10_000);
        // 简单限速：每秒重置预算
        const budgetTimer = setInterval(() => {
            conn.frameBudget = MAX_FRAMES_PER_SECOND;
        }, 1000);
        ws.on('pong', () => {
            conn.alive = true;
        });
        ws.on('close', () => {
            clearTimeout(authTimer);
            clearInterval(budgetTimer);
            this.dropPhone(id);
        });
        ws.on('message', (data) => {
            if (conn.frameBudget <= 0) {
                this.dropPhone(id);
                return;
            }
            conn.frameBudget -= 1;
            const text = typeof data === 'string' ? data : String(data);
            void this.handlePhoneFrame(id, conn, text);
        });
    }
    dropPhone(id) {
        const conn = this.phones.get(id);
        this.phones.delete(id);
        if (conn !== undefined && conn.openWorkerId !== null && conn.userId !== null) {
            void this.store.recordUsage({ userId: conn.userId, workerId: conn.openWorkerId, kind: 'phone-session-end' });
        }
        conn?.ws.terminate();
    }
    async handlePhoneFrame(id, conn, text) {
        let value;
        try {
            value = JSON.parse(text);
        }
        catch {
            return;
        }
        const frame = value;
        if (frame.kind === 'phone-auth') {
            const authToken = frame['authToken'];
            const deviceKey = frame['deviceKey'];
            if (typeof authToken !== 'string' || typeof deviceKey !== 'string') {
                this.sendToPhoneConn(conn, { kind: 'auth-rejected', reason: 'malformed auth' });
                this.dropPhone(id);
                return;
            }
            const user = await this.verify(authToken);
            if (user === null) {
                this.sendToPhoneConn(conn, { kind: 'auth-rejected', reason: 'invalid session' });
                this.dropPhone(id);
                return;
            }
            conn.userId = user.userId;
            conn.deviceKey = deviceKey;
            conn.authed = true;
            this.sendToPhoneConn(conn, { kind: 'auth-ok', userId: user.userId });
            await this.store.upsertDevice({ userId: user.userId, deviceKey, platform: 'app', expoPushToken: null });
            await this.sendPresenceTo(conn);
            return;
        }
        if (!conn.authed || conn.userId === null)
            return;
        switch (frame.kind) {
            case 'pong':
                return;
            case 'worker-open': {
                const workerId = frame['workerId'];
                if (typeof workerId !== 'string')
                    return;
                if (!(await this.store.isPaired(conn.userId, workerId))) {
                    this.sendToPhoneConn(conn, { kind: 'worker-open-result', workerId, ok: false, reason: 'not paired' });
                    return;
                }
                const workerOnline = this.findWorkerConnByWorkerId(workerId) !== undefined;
                if (!workerOnline) {
                    this.sendToPhoneConn(conn, { kind: 'worker-open-result', workerId, ok: false, reason: 'worker offline' });
                    return;
                }
                // MVP 单活跃手机：踢掉同 Worker 的旧手机
                for (const [pid, phone] of this.phones) {
                    if (pid !== id && phone.openWorkerId === workerId) {
                        phone.openWorkerId = null;
                        this.sendToPhoneConn(phone, { kind: 'worker-open-result', workerId, ok: false, reason: 'superseded by another device' });
                    }
                }
                conn.openWorkerId = workerId;
                this.sendToPhoneConn(conn, { kind: 'worker-open-result', workerId, ok: true });
                await this.store.recordUsage({ userId: conn.userId, workerId, kind: 'phone-session-start' });
                return;
            }
            case 'worker-close': {
                conn.openWorkerId = null;
                return;
            }
            case 'worker-frame': {
                const workerId = frame['workerId'];
                const inner = frame['inner'];
                if (typeof workerId !== 'string' || typeof inner !== 'string')
                    return;
                if (conn.openWorkerId !== workerId)
                    return; // 未打开或越权
                const workerConn = this.findWorkerConnByWorkerId(workerId);
                if (workerConn === undefined)
                    return;
                this.sendToWorkerConn(workerConn, { kind: 'phone-frame', phoneId: id, inner });
                return;
            }
        }
    }
    findWorkerConnByWorkerId(workerId) {
        for (const conn of this.workers.values()) {
            if (conn.workerId === workerId)
                return conn;
        }
        return undefined;
    }
    sendToPhoneConn(conn, frame) {
        if (conn.ws.readyState === WebSocket.OPEN)
            conn.ws.send(JSON.stringify(frame));
    }
    sendToUser(userId, frame) {
        for (const phone of this.phones.values()) {
            if (phone.authed && phone.userId === userId)
                this.sendToPhoneConn(phone, frame);
        }
    }
    // ---------- presence ----------
    async presenceFor(userId) {
        const pairings = await this.store.listPairings(userId);
        const result = [];
        for (const pairing of pairings) {
            const row = await this.store.getWorkerById(pairing.worker_id);
            if (row === null)
                continue;
            const conn = this.findWorkerConnByWorkerId(pairing.worker_id);
            result.push({
                workerId: pairing.worker_id,
                name: pairing.name ?? row.name,
                hostFingerprint: row.fingerprint,
                online: conn !== undefined,
                lastSeenAt: row.last_seen_at.getTime(),
                capabilities: conn !== undefined
                    ? { dshVersion: conn.dshVersion, protocolVersion: 'mobile/v1' }
                    : null,
            });
        }
        return result.sort((a, b) => Number(b.online) - Number(a.online) || b.lastSeenAt - a.lastSeenAt);
    }
    async sendPresenceTo(conn) {
        if (conn.userId === null)
            return;
        const workers = await this.presenceFor(conn.userId);
        this.sendToPhoneConn(conn, { kind: 'presence', workers });
    }
    async broadcastPresence() {
        const seen = new Set();
        for (const phone of this.phones.values()) {
            if (!phone.authed || phone.userId === null || seen.has(phone.userId))
                continue;
            seen.add(phone.userId);
            await this.sendPresenceTo(phone);
        }
    }
    // ---------- 配对（REST 调用） ----------
    async bindByQr(userId, payload, name) {
        const connId = this.workerByHostKey.get(payload.hostKey);
        const workerConn = connId !== undefined ? this.workers.get(connId) : undefined;
        if (workerConn === undefined || workerConn.workerId === '') {
            return { ok: false, reason: 'worker 不在线（请先在电脑上启动 dshc）' };
        }
        return this.challengeAndPair(userId, workerConn, payload.code, payload.fingerprint, name);
    }
    async bindByCode(userId, code, name) {
        for (const conn of this.workers.values()) {
            if (conn.pairingCode === code && conn.workerId !== '') {
                return this.challengeAndPair(userId, conn, code, conn.fingerprint, name);
            }
        }
        return { ok: false, reason: '配对码无效或 Worker 不在线' };
    }
    async challengeAndPair(userId, conn, code, fingerprint, name) {
        const challengeId = `ch_${randomUUID().slice(0, 12)}`;
        const decided = new Promise((resolve) => {
            this.challenges.set(challengeId, resolve);
            setTimeout(() => {
                if (this.challenges.has(challengeId)) {
                    this.challenges.delete(challengeId);
                    resolve(false);
                }
            }, 15_000);
        });
        this.sendToWorkerConn(conn, { kind: 'pairing-challenge', challengeId, code, requestedBy: userId });
        const accepted = await decided;
        if (!accepted)
            return { ok: false, reason: 'Worker 拒绝了配对（配对码不匹配）' };
        await this.store.pairWorker(userId, conn.workerId, name);
        await this.store.recordUsage({ userId, workerId: conn.workerId, kind: 'pairing-bound', meta: { fingerprint } });
        await this.broadcastPresence();
        return { ok: true, workerId: conn.workerId, name: name ?? conn.name };
    }
    /** REST：列出我的 Worker（含在线状态）。 */
    async listWorkers(userId) {
        return this.presenceFor(userId);
    }
    async unpair(userId, workerId) {
        await this.store.unpairWorker(userId, workerId);
        await this.broadcastPresence();
    }
    /** 心跳（server.ts 定时调用）。 */
    heartbeat() {
        for (const [id, conn] of this.workers) {
            if (!conn.alive) {
                conn.ws.terminate();
                this.dropWorker(id);
                continue;
            }
            conn.alive = false;
            conn.ws.ping();
            if (conn.workerId !== '')
                void this.store.touchWorker(conn.workerId);
        }
        for (const [id, conn] of this.phones) {
            if (!conn.alive) {
                this.dropPhone(id);
                continue;
            }
            conn.alive = false;
            conn.ws.ping();
        }
    }
}
//# sourceMappingURL=gateway.js.map