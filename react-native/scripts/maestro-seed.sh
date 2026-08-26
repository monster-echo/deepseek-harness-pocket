#!/usr/bin/env bash
# Maestro UI 测试一次性种子化（之后可反复跑 .maestro/artifacts-preview.yaml）
#
# 环境事实（2026-08-26 验证）：
#   - iOS 26.4 模拟器 + RN 0.8x 的可访问性树不可靠（截图可见的 Text 在 AX 树缺失）
#     → Maestro 的 text/id/label 选择器不可用，流程只能用坐标（百分比必须整数）
#   - App 为 Expo Development Build：clearState 会抹掉 dev server 记录 → 永远不要 clearState
#   - metro 必须持续运行（nohup npx expo start）；metro 重启后 App 需手动点一次
#     launcher 里的 localhost Connect（坐标 50%, 42%）
#
# 用法：bash scripts/maestro-seed.sh
set -euo pipefail
cd "$(dirname "$0")/.."

APP_ID="top.rwecho.dshcompanion"
EMAIL="autotest-ui@dsh-pocket.dev"
PASS="AutoTest#2026dsh"
STATE="$HOME/.deepseek-harness-pocket/bridge-state.json"
export PATH="$HOME/.maestro/bin:$PATH"

echo "== 1. metro（后台常驻）=="
if ! curl -s -m 3 http://localhost:8081/status | grep -q running; then
  nohup npx expo start --port 8081 > /tmp/metro.log 2>&1 &
  disown
  sleep 15
fi
curl -s http://localhost:8081/status && echo

echo "== 2. 测试账号 + 预绑定 worker（REST）=="
TOKEN=$(curl -s -X POST https://auth.zhongbei.tech/api/v1/auth/sign-in \
  -H "Content-Type: application/json" -H "X-App-Id: dshcompanion" -H "X-App-Environment: production" \
  -d "{\"identifier\":\"$EMAIL\",\"password\":\"$PASS\"}" | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['token'])")
CODE=$(python3 -c "import json;print(json.load(open('$STATE'))['pairingCode'])")
curl -s -X POST https://dsh-pocket.zhongbei.tech/api/v1/pairing/bind \
  -H "Content-Type: application/json" -H "authorization: Bearer $TOKEN" \
  -d "{\"code\":\"$CODE\",\"name\":\"mac-mini-autotest\"}"
echo

echo "== 3. 模拟器 =="
xcrun simctl boot "iPhone 16 Pro" 2>/dev/null || true
open -a Simulator 2>/dev/null || true
echo "（若 App 停在 dev launcher：手动点 localhost 卡片 Connect，或在模拟器上跑）"

echo "== 4. 登录种子（App 未登录时执行一次；坐标见 .maestro/ 说明）=="
cat > /tmp/seed-login.yaml <<'YAML'
appId: top.rwecho.dshcompanion
name: seed-login
---
- tapOn:
    point: "50%, 28%"
- inputText: "autotest-ui@dsh-pocket.dev"
- tapOn:
    point: "50%, 35%"
- inputText: "AutoTest#2026dsh"
- tapOn:
    point: "90%, 4%"
- runScript:
    file: sleep.js
    env:
      sleepMs: "4000"
YAML
echo "（登录变体坐标随版本可能漂移：先截图校准再执行）"
echo "maestro test /tmp/seed-login.yaml  # 如需"

echo "== 完成。跑主流程：maestro test .maestro/artifacts-preview.yaml =="
