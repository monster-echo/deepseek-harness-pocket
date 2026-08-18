/**
 * RPC envelope：对齐官方 connection.rpc.call('/api', '<ns>/<method>', { args }) 形态。
 *
 * 官方 HTTP carrier 为 `POST /api/<namespace>/<method>`，payload 只有具名 `args` 对象。
 * 我们复用同一形态（`POST /mobile/api/<ns>/<method>`），便于未来迁移官方 carrier。
 */
/** 请求 id：调用方生成，响应按 id 关联。 */
export type RpcId = string;
export interface WireRequest {
    readonly id: RpcId;
    readonly ns: string;
    readonly method: string;
    readonly args: Readonly<Record<string, unknown>>;
}
export type RpcErrorCode = 'bad-request' | 'unauthorized' | 'forbidden' | 'not-found' | 'version-mismatch' | 'unavailable' | 'internal';
export interface RpcError {
    readonly code: RpcErrorCode;
    readonly message: string;
}
export type WireResponse = {
    readonly id: RpcId;
    readonly ok: true;
    readonly result: unknown;
} | {
    readonly id: RpcId;
    readonly ok: false;
    readonly error: RpcError;
};
export declare function makeRpcId(): RpcId;
export declare function rpcSuccess(id: RpcId, result: unknown): WireResponse;
export declare function rpcFailure(id: RpcId, code: RpcErrorCode, message: string): WireResponse;
/** 解析未知对象为 WireRequest；不合法返回 null（调用方应答 bad-request）。 */
export declare function parseWireRequest(value: unknown): WireRequest | null;
/** 解析未知对象为 WireResponse。 */
export declare function parseWireResponse(value: unknown): WireResponse | null;
/** ns/method 白名单键，如 `sessions.list`。 */
export declare function methodKey(ns: string, method: string): string;
