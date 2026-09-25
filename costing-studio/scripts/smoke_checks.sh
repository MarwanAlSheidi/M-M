# Shared smoke checks. Sourced by smoke.sh (Docker) and smoke_local.sh after the stack is up,
# migrated and seeded. Expects: API, AUTH (admin bearer header), fail(), psqlq().
POSITIONS='["attractive","too_high","too_low","not_viable"]'
SEEDED=33333333-3333-3333-3333-333333333333

echo "==> login"
LOGIN=$(curl -sf -X POST "$API/api/v1/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"ops@example.om","password":"'"${SEED_ADMIN_PASSWORD:-dev-password}"'"}') || fail "login"
[ -n "$(echo "$LOGIN" | jq -r '.access_token // empty')" ] || fail "login returned no token"
curl -sf "$API/api/v1/auth/me" -H "Authorization: Bearer $(echo "$LOGIN" | jq -r .access_token)" >/dev/null || fail "/auth/me"

echo "==> seeded product envelope (tripwire 1868 / 2198 / 2669 / 3396)"
ENV=$(curl -sf -X POST "$API/api/v1/envelope" -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"product_id\":\"$SEEDED\"}") || fail "seeded envelope"
echo "$ENV" | jq -c '{unit_cost_minor, floor_minor, target_minor, ceiling_minor, currency, unit}'
echo "$ENV" | jq -e '[.unit_cost_minor, .floor_minor, .target_minor, .ceiling_minor] == [1868, 2198, 2669, 3396]' \
  >/dev/null || fail "seeded envelope != tripwire"

echo "==> create product"
NAME="smoke-widget-$(date +%s)"
PROD=$(curl -sf -X POST "$API/api/v1/products" -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"name\":\"$NAME\",\"category\":\"smoke\",\"base_unit\":\"unit\",\"attributes\":{\"note\":\"smoke\"}}") \
  || fail "create product"
PID=$(echo "$PROD" | jq -r .id)
[ -n "$PID" ] && [ "$PID" != "null" ] || fail "no product id: $PROD"

echo "==> cost elements + margin config"
for el in '{"name":"steel","unit":"kg","rate":"0.800","currency":"OMR","qty_per_unit":"1.5","valid_from":"2024-01-01"}' \
          '{"name":"machining","unit":"unit","rate":"0.450","currency":"OMR","valid_from":"2024-01-01"}' \
          '{"name":"import freight","unit":"unit","rate":"0.50","currency":"USD","valid_from":"2024-01-01"}'; do
  curl -sf -X POST "$API/api/v1/products/$PID/cost-elements" -H "$AUTH" -H "Content-Type: application/json" \
    -d "$el" >/dev/null || fail "cost element $el"
done
curl -sf -X POST "$API/api/v1/products/$PID/margin-config" -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"min_pct":"0.15","target_pct":"0.30","max_pct":"0.45","valid_from":"2024-01-01"}' >/dev/null \
  || fail "margin config"

echo "==> envelope"
ENV=$(curl -sf -X POST "$API/api/v1/envelope" -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"product_id\":\"$PID\"}") || fail "envelope"
echo "$ENV" | jq -c '{unit_cost_minor, floor_minor, target_minor, ceiling_minor, market}'
echo "$ENV" | jq -e '.floor_minor < .target_minor and .target_minor < .ceiling_minor' >/dev/null \
  || fail "expected floor < target < ceiling"

echo "==> market ingest via CSV"
CSVF=$(mktemp)
python3 - "$CSVF" <<'PY'
import sys
from datetime import date, timedelta
t = date.today()
with open(sys.argv[1], "w") as f:
    f.write("observed_at,price,currency,unit\n")
    for d, p in ((1, "2.400"), (2, "2.380"), (5, "2.350")):
        f.write(f"{t - timedelta(days=d)},{p},OMR,unit\n")
PY
ING=$(curl -sf -X POST "$API/api/v1/market-prices/ingest-csv" -H "$AUTH" -F "product_id=$PID" \
  -F "source=smoke-survey" -F "file=@$CSVF;type=text/csv") || fail "csv ingest"
rm -f "$CSVF"
echo "ingest: $ING"
[ "$(echo "$ING" | jq -r .rows)" = "3" ] || fail "expected 3 market rows ingested"

ENV=$(curl -sf -X POST "$API/api/v1/envelope" -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"product_id\":\"$PID\"}") || fail "envelope with market"
echo "$ENV" | jq -c '.market'
echo "$ENV" | jq -e --argjson p "$POSITIONS" '.market.position as $x | $p | index($x) != null' >/dev/null \
  || fail "position not one of $POSITIONS"
LATEST=$(curl -sf "$API/api/v1/envelope/$PID" -H "$AUTH") || fail "latest snapshot"
[ "$(echo "$LATEST" | jq -r .snapshot_id)" = "$(echo "$ENV" | jq -r .snapshot_id)" ] || fail "latest snapshot mismatch"
curl -sf "$API/api/v1/predict?product_id=$PID" -H "$AUTH" | jq -e '.available == false' >/dev/null || fail "predict"

