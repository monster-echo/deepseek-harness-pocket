/**
 * dsh 子进程守护：spawn + 崩溃退避重启 + 优雅停止 + 日志落盘。
 */
export declare function dshcDir(): string;
export declare function logFile(): string;
export declare function pidFile(): string;
export declare function isRunning(): number | null;
/** 前台守护循环：崩溃退避重启，直到 SIGINT/SIGTERM 或 stop-flag 出现。 */
export declare function supervise(dshBin: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<void>;
/** 后台模式：detached 再 spawn 一层 supervisor（`dshc start --detached`）。 */
export declare function detachSpawn(extraArgs: readonly string[]): number;
/** dshc stop：写 stop-flag（supervisor 检测后优雅退出）。 */
export declare function requestStop(): void;
