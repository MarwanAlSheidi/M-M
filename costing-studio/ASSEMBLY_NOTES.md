> **Historical.** These notes describe the original tuna landed-cost assembly. The tuna domain was
> replaced by the product-agnostic pricing envelope (migration 0006); see FIXES.md → "Domain swap".

# Assembly notes

This repo is the final state of ~15 design/review rounds, assembled into files.
Where the rounds left gaps or contradictions, the choice made is listed here so
nothing is silent. Items marked [DESIGN] fix a real design bug, not just a typo.

## Verified in a sandbox (no DB)
- `packages/costing/tests`: 29 passed (golden values, incoterms, FX, serialize, money, units).
- `packages/ml/tests` without LightGBM: guard, features, promote, integrate, walk-forward
  logic with a stub model: 15 passed.
- Import staging on `sample_data/tuna_25rows.csv` (repo logic, seed config): ok=24, flagged=1.

## Not yet executed
Anything needing Postgres, Redis, FastAPI or LightGBM: migrations, RLS tests, API,
jobs, `test_backtest_walk_forward.py`, the web app. `make smoke` is the first run.

## Decisions made while assembling
1. Migrations consolidated into `0001_schema` + `0002_rls_and_auth` (never deployed, so no history to keep).
2. `fx_rates` is global with no RLS; protected by grants (app SELECT, worker SELECT/INSERT)
   instead of a `current_user` policy. Same effect, simpler.
3. [DESIGN] Scheduler listed tenants with `SELECT id FROM tenants`, which RLS makes return 0 rows,
   so no nightly job would ever run. Added `list_tenant_ids()` SECURITY DEFINER.
4. `market_ingest` and `stats_recompute` write through the tenant-scoped app session
   (market_prices is tenant data). The worker role only writes `fx_rates`.
5. RQ jobs are enqueued by name (`run_job(job_name, tenant_id)`), not by function object.
6. [DESIGN] The engine does not convert processing/storage rates, so `build_inputs` rejects a
   `product_cost_config.rate_currency` different from the tenant base currency.
7. [DESIGN] FX lag features for USD/pegged currencies use "USD per 1 unit" (same direction as
   `fx_rates`). The transcript used the raw peg, which is the inverse for OMR.
8. `QuoteRequest` gained optional `origin_country`/`dest_country` (the import path needs them).
9. [DESIGN] ML-fill mode returns 422 when the request currency/unit differs from the model target;
   no conversion was designed for that path.
10. `hs_duty_rates` unique index uses NULLS NOT DISTINCT so the NULL-origin seed row is idempotent (PG15+).
11. Dropped unused `weasyprint` (needs system libs in slim images) and `anthropic` deps.
    Added `libgomp1` to the Dockerfile for LightGBM.
12. `make golden` clears old fixtures first: deal_refs contain the batch id, so reruns would pile up.
13. RLS policy-count test matches the final table list (fx_rates excluded, job_runs included).
14. Admin job routes require role admin; `fx_refresh` requires platform_admin.
15. The quote anomaly check always runs when a quote is given and a champion exists (as designed).

## Not delivered in the transcript (left out or minimal)
- ~~Web: Login, Deals list, DealDetail, ThresholdChart pages~~ — added after the first run (see FIXES.md).
- ~~`predict` router placeholder~~ — now serves the champion forecast. products/parties stay read-only lists.
- ~~No login endpoint~~ — `POST /api/v1/auth/login` added; smoke still also uses a dev JWT.
- LLM narrative (Claude API) is a stub.
