/**
 * dsh-companion 桥接插件（mobile/v1 协议服务端）。
 *
 * 安装（轻模式）：在目标 profile 里
 *   dsh plugin add @dsh-companion/bridge
 * 或 cordis.patch.yml 手工插入（见 cordis.example.yml）。
 *
 * 形态遵循 dsh 插件规范：命名导出 name/inject/Config/apply，不用默认导出。
 */

import type { Context } from '@deepseek-ai/cordis'
import { hostname } from 'node:os'
import { pluginConfig, type PluginConfig } from './config.js'
import { createAdapter } from './adapter-dsh.js'
import { BridgeHub } from './hub.js'
import { loadBridgeState, verifyToken } from './state.js'
import { startDirectServer } from './server.js'
import { startUplink } from './uplink.js'

export const name = 'dsh-companion-bridge'

/** sessions 为核心依赖；persistence/agents/approval 等经 ctx.get 优雅降级。 */
export const inject = ['sessions']

export const Config = pluginConfig

export function apply(ctx: Context, config: PluginConfig): void {
  const state = loadBridgeState(config.stateFile)
  if (state === undefined) {
    ctx.logger.error('dsh-companion bridge: 无法读取状态文件（且禁止创建）')
    return
  }
  const workerName = config.name.length > 0 ? config.name : hostname()
  const adapter = createAdapter(ctx)
  const hub = new BridgeHub(adapter, {
    workerName,
    fingerprint: state.fingerprint,
    capsLevel: config.caps,
    readOnly: config.readOnly,
    pairingToken: state.pairingToken,
    verifyToken,
  })

  // M2：审批与用户问题应答（无对应服务时 register 返回 null，自动跳过）
  if (hub.capabilities.approvals) {
    adapter.registerApprovalAsker((ask) => hub.registerApproval(ask))
    adapter.registerQuestionAsker((ask) => hub.registerQuestion(ask))
  }

  if (config.listen.enabled) {
    let disposeServer: (() => Promise<void>) | undefined
    void startDirectServer(ctx, {
      host: config.listen.host,
      port: config.listen.port,
      hub,
      workerName,
    })
      .then((running) => {
        disposeServer = () => running.dispose()
      })
      .catch((error: unknown) => {
        ctx.logger.error(
          `dsh-companion bridge: 直连 server 启动失败 (${config.listen.host}:${config.listen.port}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      })
    ctx.effect(() => () => void disposeServer?.())
  }

  let disposeUplink: (() => void) | undefined
  if (config.gateway.url.length > 0) {
    const hostKey = config.gateway.hostKey.length > 0 ? config.gateway.hostKey : state.hostKey
    disposeUplink = startUplink(ctx, {
      url: config.gateway.url,
      hostKey,
      workerName,
      fingerprint: state.fingerprint,
      dshVersion: adapter.dshVersion(),
      hub,
      pairingCode: state.pairingCode,
      reconnectMinMs: config.gateway.reconnectMinMs,
      reconnectMaxMs: config.gateway.reconnectMaxMs,
    })
  }
  ctx.effect(() => () => {
    disposeUplink?.()
    hub.dispose()
  })

  ctx.logger.info(
    `dsh-companion bridge ready: worker="${workerName}" caps=${config.caps} ` +
      `direct=${config.listen.enabled ? `ws://${config.listen.host}:${config.listen.port}/mobile/ws` : 'off'} ` +
      `gateway=${config.gateway.url.length > 0 ? config.gateway.url : 'off'} pairingCode=${state.pairingCode}`,
  )
}
