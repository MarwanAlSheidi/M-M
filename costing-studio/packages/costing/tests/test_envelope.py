"""Envelope tripwire: 50 kg cement bag, OMR base, 15/30/45% margin on price.
unit cost 1,868 · floor 2,198 · target 2,669 · ceiling 3,396 (baisa per bag)."""
import json
from datetime import date
from decimal import Decimal as D

import pytest

from costing.envelope import (
    POSITIONS, CostElement, EnvelopeInputs, MarginConfig, MarketPrice, compare_to_market,
    compute_envelope, inputs_from_json, inputs_to_json, position_of,
)
from costing.fx import FxResolver
from costing.money import Money

USD_OMR = FxResolver().rate("USD", "OMR")


def cement(margin=MarginConfig(D("0.15"), D("0.30"), D("0.45")), **kw):
    els = (
        CostElement("clinker", "t", Money.from_major("28.000", "OMR"), D("0.0475")),
        CostElement("gypsum", "t", Money.from_major("18.000", "OMR"), D("0.0025")),
        CostElement("energy", "kWh", Money.from_major("0.025", "OMR"), D("5.5")),
        CostElement("bag", "each", Money.from_major("0.090", "OMR")),
        CostElement("labour_overhead", "bag", Money.from_major("0.150", "OMR")),
        CostElement("freight", "bag", Money.from_major("0.30", "USD")),
    )
    return EnvelopeInputs(**{"product_name": "Cement 50kg", "base_unit": "bag", "base_currency": "OMR",
                             "cost_elements": els, "margin": margin, "rates": {"USD": USD_OMR}, **kw})


def mp(src, major, d, ccy="OMR", unit="bag"):
    return MarketPrice(src, Money.from_major(major, ccy), unit, d)


def test_tripwire_values():
    e = compute_envelope(cement())
    assert [(l.name, l.amount.amount_minor) for l in e.lines] == [
        ("clinker", 1330), ("gypsum", 45), ("energy", 138), ("bag", 90),
        ("labour_overhead", 150), ("freight", 115)]      # energy 137.5 and freight 115.35 round per line
    assert (e.unit_cost_minor, e.floor_minor, e.target_minor, e.ceiling_minor) == (1868, 2198, 2669, 3396)
    assert e.currency == "OMR" and e.unit == "bag" and e.ceiling_source == "max_pct"
    assert e.floor_minor < e.target_minor < e.ceiling_minor


def test_ceiling_falls_back_to_mirror_without_max_pct():
    e = compute_envelope(cement(margin=MarginConfig(D("0.15"), D("0.30"))))
    assert e.ceiling_minor == 2669 + (2669 - 2198) == 3140 and e.ceiling_source == "mirror"


@pytest.mark.parametrize("m", [(D("0.30"), D("0.15"), None), (D("0.15"), D("0.15"), None),
                               (D("-0.01"), D("0.30"), None), (D("0.15"), D("0.30"), D("0.30")),
                               (D("0.15"), D("0.30"), D("1"))])
def test_margin_config_rejects_bad_ordering(m):
    with pytest.raises(ValueError):
        MarginConfig(*m)


def test_missing_fx_rate_and_empty_elements_are_errors():
    with pytest.raises(ValueError, match="no rate for USD"):
        compute_envelope(cement(rates={}))
    with pytest.raises(ValueError, match="no cost elements"):
        compute_envelope(cement(cost_elements=()))


@pytest.mark.parametrize("market,position", [
    ("1.867", "not_viable"), ("1.868", "too_low"), ("2.197", "too_low"), ("2.198", "attractive"),
    ("3.396", "attractive"), ("3.397", "too_high")])
def test_position_band_edges(market, position):
    e = compute_envelope(cement())
    assert position_of(e, Money.from_major(market, "OMR").amount_minor) == position
    assert position in POSITIONS


def test_compare_uses_median_of_latest_per_source_and_signed_gaps():
    e = compute_envelope(cement())
    prices = [mp("retail", "2.300", date(2026, 1, 1)), mp("retail", "2.500", date(2026, 2, 1)),   # latest wins
              mp("distributor", "2.400", date(2026, 2, 1)), mp("import", "2.700", date(2026, 1, 20))]
    c = compare_to_market(e, prices)
    assert c.market_reference_minor == 2500 and c.sources_used == ("distributor", "import", "retail")
    assert (c.gap_to_floor, c.gap_to_target, c.gap_to_ceiling) == (302, -169, -896)
    assert c.position == "attractive"
    even = compare_to_market(e, prices[1:3])
    assert even.market_reference_minor == 2450                      # mean of the middle two


def test_compare_converts_currency_and_mass_units():
    e = compute_envelope(cement(base_unit="kg"))                    # same costs, per kg for this check
    c = compare_to_market(e, [mp("lme", "5000.00", date(2026, 2, 1), ccy="USD", unit="tonne")], {"USD": USD_OMR})
    assert c.market_reference_minor == 1923                         # 5000 USD/t -> 1922.5 OMR/t -> 1.923/kg


def test_compare_rejects_non_mass_unit_mismatch_and_no_prices():
    e = compute_envelope(cement())
    with pytest.raises(ValueError):
        compare_to_market(e, [mp("x", "2.4", date(2026, 1, 1), unit="pallet")])
    with pytest.raises(ValueError, match="no market prices"):
        compare_to_market(e, [])


def test_inputs_snapshot_round_trip():
    inp = cement(as_of=date(2026, 3, 1))
    back = inputs_from_json(json.loads(json.dumps(inputs_to_json(inp))))
    assert back == inp
    assert compute_envelope(back) == compute_envelope(inp)
