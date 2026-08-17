/**
 * PostgreSQL 访问层（gateway 自有库）。
 *
 * 表：workers / pairings / devices / usage_events（见 migrations/001_init.sql）。
 * 所有 SQL 集中在此；WS 核心与 REST 路由只调用函数。
 */
import pg from 'pg';
export function createStore(databaseUrl) {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
    return {
        pool,
        async upsertWorker(w) {
            await pool.query(`insert into workers (id, host_key, name, fingerprint, dsh_version, pairing_code, last_seen_at)
         values ($1, $2, $3, $4, $5, $6, now())
         on conflict (host_key) do update set
           name = excluded.name,
           fingerprint = excluded.fingerprint,
           dsh_version = excluded.dsh_version,
           pairing_code = excluded.pairing_code,
           last_seen_at = now()`, [w.id, w.hostKey, w.name, w.fingerprint, w.dshVersion, w.pairingCode]);
        },
        async getWorkerByHostKey(hostKey) {
            const { rows } = await pool.query('select * from workers where host_key = $1 limit 1', [hostKey]);
            return rows[0] ?? null;
        },
        async getWorkerByPairingCode(code) {
            const { rows } = await pool.query('select * from workers where pairing_code = $1 and last_seen_at > now() - interval \'2 minutes\' limit 1', [code]);
            return rows[0] ?? null;
        },
        async getWorkerById(id) {
            const { rows } = await pool.query('select * from workers where id = $1 limit 1', [id]);
            return rows[0] ?? null;
        },
        async touchWorker(id) {
            await pool.query('update workers set last_seen_at = now() where id = $1', [id]);
        },
        async pairWorker(userId, workerId, name) {
            await pool.query(`insert into pairings (user_id, worker_id, name, created_at)
         values ($1, $2, $3, now())
         on conflict (user_id, worker_id) do update set revoked_at = null, name = excluded.name`, [userId, workerId, name]);
        },
        async unpairWorker(userId, workerId) {
            await pool.query('update pairings set revoked_at = now() where user_id = $1 and worker_id = $2 and revoked_at is null', [userId, workerId]);
        },
        async listPairings(userId) {
            const { rows } = await pool.query('select * from pairings where user_id = $1 and revoked_at is null', [userId]);
            return rows;
        },
        async listPairingsByWorker(workerId) {
            const { rows } = await pool.query('select user_id from pairings where worker_id = $1 and revoked_at is null', [workerId]);
            return rows.map((r) => r.user_id);
        },
        async isPaired(userId, workerId) {
            const { rowCount } = await pool.query('select 1 from pairings where user_id = $1 and worker_id = $2 and revoked_at is null limit 1', [userId, workerId]);
            return rowCount === 1;
        },
        async upsertDevice(d) {
            await pool.query(`insert into devices (user_id, device_key, platform, expo_push_token, last_seen_at)
         values ($1, $2, $3, $4, now())
         on conflict (user_id, device_key) do update set
           platform = excluded.platform,
           expo_push_token = excluded.expo_push_token,
           last_seen_at = now()`, [d.userId, d.deviceKey, d.platform, d.expoPushToken]);
        },
        async listPushTokens(userId) {
            const { rows } = await pool.query('select expo_push_token from devices where user_id = $1 and expo_push_token is not null', [userId]);
            return rows.map((r) => r.expo_push_token).filter((t) => t !== null);
        },
        async recordUsage(e) {
            await pool.query('insert into usage_events (user_id, worker_id, kind, meta) values ($1, $2, $3, $4)', [e.userId, e.workerId, e.kind, JSON.stringify(e.meta ?? {})]);
        },
        async close() {
            await pool.end();
        },
    };
}
//# sourceMappingURL=store.js.map