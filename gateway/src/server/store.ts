/**
 * PostgreSQL 访问层（gateway 自有库）。
 *
 * 表：workers / pairings / devices / usage_events（见 migrations/001_init.sql）。
 * 所有 SQL 集中在此；WS 核心与 REST 路由只调用函数。
 */

import pg, { type Pool } from 'pg'

export interface WorkerRow {
  readonly id: string
  readonly host_key: string
  readonly name: string
  readonly fingerprint: string
  readonly dsh_version: string | null
  readonly pairing_code: string
  readonly last_seen_at: Date
}

export interface PairingRow {
  readonly user_id: string
  readonly worker_id: string
  readonly name: string | null
  readonly created_at: Date
  readonly revoked_at: Date | null
}

export interface DeviceRow {
  readonly user_id: string
  readonly device_key: string
  readonly platform: string
  readonly expo_push_token: string | null
  readonly last_seen_at: Date
}

export interface Store {
  pool: Pool
  upsertWorker(w: { id: string; hostKey: string; name: string; fingerprint: string; dshVersion: string | null; pairingCode: string }): Promise<void>
  getWorkerByHostKey(hostKey: string): Promise<WorkerRow | null>
  getWorkerByPairingCode(code: string): Promise<WorkerRow | null>
  getWorkerById(id: string): Promise<WorkerRow | null>
  touchWorker(id: string): Promise<void>

  pairWorker(userId: string, workerId: string, name: string | null): Promise<void>
  unpairWorker(userId: string, workerId: string): Promise<void>
  listPairings(userId: string): Promise<PairingRow[]>
  listPairingsByWorker(workerId: string): Promise<string[]>
  isPaired(userId: string, workerId: string): Promise<boolean>

  upsertDevice(d: { userId: string; deviceKey: string; platform: string; expoPushToken: string | null }): Promise<void>
  listPushTokens(userId: string): Promise<string[]>

  recordUsage(e: { userId: string | null; workerId: string | null; kind: string; meta?: Record<string, unknown> }): Promise<void>
  /** 今日（DB 时区）该用户已中转的作品预览字节（kind='preview-bytes' 聚合） */
  previewBytesToday(userId: string): Promise<number>
  close(): Promise<void>
}

export function createStore(databaseUrl: string): Store {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 })

  return {
    pool,

    async upsertWorker(w) {
      await pool.query(
        `insert into workers (id, host_key, name, fingerprint, dsh_version, pairing_code, last_seen_at)
         values ($1, $2, $3, $4, $5, $6, now())
         on conflict (host_key) do update set
           name = excluded.name,
           fingerprint = excluded.fingerprint,
           dsh_version = excluded.dsh_version,
           pairing_code = excluded.pairing_code,
           last_seen_at = now()`,
        [w.id, w.hostKey, w.name, w.fingerprint, w.dshVersion, w.pairingCode],
      )
    },

    async getWorkerByHostKey(hostKey) {
      const { rows } = await pool.query<WorkerRow>('select * from workers where host_key = $1 limit 1', [hostKey])
      return rows[0] ?? null
    },

    async getWorkerByPairingCode(code) {
      const { rows } = await pool.query<WorkerRow>(
        'select * from workers where pairing_code = $1 and last_seen_at > now() - interval \'2 minutes\' limit 1',
        [code],
      )
      return rows[0] ?? null
    },

    async getWorkerById(id) {
      const { rows } = await pool.query<WorkerRow>('select * from workers where id = $1 limit 1', [id])
      return rows[0] ?? null
    },

    async touchWorker(id) {
      await pool.query('update workers set last_seen_at = now() where id = $1', [id])
    },

    async pairWorker(userId, workerId, name) {
      await pool.query(
        `insert into pairings (user_id, worker_id, name, created_at)
         values ($1, $2, $3, now())
         on conflict (user_id, worker_id) do update set revoked_at = null, name = excluded.name`,
        [userId, workerId, name],
      )
    },

    async unpairWorker(userId, workerId) {
      await pool.query(
        'update pairings set revoked_at = now() where user_id = $1 and worker_id = $2 and revoked_at is null',
        [userId, workerId],
      )
    },

    async listPairings(userId) {
      const { rows } = await pool.query<PairingRow>(
        'select * from pairings where user_id = $1 and revoked_at is null',
        [userId],
      )
      return rows
    },

    async listPairingsByWorker(workerId) {
      const { rows } = await pool.query<{ user_id: string }>(
        'select user_id from pairings where worker_id = $1 and revoked_at is null',
        [workerId],
      )
      return rows.map((r) => r.user_id)
    },

    async isPaired(userId, workerId) {
      const { rowCount } = await pool.query(
        'select 1 from pairings where user_id = $1 and worker_id = $2 and revoked_at is null limit 1',
        [userId, workerId],
      )
      return rowCount === 1
    },

    async upsertDevice(d) {
      await pool.query(
        `insert into devices (user_id, device_key, platform, expo_push_token, last_seen_at)
         values ($1, $2, $3, $4, now())
         on conflict (user_id, device_key) do update set
           platform = excluded.platform,
           expo_push_token = excluded.expo_push_token,
           last_seen_at = now()`,
        [d.userId, d.deviceKey, d.platform, d.expoPushToken],
      )
    },

    async listPushTokens(userId) {
      const { rows } = await pool.query<{ expo_push_token: string | null }>(
        'select expo_push_token from devices where user_id = $1 and expo_push_token is not null',
        [userId],
      )
      return rows.map((r) => r.expo_push_token).filter((t): t is string => t !== null)
    },

    async recordUsage(e) {
      await pool.query(
        'insert into usage_events (user_id, worker_id, kind, meta) values ($1, $2, $3, $4)',
        [e.userId, e.workerId, e.kind, JSON.stringify(e.meta ?? {})],
      )
    },

    async previewBytesToday(userId) {
      const { rows } = await pool.query<{ total: string }>(
        `select coalesce(sum((meta->>'bytes')::bigint), 0) as total
         from usage_events
         where user_id = $1 and kind = 'preview-bytes' and at >= date_trunc('day', now())`,
        [userId],
      )
      return Number(rows[0]?.total ?? 0)
    },

    async close() {
      await pool.end()
    },
  }
}
