include .env
export

DC = docker compose
PSQL = $(DC) exec -T db psql -U $(POSTGRES_SUPERUSER) -d costing

.PHONY: up down logs roles migrate seed test golden smoke unit

unit:            ## DB-free tests on the host (run before Docker)
	uv sync --all-packages --extra dev
	uv run pytest packages/costing/tests packages/ml/tests -q

up:
	$(DC) up -d --build

down:
	$(DC) down -v

logs:
	$(DC) logs -f

roles:
	$(PSQL) -v mig_pw="$(MIG_PW)" -v app_pw="$(APP_PW)" -v worker_pw="$(WORKER_PW)" \
	  < apps/api/scripts/create_roles.sql

migrate: roles
	$(DC) exec -T api bash -lc "cd /app/apps/api && alembic upgrade head"
	$(PSQL) < apps/api/scripts/grant_app_privileges.sql

seed:
	$(DC) exec -T api bash -lc "cd /app/apps/api/scripts && python seed_hijri.py && python seed_oman_tuna.py"

test:
	$(DC) exec -T api bash -lc "cd /app && pytest packages/costing/tests packages/ml/tests apps/api/tests -q"

golden:          ## export golden fixtures and copy them into the repo (replaces old ones)
	$(DC) exec -T api bash -lc "rm -f /app/packages/costing/tests/golden/*.json && cd /app/apps/api/scripts && python export_golden.py"
	rm -f packages/costing/tests/golden/*.json
	$(DC) cp api:/app/packages/costing/tests/golden/. packages/costing/tests/golden/

smoke:
	bash scripts/smoke.sh
