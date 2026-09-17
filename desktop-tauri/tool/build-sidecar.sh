# [dev-only] v0.2.0 起安装包不再内置 sidecar，本脚本仅供开发/调试使用
#!/usr/bin/env bash
# 构建内置 node sidecar：node 运行时 + bridge(dshc) → node-sidecar/
#
# 目标布局（Rust 侧按此解析；扁平，无 arch 子目录）：
#   macOS  : node-sidecar/{node/bin/node, bridge/dist/cli/index.js}
#   Windows: node-sidecar/{node/node.exe,  bridge/dist/cli/index.js}
#
# 用法: build-sidecar.sh [darwin-arm64|windows-x64] [--force]
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
SC="$ROOT/node-sidecar"

TARGET="${1:-}"; FORCE="${2:-}"
case "$TARGET" in
  darwin-arm64|windows-x64) ;;
  --force) FORCE="--force"; TARGET="" ;;
  "") ;;
  *) echo "用法: $0 [darwin-arm64|windows-x64] [--force]" >&2; exit 64 ;;
esac

if [ -z "$TARGET" ]; then
  case "$(uname -s)-$(uname -m)" in
    Darwin-*) TARGET=darwin-arm64 ;;
    *)        TARGET=windows-x64 ;;
  esac
fi

NODE_BIN="$SC/node/bin/node"; [ -f "$NODE_BIN" ] || NODE_BIN="$SC/node/node.exe"

if [ "$FORCE" != "--force" ] && { [ -x "$NODE_BIN" ] || [ -f "$NODE_BIN" ]; } \
   && [ -f "$SC/bridge/dist/cli/index.js" ]; then
  echo "[sidecar] 已就绪，跳过（--force 可重建）"
else
  echo "[sidecar] 拉取 node（target=${TARGET}）..."
  "$ROOT/tool/fetch-node.sh" "$TARGET"
  echo "[sidecar] 构建 bridge(dshc) ..."
  "$ROOT/tool/bundle-bridge.sh" "$TARGET"
fi

NODE_BIN="$SC/node/bin/node"; [ -f "$NODE_BIN" ] || NODE_BIN="$SC/node/node.exe"
[ -x "$NODE_BIN" ] || [ -f "$NODE_BIN" ] || { echo "[sidecar] ✗ node 缺失" >&2; exit 1; }
[ -f "$SC/bridge/dist/cli/index.js" ] || { echo "[sidecar] ✗ dshc 缺失" >&2; exit 1; }
echo "[sidecar] ✓ node=$("$NODE_BIN" --version 2>/dev/null || echo ok) dshc=ok"