echo "==> jobs"
for job in market_refresh envelope_recompute retrain; do
  curl -sf -X POST "$API/api/v1/admin/jobs/$job/run" -H "$AUTH" | jq -c . || fail "enqueue $job"
done
for i in $(seq 1 30); do
  [ "$(psqlq "SELECT count(*) FROM job_runs WHERE status = 'running'")" = "0" ] && \
  [ "$(psqlq "SELECT count(DISTINCT job_name) FROM job_runs")" -ge 3 ] && break
  sleep 2
done
psqlq "SELECT job_name || ' | ' || status || ' | ' || coalesce(rows_affected::text, '') || ' | ' ||
              coalesce(reason, '') || ' | ' || coalesce(error, '')
       FROM job_runs ORDER BY started_at DESC LIMIT 15"
[ "$(psqlq "SELECT count(*) FROM job_runs WHERE status = 'running'")" = "0" ] || fail "jobs still running"
[ "$(psqlq "SELECT count(*) FROM job_runs WHERE status = 'failed'")" = "0" ] || fail "a job failed"
[ "$(psqlq "SELECT status FROM job_runs WHERE job_name='envelope_recompute' ORDER BY started_at DESC LIMIT 1")" \
  = "success" ] || fail "envelope_recompute did not succeed"
[ "$(psqlq "SELECT count(*) FROM pricing_snapshots WHERE product_id = '$PID' AND computed_by = 'envelope_recompute'")" \
  -ge 1 ] || fail "envelope_recompute stored no snapshot"
psqlq "SELECT status FROM job_runs WHERE job_name='retrain' ORDER BY started_at DESC LIMIT 1" \
  | grep -qx skipped || fail "retrain should be skipped (not enough history)"

echo "==> simulate (canned tuna, read-only)"
LOADER_DB=${DATABASE_URL:-postgresql+psycopg://costing_app:${APP_PW}@localhost:5432/costing}
TUNA_CSV=$(mktemp --suffix=.csv)
# same channel prices as sample_data, re-dated relative to today so they stay inside the 30-day window
python3 - sample_data/canned_tuna_market.csv "$TUNA_CSV" <<'PY'
import csv, sys
from datetime import date, timedelta
rows = list(csv.DictReader(open(sys.argv[1])))
last = max(date.fromisoformat(r["observed_at"]) for r in rows)
shift = (date.today() - timedelta(days=1)) - last
with open(sys.argv[2], "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=rows[0].keys()); w.writeheader()
    for r in rows:
        w.writerow({**r, "observed_at": str(date.fromisoformat(r["observed_at"]) + shift)})
PY
DATABASE_URL=$LOADER_DB ${PY:-uv run} python scripts/load_product.py sample_data/canned_tuna_product.json >/dev/null \
  || fail "load canned tuna"
DATABASE_URL=$LOADER_DB ${PY:-uv run} python scripts/load_market_prices.py "Canned Light Tuna in Sunflower Oil" \
  "$TUNA_CSV" >/dev/null || fail "load canned tuna market"
rm -f "$TUNA_CSV"
TUNA_ID=$(curl -sf "$API/api/v1/products" -H "$AUTH" | jq -r '.items[] | select(.name=="Canned Light Tuna in Sunflower Oil") | .id')
SNAPS_BEFORE=$(psqlq "SELECT count(*) FROM pricing_snapshots")
SIM=$(curl -s -w '\n%{http_code}' -X POST "$API/api/v1/simulate" -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"product_id\":\"$TUNA_ID\",\"skipjack_usd\":\"1.40\",\"margin_floor_pct\":\"15\",\"margin_target_pct\":\"30\"}")    # no exclude list: page defaults (retail + import excluded by type)
[ "$(echo "$SIM" | tail -1)" = "200" ] || fail "simulate returned $(echo "$SIM" | tail -1): $(echo "$SIM" | head -1)"
echo "$SIM" | head -1 | jq -c '{recommendation, floor: .envelope.floor_minor, channels: [.channels[] | {channel, channel_type, headroom_pct, verdict, excluded}]}'
[ "$(echo "$SIM" | head -1 | jq -r .recommendation)" = "uae-export" ] || fail "simulate recommendation != uae-export"
[ "$(psqlq "SELECT count(*) FROM pricing_snapshots")" = "$SNAPS_BEFORE" ] || fail "simulate wrote a snapshot"
PDF_OUT=$(mktemp --suffix=.pdf)
PDF_CODE=$(curl -s -o "$PDF_OUT" -w '%{http_code}' -X POST "$API/api/v1/simulate/export.pdf" -H "$AUTH" \
  -H "Content-Type: application/json" -d "{\"product_id\":\"$TUNA_ID\"}")
[ "$PDF_CODE" = "200" ] && [ -s "$PDF_OUT" ] || fail "simulate/export.pdf returned $PDF_CODE ($(wc -c <"$PDF_OUT") bytes)"
echo "export.pdf: $(wc -c <"$PDF_OUT") bytes"; rm -f "$PDF_OUT"
