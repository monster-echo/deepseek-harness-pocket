/**
 * Worker 配对二维码（`dshc qr` 打印，手机扫码）。
 *
 * 一个二维码要同时支持两条路径：
 *   1. **同网直连**：手机与电脑在同一 WiFi 时，扫码后可直接用 `host:port`
 *      走 `/mobile/ws`（pairingToken 鉴权），不依赖外网网关。
 *   2. **账号绑定**：扫码后手机用 `code` 调 gateway 的 `pairing/bind`，
 *      把该 Worker 绑到当前账号（之后 presence 里就能看到它）。
 *
 * 负载形态（URI，便于相机/系统分享一并识别）：
 *   dshp://pair?code=123456&name=mac-mini&host=192.168.1.5&port=3780&token=pt_xxx&gw=wss%3A%2F%2F...
 *
 * `token` 可选：带 token 时手机可跳过 6 位码直接直连；`gw` 可选：非默认网关地址。
 *
 * 本包是**零 Node/DOM API** 的纯 TS（与全系统共享协议层一致），
 * 所以这里不依赖 `URL` / `URLSearchParams`，自己解析这一个小 URI。
 */
export declare const PAIR_QR_SCHEME = "dshp";
export declare const PAIR_QR_HOST = "pair";
export interface PairQrPayload {
    /** 6 位配对码（gateway pairing/bind 用） */
    readonly code: string;
    /** Worker 展示名 */
    readonly name?: string;
    /** 同网直连主机（局域网 IP 或 mDNS 名） */
    readonly host?: string;
    /** 直连端口（默认 3780） */
    readonly port?: number;
    /** 直连鉴权 token（bridge-state 的 pairingToken） */
    readonly token?: string;
    /** 非默认 gateway 地址（wss://...） */
    readonly gatewayUrl?: string;
}
/** 组装二维码负载（Worker 侧使用）。 */
export declare function encodePairQr(payload: PairQrPayload): string;
/** 解析扫码结果；不是配对二维码时返回 null（调用方忽略即可）。 */
export declare function parsePairQr(text: string): PairQrPayload | null;
/** 直连 WebSocket 地址（同网路径）；host 缺失时为 null。 */
export declare function pairDirectWsUrl(payload: PairQrPayload): string | null;
