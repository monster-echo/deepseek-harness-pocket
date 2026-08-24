/**
 * dsh 子进程守护：spawn + 崩溃退避重启 + 优雅停止 + 日志落盘。
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { selfBin } from './runtime.js'

const STOP_FLAG = 'dshc.stop-flag'
const RUN_INFO = 'run.json'

/** 本次 supervisor 运行元数据（写入 run.json，桌面端状态页用）。 */
export interface RunInfo {
  readonly dshBin: string
  readonly dshVersion: string
  readonly gatewayUrl: string
  readonly port: number
  readonly host: string
  readonly name: string
}

interface StoredRunInfo extends RunInfo {
  readonly pid: number
  readonly startedAt: number
}

export function dshcDir(): string {
  const dir = `${process.env['HOME'] ?? '.'}/.deepseek-harness-pocket`
  mkdirSync(dir, { recursive: true })
  return dir
}

export function logFile(): string {
  return `${dshcDir()}/dshc.log`
}

export function pidFile(): string {
  return `${dshcDir()}/dshc.pid`
}

export function runInfoFile(): string {
  return `${dshcDir()}/${RUN_INFO}`
}

/** 读取 run.json（supervisor 未运行/残留损坏时返回 undefined）。 */
export function readRunInfo(): StoredRunInfo | undefined {
  const file = runInfoFile()
  if (!existsSync(file)) return undefined
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as StoredRunInfo
  } catch {
    return undefined
  }
}

export function isRunning(): number | null {
  if (!existsSync(pidFile())) return null
  const pid = Number.parseInt(readFileSync(pidFile(), 'utf8').trim(), 10)
  if (!Number.isInteger(pid)) return null
  try {
    process.kill(pid, 0)
    return pid
  } catch {
    return null
  }
}

function log(line: string): void {
  const file = logFile()
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, `${new Date().toISOString()} ${line}\n`)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 前台守护循环：崩溃退避重启，直到 SIGINT/SIGTERM 或 stop-flag 出现。 */
export async function supervise(
  dshBin: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  info: RunInfo,
): Promise<void> {
  writeFileSync(pidFile(), `${process.pid}\n`)
  writeFileSync(runInfoFile(), `${JSON.stringify({ ...info, pid: process.pid, startedAt: Date.now() }, undefined, 2)}\n`)
  let stopping = false
  let child: ChildProcess | undefined

  const stop = (signal: NodeJS.Signals): void => {
    if (stopping) return
    stopping = true
    log(`dshc received ${signal}, stopping dsh child`)
    if (child !== undefined && child.exitCode === null) {
      child.kill('SIGTERM')
      setTimeout(() => {
        if (child !== undefined && child.exitCode === null) child.kill('SIGKILL')
      }, 5000)
    }
    rmSync(pidFile(), { force: true })
    rmSync(runInfoFile(), { force: true })
    setTimeout(() => process.exit(0), 5500)
  }
  process.on('SIGINT', () => stop('SIGINT'))
  process.on('SIGTERM', () => stop('SIGTERM'))

  // stop-flag 监视（dshc stop 与 autostart 服务管理用）
  const flagTimer = setInterval(() => {
    if (existsSync(`${dshcDir()}/${STOP_FLAG}`)) stop('SIGTERM')
  }, 2000)
  flagTimer.unref()

  let backoffMs = 1000
  while (!stopping) {
    rmSync(`${dshcDir()}/${STOP_FLAG}`, { force: true })
    log(`spawning ${dshBin} ${args.join(' ')}`)
    process.stdout.write(`[dshc] starting: ${dshBin} ${args.join(' ')}\n`)
    child = spawn(dshBin, [...args], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout?.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk)
      log(`dsh| ${chunk.toString().trimEnd()}`)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk)
      log(`dsh! ${chunk.toString().trimEnd()}`)
    })
    const code = await new Promise<number | null>((resolve) => child!.once('exit', resolve))
    if (stopping) break
    log(`dsh exited with code ${code}`)
    process.stdout.write(`[dshc] dsh exited (code ${code}); restart in ${backoffMs}ms\n`)
    await sleep(backoffMs)
    backoffMs = code === 0 ? Math.max(1000, Math.floor(backoffMs / 2)) : Math.min(backoffMs * 2, 30_000)
  }
  clearInterval(flagTimer)
  rmSync(pidFile(), { force: true })
  rmSync(runInfoFile(), { force: true })
  process.exit(0)
}

/** 后台模式：detached 再 spawn 一层 supervisor（`dshc start --detached`）。 */
export function detachSpawn(extraArgs: readonly string[]): number {
  const child = spawn(process.execPath, [selfBin(), 'start', ...extraArgs], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  child.unref()
  return child.pid ?? -1
}

/** dshc stop：写 stop-flag（supervisor 检测后优雅退出）。 */
export function requestStop(): void {
  writeFileSync(`${dshcDir()}/${STOP_FLAG}`, '1\n')
}
