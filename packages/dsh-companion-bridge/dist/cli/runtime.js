/**
 * dsh runtime 解析：--dsh 显式指定 > $DSH_BIN > PATH 上的 dsh。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
export function resolveDshBin(explicit) {
    if (explicit !== undefined && explicit.length > 0) {
        if (!existsSync(explicit))
            throw new Error(`指定的 dsh 不存在: ${explicit}`);
        return explicit;
    }
    const fromEnv = process.env['DSH_BIN'];
    if (fromEnv !== undefined && fromEnv.length > 0 && existsSync(fromEnv))
        return fromEnv;
    const probe = spawnSync('dsh', ['--version'], { stdio: 'ignore' });
    if (probe.error === undefined)
        return 'dsh';
    throw new Error('找不到 dsh。安装 Node.js 后运行 `npm i -g @deepseek-ai/dsh`，或用 --dsh <路径> / $DSH_BIN 指定。');
}
/** dshc 自身的可执行入口（绝对路径，autostart 用）。 */
export function selfBin() {
    return process.argv[1] ?? 'dshc';
}
/** 本 npm 包根目录（plugin add file: 规格用）。 */
export function packageRoot() {
    // dist/cli/runtime.js → dist/cli → dist → <package root>
    return new URL('../..', import.meta.url).pathname;
}
//# sourceMappingURL=runtime.js.map