/**
 * 协议帧的 RN 侧出口：重导出协议包 + 宽松的下行帧解析。
 */

export * from '@deepseek-harness-pocket/bridge-protocol'

import type { WorkerToPhoneFrame } from '@deepseek-harness-pocket/bridge-protocol'

/** 宽松解析 Worker 下行帧；未知结构返回 null（不抛错）。 */
export function parseWorkerFrameSafe(value: unknown): WorkerToPhoneFrame | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  const known = [
    'auth-ok', 'auth-rejected', 'rpc-result', 'event', 'snapshot',
    'server-request', 'ping', 'resync-needed',
  ]
  if (typeof v.kind === 'string' && known.includes(v.kind)) {
    return v as unknown as WorkerToPhoneFrame
  }
  return null
}
