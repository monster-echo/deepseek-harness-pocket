/**
 * dsh runtime 解析：--dsh 显式指定 > $DSH_BIN > PATH 上的 dsh。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
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
 * 解析策略（按可靠度排序）：
 *   1. node_modules 里按 package.json 的 bin 字段反查真实入口（与 shim 模板无关，最可靠）
 *   2. 解析 .cmd 文本里的 "%~dp0\...*.js" 引用
 *   3. 都失败 → 原样返回并置 shell 标记（调用方用 cmd.exe 兜底，能跑但引号脆弱）
 */
export interface DshLaunch {
  cmd: string
  args: string[]
  /** true 时必须以 shell 方式执行（cmd/cmd 脚本兜底；参数与命令需自行加引号） */
  shell?: boolean
}

export function resolveDshLaunch(dshBin: string): DshLaunch {
  if (process.platform !== 'win32' || !/\.cmd$/i.test(dshBin)) {
    return { cmd: dshBin, args: [] }
  }
  const binDir = dirname(dshBin)
  const stem = basename(dshBin).replace(/\.cmd$/i, '')

  // 1) package.json bin 反查（确定性；npm 安装必然带 package.json）
  const viaPkg = dshEntryFromNodeModules(binDir, stem)
  if (viaPkg !== null) {
    return { cmd: process.execPath, args: [viaPkg] }
  }

  // 2) .cmd 文本解析
  let text = ''
  try {
    text = readFileSync(dshBin, 'utf8')
  } catch {
    // 读不到就走 shell 兜底
  }
  const viaShim = dshEntryFromCmdShim(text, binDir)
  if (viaShim !== null) {
    return { cmd: process.execPath, args: [viaShim] }
  }

  // 3) 兜底：cmd.exe 执行（命令与含空格参数需加引号）
  const cmd = /\s/.test(dshBin) ? `"${dshBin}"` : dshBin
  return { cmd, args: [], shell: true }
}

/** 从 npm 生成的 .cmd shim 文本里提取真实 JS 入口绝对路径；解析不出返回 null。 */
export function dshEntryFromCmdShim(text: string, binDir: string): string | null {
  // npm 生成的 shim 形如："%_prog%" "%~dp0\..\@deepseek-ai\dsh\lib\bin.js" %*
  // 兼容 %~dp0 后多级反斜杠路径；路径必须以引号收尾且以 .js 结尾
  const match = /"%~dp0\\([^"]+\.js)"/i.exec(text)
  if (match?.[1] === undefined) return null
  const entry = resolve(binDir, match[1].replaceAll('\\', '/'))
  return existsSync(entry) ? entry : null
}

/** 在 node_modules 里按 bin 字段反查 shim 名对应的 JS 入口。 */
export function dshEntryFromNodeModules(binDir: string, stem: string): string | null {
  // .bin 的上级就是 node_modules
  const nm = dirname(binDir)
  const packages: string[] = []
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(nm, { withFileTypes: true })
  } catch {
    return null
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    if (e.name.startsWith('@')) {
      // scope：@org/pkg
      let subs: import('node:fs').Dirent[]
      try {
        subs = readdirSync(join(nm, e.name), { withFileTypes: true })
      } catch {
        continue
      }
      for (const s of subs) {
        if (s.isDirectory()) packages.push(join(nm, e.name, s.name))
      }
    } else {
      packages.push(join(nm, e.name))
    }
  }
  for (const pkgDir of packages) {
    const hit = binEntryFromPackageJson(pkgDir, stem)
    if (hit !== null) return hit
  }
  return null
}

function binEntryFromPackageJson(pkgDir: string, stem: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
      bin?: Record<string, string> | string
    }
    const bin = typeof pkg.bin === 'string' ? { [stem]: pkg.bin } : (pkg.bin ?? {})
    const rel = bin[stem]
    if (typeof rel !== 'string' || rel.length === 0) return null
    const entry = resolve(pkgDir, rel)
    return existsSync(entry) ? entry : null
  } catch {
    return null
  }
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
