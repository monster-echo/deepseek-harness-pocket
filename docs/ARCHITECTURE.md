# deepseek-harness-pocket 架构

手机上的 DeepSeek Harness（dsh）完整对等客户端。

```
手机 app (Expo/RN, react-native/)
  │ 强制登录 auth.zhongbei.tech（掌鲸 DSH Pocket 统一认证）
  ├─ 直连 ws://<worker>:3780 + pairing token（同 WiFi 兜底）
  └─ wss://<gateway> + 掌鲸 DSH Pocket session（外网主路径）
         │
Gateway (gateway/, Next.js + 自定义 server 承载 WS, 自有 PG)
  ├─ 验票：auth.zhongbei.tech 内部校验端点
  ├─ Worker 注册/presence、绑定（worker↔user）
  │   ├─ 账号自动绑定：worker-register 带 accountToken（验签通过即绑）；
  │   │    手机端解绑留墓碑不复活；POST /api/v1/workers/bind 按 hostKey 主动绑
  │   └─ 扫码登录 /api/v1/devices/link/*：手机授权 → 绑定该电脑，
  │        并给桌面端签发设备凭据（dshl_<code>.<secret>；authUser 同时认 JWT 与它）
  ├─ 帧转发隧道（不理解 /mobile 会话协议）
  └─ 通知 → Expo Push；用量记录（计费预留）
         ▲ outbound wss uplink（断线重连）
电脑 ×N = Worker (packages/bridge/)
  ├─ dshc CLI：install(开机自启)/start(拉起守护 dsh)/stop/status/token/qr（--json 供 GUI）
  ├─ 桌面端（desktop-tauri/，Tauri 2 + React/TS，双窗口）：
  │    主窗口 = harness 网页壳（WebView，仅放行 loopback；跨平台回退 URL 启动时捕获）；
  │    控制台 = 独立窗口（React + Tailwind v4 + shadcn 令牌，与手机端同源；
  │      5 页：状态/配对/账号/版本/日志；托盘跨窗口导航；配置缺窗口定义时
  │      由 Rust WebviewWindowBuilder 动态建窗）；
  │    登录：浏览器 loopback OAuth → account-session.json（已实现，含续期）；
  │      扫码设备授权（device-link 主路径 → device-link.json）待接入；
  │    内置 node sidecar → dshc；托管 dsh 多版本（runtimes/dsh/<版本>：列/装/删/切）；
  │    开机自启（tauri-plugin-autostart：macOS LaunchAgent / Windows 注册表 Run 键）
  │      + 托盘常驻 + tauri-plugin-updater（latest.json + minisign 签名）
  └─ cordis 插件（dsh 内运行）：/mobile 协议服务端
       ├─ 直连模式 node:http :3780（或 shareWebServer 挂 ctx.webServer）
       ├─ uplink 模式反连 gateway（连接时读 account-session.json 上送 accountToken）
       └─ 白名单方法 mobile/v1 → ctx.sessions/agents/interaction
            （dsh 适配收敛在 adapter-dsh.ts）
```

## 分层与依赖

- `packages/bridge-protocol`：纯 TS 类型 + codec，全系统唯一协议真相源（app / 插件 / gateway / e2e 共享；零 Node/DOM API）
- `packages/bridge`：peer 依赖 cordis；导出插件 + `dshc` bin
- `gateway`：Next.js 16 自定义 server（WS upgrade），PostgreSQL
- `react-native/`：npm 单独管理（Expo 工具链约定），只依赖协议包
- `desktop-tauri/`：Tauri 2（Rust 壳 + React/TS 前端），纳入 pnpm workspace；worker 逻辑仍唯一收敛在 dshc，壳只负责托盘/窗口/进程托管

## 协议要点

- SessionEvent 原样透传（append-only、seq 连续）→ 快照 + 增量 + `sessions.resync(lastSeq)` 断线补齐
- RPC envelope 对齐官方 `connection.rpc.call('/api', ns/method, {args})` 形态，便于未来迁移官方 carrier
- 版本协商：`mobile/v1`，major 不匹配拒绝
- 详见 `packages/bridge-protocol/src/`

## 里程碑

M1 直连+只读 → M2 交互+Gateway+dshc 自启 → M3 手机创建 session+推送+对等补全。
完整计划与决议记录见开发过程文档。
