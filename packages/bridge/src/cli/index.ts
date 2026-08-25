/**
 * dshc — 掌鲸 DSH Pocket Worker CLI。
 *
 * 用法：
 *   dshc install [--gateway wss://…]     安装开机自启（launchd / systemd user）
 *   dshc uninstall                       移除自启
 *   dshc start [--gateway wss://…] [--port 3780] [--host 0.0.0.0]
 *        [--caps m1|m2|m3] [--name <名称>] [--dsh <路径>] [--detached] [--quiet]
 *                                        拉起并守护 dsh（companion profile），打印配对码
 *   dshc stop                            停止 supervisor 与 dsh
 *   dshc status [--json]                 查看运行状态（--json 机器可读，桌面端用）
 *   dshc token                           rotate 配对 token 与配对码
 *   dshc qr [--gateway wss://…] [--json] 重新打印配对二维码（--json 输出 payload）
 */

import { spawnSync } from 'node:child_process'
import { hostname, networkInterfaces } from 'node:os'
import { loadBridgeState, rotatePairing, defaultStateFile } from '../plugin/state.js'
import { printPairing } from './qr.js'
import { compareVersion, packageRoot, resolveDshBin } from './runtime.js'
import { COMPANION_PROFILE, installBridgePackage, profileDir, upsertBridgePatch } from './profile.js'
import { detachSpawn, dshcDir, isRunning, logFile, pidFile, readRunInfo, requestStop, supervise } from './supervisor.js'
import { autostartInstall, autostartUninstall } from './autostart.js'
import type { PairingQrPayload } from '@deepseek-harness-pocket/bridge-protocol'

interface CliOptions {
  gateway: string
  port: number
  host: string
  caps: 'm1' | 'm2' | 'm3'
  name: string
  dsh: string | undefined
  detached: boolean
  json: boolean
  quiet: boolean
}

function parseArgs(argv: readonly string[]): { command: string; options: CliOptions } {
  const options: CliOptions = {
    gateway: process.env['DSHC_GATEWAY'] ?? '',
    port: 3780,
    host: '0.0.0.0',
    caps: 'm2',
    name: '',
    dsh: undefined,
    detached: false,
    json: false,
    quiet: false,
  }
  const args = [...argv]
  const command = args.shift() ?? 'help'
  while (args.length > 0) {
    const flag = args.shift()
    const value = (): string => {
      const v = args.shift()
      if (v === undefined) throw new Error(`参数 ${flag} 需要值`)
      return v
    }
    switch (flag) {
      case '--gateway': options.gateway = value(); break
      case '--port': options.port = Number.parseInt(value(), 10); break
      case '--host': options.host = value(); break
      case '--caps': options.caps = value() as CliOptions['caps']; break
      case '--name': options.name = value(); break
      case '--dsh': options.dsh = value(); break
      case '--detached': options.detached = true; break
      case '--json': options.json = true; break
      case '--quiet': options.quiet = true; break
      default:
        throw new Error(`未知参数 ${flag}`)
    }
  }
  return { command, options }
}

function lanUrl(port: number): string | undefined {
  for (const nets of Object.values(networkInterfaces())) {
    for (const net of nets ?? []) {
      if (net.family === 'IPv4' && !net.internal) return `ws://${net.address}:${port}/mobile/ws`
    }
  }
  return undefined
}

function qrPayload(gatewayUrl: string, port: number): PairingQrPayload {
  const state = loadBridgeState(defaultStateFile())
  if (state === undefined) throw new Error('状态文件不可用')
  const lan = lanUrl(port)
  return lan === undefined
    ? {
        v: 1,
        gatewayUrl: gatewayUrl.length > 0 ? gatewayUrl : '(未配置 gateway，仅同网段可用)',
        hostKey: state.hostKey,
        token: state.pairingToken,
        fingerprint: state.fingerprint,
        code: state.pairingCode,
      }
    : {
        v: 1,
        gatewayUrl: gatewayUrl.length > 0 ? gatewayUrl : '(未配置 gateway，仅同网段可用)',
        lanUrl: lan,
        hostKey: state.hostKey,
        token: state.pairingToken,
        fingerprint: state.fingerprint,
        code: state.pairingCode,
      }
}

