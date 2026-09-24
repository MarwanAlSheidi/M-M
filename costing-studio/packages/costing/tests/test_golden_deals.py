import dataclasses
from decimal import Decimal
import pytest

from costing.engine import (
    InfeasibleTarget, compute_landed, max_purchase_price_per_input_unit,
    non_purchase_cost_per_input_unit, sell_price_for_margin,
    solve_max_purchase_price_per_input_unit,
)
from costing.fx import FxResolver
from costing.models import DealInputs
from costing.money import Money


def _line(r, t):
    return next(l for l in r.lines if l.type == t).amount.amount_minor


def test_case1_whole_to_loin_cfr(base_deal_kwargs):
    r = compute_landed(DealInputs(**base_deal_kwargs))
    assert _line(r, "purchase") == 22_147_200
    assert _line(r, "freight") == 0
    assert _line(r, "insurance") == 97_448
    assert _line(r, "duty") == 1_112_232
    assert _line(r, "vat") == 0
    assert _line(r, "clearing") == 250_000
    assert _line(r, "processing") == 1_440_000
    assert _line(r, "storage") == 810_000
    assert _line(r, "capital") == 85_009
    assert _line(r, "overhead") == 778_257
    assert r.sellable_qty == Decimal("9900")
    assert r.landed_cost.amount_minor == 26_720_146
    assert r.landed_cost_per_sellable_unit.amount_minor == 2_699
    assert r.sell_above_threshold.amount_minor == 2_834
    assert sell_price_for_margin(r.landed_cost_per_sellable_unit, Decimal("0.20")).amount_minor == 3_374
    assert non_purchase_cost_per_input_unit(DealInputs(**base_deal_kwargs)).amount_minor == 254


def test_case2_loin_to_portion_fob(base_deal_kwargs):
    kw = {**base_deal_kwargs, "yield_pct": Decimal("0.85"), "incoterm": "FOB",
          "purchase_unit_price_major": Decimal("5.80"),
          "freight_total": Money.from_major("0.42", "USD") * Decimal("18000")}
    r = compute_landed(DealInputs(**kw))
    assert _line(r, "purchase") == 40_141_800
    assert _line(r, "freight") == 2_906_820
    assert _line(r, "insurance") == 189_414
    assert r.sellable_qty == Decimal("15300")


def test_case3_vat_not_recoverable(base_deal_kwargs):
    r = compute_landed(DealInputs(**{**base_deal_kwargs, "vat_recoverable": False}))
    assert _line(r, "vat") == 1_167_844


def test_case4_thb_supplier_mixed_currency(base_deal_kwargs):
    fx = FxResolver({"THB/USD": Decimal("0.0278")})
    kw = {**base_deal_kwargs, "currency": "THB", "purchase_unit_price_major": Decimal("95.00"),
          "incoterm": "FOB", "freight_total": Money.from_major("0.42", "USD") * Decimal("18000"),
          "locked_rates": {"THB": fx.rate("THB", "OMR"), "USD": fx.rate("USD", "OMR")}}
    r = compute_landed(DealInputs(**kw))
    assert _line(r, "purchase") == 18_278_361
    assert _line(r, "freight") == 2_906_820


def test_case5_thresholds(base_deal_kwargs):
    b = DealInputs(**base_deal_kwargs)
    market = Money.from_major("3.400", "OMR")
    m = Decimal("0.20")
    exact = solve_max_purchase_price_per_input_unit(b, market, m)
    assert exact.currency == "USD"

    def landed_at(minor):
        p = Decimal(minor) / 100
        return compute_landed(dataclasses.replace(b, purchase_unit_price_major=p)).landed_cost_per_sellable_unit.amount_minor

    target = (market * (Decimal("1") - m)).amount_minor
    assert landed_at(exact.amount_minor) <= target < landed_at(exact.amount_minor + 1)
    approx = max_purchase_price_per_input_unit(market, m, b.yield_pct, non_purchase_cost_per_input_unit(b))
    approx_usd = approx.major / b.locked_rates["USD"]
    assert abs(exact.major - approx_usd) / exact.major < Decimal("0.05")


def test_solver_infeasible_target(base_deal_kwargs):
    with pytest.raises(InfeasibleTarget):
        solve_max_purchase_price_per_input_unit(
            DealInputs(**base_deal_kwargs), Money.from_major("0.200", "OMR"), Decimal("0.20"))


def test_capital_decreases_with_longer_supplier_terms(base_deal_kwargs):
    short = compute_landed(DealInputs(**{**base_deal_kwargs, "supplier_terms_days": 0}))
    long_ = compute_landed(DealInputs(**{**base_deal_kwargs, "supplier_terms_days": 45}))
    assert _line(long_, "capital") < _line(short, "capital")


def test_yield_applied_once(base_deal_kwargs):
    r = compute_landed(DealInputs(**base_deal_kwargs))
    assert all(l.type != "wastage" for l in r.lines)
    assert _line(r, "processing") == 1_440_000


def test_ml_provenance(base_deal_kwargs):
    r = compute_landed(DealInputs(**{**base_deal_kwargs, "ml_fields": {"purchase_unit_price_major"}}))
    src = {l.type: l.source for l in r.lines}
    assert src["purchase"] == "ml"
    assert src["insurance"] == "ml_derived"
    assert src["duty"] == "ml_derived"
    assert src["capital"] == "ml_derived"
    assert src["overhead"] == "ml_derived"
    assert src["processing"] == "formula"
