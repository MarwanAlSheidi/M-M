from __future__ import annotations
from dataclasses import dataclass
from datetime import date

from sqlalchemy import text

from costing.money import Money


class LaneNotFound(LookupError):
    pass


@dataclass(frozen=True)
class LaneCost:
    clearing_fixed: Money


def get_lane_cost(session, tenant_id, origin, dest, mode, as_of: date) -> LaneCost:
    """Tenant override (tenant_lane_costs, RLS) beats the global lane_costs row."""
    row = session.execute(text("""
      SELECT clearing_fixed_minor, clearing_currency, valid_from, 1 AS is_tenant
        FROM tenant_lane_costs
       WHERE tenant_id = :t AND origin_country = :o AND dest_country = :d AND mode = :m
         AND valid_from <= :as_of AND (valid_to IS NULL OR valid_to > :as_of)
      UNION ALL
      SELECT clearing_fixed_minor, clearing_currency, valid_from, 0 AS is_tenant
        FROM lane_costs
       WHERE origin_country = :o AND dest_country = :d AND mode = :m
         AND valid_from <= :as_of AND (valid_to IS NULL OR valid_to > :as_of)
      ORDER BY is_tenant DESC, valid_from DESC
      LIMIT 1
    """), {"t": tenant_id, "o": origin, "d": dest, "m": mode, "as_of": as_of}).mappings().first()
    if not row:
        raise LaneNotFound(f"no lane {origin}->{dest} ({mode}) valid on {as_of}")
    return LaneCost(clearing_fixed=Money(int(row["clearing_fixed_minor"]), row["clearing_currency"]))
