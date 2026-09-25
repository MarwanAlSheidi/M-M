# Costing Studio

Product-agnostic pricing envelope: **cost elements → envelope (floor / target / ceiling) →
compare to market → position** (attractive / too high / too low / not viable).
Multi-tenant, GCC-focused, Arabic/English.

A product is data. Adding one is a handful of rows (or API calls), no code:

| Row | What it holds |
|---|---|
| `products` | name, category, base unit, `attributes` JSONB for anything industry-specific |
| `cost_elements` | rate per element unit, currency, validity dates (versioned) |
| `product_bom` | optional: element units per product unit (default 1) |
| `margin_config` | min / target / max margin on price (max optional, versioned) |
| `market_sources` | where market prices come from and how long they stay fresh |

Envelope: `floor | target | ceiling = unit_cost / (1 − min | target | max)`; without `max_pct` the
ceiling mirrors the floor (`target + (target − floor)`). Market reference = median of the latest
fresh price per source. See `CLAUDE.md` for the invariants and tripwire values.

## Quick start (Claude Code)
Open this folder in Claude Code and paste `PROMPT.md`.

## Manual
```bash
cp .env.example .env
make unit          # DB-free tests on the host (uv)
uv lock
make smoke         # full stack in Docker: migrate, seed, tests, product + envelope + market flow, jobs
```
No Docker? `make smoke-local` runs the same checks (`scripts/smoke_checks.sh`) against a local
Postgres 16 + Redis.

Web app: `cd apps/web && npm i && npm run dev`, open http://localhost:5173 and sign in as
`ops@example.om` / `dev-password` (the seeded dev admin; override with `SEED_ADMIN_PASSWORD`
before `make seed`). Set a real user's password with
`cd apps/api/scripts && python set_password.py <email>` (as the migrator).

## Load a real product (no code)
Start with DECISION_BRIEF.md for the current finding, or FINDINGS.md for the underlying analysis.

The canned tuna example is a template, not a real case. Its raw material price is a market report
placeholder. See FINDINGS.md before drawing conclusions from its envelope.

Describe the product in JSON (name, base unit, cost elements with rates, margin) and its market prices in a
CSV (`observed_at,price_major,currency,unit`); both go through the same service layer as the API and print
the resulting envelope. Examples: `sample_data/example_product.json`, `sample_data/example_market_prices.csv`.
```bash
export DATABASE_URL=postgresql+psycopg://costing_app:app_pw@localhost:5432/costing   # the API role; RLS applies
uv run python scripts/load_product.py sample_data/example_product.json
uv run python scripts/load_market_prices.py "White bread loaf 600g" shop-audit sample_data/example_market_prices.csv
```
Both default to the seeded example tenant (`--tenant <id>` for another). Amounts must fit the currency's
minor unit (OMR 3 decimals): quote tiny rates per a larger unit (per MWh, per tonne) and scale
`qty_per_unit`. Market prices count only while fresh (30 days unless a `market_sources` row says otherwise).

### First real product: canned light tuna (tripwire)
Locked on the first inputs (skipjack 0.90 USD/kg, one `oman-wholesale` source), now frozen in
`apps/api/tests/fixtures/canned_tuna_v1_*`; `sample_data/canned_tuna_*` has since moved to the Oman-landed rate
(1.40 USD/kg) and four market channels (see FINDINGS.md). USD inputs, example OMR tenant, per kg:

| | OMR per kg |
|---|---|
| Unit cost | 1.203 |
| Floor (15% margin) | 1.415 |
| Target (30% margin) | 1.719 |
| Ceiling (45% margin) | 2.187 |
| Market ref (latest `oman-wholesale` price) | 1.377 |
| Position | `too_low` |

The first hand-computed values (1.201 / 1.413 / 1.716 / 2.184) were wrong: they did not round each cost line to
its currency's minor unit before summing. The engine is correct and keeps per-line rounding; this envelope is
pinned by `test_canned_tuna_tripwire`. The CSV rows are dated September 2026, so after 30 days they stop counting
as fresh: refresh the dates before re-running the loader.

## API
- `POST /api/v1/auth/login` → JWT; `GET /api/v1/auth/me`
- `GET /api/v1/products` · `POST /api/v1/products` (admin) · `GET|PATCH /api/v1/products/{id}` (patch: admin)
- `POST /api/v1/products/{id}/cost-elements` · `POST /api/v1/products/{id}/margin-config` (admin; versioned)
- `POST /api/v1/envelope` `{product_id, as_of?}` → floor / target / ceiling (+ market position);
  every call is stored in `pricing_snapshots`. `GET /api/v1/envelope/{product_id}` → latest snapshot
- `POST /api/v1/market-prices/ingest-csv` (multipart: `product_id`, `source`, CSV
  `observed_at,price,currency,unit`) · `POST /api/v1/market-prices/ingest` (JSON)
- `POST /api/v1/imports` … `/confirm` — BOM import (product, element, unit, rate, currency, qty, valid_from)
- `GET /api/v1/predict?product_id=…` — champion market-price forecast (advisory; never moves the envelope)
- `GET|POST /api/v1/admin/jobs` — `market_refresh`, `envelope_recompute`, `retrain`, `fx_refresh`

## Jobs (scheduler, Asia/Muscat)
`fx_refresh` 01:00 · `market_refresh` 01:30 · `envelope_recompute` 02:00 (snapshots every product) ·
`retrain` 03:00 (market-price and input-cost-drift targets, each gated on 180 days of history;
elasticity waits for transaction data).

## Layout
- `packages/costing` — envelope engine + money, FX, units, serialize
- `packages/ml` — LightGBM quantile models, guard, walk-forward backtest, promotion; targets in `datasets.py`
- `apps/api` — FastAPI, Alembic (`0006_envelope_schema`), RLS, BOM import, RQ jobs, scheduler
- `apps/web` — React + Vite + Tailwind (RTL/LTR): Products, Product detail, Envelope editor, BOM import
