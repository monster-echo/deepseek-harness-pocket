/**
 * 开机自启：macOS launchd LaunchAgent / Linux systemd user unit / Windows 提示手动。
 */

import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { selfBin } from './runtime.js'

const LABEL = 'top.rwecho.deepseek-harness-pocket.worker'

export function autostartInstall(gatewayUrl: string): string {
  if (process.platform === 'darwin') return installLaunchd(gatewayUrl)
  if (process.platform === 'linux') return installSystemd(gatewayUrl)
  return 'Windows 自启暂未自动化：请将 `dshc start` 加入启动项（shell:startup）'
}

export function autostartUninstall(): string {
  if (process.platform === 'darwin') {
    const target = `${homedir()}/Library/LaunchAgents/${LABEL}.plist`
    spawnSync('launchctl', ['unload', target], { stdio: 'ignore' })
    rmSync(target, { force: true })
    return `已移除 launchd LaunchAgent (${target})`
  }
  if (process.platform === 'linux') {
    const target = `${homedir()}/.config/systemd/user/deepseek-harness-pocket.service`
    spawnSync('systemctl', ['--user', 'disable', '--now', 'deepseek-harness-pocket.service'], { stdio: 'ignore' })
    rmSync(target, { force: true })
    spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' })
    return `已移除 systemd user 服务 (${target})`
  }
  return 'Windows：请手动移除启动项'
}

function commandArgs(gatewayUrl: string): string[] {
  const args = [selfBin(), 'start']
  if (gatewayUrl.length > 0) args.push('--gateway', gatewayUrl)
  return args
}

function installLaunchd(gatewayUrl: string): string {
  const dir = `${homedir()}/Library/LaunchAgents`
  mkdirSync(dir, { recursive: true })
  const target = `${dir}/${LABEL}.plist`
  const log = `${homedir()}/.deepseek-harness-pocket/launchd.log`
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${commandArgs(gatewayUrl).map((a) => `    <string>${a.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</string>`).join('\n')}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict>
</plist>
`
  writeFileSync(target, plist)
  spawnSync('launchctl', ['unload', target], { stdio: 'ignore' })
  const loaded = spawnSync('launchctl', ['load', target])
  if (loaded.status !== 0) return `已写入 ${target}，但 launchctl load 失败，请手动加载`
  return `已安装 launchd LaunchAgent 并加载（${target}），登录即自动启动 dshc`
}

function installSystemd(gatewayUrl: string): string {
  const dir = `${homedir()}/.config/systemd/user`
  mkdirSync(dir, { recursive: true })
  const target = `${dir}/deepseek-harness-pocket.service`
  const unit = `[Unit]
Description=掌鲸 DSH Pocket Worker (dshc)
After=network-online.target

[Service]
ExecStart=${commandArgs(gatewayUrl).map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`
  writeFileSync(target, unit)
  spawnSync('systemctl', ['--user', 'daemon-reload'])
  const enabled = spawnSync('systemctl', ['--user', 'enable', '--now', 'deepseek-harness-pocket.service'])
  if (enabled.status !== 0) return `已写入 ${target}，但 enable 失败，请手动 systemctl --user enable --now deepseek-harness-pocket`
  return `已安装并启动 systemd user 服务（deepseek-harness-pocket.service）`
}

/** 便捷：确保日志目录存在且脚本可执行（shebang bin）。 */
export function ensureExecutable(file: string): void {
  if (existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true })
    chmodSync(file, 0o755)
  }
}
