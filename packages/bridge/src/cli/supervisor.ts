/**
 * dsh 子进程守护：spawn + 崩溃退避重启 + 快速失败待机（give-up）+ 优雅停止 + 日志落盘。
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname } from 'node:path'
import { selfBin } from './runtime.js'

const STOP_FLAG = 'dshc.stop-flag'
const RESUME_FLAG = 'dshc.resume-flag'
const RUN_INFO = 'run.json'
const START_LOCK = 'dshc.start.lock'

/** 退出即判「快速失败」的窗口（健康 dsh 全量 boot ~20s，窗口内死掉基本是端口/环境问题）。 */
const QUICK_FAIL_WINDOW_MS = 15_000
/** 连续快速失败多少次后进入待机（不再无限退避重启烧 CPU）。 */
const QUICK_FAIL_LIMIT = 3
/** 待机期基础探测间隔（resume flag 检查）。 */
const STANDBY_POLL_MS = 2_000
/** 待机期重条件（端口/文件）探测间隔（按 STANDBY_POLL_MS × STANDBY_PROBE_EVERY 计算）。 */
const STANDBY_PROBE_EVERY = 30

export type GiveUpReason = 'port_in_use' | 'spawn_failed' | 'crash_loop'

/** 待机原因（写入 run.json，桌面端状态页/引导页展示）。 */
export interface GiveUpInfo {
  readonly reason: GiveUpReason
  readonly detail?: string | undefined
  readonly port?: number | undefined
  readonly since: number
}

/** 本次 supervisor 运行元数据（写入 run.json，桌面端状态页用）。 */
export interface RunInfo {
  readonly dshBin: string
  readonly dshVersion: string
  /** bridge（dshc sidecar）自身的包版本；旧 supervisor 不写，读方需容忍缺省。 */
  readonly bridgeVersion?: string
  readonly gatewayUrl: string
  readonly port: number
  readonly host: string
  readonly name: string
  readonly caps: string
  /** 本轮 dsh 进程打印的 Web 控制台地址（0.1.5+ 带 ?token=，随重启刷新；旧版无认证 URL 同样捕获）。 */
  webUrl?: string
  /** supervisor 状态：active 守护中；standby 已停止自动重启（giveUp 说明原因）。缺省视为 active（旧 run.json 兼容）。 */
  supervisor?: 'active' | 'standby'
  /** 进入待机的原因；恢复后清除。 */
  giveUp?: GiveUpInfo
}

/** 匹配 dsh 启动打印的 `dsh web: http://127.0.0.1:<port>/[?token=…]`（可能带 LAN 后缀）。 */
const DSH_WEB_URL_LINE = /^dsh web: (https?:\/\/127\.0\.0\.1:\d+\/?(?:\?token=\S+)?)\b/u

/**
 * 把补丁合并进 run.json（supervisor 与桌面端状态页共享该文件）。
 * 值为 undefined 的键表示删除；文件不存在或残留损坏时放弃写入，等下轮 start 重写。
 */
function mergeRunInfo(patch: Record<string, unknown>): void {
  const file = runInfoFile()
  if (!existsSync(file)) return
  try {
    const stored = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete stored[key]
      else stored[key] = value
    }
    writeFileSync(file, `${JSON.stringify(stored, undefined, 2)}\n`)
  } catch {
    // run.json 残留损坏时放弃写入
  }
}

/** 把本轮 dsh 打印的 Web URL 合并进 run.json；dsh 重启后 URL 必变，exit 时清除。 */
function writeWebUrl(url: string | undefined): void {
  mergeRunInfo({ webUrl: url })
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

export function resumeFlagFile(): string {
  return `${dshcDir()}/${RESUME_FLAG}`
}

export function startLockFile(): string {
  return `${dshcDir()}/${START_LOCK}`
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

function readStartLockHolder(): number | undefined {
  try {
    const parsed = JSON.parse(readFileSync(startLockFile(), 'utf8')) as { pid?: unknown }
    const pid = typeof parsed.pid === 'number' ? parsed.pid : Number.NaN
    return Number.isInteger(pid) ? pid : undefined
  } catch {
    return undefined
  }
}

/**
 * 获取 start 单实例锁（`wx` 独占创建 + 持有者 pid 活性检查，死锁自动接管）。
 * 必须在 `dshc start` 的慢启动（plugin add / pnpm install）之前持有，
 * 否则 check-then-act 窗口内两个 starter 都会通过 isRunning 检查、双 supervisor 抢端口。
 */
export function acquireStartLock(): { ok: boolean; holderPid?: number } {
  const file = startLockFile()
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(file, `${JSON.stringify({ pid: process.pid, at: Date.now() })}\n`, { flag: 'wx' })
      return { ok: true }
    } catch {
      const holderPid = readStartLockHolder()
      if (holderPid === undefined) {
        // 内容损坏：清掉重试一次
        rmSync(file, { force: true })
        continue
      }
      try {
        process.kill(holderPid, 0)
        return { ok: false, holderPid }
      } catch {
        // 持有者已死：接管
        rmSync(file, { force: true })
      }
    }
  }
  const holderPid = readStartLockHolder()
  return holderPid !== undefined ? { ok: false, holderPid } : { ok: false }
}

