from __future__ import annotations
from datetime import date
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, Field

LineSource = Literal["formula", "manual", "ml", "ml_derived"]


class CostLineOut(BaseModel):
    type: str
    amount_minor: int
    amount_major: str
    currency: str
    source: LineSource
    note: Optional[str] = None


class MoneyOut(BaseModel):
    amount_minor: int
    amount_major: str
    currency: str


class GuardOut(BaseModel):
    accepted: bool
    reason: str
    final_value: str


class MLInputOut(BaseModel):
    field: str
    predicted_value: str
    guard: GuardOut


class QuoteVsForecastOut(BaseModel):
    quote_price: str
    forecast_p50: str
    pct_deviation: str
    within_p10_p90: bool
    flag: Literal["ok", "outside_range"]
    compare_currency: str
    compare_unit: str


class SHAPFeature(BaseModel):
    feature: str
    contribution: float


class QuoteRequest(BaseModel):
    product_sku: str
    quantity: str
    base_unit: str = "kg"
    currency: str
    incoterm: Literal["EXW", "FOB", "CFR", "CIF", "DAP", "DDP"]
    freight_currency: str = "USD"
    origin_country: Optional[str] = None
    dest_country: Optional[str] = None
    deal_date: date = Field(default_factory=date.today)
    yield_pct: Optional[str] = None
    purchase_unit_price_major: Optional[Decimal] = Field(default=None, gt=0)
    freight_total_major: Optional[str] = None
    use_ml: bool = False
    target_margin: str = "0.20"
    min_margin: str = "0.05"
    market_sell_per_sellable_major: Optional[str] = None
    locale: Literal["en", "ar"] = "en"
    # Optional per-deal overrides (win over tenant config)
    overhead_pct: Optional[Decimal] = Field(default=None, ge=0, lt=1)
    insurance_rate: Optional[Decimal] = Field(default=None, ge=0, lt=1)
    wacc: Optional[Decimal] = Field(default=None, ge=0, lt=1)
    supplier_terms_days: Optional[int] = Field(default=None, ge=0)
    days_to_customer_payment: Optional[int] = Field(default=None, ge=0)
    storage_days: Optional[int] = Field(default=None, ge=0)


class QuoteResponse(BaseModel):
    lines: list[CostLineOut]
    landed_cost: MoneyOut
    sellable_qty: str
    landed_cost_per_sellable_unit: MoneyOut
    break_even_per_sellable_unit: MoneyOut
    sell_above_threshold: MoneyOut
    buy_below_threshold: Optional[MoneyOut] = None
    ml_inputs: list[MLInputOut] = []
    ml_fields: list[str] = []
    shap_top5: list[SHAPFeature] = []
    quote_vs_forecast: Optional[QuoteVsForecastOut] = None
    ml_skipped_reason: Optional[str] = None
    explanation: str
    locale: Literal["en", "ar"]
