# Placeholders in `canned_tuna_product.json`

None of these values is verified. Each one needs a real number before the envelope means anything.

| Value in the file | Source used | Question to ask to replace it |
|---|---|---|
| Frozen whole skipjack tuna, `rate` 1.40 USD/kg | Midpoint of the Oman frozen skipjack range 1.37–1.49 USD/kg (Tridge, May 2026). **Still a benchmark, not an actual PO price.** (Was 0.90, an unverified market-report figure.) | What did we pay per kg on the last purchase order? |
| Direct labour, `rate` 2.50 USD/hour | Assumed. | What is the actual loaded hourly cost? |
| Energy (cooking, retort, machinery), `rate` 0.08 USD/kWh | Assumed Oman industrial tariff. | What is our actual tariff? |
| Factory overhead and depreciation, `rate` 0.25 USD/kg | Assumed. | What does the finance team allocate per kg? |
| `qty_per_unit` values: skipjack 1.84 kg, tinplate cans 5.41, carton and label 5.41 (and the other per-kg quantities) | Derived from yield 0.38 and pack size 185 g (0.70 fish content ÷ 0.38 yield = 1.84 kg whole fish; 1000 g ÷ 185 g = 5.41 cans). | What is our actual yield and can count per kg? |
