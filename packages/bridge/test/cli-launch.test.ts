import { describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { dshEntryFromCmdShim, dshEntryFromNodeModules, resolveDshLaunch } from '../src/cli/runtime.js'
import { installBridgePackage, upsertBridgePatch } from '../src/cli/profile.js'

describe('dshEntryFromCmdShim（Windows .cmd shim → 真实 JS 入口）', () => {
  it('解析 npm 生成的 shim 并返回存在的入口绝对路径', () => {
    const root = mkdtempSync(join(tmpdir(), 'dshc-cmd-root-'))
    mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true })
    mkdirSync(join(root, 'node_modules', 'pkg', 'lib'), { recursive: true })
    const binDir = join(root, 'node_modules', '.bin')
    const entry = join(root, 'node_modules', 'pkg', 'lib', 'bin.js')
    writeFileSync(entry, '#!/usr/bin/env node\n')
    // npm 真实产物：带引号、反斜杠路径、%* 尾参
    const npmShim = [
      '@ECHO off',
      'GOTO start',
      ':find_dp0',
      'SET dp0=%~dp0',
      'EXIT /b',
      ':start',
      'SETLOCAL',
      'CALL :find_dp0',
      'IF EXIST "%dp0%\\node.exe" (',
      '  SET "_prog=%dp0%\\node.exe"',
      ') ELSE (',
      '  SET "_prog=node"',
      ')',
      '"%_prog%" "%~dp0\\..\\pkg\\lib\\bin.js" %*',
      'ENDLOCAL',
    ].join('\r\n')
    const resolved = dshEntryFromCmdShim(npmShim, binDir)
    expect(resolved).not.toBeNull()
    expect(resolved!.replace(/\\/g, '/')).toBe(entry.replace(/\\/g, '/'))
    rmSync(binDir, { recursive: true, force: true })
  })

  it('目标 js 不存在或内容无法识别时返回 null', () => {
    const binDir = mkdtempSync(join(tmpdir(), 'dshc-cmd-miss-'))
    expect(dshEntryFromCmdShim('"%~dp0\\..\\nope\\bin.js" %*', binDir)).toBeNull()
    expect(dshEntryFromCmdShim('echo hello', binDir)).toBeNull()
    rmSync(binDir, { recursive: true, force: true })
  })

  it('非 Windows 平台 resolveDshLaunch 原样透传（不包装 node）', () => {
    if (process.platform === 'win32') return
    expect(resolveDshLaunch('/usr/local/bin/dsh')).toEqual({ cmd: '/usr/local/bin/dsh', args: [] })
  })

  it('package.json bin 反查：与 shim 模板无关的确定性解析', () => {
    const root = mkdtempSync(join(tmpdir(), 'dshc-bin-pkg-'))
    mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true })
    mkdirSync(join(root, 'node_modules', '@scope', 'dsh'), { recursive: true })
    const entry = join(root, 'node_modules', '@scope', 'dsh', 'dist', 'cli.js')
    mkdirSync(join(root, 'node_modules', '@scope', 'dsh', 'dist'), { recursive: true })
    writeFileSync(entry, 'console.log(1)\n')
    writeFileSync(
      join(root, 'node_modules', '@scope', 'dsh', 'package.json'),
      JSON.stringify({ name: '@scope/dsh', bin: { dsh: 'dist/cli.js' } }),
    )
    const binDir = join(root, 'node_modules', '.bin')
    const resolved = dshEntryFromNodeModules(binDir, 'dsh')
    expect(resolved?.replace(/\\/g, '/')).toBe(entry.replace(/\\/g, '/'))
    expect(dshEntryFromNodeModules(binDir, 'nope')).toBeNull()
    rmSync(root, { recursive: true, force: true })
  })
})

describe('upsertBridgePatch：能力档位固定全开', () => {
  it('补丁写入 caps: "m3" 且不再来自外部配置', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dshc-patch-'))
    upsertBridgePatch(dir, {
      gatewayUrl: 'wss://gw.test/worker',
      port: 3780,
      host: '0.0.0.0',
      workerName: 'test-worker',
      stateFile: '/tmp/bridge-state.json',
    })
    const patch = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain('caps: "m3"')
    expect(patch).toContain('url: "wss://gw.test/worker"')
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('installBridgePackage：spawn 失败诊断（exit null 回归）', () => {
  it('dsh bin 不存在时报「无法启动」并带上 bin 路径，而不是笼统的 exit null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dshc-install-'))
    const ghostBin = join(dir, 'no-such-dsh')
    expect(() => installBridgePackage(dir, ghostBin, dir)).toThrow(/无法启动.*no-such-dsh/s)
    rmSync(dir, { recursive: true, force: true })
  })

  it('dsh bin 可执行但退出非零时报 exit 码与 bin 路径', () => {
    if (process.platform === 'win32') return // 假 dsh 是 sh 脚本
    const dir = mkdtempSync(join(tmpdir(), 'dshc-install-fail-'))
    const badBin = join(dir, 'fake-dsh')
    writeFileSync(badBin, '#!/bin/sh\nexit 3\n')
    chmodSync(badBin, 0o755)
    expect(() => installBridgePackage(dir, badBin, dir)).toThrow(/exit 3/)
    rmSync(dir, { recursive: true, force: true })
  })
})
