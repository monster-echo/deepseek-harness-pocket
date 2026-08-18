/**
 * dsh runtime 解析：--dsh 显式指定 > $DSH_BIN > PATH 上的 dsh。
 */
export declare function resolveDshBin(explicit?: string): string;
/** dshc 自身的可执行入口（绝对路径，autostart 用）。 */
export declare function selfBin(): string;
/** 本 npm 包根目录（plugin add file: 规格用）。 */
export declare function packageRoot(): string;