/** 释放 start 单实例锁（幂等）。 */
export function releaseStartLock(): void {
  rmSync(startLockFile(), { force: true })
}

function log(line: string): void {
  const file = logFile()
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, `${new Date().toISOString()} ${line}\n`)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 探测 127.0.0.1:<port> 是否可绑（绑定即关）。 */
function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
}

/** 依据最后一次失败的 stderr 尾部给待机原因分类。 */
function classifyGiveUp(stderrTail: string): GiveUpInfo {
  const lastLine = stderrTail.trim().split('\n').pop()
  const detail = lastLine !== undefined && lastLine.length > 0 ? lastLine.slice(0, 200) : undefined
  const eaddrinuseLine = stderrTail.split('\n').find((l) => l.includes('EADDRINUSE'))
  if (eaddrinuseLine !== undefined) {
    // 端口取行内最后一个数字：EADDRINUSE 消息形如
    // `listen EADDRINUSE: address already in use 127.0.0.1:13080`（IP 里也有数字，不能从头匹配）
    const nums = eaddrinuseLine.match(/\d+/g)
    const port = nums !== null && nums.length > 0 ? Number.parseInt(nums[nums.length - 1]!, 10) : Number.NaN
    return Number.isInteger(port)
      ? { reason: 'port_in_use', port, detail, since: Date.now() }
      : { reason: 'port_in_use', detail, since: Date.now() }
  }
  return detail !== undefined
    ? { reason: 'crash_loop', detail, since: Date.now() }
    : { reason: 'crash_loop', since: Date.now() }
}

/** 待机原因的日志/终端描述。 */
export function describeGiveUp(info: GiveUpInfo): string {
  switch (info.reason) {
    case 'port_in_use': return `端口 ${info.port ?? '?'} 已被占用（可能是另一个 dsh 实例）`
    case 'spawn_failed': return `dsh 无法启动（${info.detail ?? '未知原因'}）`
    case 'crash_loop': return 'dsh 连续异常退出'
  }
}

/**
 * 待机循环：不 spawn，等恢复条件成立（resume flag 随时可手动唤醒）。
 * 返回 false 表示 supervisor 正在停止。
 */
async function standbyWait(giveUp: GiveUpInfo, dshBin: string, isStopping: () => boolean): Promise<boolean> {
  let ticks = 0
  while (!isStopping()) {
    if (existsSync(resumeFlagFile())) {
      rmSync(resumeFlagFile(), { force: true })
      return true
    }
    ticks += 1
    if (ticks % STANDBY_PROBE_EVERY === 0) {
      if (giveUp.reason === 'port_in_use' && giveUp.port !== undefined && (await portFree(giveUp.port))) return true
      if (giveUp.reason === 'spawn_failed' && existsSync(dshBin)) return true
      // crash_loop 不自动恢复：必须 dshc resume / resume flag
    }
    await sleep(STANDBY_POLL_MS)
  }
  return false
}

