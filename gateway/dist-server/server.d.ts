/**
 * Gateway 入口：自定义 server 统一承载
 *   - /api/v1/*   REST（配对/Worker 列表/push token/健康检查）
 *   - /gw/worker  Worker uplink（WS upgrade）
 *   - /gw/phone   手机接入（WS upgrade）
 *   - 其余        Next.js（管理面 UI，未来控制台）
 *
 * 部署：Docker 自托管（不能 Vercel——需要持久 WS）；TLS 由前置反代/平台负责。
 */
export {};
