import json
from datetime import date
from decimal import Decimal

from costing.money import Money
from costing.serialize import _dec, _enc


def _round_trip(v):
    return _dec(json.loads(json.dumps(_enc(v))))


def test_scalars_round_trip_exactly():
    for v in (Decimal("0.0475"), Decimal("-12.500"), date(2026, 3, 1), Money(1868, "OMR"), Money(30, "USD"),
              "text", 7, 1.5, True, None):
        got = _round_trip(v)
        assert got == v and type(got) is type(v), v


def test_set_round_trips_as_set():
    assert _round_trip({"b", "a"}) == {"a", "b"}
    assert _round_trip(frozenset({"x"})) == {"x"}


def test_nested_dict_and_list():
    v = {"rates": {"USD": Decimal("0.3845")}, "as_of": date(2026, 1, 1),
         "lines": [{"name": "clinker", "rate": Money(28000, "OMR"), "qty": Decimal("0.0475")},
                   [Decimal("1"), date(2025, 12, 31)]],
         "tags": {"a"}}
    assert _round_trip(v) == v


def test_tuple_becomes_list_and_keys_become_strings():
    assert _round_trip((Decimal("1"), 2)) == [Decimal("1"), 2]
    assert _round_trip({1: Decimal("2")}) == {"1": Decimal("2")}


def test_encoded_form_is_plain_json():
    enc = _enc({"d": Decimal("1.10"), "m": Money(5, "USD"), "t": date(2026, 9, 1)})
    assert enc == {"d": {"__dec__": "1.10"}, "m": {"__money__": [5, "USD"]}, "t": {"__date__": "2026-09-01"}}