/** 前台守护循环：崩溃退避重启；连续快速失败转入待机，避免注定失败的无限重启。 */
export async function supervise(
  dshBin: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  info: RunInfo,
): Promise<void> {
  // start 锁释放到 pid 文件落地之间可能挤进另一实例：pid 写入前收尾检查
  const other = isRunning()
  if (other !== null) {
    log(`supervise: 已有实例 (pid ${other})，本进程让位退出`)
    releaseStartLock()
    process.exit(0)
  }
  writeFileSync(pidFile(), `${process.pid}\n`)
  writeFileSync(runInfoFile(), `${JSON.stringify({ ...info, pid: process.pid, startedAt: Date.now() }, undefined, 2)}\n`)
  releaseStartLock() // pid 文件已落地，start 锁完成使命
  // 记下 bridge 版本：售后排查「App 内 sidecar 是新是旧」的第一线索
  log(`supervisor pid=${process.pid} bridge=${info.bridgeVersion ?? '(旧版未记录)'} dsh=${info.dshVersion || '(未知)'}`)
  let stopping = false
  let child: ChildProcess | undefined

  // 只清理属于本进程的状态文件：输家 supervisor 退出时不得误删赢家的 pid/run 文件
  const removeOwnStateFiles = (): void => {
    try {
      if (Number.parseInt(readFileSync(pidFile(), 'utf8').trim(), 10) === process.pid) rmSync(pidFile(), { force: true })
    } catch {
      // pid 文件已不存在
    }
    if (readRunInfo()?.pid === process.pid) rmSync(runInfoFile(), { force: true })
  }

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
    removeOwnStateFiles()
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
  let quickFails = 0
  let giveUp: GiveUpInfo | undefined
  while (!stopping) {
    // 待机：不再 spawn，等恢复条件（60s 探一次端口/文件，CPU 可忽略）
    if (giveUp !== undefined) {
      if (!(await standbyWait(giveUp, dshBin, () => stopping))) break
      giveUp = undefined
      mergeRunInfo({ supervisor: 'active', giveUp: undefined })
      log('dshc 待机解除，恢复自动重启')
      process.stdout.write('[dshc] 待机解除，恢复自动重启\n')
      backoffMs = 1000
      quickFails = 0
    }
    rmSync(`${dshcDir()}/${STOP_FLAG}`, { force: true })
    log(`spawning ${dshBin} ${args.join(' ')}`)
    process.stdout.write(`[dshc] starting: ${dshBin} ${args.join(' ')}\n`)
    child = spawn(dshBin, [...args], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const startedAt = Date.now()
    // URL 行可能被 chunk 边界截断：跨 chunk 缓冲，只对完整行做匹配
    let lineBuffer = ''
    let stderrTail = ''
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
      stderrTail = `${stderrTail}${chunk.toString()}`.slice(-2000)
      log(`dsh! ${chunk.toString().trimEnd()}`)
    })
    // spawn 失败（ENOENT/EACCES）只发 'error' 不发 'exit'：一并 await，避免 unhandled error 崩掉 supervisor
    const outcome = await new Promise<{ kind: 'exit'; code: number | null } | { kind: 'error'; message: string }>(
      (resolve) => {
        child!.once('error', (error: Error) => resolve({ kind: 'error', message: error.message }))
        child!.once('exit', (code) => resolve({ kind: 'exit', code }))
      },
    )
    if (stopping) break
    writeWebUrl(undefined)
    if (outcome.kind === 'error') {
      // spawn 失败是确定性故障（二进制没了/没权限），无需重试计数，直接待机
      giveUp = { reason: 'spawn_failed', detail: outcome.message, since: Date.now() }
      log(`dsh spawn 失败，进入待机：${describeGiveUp(giveUp)}`)
      process.stdout.write(`[dshc] spawn 失败，进入待机：${describeGiveUp(giveUp)}\n`)
      mergeRunInfo({ supervisor: 'standby', giveUp })
      continue
    }
    log(`dsh exited with code ${outcome.code}`)
    process.stdout.write(`[dshc] dsh exited (code ${outcome.code}); restart in ${backoffMs}ms\n`)
    if (Date.now() - startedAt >= QUICK_FAIL_WINDOW_MS || outcome.code === 0) quickFails = 0
    else quickFails += 1
    if (quickFails >= QUICK_FAIL_LIMIT) {
      giveUp = classifyGiveUp(stderrTail)
      quickFails = 0
      backoffMs = 1000
      log(`dshc 进入待机：${describeGiveUp(giveUp)}；已停止自动重启`)
      process.stdout.write(`[dshc] 进入待机：${describeGiveUp(giveUp)}；已停止自动重启\n`)
      mergeRunInfo({ supervisor: 'standby', giveUp })
      continue
    }
    await sleep(backoffMs)
    backoffMs = outcome.code === 0
      ? Math.max(1000, Math.floor(backoffMs / 2))
      : Math.min(backoffMs * 2, 30_000)
  }
  clearInterval(flagTimer)
  removeOwnStateFiles()
  process.exit(0)
}

/** 后台模式：detached 再 spawn 一层 supervisor（`dshc start --detached`）。 */
export function detachSpawn(extraArgs: readonly string[]): number {
  const child = spawn(process.execPath, [selfBin(), 'start', ...extraArgs], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    windowsHide: true,
  })
  child.unref()
  return child.pid ?? -1
}

/** dshc stop：写 stop-flag（supervisor 检测后优雅退出）。 */
export function requestStop(): void {
  writeFileSync(`${dshcDir()}/${STOP_FLAG}`, '1\n')
}

/** dshc resume：写 resume-flag（crash_loop 待机的手动恢复入口；其他待机原因收到也立即重试）。 */
export function requestResume(): void {
  writeFileSync(resumeFlagFile(), '1\n')
}
