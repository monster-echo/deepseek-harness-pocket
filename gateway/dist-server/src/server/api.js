/**
 * REST /api/v1/*：由自定义 server 直接处理（不经 Next），与 WS 核心同一构建。
 *
 * POST   /api/v1/pairing/bind      { qr?: {payload}, code?, name? }
 * GET    /api/v1/workers           我的 Worker 列表（含在线状态）
 * DELETE /api/v1/workers?workerId= 解绑
 * POST   /api/v1/devices/push-token { deviceKey, platform, expoPushToken }
 * GET    /api/v1/health
 */
import { parsePairingQrPayload } from '@dsh-companion/bridge-protocol';
import { createAuthVerifier } from './auth-verify.js';
export function createApiRouter(deps) {
    const verify = createAuthVerifier(deps.config);
    const json = (res, status, body) => {
        const payload = JSON.stringify(body);
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
        res.end(payload);
    };
    const readBody = async (req) => {
        const chunks = [];
        for await (const chunk of req) {
            chunks.push(chunk);
            if (chunks.reduce((n, c) => n + c.length, 0) > 1024 * 1024)
                throw new Error('body too large');
        }
        const text = Buffer.concat(chunks).toString('utf8');
        return text.length === 0 ? {} : JSON.parse(text);
    };
    const authUser = async (req) => {
        const header = req.headers['authorization'];
        if (typeof header !== 'string' || !header.startsWith('Bearer '))
            return null;
        return verify(header.slice('Bearer '.length));
    };
    return async (req, res) => {
        const url = (req.url ?? '').split('?')[0];
        if (url === undefined || !url.startsWith('/api/v1/'))
            return false;
        if (url === '/api/v1/health' && req.method === 'GET') {
            json(res, 200, { ok: true, service: 'dsh-companion-gateway', protocol: 'mobile/v1' });
            return true;
        }
        if (url === '/api/v1/pairing/bind' && req.method === 'POST') {
            const user = await authUser(req);
            if (user === null) {
                json(res, 401, { error: 'unauthorized' });
                return true;
            }
            let body;
            try {
                body = (await readBody(req));
            }
            catch {
                json(res, 400, { error: 'bad request' });
                return true;
            }
            let result;
            if (typeof body.qr?.payload === 'string') {
                const payload = parsePairingQrPayload(body.qr.payload);
                if (payload === null) {
                    json(res, 400, { error: 'invalid qr payload' });
                    return true;
                }
                result = await deps.gateway.bindByQr(user.userId, payload, body.name ?? null);
            }
            else if (typeof body.code === 'string' && /^\d{6}$/.test(body.code)) {
                result = await deps.gateway.bindByCode(user.userId, body.code, body.name ?? null);
            }
            else {
                json(res, 400, { error: 'qr payload or 6-digit code required' });
                return true;
            }
            json(res, result.ok ? 200 : 422, result);
            return true;
        }
        if (url === '/api/v1/workers' && req.method === 'GET') {
            const user = await authUser(req);
            if (user === null) {
                json(res, 401, { error: 'unauthorized' });
                return true;
            }
            json(res, 200, { workers: await deps.gateway.listWorkers(user.userId) });
            return true;
        }
        if (url === '/api/v1/workers' && req.method === 'DELETE') {
            const user = await authUser(req);
            if (user === null) {
                json(res, 401, { error: 'unauthorized' });
                return true;
            }
            const workerId = new URL(req.url ?? '', 'http://localhost').searchParams.get('workerId');
            if (workerId === null || workerId.length === 0) {
                json(res, 400, { error: 'workerId required' });
                return true;
            }
            await deps.gateway.unpair(user.userId, workerId);
            json(res, 200, { ok: true });
            return true;
        }
        if (url === '/api/v1/devices/push-token' && req.method === 'POST') {
            const user = await authUser(req);
            if (user === null) {
                json(res, 401, { error: 'unauthorized' });
                return true;
            }
            let body;
            try {
                body = (await readBody(req));
            }
            catch {
                json(res, 400, { error: 'bad request' });
                return true;
            }
            if (typeof body.deviceKey !== 'string' || body.deviceKey.length === 0) {
                json(res, 400, { error: 'deviceKey required' });
                return true;
            }
            await deps.store.upsertDevice({
                userId: user.userId,
                deviceKey: body.deviceKey,
                platform: typeof body.platform === 'string' ? body.platform : 'ios',
                expoPushToken: typeof body.expoPushToken === 'string' ? body.expoPushToken : null,
            });
            json(res, 200, { ok: true });
            return true;
        }
        json(res, 404, { error: 'not found' });
        return true;
    };
}
//# sourceMappingURL=api.js.map