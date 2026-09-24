from __future__ import annotations
from decimal import Decimal
from enum import Enum
from typing import Optional


class PricingMode(str, Enum):
    QUOTE_GIVEN_ANOMALY_CHECK = "quote_given_anomaly_check"
    ML_FILLS_PRICE = "ml_fills_price"
    NO_PRICE_NO_ML = "no_price_no_ml"


def choose_mode(quote_price_major: Optional[Decimal], use_ml: bool) -> PricingMode:
    if quote_price_major is not None and quote_price_major > 0:
        return PricingMode.QUOTE_GIVEN_ANOMALY_CHECK
    if use_ml:
        return PricingMode.ML_FILLS_PRICE
    return PricingMode.NO_PRICE_NO_ML
