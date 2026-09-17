/**
 * 桌面端「手机扫码授权登录」负载（dshp://link）。
 *
 * 流程（三方：桌面端 / 手机 App / gateway）：
 *   1. 桌面端未登录时向 gateway 申请一次性链接码
 *      `POST /api/v1/devices/link/start { hostKey, name, platform }`
 *      → 拿到 `{ code, secret }`，把 code 编成二维码显示在控制台；
 *   2. 手机 App（已登录）扫到 `dshp://link?...`，向用户确认「授权这台电脑」后
 *      `POST /api/v1/devices/link/approve { code, email }`（Bearer = 手机会话）；
 *   3. 桌面端用 `POST /api/v1/devices/link/poll { code, secret }` 轮询取回
 *      账号身份与凭据（`dshl_<code>.<secret>`），完成「已登录」。
 *
 * 安全约定：
 * - `secret` 只在桌面端本地保存，**不进二维码**（二维码只带一次性 code）；
 * - code 短时效（默认 5 分钟）、一次性；approve 需要手机自己的有效会话；
 * - 桌面端取回的凭据是 gateway 侧的设备凭据，不是账号 token —— 手机会话不被共享。
 *
 * 该负载格式与桌面端（Dart，见 desktop/lib/services/device_link.dart）保持一致，
 * 改动需同步两侧。
 */
/** 二维码里的 scheme + host 前缀。 */
export const DEVICE_LINK_SCHEME = 'dshp://link';
/** 链接码字母表：去掉易混的 I/O/0/1，方便必要时手输。 */
export const DEVICE_LINK_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** 链接码长度。 */
export const DEVICE_LINK_CODE_LENGTH = 8;
/** 生成二维码文本（桌面端调用）。 */
export function buildDeviceLinkQr(input) {
    const parts = [`v=1`, `c=${encodeURIComponent(input.code)}`];
    if (input.name !== undefined && input.name.length > 0)
        parts.push(`h=${encodeURIComponent(input.name)}`);
    if (input.platform !== undefined && input.platform.length > 0)
        parts.push(`p=${encodeURIComponent(input.platform)}`);
    if (input.gateway !== undefined && input.gateway.length > 0)
        parts.push(`gw=${encodeURIComponent(input.gateway)}`);
    return `${DEVICE_LINK_SCHEME}?${parts.join('&')}`;
}
/**
 * 解析扫到的文本；不是授权登录二维码时返回 null
 * （调用方继续扫，并给出「不是登录二维码」的提示）。
 */
export function parseDeviceLinkQr(text) {
    const trimmed = text.trim();
    if (!trimmed.toLowerCase().startsWith(DEVICE_LINK_SCHEME))
        return null;
    const queryStart = trimmed.indexOf('?');
    if (queryStart < 0)
        return null;
    const params = parseQuery(trimmed.slice(queryStart + 1));
    const code = (params['c'] ?? '').toUpperCase();
    if (!isDeviceLinkCode(code))
        return null;
    const v = Number(params['v'] ?? '1');
    const name = params['h'];
    const platform = params['p'];
    const gateway = params['gw'];
    return {
        v: Number.isFinite(v) ? v : 1,
        code,
        ...(name !== undefined && name.length > 0 ? { name } : {}),
        ...(platform !== undefined && platform.length > 0 ? { platform } : {}),
        ...(gateway !== undefined && gateway.length > 0 ? { gateway } : {}),
    };
}
/**
 * 极简 query 解析（协议包零 DOM/Node API：不能用 URLSearchParams）。
 * 重复键取最后一个，与 URLSearchParams.get 行为一致。
 */
function parseQuery(query) {
    const out = {};
    for (const pair of query.split('&')) {
        if (pair.length === 0)
            continue;
        const eq = pair.indexOf('=');
        const rawKey = eq < 0 ? pair : pair.slice(0, eq);
        const rawValue = eq < 0 ? '' : pair.slice(eq + 1);
        const key = safeDecode(rawKey);
        if (key.length === 0)
            continue;
        out[key] = safeDecode(rawValue);
    }
    return out;
}
function safeDecode(value) {
    try {
        return decodeURIComponent(value.replace(/\+/g, ' '));
    }
    catch {
        return value;
    }
}
/** 链接码格式校验（长度 + 字母表）。 */
export function isDeviceLinkCode(code) {
    if (code.length !== DEVICE_LINK_CODE_LENGTH)
        return false;
    for (const ch of code) {
        if (!DEVICE_LINK_ALPHABET.includes(ch))
            return false;
    }
    return true;
}
/** 桌面端本地凭据前缀（gateway 侧据此与 JWT 区分）。 */
export const DEVICE_LINK_CREDENTIAL_PREFIX = 'dshl_';
/** 拼装桌面端凭据：`dshl_<code>.<secret>`。 */
export function buildDeviceLinkCredential(code, secret) {
    return `${DEVICE_LINK_CREDENTIAL_PREFIX}${code}.${secret}`;
}
/** 拆解桌面端凭据；格式不对返回 null。 */
export function parseDeviceLinkCredential(credential) {
    if (!credential.startsWith(DEVICE_LINK_CREDENTIAL_PREFIX))
        return null;
    const rest = credential.slice(DEVICE_LINK_CREDENTIAL_PREFIX.length);
    const dot = rest.indexOf('.');
    if (dot <= 0 || dot === rest.length - 1)
        return null;
    return { code: rest.slice(0, dot), secret: rest.slice(dot + 1) };
}
//# sourceMappingURL=device-link.js.map