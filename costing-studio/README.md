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
Web app (optional): `cd apps/web && npm i && npm run dev`, then set a dev JWT in
localStorage under `token`.

## Layout
- `packages/costing` — pure costing engine (money, FX, incoterms, thresholds, serialize)
- `packages/ml` — features, LightGBM quantile models, guard, walk-forward backtest, promotion
- `apps/api` — FastAPI, Alembic, RLS, import pipeline, RQ jobs, scheduler
- `apps/web` — React + Vite + Tailwind (RTL/LTR)
- `sample_data/tuna_25rows.csv` — smoke-test import (24 clean + 1 flagged)

See `CLAUDE.md` for invariants and `ASSEMBLY_NOTES.md` for what was verified and what wasn't.
