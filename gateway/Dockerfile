# deepseek-harness-pocket gateway（自托管：需要持久 WS，不能部署 Vercel）
# 构建上下文 = 仓库根目录：docker build -f gateway/Dockerfile .
FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN corepack enable pnpm

FROM base AS deps
COPY pnpm-workspace.yaml package.json ./
COPY packages/bridge-protocol/package.json packages/bridge-protocol/
COPY gateway/package.json gateway/
RUN pnpm install --frozen-lockfile=false --filter @deepseek-harness-pocket/gateway --filter @deepseek-harness-pocket/bridge-protocol

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY tsconfig.base.json ./
COPY packages/bridge-protocol packages/bridge-protocol
COPY gateway gateway
RUN pnpm --filter @deepseek-harness-pocket/bridge-protocol build \
  && pnpm --dir gateway run build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app/gateway
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/gateway/.next ./gateway/.next
COPY --from=build /app/gateway/dist-server ./gateway/dist-server
COPY --from=build /app/gateway/migrations ./gateway/migrations
COPY --from=build /app/gateway/package.json ./gateway/package.json
EXPOSE 3781
CMD ["node", "dist-server/server.js"]
