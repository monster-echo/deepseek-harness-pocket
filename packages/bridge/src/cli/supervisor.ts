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
  readonly caps: string
  /** 本轮 dsh 进程打印的 Web 控制台地址（0.1.5+ 带 ?token=，随重启刷新；旧版无认证 URL 同样捕获）。 */
  webUrl?: string
}

/** 匹配 dsh 启动打印的 `dsh web: http://127.0.0.1:<port>/[?token=…]`（可能带 LAN 后缀）。 */
const DSH_WEB_URL_LINE = /^dsh web: (https?:\/\/127\.0\.0\.1:\d+\/?(?:\?token=\S+)?)\b/u

/**
 * 把本轮 dsh 打印的 Web URL 合并进 run.json（supervisor 与桌面端状态页共享该文件）。
 * dsh 重启后 URL 必变：exit 时清除、重新打印时覆盖，保持 run.json 只反映存活进程。
 */
function writeWebUrl(url: string | undefined): void {
  const file = runInfoFile()
  if (!existsSync(file)) return
  try {
    const stored = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    if (url === undefined) delete stored['webUrl']
    else stored['webUrl'] = url
    writeFileSync(file, `${JSON.stringify(stored, undefined, 2)}\n`)
  } catch {
    // run.json 残留损坏时放弃写入，等下轮 start 重写
  }
}

/** 从一段 stdout 文本里提取 dsh web URL 行；返回 URL 或 undefined。 */
function extractWebUrl(text: string): string | undefined {
  for (const line of text.split('\n')) {
    const match = DSH_WEB_URL_LINE.exec(line.trim())
    if (match?.[1] !== undefined) return match[1]
  }
  return undefined
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
    // URL 行可能被 chunk 边界截断：跨 chunk 缓冲，只对完整行做匹配
    let lineBuffer = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = lineBuffer + chunk.toString()
      const lines = text.split('\n')
      lineBuffer = lines.pop() ?? ''
      process.stdout.write(chunk)
      for (const line of lines) {
        log(`dsh| ${line.trimEnd()}`)
        const url = extractWebUrl(line)
        if (url !== undefined) writeWebUrl(url)
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk)
      log(`dsh! ${chunk.toString().trimEnd()}`)
    })
    const code = await new Promise<number | null>((resolve) => child!.once('exit', resolve))
    if (stopping) break
    writeWebUrl(undefined)
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
