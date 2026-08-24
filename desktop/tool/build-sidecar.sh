#!/usr/bin/env bash
# 一键准备 sidecar：fetch node + bundle bridge。
#
# 用法: build-sidecar.sh <darwin-arm64|windows-x64|all|current>
#   current = 宿主平台（mac → darwin-arm64）
set -euo pipefail

TARGET="${1:-current}"
if [[ "$TARGET" == current ]]; then
  case "$(uname -s)/$(uname -m)" in
    Darwin/arm64) TARGET=darwin-arm64 ;;
    Darwin/x86_64) TARGET=darwin-arm64; echo "[sidecar] Intel mac 暂只支持 arm64 包" >&2 ;;
    *) echo "无法推断 current 目标，请显式指定" >&2; exit 64 ;;
  esac
fi

DIR="$(cd "$(dirname "$0")" && pwd)"
TARGETS=("$TARGET")
[[ "$TARGET" == all ]] && TARGETS=(darwin-arm64 windows-x64)

for T in "${TARGETS[@]}"; do
  "$DIR/fetch-node.sh" "$T"
  "$DIR/bundle-bridge.sh" "$T"
done
