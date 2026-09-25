#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

API=http://localhost:8000
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

. scripts/smoke_checks.sh

echo "SMOKE PASSED"
