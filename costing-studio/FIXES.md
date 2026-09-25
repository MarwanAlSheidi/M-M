# Fixes

## Domain swap: tuna landed cost -> product-agnostic pricing envelope

Decisions confirmed before building: margin on price (`cost / (1 − pct)`); `margin_config.max_pct`
nullable with ceiling fallback `target + (target − floor)`; four bands with a unit-cost band
(not_viable < cost ≤ too_low < floor ≤ attractive ≤ ceiling < too_high). `fx_refresh` kept (element
currency conversion).

- packages/costing/src/costing/envelope.py: new engine (compute_envelope, compare_to_market, snapshot JSON) -> replaces engine.py (deleted).
- packages/costing/tests/test_envelope.py: cement tripwire 1,868 / 2,198 / 2,669 / 3,396, band edges, FX + mass units, median -> replaces test_golden_deals, test_incoterms, test_roundtrip, test_golden_fixtures and golden/ (deleted).
- apps/api/alembic/versions/0006_envelope_schema.py: new generic schema + same RLS/auth mechanics -> replaces 0001–0003 (deleted); composite FKs keep children in the product's tenant.
- apps/api/scripts/grant_app_privileges.sql: grants for the new table list.
- apps/api/scripts/seed_example_tenant.py: cement example (6 elements, BOM, 15/30/45, two manual sources) -> replaces seed_oman_tuna.py; export_golden.py deleted.
- services/envelope_service.py: build_envelope / latest_snapshot; FX resolution, source staleness (default 30 days), every run stored in pricing_snapshots.
- services/product_service.py: product CRUD, versioned cost elements (BOM qty carried over) and margin config, audit_log on every write.
- services/bom_import_service.py + routers/imports.py: import pipeline repurposed for BOM rows (ok / rejected, savepoint per row on confirm) -> replaces import_service.py.
- routers/products.py, routers/envelope.py, routers/market_prices.py (ingest-csv + JSON), routers/predict.py (product_id) -> deals.py, quote.py deleted.
- services/inputs.py, quote_service.py, pricing_mode.py, repos/hs_repo.py, lane_repo.py, stats_repo.py: deleted (tuna-only).
- repos/product_repo.py, tenant_repo.py, market_repo.py: product-id keyed; tenant base currency from tenants.
- jobs/market_refresh.py (was market_ingest), jobs/envelope_recompute.py (new), jobs/retrain.py (retargeted), jobs/base.py + schedule.py (job list only) -> golden_regression.py, stats_recompute.py deleted.
- services/features.py, services/forecast.py: daily market / unit-cost series in base currency per product unit; champion = market-price target.
- packages/ml/src/ml/datasets.py: targets forecast_market_price_per_product, forecast_input_cost_drift, estimate_elasticity; features.py FeatureSpec defaults emptied; backtest tests retargeted.
- schemas.py, i18n.py, main.py: envelope request/response models, envelope narrative, router list (prod HS-duty startup check removed with its table).
- apps/api/tests/test_api_envelope.py: products, versioning, envelope/positions, CSV ingest, snapshots, recompute job, BOM import, trained champion via /predict, retrain training path -> replaces test_api_auth_deals_predict.py; test_rls_cross_tenant.py moved to the new tables.
- scripts/smoke_checks.sh (shared by smoke.sh and smoke_local.sh): the requested assertions; Makefile drops `golden` and the CSV check; sample_data/tuna_25rows.csv and gen_sample_csv.py deleted.
- apps/web: EnvelopeBar (was CostWaterfall), PositionIndicator (was ThresholdChart), ProductList / ProductDetail / EnvelopeEditor pages, BOM ImportWizard -> Quote, Deals, DealDetail deleted; ProvenanceBadge, GuardBadge, SHAPTop5 unchanged.
- Kept untouched by request: money.py, currencies.py, units.py, fx.py, models.py, serialize.py, ml guard/backtest/promote/models, jobs framework, Docker.

Fixed while verifying:
- jobs/retrain.py: `ProductRow` (holds a dict) used as a dict key -> "unhashable type: 'dict'"; now a list of (product, series).
- jobs/market_refresh.py: a non-numeric CSV price raised InvalidOperation (500) -> re-raised as ValueError (422).

## Earlier (tuna era)
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
