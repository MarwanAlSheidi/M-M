# Tuna Costing Studio — Claude Code context

GCC-focused, bilingual (AR/EN), multi-tenant costing SaaS. Tuna is the first product.
Owner: Marwan (Zero Axiom LLC, Muscat). Base currency OMR.

This repo is fully assembled (see ASSEMBLY_NOTES.md). The pure engine and ML logic were
tested in a sandbox; **nothing needing Postgres, Redis, FastAPI or LightGBM has ever run.**
Your job: run it and fix what breaks. Not redesign.

## Fix-loop rules
1. Run `make unit` first (host, DB-free). Then `make smoke`.
2. Fix one failure at a time, re-run, repeat.
3. No redesign, no new features, no behaviour changes. If a fix needs a design change, stop and ask.
4. Keep `FIXES.md`: one line per fix (`file: problem -> change`). Mark design-level fixes `[DESIGN]`.

## Invariants (do not change while fixing)
- Money: integer minor units only; exponents per currency (OMR 3, USD 2, JPY 0);
  conversion scales by 10^(exp_base - exp_src); ROUND_HALF_UP per line, then sum.
- USD pegs hardcoded (OMR 0.3845, AED 3.6725, SAR 3.75, QAR 3.64, BHD 0.376); only
  non-pegged currencies come from the ECB feed.
- Engine: incoterm table (EXW/FOB/CFR/CIF/DAP/DDP), insurance on (purchase+freight)x110%,
  processing on input qty, yield applied once, capital on cash-cycle days, bisection buy-below.
- ML never outputs landed cost and never overrides a supplier quote; every ML value is guarded.
- Roles: costing_migrator (owner, BYPASSRLS, migrations/seeds), costing_app (API, NOBYPASSRLS),
  costing_worker (fx_rates writes). FORCE RLS on all tenant tables.
- Jobs get a session already in one transaction with the tenant set; they never call begin().
- Deals store inputs_snapshot; regression/export/training read it, never rebuild inputs.

## Tripwire values (base case: 18,000 kg YF whole round, CFR, 3.20 USD/kg, yield 0.55)
purchase 22,147,200 · insurance 97,448 · duty 1,112,232 · capital 85,009 · overhead 778,257 ·
landed 26,720,146 · per sellable kg 2,699 · sell-above 2,834 (baisa). These are in
`packages/costing/tests/test_golden_deals.py` and already pass. If they fail, something
changed the engine — revert that first.

## Definition of done
- `make unit` passes, including `test_backtest_walk_forward.py` (first LightGBM run).
- `make smoke` prints `SMOKE PASSED`: stage ok=24 flagged=1, inserted=24, golden_created=20,
  20 fixtures pass, /quote returns landed_cost, no job running or failed, retrain skipped.
- `FIXES.md` lists every change.

## Sample data
`sample_data/tuna_25rows.csv` was generated with the verified engine under the seed config.
Row 22 (2025-05-18) has a deliberate +5% drift and must stage as flagged.
