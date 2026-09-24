"""Regenerate sample_data/tuna_25rows.csv with the pure engine under the seed config.

Mirrors apps/api/scripts/seed_oman_tuna.py and services/inputs.build_inputs, so every row
stages as ok except row 22 (2025-05-18), which carries a deliberate +5% drift and must
stage as flagged. landed_cost is the landed_scope sum (as import staging compares it);
actual_sell is landed_cost x 1.18.

    uv run python scripts/gen_sample_csv.py            # rewrite the CSV
    uv run python scripts/gen_sample_csv.py --check    # exit 1 if the CSV is stale
"""
from __future__ import annotations
import sys
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from costing.engine import compute_landed
from costing.fx import FxResolver
from costing.models import DealInputs
from costing.money import Money

CSV = Path(__file__).resolve().parent.parent / "sample_data" / "tuna_25rows.csv"
HEADER = ["sku", "quantity", "deal_date", "unit_price", "currency", "origin", "destination",
          "incoterm", "landed_cost", "actual_sell"]
LANDED_SCOPE = {"purchase", "freight", "insurance", "duty", "clearing", "processing", "storage"}
DRIFT_DATE = "2025-05-18"
DRIFT = Decimal("1.05")
SELL_MARKUP = Decimal("1.18")
MILLI = Decimal("0.001")

# Seed config (seed_oman_tuna.py)
SEED = dict(
    base_unit="kg", yield_pct=Decimal("0.55"), hs_code="0303.42",
    insurance_rate=Decimal("0.004"), duty_rate=Decimal("0.05"),
    vat_rate=Decimal("0.05"), vat_recoverable=True,
    clearing_fixed=Money.from_major("250", "OMR"),
    processing_rate_per_unit=Money(80, "OMR"), storage_days=15,
    storage_rate_per_unit_day=Money(3, "OMR"),
    days_to_customer_payment=45, supplier_terms_days=30,
    wacc=Decimal("0.08"), overhead_pct=Decimal("0.03"), base_currency="OMR",
)
# (quantity, deal_date, unit_price) — the deal sheet the sample was drawn from
DEALS = [
    (25000, "2024-02-05", "2.99"), (25000, "2024-02-27", "3.20"), (12000, "2024-03-23", "3.02"),
    (9000, "2024-04-08", "3.54"), (20000, "2024-04-29", "3.39"), (9000, "2024-05-21", "2.96"),
    (12000, "2024-06-14", "3.49"), (9000, "2024-07-06", "3.10"), (25000, "2024-07-25", "3.54"),
    (12000, "2024-08-16", "3.42"), (15000, "2024-09-08", "2.85"), (12000, "2024-09-25", "3.39"),
    (15000, "2024-10-15", "3.04"), (15000, "2024-11-04", "2.98"), (18000, "2024-11-27", "2.97"),
    (15000, "2024-12-22", "3.18"), (9000, "2025-01-10", "3.43"), (9000, "2025-01-27", "3.33"),
    (20000, "2025-02-23", "3.22"), (25000, "2025-03-14", "3.31"), (12000, "2025-03-31", "2.93"),
    (25000, "2025-04-27", "3.14"), (15000, "2025-05-18", "2.95"), (12000, "2025-06-05", "2.97"),
    (15000, "2025-06-28", "3.43"),
]


def rows(insurance_rate: Decimal = SEED["insurance_rate"]) -> list[list[str]]:
    usd = FxResolver().rate("USD", "OMR")
    out = []
    for qty, d, price in DEALS:
        inp = DealInputs(**{**SEED, "insurance_rate": insurance_rate}, product_sku="TUNA-YF-WR",
                         quantity=Decimal(qty), purchase_unit_price_major=Decimal(price),
                         currency="USD", incoterm="CFR", locked_rates={"USD": usd, "OMR": Decimal(1)})
        r = compute_landed(inp)
        landed = Decimal(sum(l.amount.amount_minor for l in r.lines if l.type in LANDED_SCOPE)) * MILLI
        if d == DRIFT_DATE:
            landed = (landed * DRIFT).quantize(MILLI, ROUND_HALF_UP)
        sell = (landed * SELL_MARKUP).quantize(MILLI, ROUND_HALF_UP)
        out.append(["TUNA-YF-WR", str(qty), d, price, "USD", "TH", "OM", "CFR",
                    f"{landed:.3f}", f"{sell:.3f}"])
    return out


def render(data: list[list[str]]) -> str:
    return "\n".join(",".join(r) for r in [HEADER, *data]) + "\n"


if __name__ == "__main__":
    text = render(rows())
    if "--check" in sys.argv:
        sys.exit(0 if CSV.read_text() == text else 1)
    CSV.write_text(text, newline="\r\n")  # the file has always used CRLF
    print(f"wrote {len(DEALS)} rows to {CSV}")
