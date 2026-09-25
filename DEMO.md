# Costing Studio — demo

## What this shows
Given a product's cost elements and market prices, the studio computes a pricing envelope (floor / target /
ceiling) and shows whether the market price clears it, per channel.

## The current finding
Canned light tuna in sunflower oil:
- Floor price: 1.832 OMR/kg (≈ 4.76 USD/kg)
- Among wholesale channels, only UAE export clears with margin (Oman retail also clears, but it is a shelf
  price, not a wholesale channel)
- Full analysis in DECISION_BRIEF.md

## How to run it
Postgres and Redis must already be running on the machine. Then, from the `costing-studio` folder:

`bash scripts/demo.sh`

Then open: http://localhost:5173/simulate and sign in with `ops@example.om` / `dev-password`.
The script prints the exact simulate and product-detail links. To stop: `bash scripts/demo.sh stop`.

## What to try
1. Change the skipjack price. Watch the envelope move.
2. Untick uae-export. Watch the recommendation change (to none: retail and import channels start unticked).
3. Open the product detail page. See the envelope, its cost breakdown and where the market sits. The
   sensitivity sweep across skipjack prices is in FINDINGS.md.

## What it does not do
- No live data feeds. Market prices come from a CSV (the demo re-dates it so the prices count as recent).
- No sales history. Every envelope is computed from inputs.
- The raw material price is a benchmark, not a verified PO.
