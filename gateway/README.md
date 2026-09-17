# Gateway（手机 ↔ Worker 中转）

Next.js 16 自定义 server（承载 WebSocket）+ PostgreSQL。协议真相源在
`packages/bridge-protocol`，序列化与 REST 路由在 `src/server/`。

## 本地开发

```sh
cp .env.example .env          # 配 DATABASE_URL（本地 PG 即可）
pnpm --filter @deepseek-harness-pocket/bridge-protocol build   # gateway 依赖其 dist
pnpm --dir gateway dev        # tsx 直跑 server.ts，含启动时自动迁移
```

- 启动时自动执行 `migrations/*.sql`（幂等 SQL，按文件名顺序）。
- `NODE_ENV=development` 且未配 `AUTH_JWKS_URL` 时放行 `dev:<userId>` 伪 token，
  便于本地与 e2e 走通「手机 approve」等需要登录的路径。
- 冒烟脚本（对着跑起来的实例验关键链路，只依赖 curl + python3）：

```sh
pnpm --dir gateway dev &      # 或 tsx server.ts
SMOKE_DB_HOST=127.0.0.1 SMOKE_DB_PORT=5432 SMOKE_DB_USER=dsh SMOKE_DB_PASSWORD=dsh \
  bash .github/scripts/gateway-smoke.sh http://127.0.0.1:3781 --seed "psql"
```

## 发布（打 tag 即发）

```sh
# 版本号取自 tag：gateway-v0.1.1 → 镜像 tag 0.1.1
git tag gateway-v0.1.1 && git push origin gateway-v0.1.1
```

流水线见 `.github/workflows/gateway-release.yml`，顺序为：

1. **verify**：协议包 + gateway 单元测试、服务端类型检查；
2. **publish**：构建镜像 → **用镜像本体**跑冒烟（真 Postgres、真迁移、扫码登录全链路、
   伪造凭据 401、未注册电脑 422）→ 通过后才推 registry；
   镜像地址 `ghcr.io/<owner>/<repo>/gateway:<版本>`（另带 `latest`、`sha-<commit>`）；
3. **release**：建 GitHub Release，正文带镜像地址与服务器升级命令；
4. **deploy**（可选，默认关）：SSH 到服务器 `docker compose pull && up -d`。

也可在 Actions 页手动 `workflow_dispatch`（填版本号；可只构建+冒烟不推镜像）。

### 仓库侧一次性配置（都可选）

| 类型 | 名称 | 说明 |
|---|---|---|
| Variable | `GATEWAY_PLATFORMS` | 默认 `linux/amd64`；ARM 服务器填 `linux/arm64`，两者都要填 `linux/amd64,linux/arm64` |
| Secret | `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` | 配了才额外推 Docker Hub（否则只发 GHCR） |
| Variable | `GATEWAY_DEPLOY_ENABLED` | `true` 才启用自动部署作业 |
| Secret | `DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_SSH_KEY` | 自动部署用的 SSH 目标与私钥 |
| Variable | `DEPLOY_PATH` | 服务器上 `docker-compose.yml` 所在目录，默认 `/opt/dsh-gateway` |
| Variable | `GATEWAY_HEALTH_URL` | 部署后校验的公网健康检查地址 |

> GHCR 包默认私有：要么在仓库 Packages 里把该镜像设为 public，
> 要么在服务器上 `docker login ghcr.io`（PAT 需 `read:packages`）。

## 服务器部署 / 升级

`docker-compose.yml` 里镜像取 `${GATEWAY_IMAGE:-…}`，所以升级只要改 `.env`：

```sh
cd <docker-compose.yml 所在目录>
sed -i '/^GATEWAY_IMAGE=/d' .env
echo 'GATEWAY_IMAGE=ghcr.io/monster-echo/deepseek-harness-pocket/gateway:0.1.1' >> .env
docker compose pull gateway && docker compose up -d gateway
docker compose ps gateway
curl -fsS https://<你的域名>/api/v1/health
```

写进 `.env` 而不是命令行前缀，是为了服务器重启后 `docker compose up -d` 仍用同一版本。

## 主要接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/health` | 健康检查（compose healthcheck 用） |
| GET | `/api/v1/workers` | 我的 Worker 列表（含在线状态） |
| POST | `/api/v1/workers/bind` | 按 hostKey 绑定（桌面端登录后主动绑） |
| DELETE | `/api/v1/workers?workerId=` | 解绑 |
| POST | `/api/v1/devices/push-token` | 注册 Expo Push token |
| POST | `/api/v1/devices/link/start` | 桌面端申请扫码登录链接码（无需鉴权） |
| POST | `/api/v1/devices/link/preview` | 手机扫到码后先取设备信息（服务端权威，用于确认弹窗） |
| POST | `/api/v1/devices/link/approve` | 手机确认授权 → 绑定该电脑 |
| POST | `/api/v1/devices/link/poll` | 桌面端轮询取回账号身份与设备凭据 |
| POST | `/api/v1/devices/link/revoke` | 桌面端退出登录：解绑 + 作废凭据 |

鉴权两种形态（`src/server/api.ts` 的 `authUser`）：auth 签发的 RS256 JWT（JWKS 离线验签）
与 gateway 自签的设备凭据 `dshl_<code>.<secret>`（只存 sha256，可吊销）。

扫码登录的完整契约见 `desktop/README.md` 与 `packages/bridge-protocol/src/device-link.ts`。