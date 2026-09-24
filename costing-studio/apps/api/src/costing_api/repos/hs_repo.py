from __future__ import annotations
from datetime import date
from decimal import Decimal

from sqlalchemy import text


class DutyRateNotFound(LookupError):
    pass


def get_duty_rate(session, hs_code: str, import_country: str,
                  origin_country: str | None, on_date: date) -> Decimal:
    """Most specific match: origin-specific beats NULL, then latest valid_from."""
    rate = session.execute(text("""
      SELECT rate FROM hs_duty_rates
       WHERE hs_code = :hs AND import_country = :ic
         AND (origin_country = :oc OR origin_country IS NULL)
         AND valid_from <= :d AND (valid_to IS NULL OR valid_to > :d)
       ORDER BY (origin_country IS NOT NULL) DESC, valid_from DESC
       LIMIT 1
    """), {"hs": hs_code, "ic": import_country, "oc": origin_country, "d": on_date}).scalar()
    if rate is None:
        raise DutyRateNotFound(f"no duty row for hs={hs_code} import={import_country} "
                               f"origin={origin_country} on {on_date}")
    return Decimal(str(rate))
