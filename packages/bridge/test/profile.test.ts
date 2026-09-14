import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BRIDGE_DEP_NAME, fileSpecPath, migrateStaleBridgeSpec } from '../src/cli/profile.js'

function makeProfile(dependencies: Record<string, string>, extra: { lock?: boolean; staleLink?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'dshc-profile-'))
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: 'dsh-profile-companion', private: true, dependencies }, undefined, 2)}\n`,
  )
  if (extra.lock) writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
  if (extra.staleLink) {
    mkdirSync(join(dir, 'node_modules', BRIDGE_DEP_NAME), { recursive: true })
    symlinkSync('/nonexistent/old-app/bridge', join(dir, 'node_modules', BRIDGE_DEP_NAME, 'dead-link'), 'dir')
  }
  return dir
}

describe('fileSpecPath', () => {
  it('解出 file: 依赖的绝对路径，registry spec 返回 undefined', () => {
    expect(fileSpecPath('file:/Applications/DSH Pocket.app/bridge/')).toMatch(/DSH Pocket\.app\/bridge\/?$/)
    expect(fileSpecPath('^0.1.0')).toBeUndefined()
    expect(fileSpecPath('workspace:*')).toBeUndefined()
  })
})

describe('migrateStaleBridgeSpec', () => {
  it('旧路径 file: 依赖改写到新路径，并清掉旧 lock 与断链', () => {
    const dir = makeProfile({ [BRIDGE_DEP_NAME]: 'file:/Applications/DSH Pocket Worker.app/bridge/' }, { lock: true, staleLink: true })
    const root = '/Applications/DSH Pocket.app/Contents/Resources/node-sidecar/bridge'
    migrateStaleBridgeSpec(dir, root)
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
    expect(manifest.dependencies[BRIDGE_DEP_NAME]).toBe(`file:${root}`)
    expect(existsSync(join(dir, 'pnpm-lock.yaml'))).toBe(false)
    expect(existsSync(join(dir, 'node_modules', BRIDGE_DEP_NAME))).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  it('同路径依赖不动（不删 lock，避免每次启动重装）', () => {
    const root = '/Applications/DSH Pocket.app/Contents/Resources/node-sidecar/bridge'
    const dir = makeProfile({ [BRIDGE_DEP_NAME]: `file:${root}` }, { lock: true })
    migrateStaleBridgeSpec(dir, root)
    expect(existsSync(join(dir, 'pnpm-lock.yaml'))).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('registry 型依赖与缺失/损坏 manifest 均不改动、不抛错', () => {
    const dir = makeProfile({ eslint: '^9.0.0' })
    expect(() => migrateStaleBridgeSpec(dir, '/somewhere/bridge')).not.toThrow()
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))).toEqual({ name: 'dsh-profile-companion', private: true, dependencies: { eslint: '^9.0.0' } })
    const empty = mkdtempSync(join(tmpdir(), 'dshc-profile-'))
    expect(() => migrateStaleBridgeSpec(empty, '/somewhere/bridge')).not.toThrow()
    const broken = mkdtempSync(join(tmpdir(), 'dshc-profile-'))
    writeFileSync(join(broken, 'package.json'), '{oops')
    expect(() => migrateStaleBridgeSpec(broken, '/somewhere/bridge')).not.toThrow()
    rmSync(dir, { recursive: true, force: true })
    rmSync(empty, { recursive: true, force: true })
    rmSync(broken, { recursive: true, force: true })
  })
})
