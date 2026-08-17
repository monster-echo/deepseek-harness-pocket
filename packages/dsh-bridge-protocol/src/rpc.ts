/**
 * RPC envelope：对齐官方 connection.rpc.call('/api', '<ns>/<method>', { args }) 形态。
 *
 * 官方 HTTP carrier 为 `POST /api/<namespace>/<method>`，payload 只有具名 `args` 对象。
 * 我们复用同一形态（`POST /mobile/api/<ns>/<method>`），便于未来迁移官方 carrier。
 */

/** 请求 id：调用方生成，响应按 id 关联。 */
export type RpcId = string

export interface WireRequest {
  readonly id: RpcId
  readonly ns: string
  readonly method: string
  readonly args: Readonly<Record<string, unknown>>
}

export type RpcErrorCode =
  | 'bad-request'
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'version-mismatch'
  | 'unavailable'
  | 'internal'

export interface RpcError {
  readonly code: RpcErrorCode
  readonly message: string
}

export type WireResponse =
  | { readonly id: RpcId; readonly ok: true; readonly result: unknown }
  | { readonly id: RpcId; readonly ok: false; readonly error: RpcError }

export function makeRpcId(): RpcId {
  return `r${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

export function rpcSuccess(id: RpcId, result: unknown): WireResponse {
  return { id, ok: true, result }
}

export function rpcFailure(id: RpcId, code: RpcErrorCode, message: string): WireResponse {
  return { id, ok: false, error: { code, message } }
}

/** 解析未知对象为 WireRequest；不合法返回 null（调用方应答 bad-request）。 */
export function parseWireRequest(value: unknown): WireRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  const { id, ns, method, args } = v
  if (typeof id !== 'string' || id.length === 0 || id.length > 64) return null
  if (typeof ns !== 'string' || !/^[a-z][a-z0-9-]*$/.test(ns)) return null
  if (typeof method !== 'string' || !/^[a-z][a-zA-Z0-9.-]*$/.test(method)) return null
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return null
  return { id, ns, method, args: args as Record<string, unknown> }
}

/** 解析未知对象为 WireResponse。 */
export function parseWireResponse(value: unknown): WireResponse | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  const { id, ok } = v
  if (typeof id !== 'string' || id.length === 0) return null
  if (ok === true) return { id, ok: true, result: v.result }
  const err = v.error
  if (typeof err !== 'object' || err === null) return null
  const e = err as Record<string, unknown>
  if (typeof e.code !== 'string' || typeof e.message !== 'string') return null
  return { id, ok: false, error: { code: e.code as RpcErrorCode, message: e.message } }
}

/** ns/method 白名单键，如 `sessions.list`。 */
export function methodKey(ns: string, method: string): string {
  return `${ns}.${method}`
}
