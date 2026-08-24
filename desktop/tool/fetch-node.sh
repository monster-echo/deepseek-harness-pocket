#!/usr/bin/env bash
# 下载 Node 发行版（含 npm）+ 安装 pnpm 到 sidecar 的 node 前缀。
#
# 用法: fetch-node.sh <darwin-arm64|windows-x64>
# 环境变量:
#   NODE_MIRROR   Node 二进制源（默认 npmmirror，CI 可设 https://nodejs.org/dist）
#   NPM_REGISTRY  npm 源（默认 npmmirror）
set -euo pipefail

NODE_VERSION=v22.18.0
PNPM_VERSION=10.33.0
NODE_MIRROR="${NODE_MIRROR:-https://registry.npmmirror.com/-/binary/node}"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"

TARGET="${1:-}"
case "$TARGET" in
  darwin-arm64) NODE_FILE="node-$NODE_VERSION-darwin-arm64.tar.gz" ;;
  windows-x64)  NODE_FILE="node-$NODE_VERSION-win-x64.zip" ;;
  *) echo "用法: $0 <darwin-arm64|windows-x64>" >&2; exit 64 ;;
esac

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SC="$ROOT/desktop/node-sidecar/$TARGET"
mkdir -p "$SC/node"

if [[ "$TARGET" == darwin-* ]] && [[ -x "$SC/node/bin/node" ]]; then
  echo "[sidecar] node 已存在: $SC/node，如需重下先删除该目录"
elif [[ "$TARGET" == windows-* ]] && [[ -f "$SC/node/node.exe" ]]; then
  echo "[sidecar] node 已存在: $SC/node，如需重下先删除该目录"
else
  URL="$NODE_MIRROR/$NODE_VERSION/$NODE_FILE"
  TMP="$(mktemp -d)"
  echo "[sidecar] 下载 $URL"
  curl -fL --retry 3 --connect-timeout 20 -o "$TMP/$NODE_FILE" "$URL"
  if [[ "$TARGET" == darwin-* ]]; then
    tar -xzf "$TMP/$NODE_FILE" --strip-components=1 -C "$SC/node"
    chmod +x "$SC/node/bin/node"
  else
    # Windows zip：git-bash 的 GNU tar 解不了 zip，走 PowerShell
    powershell.exe -NoProfile -Command "Expand-Archive -Force -DestinationPath '$(cygpath -w "$TMP" 2>/dev/null || echo "$TMP")'" "$TMP/$NODE_FILE" 2>/dev/null \
      || powershell.exe -NoProfile -Command "Expand-Archive -Force -DestinationPath \"$TMP\" \"$TMP/$NODE_FILE\""
    rm -rf "$SC/node"
    mv "$TMP/node-$NODE_VERSION-win-x64" "$SC/node"
  fi
  rm -rf "$TMP"
fi

# 平台相关的 node / npm-cli 路径
if [[ "$TARGET" == darwin-* ]]; then
  NODE_BIN="$SC/node/bin/node"
  NPM_CLI="$SC/node/lib/node_modules/npm/bin/npm-cli.js"
  PNPM_BIN="$SC/node/bin/pnpm"
else
  NODE_BIN="$SC/node/node.exe"
  NPM_CLI="$SC/node/node_modules/npm/bin/npm-cli.js"
  PNPM_BIN="$SC/node/pnpm.cmd"
fi

if [[ ! -f "$NPM_CLI" ]]; then
  echo "[sidecar] npm-cli 不存在: $NPM_CLI（发行版损坏？删掉 $SC/node 重试）" >&2
  exit 1
fi

# dsh plugin 子命令要求 PATH 上有 pnpm：装进 sidecar node 前缀
if [[ ! -e "$PNPM_BIN" ]]; then
  echo "[sidecar] 安装 pnpm@$PNPM_VERSION 到 $SC/node"
  "$NODE_BIN" "$NPM_CLI" install -g "pnpm@$PNPM_VERSION" \
    --prefix "$SC/node" --registry "$NPM_REGISTRY" --no-fund --no-audit --loglevel=error
fi

echo "[sidecar] $TARGET 就绪: $SC"
