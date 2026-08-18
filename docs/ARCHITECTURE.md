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
  ├─ Worker 注册/presence、配对绑定（worker↔user）
  ├─ 帧转发隧道（不理解 /mobile 会话协议）
  └─ 通知 → Expo Push；用量记录（计费预留）
         ▲ outbound wss uplink（断线重连）
电脑 ×N = Worker (packages/bridge/)
  ├─ dshc CLI：install(开机自启)/start(拉起守护 dsh)/stop/status/token/qr
  └─ cordis 插件（dsh 内运行）：/mobile 协议服务端
       ├─ 直连模式 node:http :3780（或 shareWebServer 挂 ctx.webServer）
       ├─ uplink 模式反连 gateway
       └─ 白名单方法 mobile/v1 → ctx.sessions/agents/interaction
            （dsh 适配收敛在 adapter-dsh.ts）
```

## 分层与依赖

- `packages/bridge-protocol`：纯 TS 类型 + codec，全系统唯一协议真相源（app / 插件 / gateway / e2e 共享；零 Node/DOM API）
- `packages/bridge`：peer 依赖 cordis；导出插件 + `dshc` bin
- `gateway`：Next.js 16 自定义 server（WS upgrade），PostgreSQL
- `react-native/`：npm 单独管理（Expo 工具链约定），只依赖协议包

## 协议要点

- SessionEvent 原样透传（append-only、seq 连续）→ 快照 + 增量 + `sessions.resync(lastSeq)` 断线补齐
- RPC envelope 对齐官方 `connection.rpc.call('/api', ns/method, {args})` 形态，便于未来迁移官方 carrier
- 版本协商：`mobile/v1`，major 不匹配拒绝
- 详见 `packages/bridge-protocol/src/`

## 里程碑

M1 直连+只读 → M2 交互+Gateway+dshc 自启 → M3 手机创建 session+推送+对等补全。
完整计划与决议记录见开发过程文档。
