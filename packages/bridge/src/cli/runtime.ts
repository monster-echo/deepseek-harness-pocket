/**
 * dsh runtime 解析：--dsh 显式指定 > $DSH_BIN > PATH 上的 dsh。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function resolveDshBin(explicit?: string): string {
  if (explicit !== undefined && explicit.length > 0) {
    if (!existsSync(explicit)) throw new Error(`指定的 dsh 不存在: ${explicit}`)
    return explicit
  }
  const fromEnv = process.env['DSH_BIN']
  if (fromEnv !== undefined && fromEnv.length > 0 && existsSync(fromEnv)) return fromEnv
  const probe = spawnSync('dsh', ['--version'], { stdio: 'ignore', windowsHide: true })
  if (probe.error === undefined) return 'dsh'
  throw new Error(
    '找不到 dsh。安装 Node.js 后运行 `npm i -g @deepseek-ai/dsh`，或用 --dsh <路径> / $DSH_BIN 指定。',
  )
}

/** dshc 自身的可执行入口（绝对路径，autostart 用）。 */
export function selfBin(): string {
  return process.argv[1] ?? 'dshc'
}

/**
 * 解析 dsh 启动目标。
 *
 * Windows 上 npm 的 .bin shim 是 `.cmd` 批处理脚本，Node ≥ 18.20/20.12 出于安全
 * 原因拒绝直接 spawn（EINVAL → spawnSync status 为 null，表现为「exit null」）。
 * 这里解析 .cmd 内容找到真实 JS 入口，用当前 node 进程直接运行；其余平台原样返回。
 */
export function resolveDshLaunch(dshBin: string): { cmd: string; args: string[] } {
  if (process.platform !== 'win32' || !/\.cmd$/i.test(dshBin)) {
    return { cmd: dshBin, args: [] }
  }
  let text: string
  try {
    text = readFileSync(dshBin, 'utf8')
  } catch {
    return { cmd: dshBin, args: [] }
  }
  const entry = dshEntryFromCmdShim(text, dirname(dshBin))
  if (entry !== null) {
    return { cmd: process.execPath, args: [entry] }
  }
  return { cmd: dshBin, args: [] }
}

/** 从 npm 生成的 .cmd shim 文本里提取真实 JS 入口绝对路径；解析不出返回 null。 */
export function dshEntryFromCmdShim(text: string, binDir: string): string | null {
  // npm 生成的 shim 形如："%~dp0\..\@deepseek-ai\dsh\lib\bin.js" %*
  const match = /"%~dp0\\([^"]+\.js)"/i.exec(text)
  if (match?.[1] === undefined) return null
  const entry = resolve(binDir, match[1].replaceAll('\\', '/'))
  return existsSync(entry) ? entry : null
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
