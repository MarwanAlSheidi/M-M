"""Populate hijri_calendar (Umm al-Qura via hijridate). Idempotent."""
from __future__ import annotations
from datetime import date, timedelta

from hijridate import Gregorian
from sqlalchemy import text

from _db import MigratorSessionLocal

START, END = date(2020, 1, 1), date(2030, 12, 31)
# Oman moon-sighting adjustments, e.g. {date(2024, 3, 11): (1445, 9, 1)}. Fill once verified.
OVERRIDES: dict[date, tuple[int, int, int]] = {}


def main() -> None:
    rows, d = [], START
    while d <= END:
        if d in OVERRIDES:
            y, m, dd = OVERRIDES[d]
            src, ovr = "override", True
        else:
            h = Gregorian(d.year, d.month, d.day).to_hijri()
            y, m, dd, src, ovr = h.year, h.month, h.day, "ummalqura", False
        rows.append({"d": d, "y": y, "m": m, "day": dd, "src": src, "ovr": ovr})
        d += timedelta(days=1)
    with MigratorSessionLocal() as s, s.begin():
        s.execute(text("""
          INSERT INTO hijri_calendar (gregorian_date, hijri_year, hijri_month, hijri_day, source, official_override)
          VALUES (:d, :y, :m, :day, :src, :ovr)
          ON CONFLICT (gregorian_date) DO UPDATE SET hijri_year = EXCLUDED.hijri_year,
            hijri_month = EXCLUDED.hijri_month, hijri_day = EXCLUDED.hijri_day,
            source = EXCLUDED.source, official_override = EXCLUDED.official_override
        """), rows)
    print(f"Hijri seed: {len(rows)} rows")


if __name__ == "__main__":
    main()
