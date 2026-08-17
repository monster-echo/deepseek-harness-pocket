/**
 * 内嵌迁移：server.ts 启动时自动执行 migrations/*.sql（幂等 SQL）。
 */
import { readdirSync, readFileSync } from 'node:fs';
import pg from 'pg';
export async function runMigrations(databaseUrl, dir) {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
        const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
        for (const file of files) {
            await client.query(readFileSync(`${dir}/${file}`, 'utf8'));
        }
    }
    finally {
        await client.end();
    }
}
//# sourceMappingURL=migrate.js.map