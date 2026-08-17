import { join } from 'node:path';
const workspaceRoot = join(import.meta.dirname, '../..');
const nextConfig = {
    // monorepo：pnpm lockfile 在仓库根，显式告知 Next/Turbopack workspace root
    outputFileTracingRoot: workspaceRoot,
    turbopack: { root: workspaceRoot },
};
export default nextConfig;
//# sourceMappingURL=next.config.js.map