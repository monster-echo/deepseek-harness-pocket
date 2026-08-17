import { join } from 'node:path'
import type { NextConfig } from 'next'

const workspaceRoot = join(import.meta.dirname, '../..')

const nextConfig: NextConfig = {
  // monorepo：pnpm lockfile 在仓库根，显式告知 Next/Turbopack workspace root
  outputFileTracingRoot: workspaceRoot,
  turbopack: { root: workspaceRoot },
}

export default nextConfig
