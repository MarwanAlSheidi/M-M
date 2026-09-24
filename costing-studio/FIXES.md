# Fixes

- apps/api/tests/test_rls_cross_tenant.py: one bind param used as both uuid and text (`:t` and `CAST(:t AS text)`) -> psycopg3 server-side binding fails with "inconsistent types deduced for parameter"; the text uses now get their own param `:tt`.
- Makefile, scripts/smoke_local.sh: added `make smoke-local`, the same checks as `make smoke` but against a local Postgres 16 + Redis (for hosts where Docker images cannot reach apt/PyPI). Not a behaviour change.

## Open [DESIGN] items (not fixed; need a decision)

- [DESIGN] Insurance is never charged by the API. `DealInputs.insurance_rate` defaults to 0 and nothing sets it (no column in `tenant_cost_config`, no field on `QuoteRequest`, not in `build_inputs`). So EXW/FOB/CFR quotes omit insurance: the base case (18,000 kg, CFR, 3.20 USD) quotes landed 26,614,410 via `/quote` vs the 26,720,146 tripwire (insurance 0 vs 97,448, which also shifts duty, capital and overhead). `sample_data/tuna_25rows.csv` was generated the same way, so adding insurance also means regenerating it.
- The Docker build (`make smoke`) could not run in this session: the sandbox blocks `apt-get` inside image builds (403 from deb.debian.org). Not a repo bug; `make smoke-local` runs the identical checks and passes.

## Run results

- `make unit`: 45 passed, 1 skipped (golden fixtures, empty before export). `test_backtest_walk_forward.py` passes on the first LightGBM run.
- `make smoke-local`: SMOKE PASSED. Stage ok=24 flagged=1; confirm inserted=24 golden_created=20; 20 fixtures exported and pass; `/quote` returns landed_cost; stats_recompute and golden_regression success; retrain skipped ("market history 90 days < 180"); no job running or failed.
- `apps/web`: `npm run build` (tsc + vite) passes.
