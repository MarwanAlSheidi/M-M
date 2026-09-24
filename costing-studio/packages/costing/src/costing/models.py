from __future__ import annotations
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Dict, List, Literal, Optional
from .money import Money
@dataclass
class CostLine:
    type: str
    amount: Money
    source: str = "formula"
    note: Optional[str] = None
@dataclass(frozen=True)
class DealInputs:
    product_sku: str
    quantity: Decimal
    base_unit: str
    yield_pct: Decimal
    purchase_unit_price_major: Decimal
    currency: str
    incoterm: str
    origin_charges: Money = field(default_factory=lambda: Money(0, "USD"))
    freight_total: Money = field(default_factory=lambda: Money(0, "USD"))
    insurance_rate: Decimal = Decimal("0")
    hs_code: str = ""
    duty_rate: Decimal = Decimal("0")
    vat_rate: Decimal = Decimal("0")
    vat_recoverable: bool = True
    clearing_fixed: Money = field(default_factory=lambda: Money(0, "OMR"))
    processing_rate_per_unit: Money = field(default_factory=lambda: Money(0, "OMR"))
    storage_days: int = 0
    storage_rate_per_unit_day: Money = field(default_factory=lambda: Money(0, "OMR"))
    days_to_customer_payment: int = 0
    supplier_terms_days: int = 0
    wacc: Decimal = Decimal("0.08")
    overhead_pct: Decimal = Decimal("0")
    min_margin: Decimal = Decimal("0.05")
    locked_rates: Dict[str, Decimal] = field(default_factory=dict)
    base_currency: str = "OMR"
    ml_fields: set = field(default_factory=set)
    deal_date: Optional[date] = None
@dataclass
class CostingResult:
    inputs: DealInputs
    lines: List[CostLine]
    landed_cost: Money
    sellable_qty: Decimal
    landed_cost_per_sellable_unit: Money
    break_even_per_sellable_unit: Money
    sell_above_threshold: Money
    buy_below_threshold: Optional[Money] = None
    notes: List[str] = field(default_factory=list)
    ml_fields: set = field(default_factory=set)
