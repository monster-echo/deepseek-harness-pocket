# deepseek-harness-pocket gateway（自托管：需要持久 WS，不能部署 Vercel）
# 构建上下文 = 仓库根目录：docker build -f gateway/Dockerfile .
FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN corepack enable pnpm

FROM base AS deps
COPY pnpm-workspace.yaml package.json ./
COPY packages/bridge-protocol/package.json packages/bridge-protocol/
COPY packages/legal/package.json packages/legal/
COPY gateway/package.json gateway/
RUN pnpm install --frozen-lockfile=false --filter @deepseek-harness-pocket/gateway --filter @deepseek-harness-pocket/bridge-protocol --filter @deepseek-harness-pocket/legal

FROM base AS build
COPY --from=deps /app/node_modules /app/node_modules
COPY package.json pnpm-workspace.yaml ./
COPY tsconfig.base.json ./
COPY packages/bridge-protocol packages/bridge-protocol
COPY packages/legal packages/legal
COPY gateway gateway
# COPY 源码会覆盖 deps 阶段装的包自身 node_modules（pnpm 依赖链接在各自包目录下），重新放回
COPY --from=deps /app/packages/bridge-protocol/node_modules /app/packages/bridge-protocol/node_modules
COPY --from=deps /app/packages/legal/node_modules /app/packages/legal/node_modules
COPY --from=deps /app/gateway/node_modules /app/gateway/node_modules
RUN pnpm --filter @deepseek-harness-pocket/bridge-protocol build \
  && pnpm --filter @deepseek-harness-pocket/legal build \
  && pnpm --dir gateway run build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages /app/packages
COPY --from=build /app/gateway /app/gateway
# server.ts 按编译产物位置（dist-server/）查找 migrations，需要放回该路径
COPY --from=build /app/gateway/migrations /app/gateway/dist-server/migrations
WORKDIR /app/gateway
EXPOSE 3781
CMD ["node", "dist-server/server.js"]