/** 探测 dsh 版本（run.json 元数据用；失败返回空串）。 */
function probeDshVersion(dshBin: string): string {
  const result = spawnSync(dshBin, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' })
  if (result.status !== 0 || typeof result.stdout !== 'string') return ''
  return result.stdout.trim().split('\n')[0] ?? ''
}

async function main(): Promise<void> {
  const { command, options } = parseArgs(process.argv.slice(2))
  const stateFile = defaultStateFile()

  switch (command) {
    case 'start': {
      const running = isRunning()
      if (running !== null) {
        process.stdout.write(`[dshc] 已在运行 (pid ${running})；如需重启先 dshc stop\n`)
        process.exit(0)
      }
      const dshBin = resolveDshBin(options.dsh)
      const dir = profileDir(COMPANION_PROFILE)
      process.stdout.write(`[dshc] 准备 companion profile: ${dir}\n`)
      installBridgePackage(dir, dshBin, packageRoot())
      const name = options.name.length > 0 ? options.name : hostname()
      upsertBridgePatch(dir, {
        gatewayUrl: options.gateway,
        port: options.port,
        host: options.host,
        caps: options.caps,
        workerName: name,
        stateFile,
      })
      if (!options.quiet) printPairing(qrPayload(options.gateway, options.port))
      if (options.detached) {
        const args = [
          '--gateway', options.gateway,
          '--port', String(options.port),
          '--host', options.host,
          '--caps', options.caps,
        ]
        if (options.name.length > 0) args.push('--name', options.name)
        if (options.dsh !== undefined) args.push('--dsh', options.dsh)
        if (options.quiet) args.push('--quiet')
        const pid = detachSpawn(args)
        process.stdout.write(`[dshc] 后台运行中 (pid ${pid})，日志: ${logFile()}\n`)
        process.exit(0)
      }
      const dshVersion = probeDshVersion(dshBin)
      const dshArgs = ['--profile', COMPANION_PROFILE]
      // dsh 0.1.1 起 boot 会自动开浏览器（后台 companion 不该开）；旧版不认识 --no-open
      if (compareVersion(dshVersion, '0.1.1') >= 0) dshArgs.push('--no-open')
      await supervise(dshBin, dshArgs, { ...process.env }, {
        dshBin,
        dshVersion,
        gatewayUrl: options.gateway,
        port: options.port,
        host: options.host,
        name,
        caps: options.caps,
      })
      break
    }

    case 'stop': {
      const pid = isRunning()
      if (pid === null) {
        if (options.json) process.stdout.write(`${JSON.stringify({ stopped: false, running: false })}\n`)
        else process.stdout.write('[dshc] 未在运行\n')
        process.exit(0)
      }
      requestStop()
      if (options.json) process.stdout.write(`${JSON.stringify({ stopped: true, running: true, pid })}\n`)
      else process.stdout.write(`[dshc] 已请求停止 (pid ${pid})；若 5 秒未退出: kill ${pid}\n`)
      break
    }

    case 'status': {
      const pid = isRunning()
      if (options.json) {
        const run = readRunInfo()
        process.stdout.write(`${JSON.stringify({
          running: pid !== null,
          pid: pid ?? undefined,
          run: run ?? undefined,
          profileDir: profileDir(COMPANION_PROFILE),
          stateFile,
          pidFile: pidFile(),
          logFile: logFile(),
          home: dshcDir(),
        }, undefined, 2)}\n`)
        break
      }
      process.stdout.write(
        pid === null
          ? 'dshc: 未运行\n'
          : `dshc: 运行中 (pid ${pid})，日志 ${logFile()}\n`,
      )
      process.stdout.write(`状态文件: ${stateFile}\npid 文件: ${pidFile()}\nhome: ${dshcDir()}\n`)
      break
    }

    case 'token': {
      const state = loadBridgeState(stateFile)
      if (state === undefined) throw new Error('状态文件不可用')
      // 运行中的 dsh 只在启动时读状态文件：rotate 后必须重启，否则直连 token/配对码失配
      const runBefore = readRunInfo()
      const wasRunning = isRunning() !== null
      const next = rotatePairing(state, stateFile)
      if (wasRunning && runBefore !== undefined) {
        requestStop()
        for (let i = 0; i < 20 && isRunning() !== null; i += 1) await new Promise((r) => setTimeout(r, 500))
        const args = [
          '--gateway', runBefore.gatewayUrl,
          '--port', String(runBefore.port),
          '--host', runBefore.host,
          '--caps', runBefore.caps.length > 0 ? runBefore.caps : 'm2',
        ]
        if (runBefore.name.length > 0) args.push('--name', runBefore.name)
        args.push('--dsh', runBefore.dshBin, '--quiet')
        const pid = detachSpawn(args)
        process.stdout.write(`[dshc] 配对 token 已 rotate，新配对码 ${next.pairingCode}；worker 已重启生效 (pid ${pid})（运行 dshc qr 查看二维码）\n`)
      } else {
        process.stdout.write(`[dshc] 配对 token 已 rotate，新配对码 ${next.pairingCode}（运行 dshc qr 查看二维码）\n`)
      }
      break
    }

    case 'qr': {
      const payload = qrPayload(options.gateway, options.port)
      if (options.json) process.stdout.write(`${JSON.stringify(payload)}\n`)
      else printPairing(payload)
      break
    }

    case 'install': {
      process.stdout.write(`${autostartInstall(options.gateway)}\n`)
      break
    }

    case 'uninstall': {
      process.stdout.write(`${autostartUninstall()}\n`)
      break
    }

    default:
      process.stdout.write(
        [
          'dshc — 掌鲸 DSH Pocket Worker',
          '',
          '用法: dshc <command> [options]',
          '',
          '命令:',
          '  install [--gateway wss://…]   安装开机自启（并启动）',
          '  uninstall                     移除自启',
          '  start [--gateway …] [--port 3780] [--caps m2] [--detached] [--quiet]',
          '                                拉起并守护 dsh，打印配对二维码',
          '  stop / status [--json] / token / qr [--json]',
        ].join('\n'),
      )
      if (command !== 'help') process.exit(64)
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`dshc: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
