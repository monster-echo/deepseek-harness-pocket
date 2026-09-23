# 上游修复提案：dsh-client-connection 心跳保活（WebKit 后台静默断流）

## 背景与现象

- 目标包：`@deepseek-ai/dsh-client-connection`（upstream 仓库 `deepseek-ai/deepseek-harness`，
  `packages/client/connection`，对应 `lib/client.js` 中 `ConnectionController`）。
- 现象：macOS WKWebView（含 Safari 浏览器、Tauri/WebKitGTK 壳）把后台页面挂起后，
  物理 WebSocket 被静默断开：
  - `online/offline` 事件不派发；
  - `$events` 流不一定正常结束（无 close 帧，pump 的 Promise 永不 resolve）；
  - `ConnectionController.loop()` 的「连接丢失 → 退避重连」路径完全不触发；
  - 结果：投影停在挂起前（模型胶囊「选了不生效」），或 GUI 重拉时闪
    「Loading history… / Deep diving…」。
- Chromium 系无此问题：后台标签只节流定时器，连接保活。Safari 浏览器实测同样复现，
  属 WebKit 通用缺陷，应在 client 侧修复而非每个壳各自打补丁。

## 修复方案：Generation 源级 ping/pong 心跳

在 `ConnectionController`（或其包裹的 generation source）内加心跳，**有活动才发**，
避免与业务流量叠加：

1. 每次 pump 收到任何入站帧（消息/pong）时刷新 `lastActivityAt`；
2. 空闲超过 `heartbeatIdleMs`（建议 30s，可并入 `ConnectionRecoveryConfig`，默认关闭或宽松）
   发送一个 transport 层 ping（WebSocket `ws.ping()` 不存在时，发协议层轻量 RPC）；
3. `heartbeatTimeoutMs`（建议 10s）内未收到 pong/任何入站帧 → 视为死连接：
   `current.abort()`，让现有 loop 走正常的退避重连路径（复用全部既有语义，包括
   `onReconnectRequested` sink 与状态广播）；
4. 页面隐藏时照常运行心跳——挂起进程里定时器本来就不跑，唤醒后第一个超时即触发
   重建，等价于自动恢复；这正是与 Chrome 行为对齐的关键。

实现要点（对齐现编译产物 `lib/client.js` 820-960 行的结构）：

- 在 `loop()` 内每次建立 generation 后启动心跳计时；`stop()`/`abort` 时清理；
- 心跳失败用专用哨兵错误（如 `HEARTBEAT_TIMEOUT`），console.warn 便于定位；
- `ConnectionRecoveryConfigSchema` 增加可选 `heartbeatIdleMs` / `heartbeatTimeoutMs`，
  `resolveConnectionConfig` 给默认值；Host 与 bootstrap data 都可不传（零迁移成本）。

## 验收

- WebKit 壳/Safari：后台 5 分钟+ 回来，投影自动恢复，无「Loading history…」闪动；
- 壳侧可随之删除 `RESUME_WATCHDOG_JS`（dsh-companion `desktop-tauri/src-tauri/src/lib.rs`）
  与 `WEBVIEW_STALE_RELOAD_MS` 整页重载兜底；
- Chromium 下无行为回归（心跳空闲 30s + 10s 超时对正常连接零影响）。

## 环境备注

本开发环境当前无法访问 GitHub（clone/web_fetch 均被拦），补丁需在可联网环境对
`deepseek-ai/deepseek-harness` 提 PR；本文档含全部实现要素。
