/**
 * 简单迁移脚本：按文件名顺序执行 migrations/*.sql（幂等 SQL，可重复执行）。
 * 用法：pnpm --dir gateway migrate
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { loadConfig } from '../src/server/config.js'

async function main(): Promise<void> {
  const config = loadConfig()
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  const client = new pg.Client({ connectionString: config.databaseUrl })
  await client.connect()
  try {
    for (const file of files) {
      process.stdout.write(`applying ${file} ... `)
      await client.query(readFileSync(join(dir, file), 'utf8'))
      process.stdout.write('ok\n')
    }
  } finally {
    await client.end()
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`migrate: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
