from __future__ import annotations
import numpy as np


def cyclical_month(month: int) -> tuple[float, float]:
    """Shared by training and serving so they cannot drift."""
    theta = 2.0 * np.pi * float(month) / 12.0
    return float(np.sin(theta)), float(np.cos(theta))


def cyclical_month_series(months):
    """Returns numpy arrays so assignment into a filtered frame cannot misalign."""
    values = months.astype(float).to_numpy() if hasattr(months, "to_numpy") \
        else np.asarray(months, dtype=float)
    theta = 2.0 * np.pi * values / 12.0
    return np.sin(theta), np.cos(theta)
