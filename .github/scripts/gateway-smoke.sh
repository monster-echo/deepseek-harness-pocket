#!/usr/bin/env bash
# Gateway 发布冒烟：对着**真实运行**的 gateway 跑一遍关键链路。
#
# 用途：发布流水线在推镜像前用它验证镜像本体（真 Postgres + 真迁移 + 真接口），
# 本地排查同样可用。脚本只依赖 curl + python3。
#
# 覆盖：
#   1. /api/v1/health 就绪
#   2. 扫码登录全链路：start → approve（手机侧）→ poll 取回账号与设备凭据
#      → 设备凭据能调 /api/v1/workers → revoke 后解绑且凭据失效（401）
#   3. 未注册电脑 approve 被拒（422）
#   4. 伪造设备凭据被拒（401）
#
# 用法：
#   .github/scripts/gateway-smoke.sh <base-url> [--seed "<psql 命令前缀>"]
#
#   --seed 传入 psql 命令前缀（如 "docker run --rm --network host -e PGPASSWORD=pw postgres:16 psql"
#   或 "/opt/homebrew/opt/postgresql@16/bin/psql"），脚本会用它插入一台「已注册的电脑」，
#   因为 approve 需要 gateway 侧存在该 hostKey（真实场景由 Worker 连上来注册）。
#   不传 --seed 时跳过需要已注册电脑的步骤（其余仍会执行）。
#
# 环境变量（配合 --seed）：
#   SMOKE_DB_HOST（默认 127.0.0.1）SMOKE_DB_PORT（5432）SMOKE_DB_USER（dsh）
#   SMOKE_DB_NAME（dsh_gateway）SMOKE_DB_PASSWORD（dsh）
set -euo pipefail

BASE="${1:-}"
if [[ -z "$BASE" ]]; then
  echo "用法: $0 <base-url> [--seed \"<psql 命令前缀>\"]" >&2
  exit 2
fi
shift || true

SEED=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --seed) SEED="${2:-}"; shift 2 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

DB_HOST="${SMOKE_DB_HOST:-127.0.0.1}"
DB_PORT="${SMOKE_DB_PORT:-5432}"
DB_USER="${SMOKE_DB_USER:-dsh}"
DB_NAME="${SMOKE_DB_NAME:-dsh_gateway}"
DB_PASSWORD="${SMOKE_DB_PASSWORD:-dsh}"

HOST_KEY="hk_smoke_$$"
WORKER_ID="w_smoke_$$"
USER_ID="user_smoke_$$"
PASS=0

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok() { printf '  ✓ %s\n' "$*"; PASS=$((PASS + 1)); }
die() { printf '   %s\n' "$*" >&2; exit 1; }

# json <python 表达式>：从 stdin 读 JSON，按表达式取值
jget() { python3 -c "import json,sys;d=json.load(sys.stdin);print($1)"; }

# post <path> [json-body] [bearer]
post() {
  local path="$1" body="${2:-}" bearer="${3:-}"
  local args=(-s -m 15 -X POST "$BASE$path" -H 'content-type: application/json')
  [[ -n "$bearer" ]] && args+=(-H "Authorization: Bearer $bearer")
  [[ -n "$body" ]] && args+=(-d "$body")
  curl "${args[@]}"
}

# status_of <method> <path> [bearer]
status_of() {
  local method="$1" path="$2" bearer="${3:-}"
  local args=(-s -o /dev/null -w '%{http_code}' -m 15 -X "$method" "$BASE$path")
  [[ -n "$bearer" ]] && args+=(-H "Authorization: Bearer $bearer")
  curl "${args[@]}"
}

psql_run() {
  PGPASSWORD="$DB_PASSWORD" $SEED -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "$1"
}

# 冒烟自己造的数据自己收尾（CI 的 PG 是一次性的，本地跑也别留垃圾）
cleanup() {
  [[ -n "$SEED" ]] || return 0
  psql_run "delete from pairings where worker_id = '$WORKER_ID';
            delete from usage_events where worker_id = '$WORKER_ID';
            delete from workers where id = '$WORKER_ID';
            delete from device_links where host_key in ('$HOST_KEY','hk_smoke_never');" >/dev/null 2>&1 || true
}
trap cleanup EXIT

say "1/4 健康检查 $BASE/api/v1/health"
HEALTH="$(curl -s -m 15 "$BASE/api/v1/health")"
[[ "$(printf '%s' "$HEALTH" | jget "d.get('ok')")" == "True" ]] || die "health 不 ok：$HEALTH"
ok "health ok（$(printf '%s' "$HEALTH" | jget "d.get('service')")）"

