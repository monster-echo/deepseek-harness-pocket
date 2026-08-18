/**
 * dsh 子进程守护：spawn + 崩溃退避重启 + 优雅停止 + 日志落盘。
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { selfBin } from './runtime.js'

const STOP_FLAG = 'dshc.stop-flag'

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
export async function supervise(dshBin: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<void> {
  writeFileSync(pidFile(), `${process.pid}\n`)
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
