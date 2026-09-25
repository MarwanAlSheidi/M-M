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

## Market channels (benchmarks, not verified sales)
- Oman import: 2.15 – 3.89 USD/kg
- UAE export: 4.80 – 5.91 USD/kg
- MENA export: 4.78 USD/kg
- Oman retail (shelf, not relevant for wholesale): 9.30 – 19.50 USD/kg

## Last viable sell price per channel (at skipjack 1.40 USD/kg)
`costing-studio/scripts/last_sell_price.py "Canned Light Tuna in Sunflower Oil"` (as of 2026-09-25; OMR per kg;
market_ref = latest price per channel), output verbatim:

```
channel | market_ref | unit_cost | floor | target | ceiling | position | last_viable_sell
oman-import | 1.496 | 1.557 | 1.832 | 2.224 | 2.831 | not_viable | 1.832
mena-export | 1.838 | 1.557 | 1.832 | 2.224 | 2.831 | attractive | 1.832
uae-export | 2.272 | 1.557 | 1.832 | 2.224 | 2.831 | attractive | 1.832
oman-retail | 7.498 | 1.557 | 1.832 | 2.224 | 2.831 | too_high | 1.832
Lowest channel where product is sellable: mena-export at 1.832 (position: attractive)
```

## Answer
`costing-studio/scripts/last_sell_price.py "Canned Light Tuna in Sunflower Oil"` (as of 2026-09-25; OMR per kg;
min / latest / max over each channel's 30-day window; latest is the engine's market reference):

```
channel | min | latest | max | unit_cost | floor | target | ceiling | position_at_latest | headroom_pct | last_viable_sell | verdict
oman-import | 0.827 | 1.496 | 1.496 | 1.557 | 1.832 | 2.224 | 2.831 | not_viable | -18.3 | 1.832 | not_sellable
mena-export | 1.838 | 1.838 | 1.838 | 1.557 | 1.832 | 2.224 | 2.831 | attractive | +0.3 | 1.832 | sellable_marginal
uae-export | 1.846 | 2.272 | 2.272 | 1.557 | 1.832 | 2.224 | 2.831 | attractive | +24.0 | 1.832 | sellable_comfortable
oman-retail | 3.576 | 7.498 | 7.498 | 1.557 | 1.832 | 2.224 | 2.831 | too_high | +309.3 | 1.832 | sellable_comfortable
```

The floor price is 1.832 OMR/kg (about 4.76 USD/kg). It is the same for every channel because it depends only
on cost and the configured margin floor. What differs is whether any channel clears it:

- Channels clearing with comfortable margin: oman-retail (+309.3%, a shelf price, not a wholesale channel),
  uae-export (+24.0%)
- Channels clearing with marginal margin: mena-export (+0.3%)
- Channels not clearing: oman-import (−18.3%)

The practical minimum sell price is 1.832 OMR/kg. Below it, the product is not viable at any margin floor.
Above it, viability depends on the channel.

## Sensitivity to raw material price
`costing-studio/scripts/last_sell_price.py "Canned Light Tuna in Sunflower Oil" --skipjack-range 1.00:1.80:0.05`
(as of 2026-09-25; cells = headroom_pct of each channel's latest price over the floor; channel prices held fixed):

```
skipjack_usd | oman-import | mena-export | uae-export | oman-retail
1.00 | +0.0 | +22.9 | +51.9 | +401.2
1.05 | -2.7 | +19.5 | +47.7 | +387.5
1.10 | -5.3 | +16.4 | +43.9 | +374.9
1.15 | -7.9 | +13.2 | +39.9 | +361.7
1.20 | -10.2 | +10.4 | +36.5 | +350.3
1.25 | -12.3 | +7.8 | +33.3 | +339.8
1.30 | -14.3 | +5.3 | +30.1 | +329.4
1.35 | -16.3 | +2.9 | +27.1 | +319.6
1.40 | -18.3 | +0.3 | +24.0 | +309.3
1.45 | -20.1 | -1.9 | +21.3 | +300.3
1.50 | -21.8 | -3.9 | +18.8 | +291.9
1.55 | -23.4 | -5.9 | +16.3 | +283.7
1.60 | -25.0 | -7.8 | +13.9 | +276.0
1.65 | -26.7 | -9.9 | +11.4 | +267.5
1.70 | -28.1 | -11.6 | +9.2 | +260.5
1.75 | -29.5 | -13.3 | +7.1 | +253.5
1.80 | -30.8 | -15.0 | +5.1 | +246.8

oman-import: floor breach at skipjack >= 1.05 USD/kg
mena-export: floor breach at skipjack >= 1.45 USD/kg
uae-export: never in range
oman-retail: never in range
```

At the benchmark skipjack price of 1.40 USD/kg, among wholesale channels only uae-export clears the floor with
comfortable margin (+24.0%); mena-export clears by +0.3% and oman-retail, a shelf price, clears by +309.3%.
The raw material price at which each channel stops clearing is listed above. Each 0.05 USD/kg on skipjack
moves every channel's headroom by roughly 2–3 points (more for oman-retail, whose reference is highest):
oman-import stops clearing from 1.05 USD/kg (headroom exactly 0.0% at 1.00), mena-export from 1.45 USD/kg, one
step above the reference price, while uae-export stays above the floor across the whole range but falls from
comfortable to marginal (below 10%) at 1.70 USD/kg and is at +5.1% at 1.80. The market side is unchanged
throughout: only the floor moves, because it is built from costs and the margin floor alone.

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
