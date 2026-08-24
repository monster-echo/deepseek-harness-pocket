/**
 * dsh runtime 解析：--dsh 显式指定 > $DSH_BIN > PATH 上的 dsh。
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function resolveDshBin(explicit?: string): string {
  if (explicit !== undefined && explicit.length > 0) {
    if (!existsSync(explicit)) throw new Error(`指定的 dsh 不存在: ${explicit}`)
    return explicit
  }
  const fromEnv = process.env['DSH_BIN']
  if (fromEnv !== undefined && fromEnv.length > 0 && existsSync(fromEnv)) return fromEnv
  const probe = spawnSync('dsh', ['--version'], { stdio: 'ignore' })
  if (probe.error === undefined) return 'dsh'
  throw new Error(
    '找不到 dsh。安装 Node.js 后运行 `npm i -g @deepseek-ai/dsh`，或用 --dsh <路径> / $DSH_BIN 指定。',
  )
}

/** dshc 自身的可执行入口（绝对路径，autostart 用）。 */
export function selfBin(): string {
  return process.argv[1] ?? 'dshc'
}

/** 粗粒度 semver 比较（只看 major.minor.patch，rc 后缀忽略）。返回 -1|0|1。 */
export function compareVersion(a: string, b: string): number {
  const pa = a.trim().replace(/^v/, '').split(/[.-]/).map(Number)
  const pb = b.trim().replace(/^v/, '').split(/[.-]/).map(Number)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/** 本 npm 包根目录（plugin add file: 规格用）。 */
export function packageRoot(): string {
  // dist/cli/runtime.js → dist/cli → dist → <package root>
  // fileURLToPath：应用包路径含空格（DSH%20Pocket%20Worker.app）时必须解码
  return fileURLToPath(new URL('../..', import.meta.url))
}
