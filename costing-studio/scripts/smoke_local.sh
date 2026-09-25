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

API=http://localhost:8000
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
(cd apps/api/scripts && $PY python seed_hijri.py && $PY python seed_example_tenant.py)

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

. scripts/smoke_checks.sh

echo "SMOKE PASSED"
