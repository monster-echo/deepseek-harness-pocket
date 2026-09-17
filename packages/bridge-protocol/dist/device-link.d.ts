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
export declare const DEVICE_LINK_SCHEME = "dshp://link";
/** 链接码字母表：去掉易混的 I/O/0/1，方便必要时手输。 */
export declare const DEVICE_LINK_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** 链接码长度。 */
export declare const DEVICE_LINK_CODE_LENGTH = 8;
export interface DeviceLinkQrPayload {
    /** 协议版本（当前 1）。 */
    readonly v: number;
    /** 一次性链接码。 */
    readonly code: string;
    /** 电脑名称（手机确认页展示用，可空）。 */
    readonly name?: string;
    /** 平台标识（darwin / win32，可空）。 */
    readonly platform?: string;
    /** 申请链接的 gateway 地址（手机据此判断是否同一后端，可空）。 */
    readonly gateway?: string;
}
/** 生成二维码文本（桌面端调用）。 */
export declare function buildDeviceLinkQr(input: {
    code: string;
    name?: string;
    platform?: string;
    gateway?: string;
}): string;
/**
 * 解析扫到的文本；不是授权登录二维码时返回 null
 * （调用方继续扫，并给出「不是登录二维码」的提示）。
 */
export declare function parseDeviceLinkQr(text: string): DeviceLinkQrPayload | null;
/** 链接码格式校验（长度 + 字母表）。 */
export declare function isDeviceLinkCode(code: string): boolean;
/** 桌面端本地凭据前缀（gateway 侧据此与 JWT 区分）。 */
export declare const DEVICE_LINK_CREDENTIAL_PREFIX = "dshl_";
/** 拼装桌面端凭据：`dshl_<code>.<secret>`。 */
export declare function buildDeviceLinkCredential(code: string, secret: string): string;
/** 拆解桌面端凭据；格式不对返回 null。 */
export declare function parseDeviceLinkCredential(credential: string): {
    code: string;
    secret: string;
} | null;
