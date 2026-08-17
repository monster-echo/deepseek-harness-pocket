/**
 * Worker 本机状态：hostKey / pairing token / 配对码 / 指纹。
 *
 * 状态文件默认 ~/.dsh-companion/bridge-state.json，dshc CLI 与插件共用，
 * CLI 负责打印二维码，插件负责校验。
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
export function defaultStateFile() {
    return join(homedir(), '.dsh-companion', 'bridge-state.json');
}
function b64url(bytes) {
    return bytes.toString('base64url');
}
export function makeFingerprint() {
    const seed = `${homedir()}|${process.platform}|${process.arch}|${randomBytes(8).toString('hex')}`;
    return createHash('sha256').update(seed).digest('hex').slice(0, 16);
}
export function generateBridgeState(now = Date.now()) {
    const code = String(100000 + (randomBytes(4).readUInt32BE(0) % 900000));
    return {
        version: 1,
        hostKey: `hk_${b64url(randomBytes(18))}`,
        pairingToken: `pt_${b64url(randomBytes(24))}`,
        pairingCode: code,
        fingerprint: makeFingerprint(),
        createdAt: now,
    };
}
/** 读取或创建状态文件（首启生成）。返回 undefined 表示读取失败且 allowCreate=false。 */
export function loadBridgeState(file, allowCreate = true) {
    const path = resolve(file.replace(/^~(?=\/|$)/, homedir()));
    if (existsSync(path)) {
        try {
            const parsed = JSON.parse(readFileSync(path, 'utf8'));
            if (parsed.version === 1
                && typeof parsed.hostKey === 'string' && parsed.hostKey.length > 0
                && typeof parsed.pairingToken === 'string' && parsed.pairingToken.length > 0
                && typeof parsed.pairingCode === 'string' && /^\d{6}$/.test(parsed.pairingCode)
                && typeof parsed.fingerprint === 'string' && parsed.fingerprint.length > 0
                && typeof parsed.createdAt === 'number') {
                return parsed;
            }
        }
        catch {
            // 损坏的状态文件：走重建
        }
    }
    if (!allowCreate)
        return undefined;
    const state = generateBridgeState();
    saveBridgeState(path, state);
    return state;
}
/** rotate 配对 token 与配对码（hostKey 与指纹保持稳定）。 */
export function rotatePairing(state, file) {
    const code = String(100000 + (randomBytes(4).readUInt32BE(0) % 900000));
    const next = {
        ...state,
        pairingToken: `pt_${b64url(randomBytes(24))}`,
        pairingCode: code,
    };
    saveBridgeState(resolve(file.replace(/^~(?=\/|$)/, homedir())), next);
    return next;
}
function saveBridgeState(path, state) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(state, undefined, 2)}\n`, { mode: 0o600 });
}
/** 常量时间 token 比较（长度不同也走完比较）。 */
export function verifyToken(expected, actual) {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(actual, 'utf8');
    if (a.length !== b.length) {
        timingSafeEqual(a, a);
        return false;
    }
    return timingSafeEqual(a, b);
}
//# sourceMappingURL=state.js.map