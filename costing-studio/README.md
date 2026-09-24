# Costing Studio

ML-assisted landed-cost and pricing studio. Tuna is the first product; GCC-focused, Arabic/English.

## Quick start (Claude Code)
Open this folder in Claude Code and paste `PROMPT.md`.

## Manual
```bash
cp .env.example .env
make unit          # DB-free tests on the host (uv)
uv lock
make smoke         # full stack in Docker: migrate, seed, tests, import, quote, jobs
```
No Docker? `make smoke-local` runs the same checks against a local Postgres 16 + Redis.

Web app: `cd apps/web && npm i && npm run dev`, open http://localhost:5173 and sign in as
`ops@example.om` / `dev-password` (the seeded dev admin; override with `SEED_ADMIN_PASSWORD`
before `make seed`). Set a real user's password with
`cd apps/api/scripts && python set_password.py <email>` (as the migrator).

## API
- `POST /api/v1/auth/login` → JWT (`JWT_TTL_MINUTES`, default 720); `GET /api/v1/auth/me`
- `POST /api/v1/quote` — landed cost, thresholds, ML anomaly check / guarded ML fill
- `GET /api/v1/deals` (`q`, `golden`, `limit`), `GET /api/v1/deals/{id}`,
  `GET /api/v1/deals/{id}/thresholds?target_margin=0.20` (recomputed from `inputs_snapshot`)
- `GET /api/v1/predict?product_sku=…&deal_date=…&currency=USD` — champion P10/P50/P90 forward
  price + SHAP top 5; advisory only, never a landed cost
- imports, admin jobs, products, parties, market prices

## Layout
- `packages/costing` — pure costing engine (money, FX, incoterms, thresholds, serialize)
- `packages/ml` — features, LightGBM quantile models, guard, walk-forward backtest, promotion
- `apps/api` — FastAPI, Alembic, RLS, import pipeline, RQ jobs, scheduler
- `apps/web` — React + Vite + Tailwind (RTL/LTR)
- `sample_data/tuna_25rows.csv` — smoke-test import (24 clean + 1 flagged)

See `CLAUDE.md` for invariants and `ASSEMBLY_NOTES.md` for what was verified and what wasn't.
