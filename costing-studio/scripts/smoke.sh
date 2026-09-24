#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

API=http://localhost:8000
CSV=sample_data/tuna_25rows.csv
fail() { echo "SMOKE FAILED: $*"; exit 1; }
command -v jq >/dev/null || fail "jq required"
psqlq() { docker compose exec -T db psql -U "$POSTGRES_SUPERUSER" -d costing -Atc "$1"; }

echo "==> fresh stack"
docker compose down -v
docker compose up -d --build
for i in $(seq 1 40); do curl -sf "$API/health" >/dev/null 2>&1 && break; sleep 2; done

echo "==> migrate + seed"
make migrate
make seed

echo "==> tests"
make test

echo "==> auth token"
TOKEN=$(docker compose exec -T api python -c "
import jwt
from costing_api.settings import settings
print(jwt.encode({'sub':'22222222-2222-2222-2222-222222222222',
                  'tenant_id':'11111111-1111-1111-1111-111111111111',
                  'role':'admin','locale':'en'}, settings.jwt_secret, algorithm='HS256'))
" | tr -d '\r')
AUTH="Authorization: Bearer $TOKEN"

echo "==> login"
LOGIN=$(curl -sf -X POST "$API/api/v1/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"ops@example.om","password":"'"${SEED_ADMIN_PASSWORD:-dev-password}"'"}') || fail "login"
[ -n "$(echo "$LOGIN" | jq -r '.access_token // empty')" ] || fail "login returned no token"
curl -sf "$API/api/v1/auth/me" -H "Authorization: Bearer $(echo "$LOGIN" | jq -r .access_token)" >/dev/null || fail "/auth/me"

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
make golden
docker compose exec -T api bash -lc "cd /app && pytest packages/costing/tests/test_golden_fixtures.py -q"
[ "$(ls packages/costing/tests/golden/*.json | wc -l | tr -d ' ')" = "20" ] || fail "expected 20 fixtures"

echo "==> quote"
QUOTE=$(curl -sf -X POST "$API/api/v1/quote" -H "$AUTH" -H "Content-Type: application/json" -d '{
  "product_sku":"TUNA-YF-WR","quantity":"18000","base_unit":"kg","currency":"USD","incoterm":"CFR",
  "purchase_unit_price_major":"3.20","target_margin":"0.20","market_sell_per_sellable_major":"3.40"}') || fail "quote"
echo "$QUOTE" | jq '{landed_cost, sell_above_threshold, buy_below_threshold, ml_skipped_reason}'
[ -n "$(echo "$QUOTE" | jq -r '.landed_cost.amount_major // empty')" ] || fail "no landed_cost"
[ "$(echo "$QUOTE" | jq -r .landed_cost.amount_minor)" = "26720146" ] || fail "landed_cost != tripwire 26720146"

echo "==> deals + thresholds + predict"
DEAL=$(curl -sf "$API/api/v1/deals?golden=true" -H "$AUTH" | jq -r '.items | length') || fail "deals"
[ "$DEAL" = "20" ] || fail "expected 20 golden deals, got $DEAL"
DEAL_ID=$(curl -sf "$API/api/v1/deals?limit=1" -H "$AUTH" | jq -r '.items[0].id')
curl -sf "$API/api/v1/deals/$DEAL_ID" -H "$AUTH" | jq -e '.lines | length == 11' >/dev/null || fail "deal detail"
curl -sf "$API/api/v1/deals/$DEAL_ID/thresholds" -H "$AUTH" | jq -e '.curve | length == 21' >/dev/null || fail "thresholds"
curl -sf "$API/api/v1/predict?product_sku=TUNA-YF-WR" -H "$AUTH" | jq -e '.available == false' >/dev/null || fail "predict"

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
