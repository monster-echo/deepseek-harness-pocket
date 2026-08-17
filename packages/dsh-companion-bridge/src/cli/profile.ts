/**
 * companion profile 管理：确保 ~/.dsh/profiles/companion 存在、
 * 插件已安装（dsh plugin add file:<本包>）、cordis.patch.yml 含本插件行（含运行配置）。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const COMPANION_PROFILE = 'companion'

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
  if (existsSync(manifestPath)) return
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

/** cordis.patch.yml 的插行配置：幂等（替换既有 dsh-companion-bridge 行）。 */
export function upsertBridgePatch(dir: string, config: BridgePatchConfig): void {
  const patchPath = join(dir, 'cordis.patch.yml')
  const entry = [
    '- insert:',
    `  - id: dsh-companion-bridge`,
    `    name: '@dsh-companion/bridge'`,
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
  if (existing.includes('id: dsh-companion-bridge')) {
    // 逐块替换：以 "- insert:" 或 "- " 开头的行块中含本 id 的整块替换
    const blocks = existing.split(/(?=^- )/m)
    const kept = blocks.filter((b) => !b.includes('id: dsh-companion-bridge'))
    writeFileSync(patchPath, `${kept.join('').trimEnd()}\n${entry}\n`)
  } else {
    writeFileSync(patchPath, `${existing.trimEnd()}\n${entry}\n`)
  }
}

/** 安装/更新本插件包到 profile（dsh plugin = pnpm 转发器）。 */
export function installBridgePackage(dir: string, dshBin: string, packageRootPath: string): void {
  ensureProfileManifest(dir)
  const spec = process.platform === 'win32' ? packageRootPath : `file:${packageRootPath}`
  const result = spawnSync(dshBin, ['plugin', '--profile', COMPANION_PROFILE, 'add', spec], {
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    throw new Error(`dsh plugin add 失败（exit ${result.status}）`)
  }
}
