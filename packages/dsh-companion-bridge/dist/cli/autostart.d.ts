/**
 * 开机自启：macOS launchd LaunchAgent / Linux systemd user unit / Windows 提示手动。
 */
export declare function autostartInstall(gatewayUrl: string): string;
export declare function autostartUninstall(): string;
/** 便捷：确保日志目录存在且脚本可执行（shebang bin）。 */
export declare function ensureExecutable(file: string): void;
