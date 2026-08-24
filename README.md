# deepseek-harness-pocket

手机上的 DeepSeek Harness（dsh）完整对等客户端。

**开机即连 · 打开即见 · 选中即用**：电脑开机后 dshc 自动拉起 dsh 并连上 Gateway；手机打开 App 看到自己的电脑在线；点开一台，选择 workspace 创建 session，与 agent 完整交互（发消息/工具调用/审批/停止）。

## 仓库结构（monorepo，全部工程同一目录）

| 目录 | 是什么 | 状态 |
|---|---|---|
| `packages/bridge-protocol` | mobile/v1 协议包（全系统唯一协议真相源，纯 TS） | ✅ M1 |
| `packages/bridge` | dsh 插件（协议服务端：直连 server + gateway uplink）+ `dshc` Worker CLI（拉起守护 dsh、开机自启、配对码） | ✅ M1/M2 |
| `gateway/` | 中转服务（Next.js + 自定义 server 承载 WS；掌鲸 DSH Pocket 认证、配对、presence、推送、用量） | ✅ M2 |
| `react-native/` | 手机 App（Expo；侧边栏布局、会话聊天最大化、配对引导） | ✅ M1/M2 |
| `desktop/` | 电脑端 GUI（Flutter macOS/Windows：Worker 控制、dsh 版本管理、开机自启、自更新） | ✅ |
| `e2e/` | 全链路冒烟（假手机→gateway→uplink→hub→假 dsh + 真实 dsh 冒烟脚本） | ✅ |

## 快速开始

```sh
# 协议/插件/gateway
pnpm install && pnpm -r build && pnpm test

# gateway（需 PostgreSQL，见 gateway/.env.example）
pnpm --dir gateway migrate && pnpm --dir gateway dev

# 电脑端（Worker）
cd packages/bridge && npm link   # 或 npm i -g 文件安装
dshc start                                     # 拉起守护 dsh + 打印配对码
dshc install                                   # 开机自启

# 手机 App
cd react-native && cp .env.example .env && npm install && npx expo start

# 桌面端 GUI（macOS / Windows）
desktop/tool/build-sidecar.sh current && cd desktop && flutter run -d macos
```

架构详见 `docs/ARCHITECTURE.md`；里程碑与决议记录见开发计划。
