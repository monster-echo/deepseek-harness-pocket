/**
 * dshc — 掌鲸 DSH Pocket Worker CLI。
 *
 * 用法：
 *   dshc install [--gateway wss://…]     安装开机自启（launchd / systemd user）
 *   dshc uninstall                       移除自启
 *   dshc start [--gateway wss://…] [--port 3780] [--host 0.0.0.0]
 *        [--name <名称>] [--dsh <路径>] [--detached]
 *                                        拉起并守护 dsh（companion profile）
 *   dshc stop                            停止 supervisor 与 dsh
 *   dshc resume                          恢复待机中的 worker（重试启动）
 *   dshc status [--json]                 查看运行状态（--json 机器可读，桌面端用）
 *   dshc qr [--json]                     打印配对二维码（手机扫码配对/绑定）
 *
 * 手机端绑定走账号登录：桌面端登录后会话写入 account-session.json，
 * 插件 uplink 随注册上送 gateway 自动绑定（同账号免扫码）。
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { hostname, networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'
import qrcode from 'qrcode-terminal'
import { encodePairQr } from '@deepseek-harness-pocket/bridge-protocol'
import { defaultStateFile, loadBridgeState } from '../plugin/state.js'
import { compareVersion, packageRoot, resolveDshBin, resolveDshLaunch } from './runtime.js'
import { COMPANION_PROFILE, installBridgePackage, profileDir, upsertBridgePatch } from './profile.js'
import {
  acquireStartLock,
  detachSpawn,
  describeGiveUp,
  dshcDir,
  isRunning,
  logFile,
  pidFile,
  readRunInfo,
  releaseStartLock,
  requestResume,
  requestStop,
  supervise,
} from './supervisor.js'
import { autostartInstall, autostartUninstall } from './autostart.js'

/** 首个非回环 IPv4（手机同网直连用）；取不到返回 null。 */
function firstLanIpv4(): string | null {
  const ifaces = networkInterfaces()
  for (const list of Object.values(ifaces)) {
    for (const info of list ?? []) {
      if (info.family === 'IPv4' && !info.internal) return info.address
    }
  }
  return null
}

interface CliOptions {
  gateway: string
  port: number
  host: string
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
  const launch = resolveDshLaunch(dshBin)
  const result = spawnSync(launch.cmd, [...launch.args, '--version'], {
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf8',
    windowsHide: true,
    shell: launch.shell === true,
  })
  if (result.status !== 0 || typeof result.stdout !== 'string') return ''
  return result.stdout.trim().split('\n')[0] ?? ''
}

