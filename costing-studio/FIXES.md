# Fixes

- apps/api/tests/test_rls_cross_tenant.py: one bind param used as both uuid and text (`:t` and `CAST(:t AS text)`) -> psycopg3 server-side binding fails with "inconsistent types deduced for parameter"; the text uses now get their own param `:tt`.
- Makefile, scripts/smoke_local.sh: added `make smoke-local`, the same checks as `make smoke` but against a local Postgres 16 + Redis (for hosts where Docker images cannot reach apt/PyPI). Not a behaviour change.

- [DESIGN] Insurance was never charged by the API: nothing set `DealInputs.insurance_rate`, so EXW/FOB/CFR quotes had insurance 0 (base case quoted 26,614,410 vs the 26,720,146 tripwire). Added `tenant_cost_config.insurance_rate` (migration 0003, default 0, 0 <= rate < 1), read it in `tenant_repo`/`build_inputs`, allowed a per-deal `insurance_rate` override on `QuoteRequest` and as an import column, and seeded 0.004. `/quote` now returns exactly the tripwire (landed 26,720,146, sell-above 2,834) and both smoke scripts assert it.
- sample_data/tuna_25rows.csv: regenerated with insurance by the new `scripts/gen_sample_csv.py` (reproduces the old file byte for byte at insurance 0; row 22 keeps its +5% drift). `make unit` now fails if the CSV is stale.

## Additions (requested after the fix loop)

- Login: `POST /api/v1/auth/login` (bcrypt via `auth_lookup_user`, same 401 for unknown email and wrong password, JWT with `exp`), `GET /api/v1/auth/me`; seed sets a dev password; `apps/api/scripts/set_password.py`.
- Deals: list gains product join and `q`/`golden` filters; `GET /deals/{id}` (lines, predictions); `GET /deals/{id}/thresholds` recomputes from `inputs_snapshot` (landed per sellable kg across ±30% purchase price, sell-above, buy-below at a chosen margin).
- Predict: `GET /api/v1/predict` serves the champion P10/P50/P90 + SHAP. The forecast code moved from `quote_service` into `services/forecast.py`, shared by `/quote` and `/predict` (same behaviour).
- Tests: `apps/api/tests/test_api_auth_deals_predict.py` covers login, deal detail/thresholds (tripwire 2,699 / 2,834) and trains a real LightGBM champion to exercise `/predict` and the `/quote` anomaly check, which smoke never reaches because retrain is skipped. Smoke also checks login, deals, thresholds and predict.
- Web: Login page, auth guard + 401 redirect + sign out, Deals list, Deal detail with a threshold chart (hover readout, table view, RTL-aware), language switch moved to the nav.

## Open items

- The Docker build (`make smoke`) could not run in this session: the sandbox blocks `apt-get` inside image builds (403 from deb.debian.org). Not a repo bug; `make smoke-local` runs the identical checks and passes.

## Run results

- `make unit`: 65 passed (incl. the 20 exported golden fixtures) + sample CSV check. `test_backtest_walk_forward.py` passes on the first LightGBM run.
- `make smoke-local`: SMOKE PASSED. Stage ok=24 flagged=1; confirm inserted=24 golden_created=20; 20 fixtures exported and pass; `/quote` returns landed 26,720,146 (tripwire); stats_recompute and golden_regression success; retrain skipped ("market history 90 days < 180"); no job running or failed.
- `apps/web`: `npm run build` (tsc + vite) passes.
