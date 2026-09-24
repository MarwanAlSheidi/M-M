"""Global job: ECB daily reference rates -> fx_rates (non-pegged only), written as costing_worker."""
from __future__ import annotations
import xml.etree.ElementTree as ET
from datetime import date
from decimal import Decimal

import httpx
from sqlalchemy import text

from costing.currencies import is_pegged_to_usd

from ..db import WorkerSessionLocal

ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"


def fetch_ecb() -> tuple[date, dict[str, Decimal]]:
    with httpx.Client(timeout=20) as c:
        r = c.get(ECB_URL)
        r.raise_for_status()
    root = ET.fromstring(r.text)
    obs_date, per_eur = None, {}
    for el in root.iter():
        if not el.tag.endswith("Cube"):
            continue
        if "time" in el.attrib:
            obs_date = date.fromisoformat(el.attrib["time"])
        elif "currency" in el.attrib:
            per_eur[el.attrib["currency"]] = Decimal(el.attrib["rate"])
    if obs_date is None or "USD" not in per_eur:
        raise RuntimeError("ECB feed incomplete")
    usd_per_eur = per_eur["USD"]
    out = {"EUR": usd_per_eur}  # 1 EUR = usd_per_eur USD
    for ccy, x_per_eur in per_eur.items():
        out[ccy] = usd_per_eur / x_per_eur   # USD per 1 ccy
    return obs_date, out


def run(session, tenant_id=None):
    obs_date, rates = fetch_ecb()
    inserted = 0
    ws = WorkerSessionLocal()
    try:
        with ws.begin():
            for ccy, usd_per_ccy in rates.items():
                if ccy == "USD" or is_pegged_to_usd(ccy):
                    continue
                # Contract: 1 base = rate × quote  ->  base=ccy, quote=USD
                res = ws.execute(text("""
                  INSERT INTO fx_rates (base, quote, rate, source, observed_at)
                  VALUES (:c, 'USD', :r, 'ecb', :d)
                  ON CONFLICT (base, quote, observed_at, source) DO NOTHING
                """), {"c": ccy, "r": usd_per_ccy, "d": obs_date})
                inserted += res.rowcount
    finally:
        ws.close()
    return {"rows": inserted}
