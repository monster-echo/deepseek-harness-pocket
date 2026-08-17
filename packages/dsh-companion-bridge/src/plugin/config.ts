/**
 * 插件配置（schemastery）。
 *
 * cordis.patch.yml / profile 配置示例：
 *   - id: dsh-companion-bridge
 *     name: '@dsh-companion/bridge'
 *     config:
 *       listen:
 *         host: 0.0.0.0
 *         port: 3780
 *       gateway:
 *         url: wss://gateway.example.com
 */

import z from '@deepseek-ai/schemastery'

export const pluginConfig = z.object({
  /** 直连模式：自起 http/ws server（独立端口，不依赖 ctx.webServer） */
  listen: z.object({
    enabled: z.boolean().default(true),
    host: z.string().default('0.0.0.0'),
    port: z.number().default(3780),
  }).default({ enabled: true, host: '0.0.0.0', port: 3780 }),
  /** uplink 模式：反向连接 gateway */
  gateway: z.object({
    url: z.string().default(''),
    /** 由 dshc 生成并注入，避免与状态文件双源 */
    hostKey: z.string().default(''),
    reconnectMinMs: z.number().default(1000),
    reconnectMaxMs: z.number().default(30000),
  }).default({ url: '', hostKey: '', reconnectMinMs: 1000, reconnectMaxMs: 30000 }),
  /** 能力面：按里程碑声明，handshake 下发给 app */
  caps: z.union(['m1', 'm2', 'm3']).default('m2'),
  /** 状态文件路径（hostKey/pairingToken） */
  stateFile: z.string().default('~/.dsh-companion/bridge-state.json'),
  /** Worker 显示名（默认取 hostname） */
  name: z.string().default(''),
  /** 禁用一切写操作（只读模式开关） */
  readOnly: z.boolean().default(false),
  /**
   * 注册 user-questions provider（默认 false）：dsh 的 provider 槽唯一，
   * web-app bundle 的 api-gateway 已占用；仅 headless/自定义 profile 开启。
   * 审批走 approval/request 瀑布流，多应答器共存，不受此限制。
   */
  userQuestions: z.boolean().default(false),
  /** 新会话默认模型路由（sessions.create 可按次覆盖） */
  model: z.object({
    provider: z.string().default('deepseek-official'),
    model: z.string().default('deepseek-v4-flash'),
  }).default({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }),
})

/** 与 schema 对应的手写类型（schemastery 无 infer 辅助）。 */
export interface PluginConfig {
  listen: { enabled: boolean; host: string; port: number }
  gateway: { url: string; hostKey: string; reconnectMinMs: number; reconnectMaxMs: number }
  caps: 'm1' | 'm2' | 'm3'
  stateFile: string
  name: string
  readOnly: boolean
  userQuestions: boolean
  model: { provider: string; model: string }
}
