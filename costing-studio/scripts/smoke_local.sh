#!/usr/bin/env bash
# Same checks as scripts/smoke.sh, but without Docker: runs against a Postgres 16
# and Redis already listening on localhost (5432 / 6379), with the uv venv on the host.
# The `costing` database must exist and POSTGRES_SUPERUSER must be able to log in.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
set -a; . ./.env; set +a

PGHOST=${PGHOST:-localhost}
DATA=${SMOKE_DATA:-$ROOT/.smoke}
export PGPASSWORD=$POSTGRES_SUPERUSER_PW
export DATABASE_URL=postgresql+psycopg://costing_app:${APP_PW}@$PGHOST:5432/costing
export APP_DATABASE_URL=$DATABASE_URL
export WORKER_DATABASE_URL=postgresql+psycopg://costing_worker:${WORKER_PW}@$PGHOST:5432/costing
export MIGRATOR_DATABASE_URL=postgresql+psycopg://costing_migrator:${MIG_PW}@$PGHOST:5432/costing
export ADMIN_DATABASE_URL=postgresql+psycopg://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PW}@$PGHOST:5432/costing
export REDIS_URL=${REDIS_URL:-redis://localhost:6379/0}
export ENV=dev UPLOAD_ROOT=$DATA/uploads MODEL_STORE_ROOT=$DATA/models
export GOLDEN_DIR=$ROOT/packages/costing/tests/golden

API=http://localhost:8000
CSV=sample_data/tuna_25rows.csv
PY="uv run --no-sync"
fail() { echo "SMOKE FAILED: $*"; exit 1; }
command -v jq >/dev/null || fail "jq required"
psqlq() { psql -h "$PGHOST" -U "$POSTGRES_SUPERUSER" -d costing -Atc "$1"; }
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT

echo "==> fresh database"
psql -h "$PGHOST" -U "$POSTGRES_SUPERUSER" -d postgres -qc "DROP DATABASE IF EXISTS costing WITH (FORCE)"
psql -h "$PGHOST" -U "$POSTGRES_SUPERUSER" -d postgres -qc "CREATE DATABASE costing"
redis-cli -u "$REDIS_URL" FLUSHDB >/dev/null
rm -rf "$DATA"; mkdir -p "$DATA/uploads" "$DATA/models"
uv sync --all-packages --extra dev -q

echo "==> migrate + seed"
psql -h "$PGHOST" -U "$POSTGRES_SUPERUSER" -d costing -q -v mig_pw="$MIG_PW" -v app_pw="$APP_PW" \
  -v worker_pw="$WORKER_PW" < apps/api/scripts/create_roles.sql
(cd apps/api && $PY alembic upgrade head)
psql -h "$PGHOST" -U "$POSTGRES_SUPERUSER" -d costing -q < apps/api/scripts/grant_app_privileges.sql
(cd apps/api/scripts && $PY python seed_hijri.py && $PY python seed_oman_tuna.py)

echo "==> tests"
$PY pytest packages/costing/tests packages/ml/tests apps/api/tests -q

echo "==> api + worker"
(cd apps/api && exec $PY uvicorn costing_api.main:app --port 8000 >"$DATA/api.log" 2>&1) & PIDS+=($!)
(cd apps/api && exec $PY python -m costing_api.worker >"$DATA/worker.log" 2>&1) & PIDS+=($!)
for i in $(seq 1 40); do curl -sf "$API/health" >/dev/null 2>&1 && break; sleep 1; done
curl -sf "$API/health" >/dev/null || { cat "$DATA/api.log"; fail "api did not start"; }

echo "==> auth token"
TOKEN=$(cd apps/api && $PY python -c "
import jwt
from costing_api.settings import settings
print(jwt.encode({'sub':'22222222-2222-2222-2222-222222222222',
                  'tenant_id':'11111111-1111-1111-1111-111111111111',
                  'role':'admin','locale':'en'}, settings.jwt_secret, algorithm='HS256'))
")
AUTH="Authorization: Bearer $TOKEN"

echo "==> import 25-row CSV"
RESP=$(curl -sf -X POST "$API/api/v1/imports" -H "$AUTH" -F "kind=deals" -F "file=@$CSV") || fail "upload"
BATCH=$(echo "$RESP" | jq -r .batch_id)
[ "$BATCH" != "null" ] || fail "no batch_id: $RESP"

curl -sf -X POST "$API/api/v1/imports/$BATCH/map" -H "$AUTH" -H "Content-Type: application/json" -d '{
  "column_map": {"sku":"sku","quantity":"quantity","deal_date":"deal_date",
    "purchase_unit_price_major":"unit_price","currency":"currency","origin_country":"origin",
    "dest_country":"destination","incoterm":"incoterm","actual_landed_cost_major":"landed_cost",
    "actual_sell_price_major":"actual_sell"},
  "date_format":"%Y-%m-%d","dayfirst":false,"decimal_sep":"."}' >/dev/null || fail "map"

STAGE=$(curl -sf -X POST "$API/api/v1/imports/$BATCH/stage" -H "$AUTH") || fail "stage"
echo "stage: $STAGE"
[ "$(echo "$STAGE" | jq -r .counts.ok)" = "24" ] || fail "expected ok=24"
[ "$(echo "$STAGE" | jq -r .counts.flagged)" = "1" ] || fail "expected flagged=1"

echo "==> approve rows 0-19 as golden; leave row 22 (flagged) unaccepted"
for i in $(seq 0 19); do
  curl -sf -X PATCH "$API/api/v1/imports/$BATCH/rows/$i" -H "$AUTH" -H "Content-Type: application/json" \
    -d '{"is_golden_approved": true}' >/dev/null || fail "approve row $i"
done
CONFIRM=$(curl -sf -X POST "$API/api/v1/imports/$BATCH/confirm" -H "$AUTH") || fail "confirm"
echo "confirm: $CONFIRM"
[ "$(echo "$CONFIRM" | jq -r .golden_created)" = "20" ] || fail "expected golden_created=20"
[ "$(echo "$CONFIRM" | jq -r .inserted)" = "24" ] || fail "expected inserted=24"

echo "==> export golden + fixture tests"
rm -f "$GOLDEN_DIR"/*.json
(cd apps/api/scripts && $PY python export_golden.py)
$PY pytest packages/costing/tests/test_golden_fixtures.py -q
[ "$(ls "$GOLDEN_DIR"/*.json | wc -l | tr -d ' ')" = "20" ] || fail "expected 20 fixtures"

echo "==> quote"
QUOTE=$(curl -sf -X POST "$API/api/v1/quote" -H "$AUTH" -H "Content-Type: application/json" -d '{
  "product_sku":"TUNA-YF-WR","quantity":"18000","base_unit":"kg","currency":"USD","incoterm":"CFR",
  "purchase_unit_price_major":"3.20","target_margin":"0.20","market_sell_per_sellable_major":"3.40"}') || fail "quote"
echo "$QUOTE" | jq '{landed_cost, sell_above_threshold, buy_below_threshold, ml_skipped_reason}'
[ -n "$(echo "$QUOTE" | jq -r '.landed_cost.amount_major // empty')" ] || fail "no landed_cost"
[ "$(echo "$QUOTE" | jq -r .landed_cost.amount_minor)" = "26720146" ] || fail "landed_cost != tripwire 26720146"

echo "==> jobs"
for job in stats_recompute golden_regression retrain; do
  curl -sf -X POST "$API/api/v1/admin/jobs/$job/run" -H "$AUTH" | jq -c . || fail "enqueue $job"
done
for i in $(seq 1 30); do
  [ "$(psqlq "SELECT count(*) FROM job_runs WHERE status = 'running'")" = "0" ] && \
  [ "$(psqlq "SELECT count(DISTINCT job_name) FROM job_runs")" -ge 3 ] && break
  sleep 2
done
psqlq "SELECT job_name || ' | ' || status || ' | ' || coalesce(reason, '') || ' | ' || coalesce(error, '')
       FROM job_runs ORDER BY started_at DESC LIMIT 15"
[ "$(psqlq "SELECT count(*) FROM job_runs WHERE status = 'running'")" = "0" ] || fail "jobs still running"
[ "$(psqlq "SELECT count(*) FROM job_runs WHERE status = 'failed'")" = "0" ] || fail "a job failed"
psqlq "SELECT status FROM job_runs WHERE job_name='retrain' ORDER BY started_at DESC LIMIT 1" \
  | grep -qx skipped || fail "retrain should be skipped"

echo "SMOKE PASSED"
