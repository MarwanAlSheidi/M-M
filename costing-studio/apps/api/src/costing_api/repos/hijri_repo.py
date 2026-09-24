from __future__ import annotations
from datetime import date

from sqlalchemy import text


def is_ramadan(session, d: date) -> bool:
    row = session.execute(text("SELECT hijri_month FROM hijri_calendar WHERE gregorian_date = :d"),
                          {"d": d}).first()
    return bool(row and row.hijri_month == 9)
