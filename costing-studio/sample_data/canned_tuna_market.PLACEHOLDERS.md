# Placeholders in `canned_tuna_market.csv`

| Value in the file | Source used | Question to ask to replace it |
|---|---|---|
| All four rows: 3.57, 3.55, 3.60, 3.58 USD/kg (dated 2026-09-01 to 2026-09-22) | Oman blended first-sale ASP, Jan 2026 report. | What price do we actually sell at, or what have distributors offered? |

The engine uses the latest row per source (3.58 USD/kg = 1.377 OMR/kg) as the market reference, and only rows
from the last 30 days count, so the dates must be refreshed before re-running the loader.
