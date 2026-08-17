/**
 * PostgreSQL 访问层（gateway 自有库）。
 *
 * 表：workers / pairings / devices / usage_events（见 migrations/001_init.sql）。
 * 所有 SQL 集中在此；WS 核心与 REST 路由只调用函数。
 */
import { type Pool } from 'pg';
export interface WorkerRow {
    readonly id: string;
    readonly host_key: string;
    readonly name: string;
    readonly fingerprint: string;
    readonly dsh_version: string | null;
    readonly pairing_code: string;
    readonly last_seen_at: Date;
}
export interface PairingRow {
    readonly user_id: string;
    readonly worker_id: string;
    readonly name: string | null;
    readonly created_at: Date;
    readonly revoked_at: Date | null;
}
export interface DeviceRow {
    readonly user_id: string;
    readonly device_key: string;
    readonly platform: string;
    readonly expo_push_token: string | null;
    readonly last_seen_at: Date;
}
export interface Store {
    pool: Pool;
    upsertWorker(w: {
        id: string;
        hostKey: string;
        name: string;
        fingerprint: string;
        dshVersion: string | null;
        pairingCode: string;
    }): Promise<void>;
    getWorkerByHostKey(hostKey: string): Promise<WorkerRow | null>;
    getWorkerByPairingCode(code: string): Promise<WorkerRow | null>;
    getWorkerById(id: string): Promise<WorkerRow | null>;
    touchWorker(id: string): Promise<void>;
    pairWorker(userId: string, workerId: string, name: string | null): Promise<void>;
    unpairWorker(userId: string, workerId: string): Promise<void>;
    listPairings(userId: string): Promise<PairingRow[]>;
    listPairingsByWorker(workerId: string): Promise<string[]>;
    isPaired(userId: string, workerId: string): Promise<boolean>;
    upsertDevice(d: {
        userId: string;
        deviceKey: string;
        platform: string;
        expoPushToken: string | null;
    }): Promise<void>;
    listPushTokens(userId: string): Promise<string[]>;
    recordUsage(e: {
        userId: string | null;
        workerId: string | null;
        kind: string;
        meta?: Record<string, unknown>;
    }): Promise<void>;
    close(): Promise<void>;
}
export declare function createStore(databaseUrl: string): Store;
