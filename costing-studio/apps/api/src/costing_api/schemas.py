from __future__ import annotations
from datetime import date
from decimal import Decimal
from typing import Any, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class MoneyOut(BaseModel):
    amount_minor: int
    amount_major: str
    currency: str


class GuardOut(BaseModel):
    accepted: bool
    reason: str
    final_value: str


class SHAPFeature(BaseModel):
    feature: str
    contribution: float


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=256)


class UserOut(BaseModel):
    id: str
    tenant_id: str
    email: str
    role: str
    locale: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    user: UserOut


class ForecastOut(BaseModel):
    """Champion market-price forecast (per target_unit, in target_currency). Advisory only:
    it moves no envelope number (the envelope is arithmetic)."""
    model_config = ConfigDict(protected_namespaces=())
    available: bool
    reason: Optional[str] = None
    product_id: str
    as_of: date
    target: str
    model_version: Optional[str] = None
    target_currency: Optional[str] = None
    target_unit: Optional[str] = None
    p10: Optional[str] = None
    p50: Optional[str] = None
    p90: Optional[str] = None
    shap_top5: list[SHAPFeature] = []


# ---------------------------------------------------------------- products / envelope
class ProductIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    category: str = Field(min_length=1, max_length=100)
    base_unit: str = Field(min_length=1, max_length=20)
    attributes: dict[str, Any] = {}


class ProductPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    category: Optional[str] = Field(default=None, min_length=1, max_length=100)
    base_unit: Optional[str] = Field(default=None, min_length=1, max_length=20)
    attributes: Optional[dict[str, Any]] = None


class CostElementIn(BaseModel):
    """rate is per `unit` of the element, in major units of `currency`; qty_per_unit is element
    units per product unit (omit for elements priced per product unit)."""
    name: str = Field(min_length=1, max_length=200)
    unit: str = Field(min_length=1, max_length=20)
    rate: Decimal = Field(ge=0)
    currency: str = Field(min_length=3, max_length=3)
    qty_per_unit: Optional[Decimal] = Field(default=None, ge=0)
    valid_from: date = Field(default_factory=date.today)


class MarginConfigIn(BaseModel):
    """Margin on price. max_pct omitted -> ceiling = target + (target - floor)."""
    min_pct: Decimal = Field(ge=0, lt=1)
    target_pct: Decimal = Field(gt=0, lt=1)
    max_pct: Optional[Decimal] = Field(default=None, gt=0, lt=1)
    valid_from: date = Field(default_factory=date.today)


class EnvelopeRequest(BaseModel):
    product_id: UUID
    as_of: Optional[date] = None


class MarketPriceIn(BaseModel):
    price: Decimal = Field(gt=0)
    currency: str = Field(min_length=3, max_length=3)
    unit: str = Field(min_length=1, max_length=20)
    observed_at: date
