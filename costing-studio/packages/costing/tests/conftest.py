from decimal import Decimal
import pytest
from costing.fx import FxResolver
from costing.money import Money


@pytest.fixture
def usd_omr_rate():
    return FxResolver().rate("USD", "OMR")


@pytest.fixture
def base_deal_kwargs(usd_omr_rate):
    return dict(
        product_sku="TUNA-YF-WR", quantity=Decimal("18000"), base_unit="kg",
        yield_pct=Decimal("0.55"), purchase_unit_price_major=Decimal("3.20"),
        currency="USD", incoterm="CFR",
        origin_charges=Money(0, "USD"), freight_total=Money(0, "USD"),
        insurance_rate=Decimal("0.004"), hs_code="0303.42",
        duty_rate=Decimal("0.05"), vat_rate=Decimal("0.05"), vat_recoverable=True,
        clearing_fixed=Money.from_major("250", "OMR"),
        processing_rate_per_unit=Money.from_major("0.080", "OMR"),
        storage_days=15, storage_rate_per_unit_day=Money.from_major("0.003", "OMR"),
        days_to_customer_payment=45, supplier_terms_days=30, wacc=Decimal("0.08"),
        overhead_pct=Decimal("0.03"), min_margin=Decimal("0.05"),
        locked_rates={"USD": usd_omr_rate}, base_currency="OMR",
    )
