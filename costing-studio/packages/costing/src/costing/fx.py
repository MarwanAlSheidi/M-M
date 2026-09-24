from __future__ import annotations
from decimal import Decimal
from .currencies import is_pegged_to_usd, usd_peg_rate
class FxResolver:
    def __init__(self, market_rates=None): self._market = market_rates or {}
    def _to_usd(self, code):
        if code == "USD": return Decimal("1")
        if is_pegged_to_usd(code): return Decimal("1") / usd_peg_rate(code)
        key = f"{code}/USD"
        if key not in self._market: raise ValueError(f"Missing market rate: {key}")
        return self._market[key]
    def _from_usd(self, code):
        if code == "USD": return Decimal("1")
        if is_pegged_to_usd(code): return usd_peg_rate(code)
        key = f"USD/{code}"
        if key not in self._market: raise ValueError(f"Missing market rate: {key}")
        return self._market[key]
    def rate(self, frm, to):
        if frm == to: return Decimal("1")
        return self._to_usd(frm) * self._from_usd(to)
