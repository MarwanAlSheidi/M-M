# Costing Studio — Claude Code context

Product-agnostic pricing-envelope SaaS, GCC-focused, bilingual (AR/EN), multi-tenant.
cost elements → envelope (floor / target / ceiling) → compare to market → position.
Owner: Marwan (Zero Axiom LLC, Muscat). Example tenant base currency OMR.

A product is data, never code: a `products` row plus `cost_elements` (+ `product_bom`),
`margin_config` and `market_sources` rows. Industry specifics live in `products.attributes`.

## Rules
1. Run `make unit` first (host, DB-free). Then `make smoke` (or `make smoke-local` without Docker).
2. Fix one failure at a time, re-run, repeat. No redesign; if a fix needs a design change, stop and ask.
3. Keep `FIXES.md`: one line per change (`file: problem -> change`).

## Invariants
- Money: integer minor units only; exponents per currency (OMR 3, USD 2, JPY 0);
  conversion scales by 10^(exp_base - exp_src); ROUND_HALF_UP per line, then sum.
- USD pegs hardcoded (OMR 0.3845, AED 3.6725, SAR 3.75, QAR 3.64, BHD 0.376); only
  non-pegged currencies come from the ECB feed (`fx_refresh`).
- Envelope (`packages/costing/src/costing/envelope.py`), margin on price:
  unit_cost = Σ rate × qty_per_unit (qty 1 without a BOM row), each line converted to base first;
  floor / target / ceiling = unit_cost / (1 − min / target / max pct);
  max_pct NULL → ceiling = target + (target − floor).
- Positions (M = market reference = median of the latest fresh price per source, per product unit):
  M < unit_cost → not_viable · unit_cost ≤ M < floor → too_low · floor ≤ M ≤ ceiling → attractive ·
  M > ceiling → too_high.
- Cost lines round to the element's own currency minor unit before conversion. Changing the tenant base
  currency therefore moves the envelope by a few minor units. This is intentional: it matches how invoices
  are issued. (Pinned by `test_cost_lines_round_in_element_currency_before_conversion`.)
- No ML in the envelope math. ML forecasts (market price, input-cost drift, elasticity) are advisory.
- Every envelope computation is stored in `pricing_snapshots` with its inputs; audit/ML read those.
- Cost elements and margin config are dated versions; a new version closes the open one.
- Roles: costing_migrator (owner, BYPASSRLS, migrations/seeds), costing_app (API, NOBYPASSRLS),
  costing_worker (fx_rates writes). FORCE RLS on all tenant tables.
- Jobs get a session already in one transaction with the tenant set; they never call begin().

## Tripwire values (seed: Portland cement 50 kg bag, OMR, margins 15 / 30 / 45 %)
lines clinker 1,330 · gypsum 45 · energy 138 · bag 90 · labour 150 · freight (0.30 USD) 115 ·
unit cost 1,868 · floor 2,198 · target 2,669 · ceiling 3,396 (baisa per bag); mirror ceiling 3,140.
In `packages/costing/tests/test_envelope.py` and asserted through the API by `make smoke`.

First real product (`apps/api/tests/fixtures/canned_tuna_v1_*`, the frozen first inputs; USD inputs, OMR tenant, per kg): unit cost 1,203 · floor 1,415 ·
target 1,719 · ceiling 2,187 · market 1,377 · too_low (baisa). In `apps/api/tests/test_api_envelope.py`
(`test_canned_tuna_tripwire`, as_of pinned to 2026-09-25).

## Definition of done
- `make unit` passes (envelope, money, fx, units, serialize; ML harness incl. LightGBM walk-forward).
- `make smoke` prints `SMOKE PASSED`: seeded envelope = tripwire; product created via the API;
  cost elements + margin posted; floor < target < ceiling; CSV market ingest; position is one of the
  four values; `envelope_recompute` succeeds and stores a snapshot; no job left running or failed;
  `retrain` skipped (not enough history).
