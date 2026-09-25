# Placeholders in `canned_tuna_market.csv`

Every row is a published benchmark, not a verified sale. One `source` per channel:

| Channel (`source`) | Values (USD/kg) | Source used | Question to ask to replace it |
|---|---|---|---|
| `oman-import` | 2.15, 2.85, 3.89 | Tridge, Oman imports (Jan 2026 / May 2026) | What do importers actually land it at in Oman? |
| `uae-export` | 4.80, 5.00, 5.91 | Tridge, UAE exports (Jan 2026 / May 2026) | What have UAE buyers actually offered or paid? |
| `mena-export` | 4.78 | IndexBox, MENA exports 2024 | What is the current MENA export price for our spec? |
| `oman-retail` | 9.30, 12.00, 19.50 | Lulu / Oman retail aggregators (2026); shelf prices, not relevant for wholesale | n/a for wholesale pricing |

The rows are dated 2026-09-08 / 09-15 / 09-22 in the order listed. The engine uses the latest row per source as
that channel's market reference, so each channel's reference is its last-listed value (the top of each range as
listed). Only rows from the last 30 days count: refresh the dates before re-running the loader.