say "2/4 扫码登录全链路"
START="$(post /api/v1/devices/link/start "{\"hostKey\":\"$HOST_KEY\",\"name\":\"CI 冒烟机\",\"platform\":\"linux\"}")"
CODE="$(printf '%s' "$START" | jget "d['code']")"
SECRET="$(printf '%s' "$START" | jget "d['secret']")"
[[ ${#CODE} -eq 8 ]] || die "链接码长度异常：$START"
[[ ${#SECRET} -eq 64 ]] || die "secret 长度异常：$START"
ok "start 返回 8 位链接码 + 64 位 secret"

PENDING="$(post /api/v1/devices/link/poll "{\"code\":\"$CODE\",\"secret\":\"$SECRET\"}")"
[[ "$(printf '%s' "$PENDING" | jget "d.get('status')")" == "pending" ]] || die "未确认时应为 pending：$PENDING"
ok "未确认时 poll = pending"

WRONG="$(status_of POST /api/v1/devices/link/approve "dev:$USER_ID")"
# 无 body 时先看 400/422 都算「没有链接码就被拒」
[[ "$WRONG" == "400" || "$WRONG" == "422" ]] || die "缺链接码应被拒，实得 HTTP $WRONG"
ok "缺链接码 approve 被拒（HTTP $WRONG）"

if [[ -n "$SEED" ]]; then
  # 真实场景由 Worker 连上 gateway 注册；冒烟里直接落一行，等价于「这台电脑已在线过」。
  # 名字故意与 start 时自称的不同：preview 应以服务端已注册名为准（防伪造二维码）。
  psql_run "insert into workers (id, host_key, name, fingerprint, dsh_version, pairing_code, last_seen_at)
            values ('$WORKER_ID', '$HOST_KEY', 'CI 冒烟机·已注册', 'fp_smoke', '0', '', now())
            on conflict (host_key) do update set name = excluded.name, last_seen_at = now();" >/dev/null
  ok "已在 gateway 侧注册电脑（$HOST_KEY）"

  # preview：确认弹窗的设备信息必须来自服务端（已注册 Worker 名优先）
  PREVIEW="$(post /api/v1/devices/link/preview "{\"code\":\"$CODE\"}" "dev:$USER_ID")"
  [[ "$(printf '%s' "$PREVIEW" | jget "d.get('ok')")" == "True" ]] || die "preview 失败：$PREVIEW"
  [[ "$(printf '%s' "$PREVIEW" | jget "d.get('name')")" == "CI 冒烟机·已注册" ]] || die "preview 应返回已注册 Worker 名：$PREVIEW"
  [[ "$(printf '%s' "$PREVIEW" | jget "d.get('workerKnown')")" == "True" ]] || die "preview 的 workerKnown 应为 true：$PREVIEW"
  ok "preview 返回权威设备信息（$(printf '%s' "$PREVIEW" | jget "d.get('name')")）"

  APPROVE="$(post /api/v1/devices/link/approve "{\"code\":\"$CODE\",\"email\":\"smoke@example.com\"}" "dev:$USER_ID")"
  [[ "$(printf '%s' "$APPROVE" | jget "d.get('ok')")" == "True" ]] || die "approve 失败：$APPROVE"
  ok "手机 approve 成功（workerId=$(printf '%s' "$APPROVE" | jget "d.get('workerId')")）"

  APPROVED="$(post /api/v1/devices/link/poll "{\"code\":\"$CODE\",\"secret\":\"$SECRET\"}")"
  [[ "$(printf '%s' "$APPROVED" | jget "d.get('status')")" == "approved" ]] || die "确认后应为 approved：$APPROVED"
  CRED="$(printf '%s' "$APPROVED" | jget "d['credential']")"
  [[ "$(printf '%s' "$APPROVED" | jget "d['account']['email']")" == "smoke@example.com" ]] || die "账号身份不对：$APPROVED"
  ok "poll 取回账号身份与设备凭据"

  [[ "$(status_of GET /api/v1/workers "$CRED")" == "200" ]] || die "设备凭据应能调 /workers"
  ok "设备凭据可调 /api/v1/workers"

  FAKE="dshl_${CODE}.$(printf 'a%.0s' {1..64})"
  [[ "$(status_of GET /api/v1/workers "$FAKE")" == "401" ]] || die "伪造凭据应 401"
  ok "伪造设备凭据被拒（401）"

  [[ "$(post /api/v1/devices/link/revoke "{\"code\":\"$CODE\",\"secret\":\"$SECRET\"}" | jget "d.get('ok')")" == "True" ]] || die "revoke 失败"
  [[ "$(status_of GET /api/v1/workers "$CRED")" == "401" ]] || die "吊销后凭据应失效"
  ok "revoke 解绑并作废凭据（401）"

  say "3/4 未注册电脑被拒（422）"
  START2="$(post /api/v1/devices/link/start '{"hostKey":"hk_smoke_never","name":"ghost"}')"
  CODE2="$(printf '%s' "$START2" | jget "d['code']")"
  R2="$(curl -s -m 15 -o /tmp/smoke-approve2.json -w '%{http_code}' -X POST "$BASE/api/v1/devices/link/approve" \
    -H 'content-type: application/json' -H "Authorization: Bearer dev:$USER_ID" -d "{\"code\":\"$CODE2\"}")"
  [[ "$R2" == "422" ]] || die "未注册电脑应 422，实得 $R2：$(cat /tmp/smoke-approve2.json)"
  ok "未注册电脑 approve = 422（$(cat /tmp/smoke-approve2.json)）"
else
  say "3/4 跳过（未提供 --seed，无法造「已注册电脑」）"
fi

say "4/4 结果"
printf '  \033[32m冒烟通过：%d 项断言\033[0m\n' "$PASS"