#!/usr/bin/env bash
# 构建 packages/bridge 并暂存到 sidecar（dist + package.json + 运行时依赖）。
#
# 用法: bundle-bridge.sh <darwin-arm64|windows-x64>
# 依赖: 先运行 fetch-node.sh <target>
set -euo pipefail

NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"

TARGET="${1:-}"
case "$TARGET" in
  darwin-arm64|windows-x64) ;;
  *) echo "用法: $0 <darwin-arm64|windows-x64>" >&2; exit 64 ;;
esac

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SC="$ROOT/desktop/node-sidecar/$TARGET"

if [[ "$TARGET" == darwin-* ]]; then
  NODE_BIN="$SC/node/bin/node"
  NPM_CLI="$SC/node/lib/node_modules/npm/bin/npm-cli.js"
else
  NODE_BIN="$SC/node/node.exe"
  NPM_CLI="$SC/node/node_modules/npm/bin/npm-cli.js"
fi
[[ -f "$NPM_CLI" ]] || { echo "[bridge] sidecar node 缺失，先运行 fetch-node.sh $TARGET" >&2; exit 1; }

echo "[bridge] 构建 packages/bridge"
pnpm --dir "$ROOT/packages/bridge" build

BR="$SC/bridge"
echo "[bridge] 暂存到 $BR"
rm -rf "$BR"
mkdir -p "$BR"
cp -R "$ROOT/packages/bridge/dist" "$BR/dist"
cp "$ROOT/packages/bridge/package.json" "$BR/package.json"

# 剥离 devDependencies（含 workspace:* 协议，npm 无法解析；CLI 运行时不需要）
"$NODE_BIN" -e '
const fs = require("node:fs")
const file = process.argv[1]
const pkg = JSON.parse(fs.readFileSync(file, "utf8"))
delete pkg.devDependencies
delete pkg.scripts
fs.writeFileSync(file, JSON.stringify(pkg, undefined, 2) + "\n")
' "$BR/package.json"

# CLI 运行时依赖（ws、qrcode-terminal；peer 由 dsh profile 侧解析，不装副本）
(
  cd "$BR"
  "$NODE_BIN" "$NPM_CLI" install --omit=dev --ignore-scripts --legacy-peer-deps \
    --registry "$NPM_REGISTRY" --no-fund --no-audit --loglevel=error
)

echo "[bridge] 完成: $BR"
