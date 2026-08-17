/**
 * 内嵌迁移：server.ts 启动时自动执行 migrations/*.sql（幂等 SQL）。
 */
export declare function runMigrations(databaseUrl: string, dir: string): Promise<void>;
