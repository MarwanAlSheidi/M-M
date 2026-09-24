from decimal import Decimal
from costing.engine import compute_landed
from costing.models import DealInputs
from costing.money import Money


def _line(r, t):
    return next(l for l in r.lines if l.type == t).amount.amount_minor


def _kw(base):
    return {**base, "origin_charges": Money.from_major("120", "USD"),
            "freight_total": Money.from_major("0.15", "USD") * Decimal("18000")}


def test_exw(base_deal_kwargs):
    r = compute_landed(DealInputs(**{**_kw(base_deal_kwargs), "incoterm": "EXW"}))
    assert _line(r, "origin") == 46_140
    assert _line(r, "freight") == 1_038_150
    assert _line(r, "insurance") > 0


def test_fob(base_deal_kwargs):
    r = compute_landed(DealInputs(**{**_kw(base_deal_kwargs), "incoterm": "FOB"}))
    assert _line(r, "origin") == 0
    assert _line(r, "freight") == 1_038_150
    assert _line(r, "insurance") > 0


def test_cfr(base_deal_kwargs):
    r = compute_landed(DealInputs(**{**_kw(base_deal_kwargs), "incoterm": "CFR"}))
    assert _line(r, "freight") == 0
    assert _line(r, "insurance") > 0


def test_cif(base_deal_kwargs):
    r = compute_landed(DealInputs(**{**_kw(base_deal_kwargs), "incoterm": "CIF"}))
    assert _line(r, "freight") == 0
    assert _line(r, "insurance") == 0


def test_dap(base_deal_kwargs):
    r = compute_landed(DealInputs(**{**_kw(base_deal_kwargs), "incoterm": "DAP"}))
    assert _line(r, "freight") == 0
    assert _line(r, "insurance") == 0
    assert _line(r, "duty") > 0


def test_ddp(base_deal_kwargs):
    r = compute_landed(DealInputs(**{**_kw(base_deal_kwargs), "incoterm": "DDP", "vat_recoverable": False}))
    assert _line(r, "duty") == 0
    assert _line(r, "vat") == 0
