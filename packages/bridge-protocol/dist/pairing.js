/**
 * 配对：Worker 与用户账号的绑定。
 *
 * 两种绑定方式（均经 gateway 向 Worker 挑战确认）：
 * 1. 二维码 payload（dshc 在终端打印 ASCII QR）
 * 2. 6 位配对码（扫码失败的手输兜底）
 */
export function parsePairingQrPayload(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return null;
    }
    if (typeof parsed !== 'object' || parsed === null)
        return null;
    const v = parsed;
    if (v.v !== 1)
        return null;
    if (typeof v.gatewayUrl !== 'string' || !/^wss?:\/\//.test(v.gatewayUrl))
        return null;
    if (typeof v.hostKey !== 'string' || v.hostKey.length === 0)
        return null;
    if (typeof v.token !== 'string' || v.token.length === 0)
        return null;
    if (typeof v.fingerprint !== 'string' || v.fingerprint.length === 0)
        return null;
    if (typeof v.code !== 'string' || !/^\d{6}$/.test(v.code))
        return null;
    const lanUrl = v.lanUrl;
    if (lanUrl !== undefined && (typeof lanUrl !== 'string' || !/^ws?:\/\//.test(lanUrl)))
        return null;
    if (lanUrl === undefined) {
        return {
            v: 1,
            gatewayUrl: v.gatewayUrl,
            hostKey: v.hostKey,
            token: v.token,
            fingerprint: v.fingerprint,
            code: v.code,
        };
    }
    return {
        v: 1,
        gatewayUrl: v.gatewayUrl,
        lanUrl,
        hostKey: v.hostKey,
        token: v.token,
        fingerprint: v.fingerprint,
        code: v.code,
    };
}
/** 配对码格式校验（手输路径）。 */
export function isValidPairingCode(code) {
    return /^\d{6}$/.test(code);
}
//# sourceMappingURL=pairing.js.map