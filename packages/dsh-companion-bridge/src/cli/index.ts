/**
 * dshc — DSH Companion Worker CLI。
 *
 * 用法：
 *   dshc install [--gateway wss://…]     安装开机自启（launchd / systemd user）
 *   dshc uninstall                       移除自启
 *   dshc start [--gateway wss://…] [--port 3780] [--host 0.0.0.0]
 *        [--caps m1|m2|m3] [--name <名称>] [--dsh <路径>] [--detached]
 *                                        拉起并守护 dsh（companion profile），打印配对码
 *   dshc stop                            停止 supervisor 与 dsh
 *   dshc status                          查看运行状态
 *   dshc token                           rotate 配对 token 与配对码
 *   dshc qr [--gateway wss://…]          重新打印配对二维码
 */

import { hostname, networkInterfaces } from 'node:os'
import { loadBridgeState, rotatePairing, defaultStateFile } from '../plugin/state.js'
import { printPairing } from './qr.js'
import { packageRoot, resolveDshBin } from './runtime.js'
import { COMPANION_PROFILE, installBridgePackage, profileDir, upsertBridgePatch } from './profile.js'
import { detachSpawn, dshcDir, isRunning, logFile, pidFile, requestStop, supervise } from './supervisor.js'
import { autostartInstall, autostartUninstall } from './autostart.js'
import type { PairingQrPayload } from '@dsh-companion/bridge-protocol'

interface CliOptions {
  gateway: string
  port: number
  host: string
  caps: 'm1' | 'm2' | 'm3'
  name: string
  dsh: string | undefined
  detached: boolean
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
      printPairing(qrPayload(options.gateway, options.port))
      if (options.detached) {
        const args = [
          '--gateway', options.gateway,
          '--port', String(options.port),
          '--host', options.host,
          '--caps', options.caps,
        ]
        if (options.name.length > 0) args.push('--name', options.name)
        if (options.dsh !== undefined) args.push('--dsh', options.dsh)
        const pid = detachSpawn(args)
        process.stdout.write(`[dshc] 后台运行中 (pid ${pid})，日志: ${logFile()}\n`)
        process.exit(0)
      }
      await supervise(dshBin, ['--profile', COMPANION_PROFILE], { ...process.env })
      break
    }

    case 'stop': {
      const pid = isRunning()
      if (pid === null) {
        process.stdout.write('[dshc] 未在运行\n')
        process.exit(0)
      }
      requestStop()
      process.stdout.write(`[dshc] 已请求停止 (pid ${pid})；若 5 秒未退出: kill ${pid}\n`)
      break
    }

    case 'status': {
      const pid = isRunning()
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
      const next = rotatePairing(state, stateFile)
      process.stdout.write(`[dshc] 配对 token 已 rotate，新配对码 ${next.pairingCode}（运行 dshc qr 查看二维码）\n`)
      break
    }

    case 'qr': {
      printPairing(qrPayload(options.gateway, options.port))
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
          'dshc — DSH Companion Worker',
          '',
          '用法: dshc <command> [options]',
          '',
          '命令:',
          '  install [--gateway wss://…]   安装开机自启（并启动）',
          '  uninstall                     移除自启',
          '  start [--gateway …] [--port 3780] [--caps m2] [--detached]',
          '                                拉起并守护 dsh，打印配对二维码',
          '  stop / status / token / qr',
        ].join('\n'),
      )
      if (command !== 'help') process.exit(64)
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`dshc: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
