# Findings: canned light tuna (costing studio)

Inputs are placeholders; see `costing-studio/sample_data/canned_tuna_*.PLACEHOLDERS.md`. All envelope
amounts are OMR per kg of finished product (example tenant, USD inputs at the 0.3845 peg).

## What the tool found
At Bangkok skipjack benchmark prices (1.30-1.70 USD/kg), canned light tuna at Oman wholesale prices
(3.58 USD/kg) is not viable. The break-even raw material price is approximately 1.15 USD/kg (the last
viable price in 0.01 steps is 1.14). Above that, unit cost exceeds market price before any margin is applied.

## How we know
Sensitivity sweep from 0.80 to 1.80 USD/kg (`costing-studio/scripts/sensitivity.py`, default range), output verbatim:

```
skipjack_usd | unit_cost | floor | target | ceiling | market_ref | position
0.80 | 1.130 | 1.329 | 1.614 | 2.055 | 1.377 | attractive
0.90 | 1.203 | 1.415 | 1.719 | 2.187 | 1.377 | too_low
1.00 | 1.272 | 1.496 | 1.817 | 2.313 | 1.377 | too_low
1.10 | 1.342 | 1.579 | 1.917 | 2.440 | 1.377 | too_low
1.20 | 1.415 | 1.665 | 2.021 | 2.573 | 1.377 | not_viable
1.30 | 1.484 | 1.746 | 2.120 | 2.698 | 1.377 | not_viable
1.40 | 1.557 | 1.832 | 2.224 | 2.831 | 1.377 | not_viable
1.50 | 1.626 | 1.913 | 2.323 | 2.956 | 1.377 | not_viable
1.60 | 1.695 | 1.994 | 2.421 | 3.082 | 1.377 | not_viable
1.70 | 1.768 | 2.080 | 2.526 | 3.215 | 1.377 | not_viable
1.80 | 1.838 | 2.162 | 2.626 | 3.342 | 1.377 | not_viable
```

Benchmark source: Infofish and Thai Union weekly quotes (2024-2025), whole frozen FOB; placeholder pending
the actual purchase price.

## What we do not know yet
- Actual frozen skipjack purchase price
- Actual selling price achieved (if any sales exist)
- Whether the product spec (70% fish, 185g can) is fixed or adjustable

## What changes the answer
- Raw material: 0.80 attractive, 1.20+ not viable.
- Market reference: the envelope does not depend on the market price (it is built from costs and margins
  only), so +10% on the market price leaves floor / target / ceiling unchanged and moves the market
  reference instead (1.377 -> 1.515 OMR/kg). That shifts the break-even raw material price from about
  1.14 to about 1.34 USD/kg.
- Fish content: 70% -> 50% reduces the raw fish quantity per kg by about 29% (1.84 -> 1.32 kg whole fish),
  moving the boundary significantly.

## Next action
Obtain the actual frozen skipjack purchase price and re-run `scripts/sensitivity.py` with it. Do not adjust
the engine or the sweep.
