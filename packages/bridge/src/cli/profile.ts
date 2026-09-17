/**
 * companion profile 管理：确保 ~/.dsh/profiles/companion 存在、
 * 插件已安装（dsh plugin add file:<本包>）、cordis.patch.yml 含本插件行（含运行配置）。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const COMPANION_PROFILE = 'companion'

/** bridge 插件在 profile manifest 里的依赖名（installBridgePackage 写入的 file: 依赖）。 */
export const BRIDGE_DEP_NAME = '@deepseek-harness-pocket/bridge'

export interface BridgePatchConfig {
  readonly gatewayUrl: string
  readonly port: number
  readonly host: string
  readonly caps: 'm1' | 'm2' | 'm3'
  readonly workerName: string
  readonly stateFile: string
}

export function resolveDshHomeDir(): string {
  const fromEnv = process.env['DSH_HOME']
  return resolve((fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), '.dsh')).replace(/^~(?=\/|$)/, homedir()))
}

export function profileDir(profile = COMPANION_PROFILE): string {
  return join(resolveDshHomeDir(), 'profiles', profile)
}

/** 首次创建 profile manifest（dsh plugin add 会跳过已存在的）。bundles 含 web-app 以保证常驻 host。 */
function ensureProfileManifest(dir: string): void {
  mkdirSync(dir, { recursive: true })
  const manifestPath = join(dir, 'package.json')
  if (existsSync(manifestPath)) {
    // 已初始化的 manifest：确保 bundle 集完整（升级补齐 web-app）
    try {
      const existing = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        dsh?: { profile?: { bundles?: string[] } }
      }
      const bundles = existing.dsh?.profile?.bundles ?? []
      if (!bundles.includes('@deepseek-ai/dsh-web-app')) {
        bundles.push('@deepseek-ai/dsh-web-app')
        writeFileSync(manifestPath, `${JSON.stringify(existing, undefined, 2)}\n`)
      }
    } catch {
      // 损坏 manifest：保持原行为，交给 dsh 报错
    }
    return
  }
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        name: 'dsh-profile-companion',
        private: true,
        dependencies: {},
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
      },
      undefined,
      2,
    )}\n`,
  )
}

/** cordis.patch.yml 的插行配置：幂等（替换既有 deepseek-harness-pocket-bridge 行）。 */
export function upsertBridgePatch(dir: string, config: BridgePatchConfig): void {
  const patchPath = join(dir, 'cordis.patch.yml')
  const entry = [
    '- insert:',
    `  - id: deepseek-harness-pocket-bridge`,
    `    name: '@deepseek-harness-pocket/bridge'`,
    '    config:',
    '      listen:',
    `        host: ${JSON.stringify(config.host)}`,
    `        port: ${config.port}`,
    '      gateway:',
    `        url: ${JSON.stringify(config.gatewayUrl)}`,
    "        hostKey: ''",
    `      caps: ${JSON.stringify(config.caps)}`,
    `      name: ${JSON.stringify(config.workerName)}`,
    `      stateFile: ${JSON.stringify(config.stateFile)}`,
  ].join('\n')

  if (!existsSync(patchPath)) {
    writeFileSync(patchPath, `# managed by dshc — companion bridge layer\n${entry}\n`)
    return
  }
  const existing = readFileSync(patchPath, 'utf8')
  if (existing.includes('id: deepseek-harness-pocket-bridge')) {
    // 逐块替换：以 "- insert:" 或 "- " 开头的行块中含本 id 的整块替换
    const blocks = existing.split(/(?=^- )/m)
    const kept = blocks.filter((b) => !b.includes('id: deepseek-harness-pocket-bridge'))
    writeFileSync(patchPath, `${kept.join('').trimEnd()}\n${entry}\n`)
  } else {
    writeFileSync(patchPath, `${existing.trimEnd()}\n${entry}\n`)
  }
}

/** 把 file: 依赖 spec 解回绝对路径；非路径型 spec（registry 版本号等）返回 undefined。 */
export function fileSpecPath(spec: string): string | undefined {
  // Windows 的 file: 依赖是裸路径（也可能是 file:C:\...）；posix 统一 `file:<绝对路径>`
  const raw = process.platform === 'win32' ? spec.replace(/^file:/, '') : spec.startsWith('file:') ? spec.slice('file:'.length) : undefined
  if (raw === undefined) return undefined
  return resolve(raw)
}

/**
 * 迁移 manifest 里钉死的旧安装路径。App 改名/搬家后 file: 依赖指向已删除目录，
 * pnpm install 第一步就会失败，`dsh plugin add` 无法自愈（install 先于 manifest 更新）。
 * 仅在指向不同路径时改写，并清掉会卡住解析的旧 lock 与断链；manifest 残缺时交给 dsh 报错。
 */
export function migrateStaleBridgeSpec(dir: string, packageRootPath: string): void {
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) return
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      dependencies?: Record<string, string>
    }
    const spec = manifest.dependencies?.[BRIDGE_DEP_NAME]
    if (spec === undefined) return
    const pinned = fileSpecPath(spec)
    const wanted = resolve(packageRootPath)
    if (pinned === undefined || pinned === wanted) return
    const nextSpec = process.platform === 'win32' ? wanted : `file:${wanted}`
    manifest.dependencies = { ...manifest.dependencies, [BRIDGE_DEP_NAME]: nextSpec }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
    // 旧路径时代的解析产物一并清掉，避免 pnpm 拿断链/旧 lock 复原
    rmSync(join(dir, 'pnpm-lock.yaml'), { force: true })
    rmSync(join(dir, 'node_modules', BRIDGE_DEP_NAME), { recursive: true, force: true })
  } catch {
    // manifest 残缺：保持原行为，交给 dsh plugin add 报错
  }
}

/** 安装/更新本插件包到 profile（dsh plugin = pnpm 转发器）。 */
export function installBridgePackage(dir: string, dshBin: string, packageRootPath: string): void {
  ensureProfileManifest(dir)
  migrateStaleBridgeSpec(dir, packageRootPath)
  const spec = process.platform === 'win32' ? packageRootPath : `file:${packageRootPath}`
  const result = spawnSync(dshBin, ['plugin', '--profile', COMPANION_PROFILE, 'add', spec], {
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new Error(`dsh plugin add 失败（exit ${result.status}）`)
  }
}
