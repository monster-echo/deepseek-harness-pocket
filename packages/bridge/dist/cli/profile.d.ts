/**
 * companion profile 管理：确保 ~/.dsh/profiles/companion 存在、
 * 插件已安装（dsh plugin add file:<本包>）、cordis.patch.yml 含本插件行（含运行配置）。
 */
export declare const COMPANION_PROFILE = "companion";
export interface BridgePatchConfig {
    readonly gatewayUrl: string;
    readonly port: number;
    readonly host: string;
    readonly caps: 'm1' | 'm2' | 'm3';
    readonly workerName: string;
    readonly stateFile: string;
}
export declare function resolveDshHomeDir(): string;
export declare function profileDir(profile?: string): string;
/** cordis.patch.yml 的插行配置：幂等（替换既有 deepseek-harness-pocket-bridge 行）。 */
export declare function upsertBridgePatch(dir: string, config: BridgePatchConfig): void;
/** 安装/更新本插件包到 profile（dsh plugin = pnpm 转发器）。 */
export declare function installBridgePackage(dir: string, dshBin: string, packageRootPath: string): void;
