/**
 * 协议版本：mobile/v1。
 *
 * 协议版本独立于 dsh 版本演进；dsh 侧适配（SessionEvent 新事件类型等）
 * 收敛在插件的 adapter-dsh.ts，不改变本包 wire 契约。
 *
 * 协商规则：双方 major 必须一致（`mobile/v1` ↔ `mobile/v1`）；
 * minor 差异通过 handshake capabilities 降级处理。
 */

export const PROTOCOL_VERSION = 'mobile/v1' as const

export function parseProtocolVersion(version: string): { major: number; minor: number } | null {
  const match = /^mobile\/v(\d+)(?:\.(\d+))?$/.exec(version)
  if (!match) return null
  const major = Number(match[1])
  const minor = match[2] === undefined ? 0 : Number(match[2])
  if (!Number.isInteger(major) || !Number.isInteger(minor)) return null
  return { major, minor }
}

export function isCompatibleVersion(client: string, server: string): boolean {
  const c = parseProtocolVersion(client)
  const s = parseProtocolVersion(server)
  if (!c || !s) return false
  return c.major === s.major
}