/** bridge 包版本（写入 run.json，方便诊断 App 内 sidecar 的新旧）。 */
function bridgeVersion(): string {
  try {
    const raw = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
    ) as { version?: string }
    return raw.version ?? ''
  } catch {
    return ''
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 获取 start 单实例锁；被活进程持有时等它写出 pid 文件（正常几百 ms～一次 pnpm install），最多 30s。 */
async function acquireStartLockWithWait(): Promise<boolean> {
  const deadline = Date.now() + 30_000
  for (;;) {
    const lock = acquireStartLock()
    if (lock.ok) return true
    const pid = isRunning()
    if (pid !== null) {
      process.stdout.write(`[dshc] 已在运行 (pid ${pid})；如需重启先 dshc stop\n`)
      process.exit(0)
    }
    if (Date.now() >= deadline) return false
    await sleep(500)
  }
}

/** start 锁已持有：解析 dsh → 准备 profile → 前台守护或 detached 拉起。 */
async function startSupervised(options: CliOptions, stateFile: string): Promise<void> {
  const dshBin = resolveDshBin(options.dsh)
  const dir = profileDir(COMPANION_PROFILE)
  process.stdout.write(`[dshc] 准备 companion profile: ${dir}\n`)
  installBridgePackage(dir, dshBin, packageRoot())
  const name = options.name.length > 0 ? options.name : hostname()
  upsertBridgePatch(dir, {
    gatewayUrl: options.gateway,
    port: options.port,
    host: options.host,
    workerName: name,
    stateFile,
  })
  if (options.detached) {
    const args = [
      '--gateway', options.gateway,
      '--port', String(options.port),
      '--host', options.host,
    ]
    if (options.name.length > 0) args.push('--name', options.name)
    if (options.dsh !== undefined) args.push('--dsh', options.dsh)
    const pid = detachSpawn(args)
    process.stdout.write(`[dshc] 后台运行中 (pid ${pid})，日志: ${logFile()}\n`)
    // 不释放 start 锁：detached 子进程按「持有者已死」接管，pid 文件落地前窗口仍受保护
    process.exit(0)
  }
  const dshVersion = probeDshVersion(dshBin)
  const dshArgs = ['--profile', COMPANION_PROFILE]
  // dsh 0.1.1 起 boot 会自动开浏览器（后台 companion 不该开）；旧版不认识 --no-open
  if (compareVersion(dshVersion, '0.1.1') >= 0) dshArgs.push('--no-open')
  await supervise(dshBin, dshArgs, { ...process.env }, {
    dshBin,
    dshVersion,
    bridgeVersion: bridgeVersion(),
    gatewayUrl: options.gateway,
    port: options.port,
    host: options.host,
    name,
  })
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
      // 单实例锁：check-then-act 窗口内只允许一个 starter 做慢启动（plugin add / pnpm install），
      // 否则双 supervisor 会各自 spawn dsh 互抢 127.0.0.1:3080，输家无限退避重启烧 CPU
      if (!await acquireStartLockWithWait()) {
        process.stderr.write('[dshc] 另一个 dshc start 正在进行，请稍后重试\n')
        process.exit(75)
      }
      try {
        await startSupervised(options, stateFile)
      } catch (error) {
        releaseStartLock()
        throw error
      }
      break
    }

    case 'resume': {
      requestResume()
      if (options.json) process.stdout.write(`${JSON.stringify({ resumed: true })}\n`)
      else process.stdout.write('[dshc] 已请求恢复（待机中的 supervisor 会在数秒内重试启动）\n')
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
      const run = readRunInfo()
      if (options.json) {
        process.stdout.write(`${JSON.stringify({
          running: pid !== null,
          pid: pid ?? undefined,
          standby: run?.supervisor === 'standby',
          supervisor: run?.supervisor ?? 'active',
          giveUp: run?.giveUp ?? undefined,
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
          : run?.supervisor === 'standby'
            ? `dshc: 待机中 (pid ${pid})——${describeGiveUp(run.giveUp ?? { reason: 'crash_loop', since: 0 })}；dshc resume 可手动恢复\n`
            : `dshc: 运行中 (pid ${pid})，日志 ${logFile()}\n`,
      )
      process.stdout.write(`状态文件: ${stateFile}\npid 文件: ${pidFile()}\nhome: ${dshcDir()}\n`)
      break
    }

    case 'qr': {
      const state = loadBridgeState(stateFile)
      if (state === undefined) {
        process.stdout.write('[dshc] 无法读取/创建状态文件，请先 dshc start\n')
        process.exit(1)
      }
      const name = options.name.length > 0 ? options.name : hostname()
      const lanIp = firstLanIpv4()
      const payload = encodePairQr({
        code: state.pairingCode,
        name,
        ...(lanIp !== null ? { host: lanIp } : {}),
        port: options.port,
        token: state.pairingToken,
        ...(options.gateway.length > 0 ? { gatewayUrl: options.gateway } : {}),
      })
      if (options.json) {
        process.stdout.write(`${JSON.stringify({
          payload,
          code: state.pairingCode,
          name,
          host: lanIp ?? undefined,
          port: options.port,
          gatewayUrl: options.gateway.length > 0 ? options.gateway : undefined,
          fingerprint: state.fingerprint,
        }, undefined, 2)}\n`)
        break
      }
      process.stdout.write(`[dshc] 扫描下方二维码，把 ${name} 绑定到手机账号\n\n`)
      qrcode.generate(payload, { small: true })
      process.stdout.write(`\n配对码: ${state.pairingCode}${lanIp !== null ? `    局域网: ${lanIp}:${options.port}` : ''}\n`)
      process.stdout.write('（相机扫不动时，可在手机「添加电脑」里手输配对码）\n')
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
          '  start [--gateway …] [--port 3780] [--detached]',
          '                                拉起并守护 dsh（手机端经账号登录绑定）',
          '  stop / status [--json]',
          '  resume                        恢复待机中的 worker（重试启动）',
          '  qr [--json]                   打印配对二维码（手机扫码绑定）',
        ].join('\n'),
      )
      if (command !== 'help') process.exit(64)
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`dshc: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
