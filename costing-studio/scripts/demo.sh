#!/usr/bin/env bash
# One-command demo: bash scripts/demo.sh        (stop with: bash scripts/demo.sh stop)
#
# Assumes Postgres (with a superuser from .env) and Redis are already running on this machine; it
# does not install them. Safe to re-run: migrations, roles, grants, seeds and the canned tuna product
# load are idempotent (the loader no-ops on identical JSON). Starts the API (port 8000) and the web app
# (port 5173) in the background and prints the pages to open. Touches no analysis logic.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
DEMO=$ROOT/.demo
PRODUCT="Canned Light Tuna in Sunflower Oil"
WEB_HOST=${DEMO_HOST:-127.0.0.1}          # DEMO_HOST=0.0.0.0 to let another machine open the pages
mkdir -p "$DEMO"
say() { printf '\n==> %s\n' "$*"; }
die() { printf '\ndemo: %s\n' "$*" >&2; exit 1; }

stop() {
  for f in "$DEMO"/*.pid; do
    [ -e "$f" ] || continue
    pid=$(cat "$f"); kill "$pid" 2>/dev/null && echo "stopped $(basename "$f" .pid) (pid $pid)" || true
    rm -f "$f"
  done
}
if [ "${1:-}" = "stop" ]; then stop; exit 0; fi

[ -f .env ] || cp .env.example .env
set -a; . ./.env; set +a
export PGHOST=${PGHOST:-localhost} PGPORT=${PGPORT:-5432} PGPASSWORD=$POSTGRES_SUPERUSER_PW
for tool in uv npm psql redis-cli curl; do command -v "$tool" >/dev/null || die "$tool is required"; done
pg_isready -h "$PGHOST" -p "$PGPORT" -q || die "Postgres is not reachable on $PGHOST:$PGPORT (start it first)"
redis-cli -u "${REDIS_URL:-redis://localhost:6379/0}" ping >/dev/null 2>&1 || die "Redis is not reachable (start it first)"
SUPER=(psql -h "$PGHOST" -p "$PGPORT" -U "$POSTGRES_SUPERUSER" -v ON_ERROR_STOP=1 -q)

export DATABASE_URL=postgresql+psycopg://costing_app:${APP_PW}@$PGHOST:$PGPORT/costing
export WORKER_DATABASE_URL=postgresql+psycopg://costing_worker:${WORKER_PW}@$PGHOST:$PGPORT/costing
export MIGRATOR_DATABASE_URL=postgresql+psycopg://costing_migrator:${MIG_PW}@$PGHOST:$PGPORT/costing
export REDIS_URL=${REDIS_URL:-redis://localhost:6379/0}
export UPLOAD_ROOT=$DEMO/uploads MODEL_STORE_ROOT=$DEMO/models ENV=dev
mkdir -p "$UPLOAD_ROOT" "$MODEL_STORE_ROOT"

stop >/dev/null                                                   # a previous demo run, if any

say "Python and web dependencies"
uv sync --all-packages --extra dev -q
[ -d apps/web/node_modules ] || (cd apps/web && npm install --no-audit --no-fund --silent)

say "Database: roles, migrations, grants, seed"
[ "$("${SUPER[@]}" -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = 'costing'")" = "1" ] \
  || "${SUPER[@]}" -d postgres -c "CREATE DATABASE costing"
"${SUPER[@]}" -d costing -v mig_pw="$MIG_PW" -v app_pw="$APP_PW" -v worker_pw="$WORKER_PW" \
  < apps/api/scripts/create_roles.sql
(cd apps/api && uv run --no-sync alembic upgrade head)
"${SUPER[@]}" -d costing < apps/api/scripts/grant_app_privileges.sql
(cd apps/api/scripts && uv run --no-sync python seed_hijri.py && uv run --no-sync python seed_example_tenant.py)

say "Canned tuna product and market channels"
# idempotent: creates the product, updates attributes / versions that differ from the JSON, or no-ops
uv run --no-sync python scripts/load_product.py sample_data/canned_tuna_product.json | sed '/^$/,$d'
# Same channel prices as sample_data/canned_tuna_market.csv, re-dated so the latest row is yesterday:
# prices only count for 30 days, and the file's own dates are fixed.
MARKET=$DEMO/canned_tuna_market.csv
uv run --no-sync python - sample_data/canned_tuna_market.csv "$MARKET" <<'PY'
import csv, sys
from datetime import date, timedelta
rows = list(csv.DictReader(open(sys.argv[1])))
shift = (date.today() - timedelta(days=1)) - max(date.fromisoformat(r["observed_at"]) for r in rows)
with open(sys.argv[2], "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=rows[0].keys()); w.writeheader()
    w.writerows({**r, "observed_at": str(date.fromisoformat(r["observed_at"]) + shift)} for r in rows)
PY
uv run --no-sync python scripts/load_market_prices.py "$PRODUCT" "$MARKET" | sed -n 1p
PID_TUNA=$("${SUPER[@]}" -d costing -Atc "SELECT id FROM products WHERE name = '$PRODUCT'")

say "Starting the API and the web app"
# exec the real server binaries so each pid file holds the server itself (stop kills the right process),
# and redirect the whole subshell so nothing keeps this script's output open.
(cd apps/api && exec nohup "$ROOT/.venv/bin/uvicorn" costing_api.main:app --host 127.0.0.1 --port 8000) \
  </dev/null >"$DEMO/api.log" 2>&1 &
echo $! >"$DEMO/api.pid"
(cd apps/web && exec nohup ./node_modules/.bin/vite --host "$WEB_HOST" --port 5173 --strictPort) \
  </dev/null >"$DEMO/web.log" 2>&1 &
echo $! >"$DEMO/web.pid"

for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:8000/api/v1/health >/dev/null 2>&1 && break; sleep 1
done
curl -sf http://127.0.0.1:8000/api/v1/health || die "API did not come up; see $DEMO/api.log"
echo
for _ in $(seq 1 60); do curl -sf http://127.0.0.1:5173/ >/dev/null 2>&1 && break; sleep 1; done
curl -sf http://127.0.0.1:5173/ >/dev/null || die "web app did not come up; see $DEMO/web.log"

HOST_SHOWN=$([ "$WEB_HOST" = "0.0.0.0" ] && hostname -I 2>/dev/null | awk '{print $1}' || echo localhost)
cat <<EOF

Costing Studio demo is running.

  Simulate:        http://${HOST_SHOWN:-localhost}:5173/simulate?product=$PID_TUNA
  Product detail:  http://${HOST_SHOWN:-localhost}:5173/products/$PID_TUNA
  Sign in with:    ops@example.om / ${SEED_ADMIN_PASSWORD:-dev-password}

  Logs: $DEMO/api.log, $DEMO/web.log      Stop: bash scripts/demo.sh stop
EOF
