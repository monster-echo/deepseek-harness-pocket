/**
 * Worker 本机状态：hostKey / pairing token / 配对码 / 指纹。
 *
 * 状态文件默认 ~/.deepseek-harness-pocket/bridge-state.json，dshc CLI 与插件共用，
 * CLI 负责打印二维码，插件负责校验。
 */
export interface BridgeState {
    readonly version: 1;
    readonly hostKey: string;
    readonly pairingToken: string;
    readonly pairingCode: string;
    readonly fingerprint: string;
    readonly createdAt: number;
}
export declare function defaultStateFile(): string;
export declare function makeFingerprint(): string;
export declare function generateBridgeState(now?: number): BridgeState;
/** 读取或创建状态文件（首启生成）。返回 undefined 表示读取失败且 allowCreate=false。 */
export declare function loadBridgeState(file: string, allowCreate?: boolean): BridgeState | undefined;
/** rotate 配对 token 与配对码（hostKey 与指纹保持稳定）。 */
export declare function rotatePairing(state: BridgeState, file: string): BridgeState;
/** 常量时间 token 比较（长度不同也走完比较）。 */
export declare function verifyToken(expected: string, actual: string): boolean;
