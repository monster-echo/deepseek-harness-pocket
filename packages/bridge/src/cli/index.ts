/**
 * dshc — 掌鲸 DSH Pocket Worker CLI。
 *
 * 用法：
 *   dshc install [--gateway wss://…]     安装开机自启（launchd / systemd user）
 *   dshc uninstall                       移除自启
 *   dshc start [--gateway wss://…] [--port 3780] [--host 0.0.0.0]
 *        [--caps m1|m2|m3] [--name <名称>] [--dsh <路径>] [--detached]
 *                                        拉起并守护 dsh（companion profile）
 *   dshc stop                            停止 supervisor 与 dsh
 *   dshc status [--json]                 查看运行状态（--json 机器可读，桌面端用）
 *
 * 手机端绑定走账号登录：桌面端登录后会话写入 account-session.json，
 * 插件 uplink 随注册上送 gateway 自动绑定（同账号免扫码）。
 */

import { spawnSync } from 'node:child_process'
import { hostname, networkInterfaces } from 'node:os'
import { defaultStateFile } from '../plugin/state.js'
import { compareVersion, packageRoot, resolveDshBin } from './runtime.js'
import { COMPANION_PROFILE, installBridgePackage, profileDir, upsertBridgePatch } from './profile.js'
import { detachSpawn, dshcDir, isRunning, logFile, pidFile, readRunInfo, requestStop, supervise } from './supervisor.js'
import { autostartInstall, autostartUninstall } from './autostart.js'

interface CliOptions {
  gateway: string
  port: number
  host: string
  caps: 'm1' | 'm2' | 'm3'
  name: string
  dsh: string | undefined
  detached: boolean
  json: boolean
}

function parseArgs(argv: readonly string[]): { command: string; options: CliOptions } {
  const options: CliOptions = {
    gateway: process.env['DSHC_GATEWAY'] ?? '',
    port: 3780,
    host: '0.0.0.0',
    // m3 起 sessionCreate/artifacts 才可用：手机端「新建会话/选目录/作品」是主流程，
    // 默认必须给全（与桌面端 GUI 默认一致）；要收敛能力仍可显式 --caps m1|m2
    caps: 'm3',
    name: '',
    dsh: undefined,
    detached: false,
    json: false,
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
      default:
        throw new Error(`未知参数 ${flag}`)
    }
  }
  return { command, options }
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
          '  start [--gateway …] [--port 3780] [--caps m3] [--detached]',
          '                                拉起并守护 dsh（手机端经账号登录绑定）',
          '  stop / status [--json]',
        ].join('\n'),
      )
      if (command !== 'help') process.exit(64)
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`dshc: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
