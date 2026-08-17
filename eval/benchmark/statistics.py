"""Statistics: confidence intervals, paired significance, percentiles.

Implemented without scipy. The benchmark deliberately carries no scientific
stack — every function here is a closed form or a small exact computation, and
each one documents its formula so a reviewer can check the arithmetic rather
than trust a library version.
"""

from __future__ import annotations

import math
from typing import Dict, Optional, Sequence

# Two-sided normal quantiles for the intervals the benchmark reports.
_Z_SCORES = {0.90: 1.6448536269514722, 0.95: 1.959963984540054, 0.99: 2.5758293035489004}

DEFAULT_CONFIDENCE = 0.95

# Above this discordant-pair count the exact binomial is slow and the
# chi-square approximation is accurate; below it, exactness matters.
_MCNEMAR_EXACT_THRESHOLD = 25


def z_for(confidence: float = DEFAULT_CONFIDENCE) -> float:
    """Normal quantile for a two-sided interval at ``confidence``."""
    if confidence in _Z_SCORES:
        return _Z_SCORES[confidence]
    raise ValueError(
        f"Unsupported confidence level {confidence!r}; use one of {sorted(_Z_SCORES)}"
    )


def wilson_interval(
    successes: int,
    total: int,
    confidence: float = DEFAULT_CONFIDENCE,
) -> Dict[str, Optional[float]]:
    """Wilson score interval for a binomial proportion.

    Wilson rather than the textbook normal approximation because benchmark
    accuracies live near 0 and 1, where the normal interval produces bounds
    outside [0, 1] and collapses to zero width at exactly 0/n and n/n — both of
    which would overstate certainty on precisely the results people quote.

        centre = (p̂ + z²/2n) / (1 + z²/n)
        halfwidth = z/(1 + z²/n) · √(p̂(1-p̂)/n + z²/4n²)

    A zero denominator returns ``None`` bounds: no observations means no
    interval, which is different from an interval of [0, 0].
    """
    if total <= 0:
        return {"point": 0.0, "low": None, "high": None, "n": 0, "successes": 0,
                "confidence": confidence, "method": "wilson"}

    successes = max(0, min(int(successes), int(total)))
    z = z_for(confidence)
    n = float(total)
    p = successes / n

    denominator = 1.0 + z * z / n
    centre = (p + z * z / (2 * n)) / denominator
    spread = z / denominator * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))

    return {
        "point": round(p, 6),
        "low": round(max(0.0, centre - spread), 6),
        "high": round(min(1.0, centre + spread), 6),
        "n": int(total),
        "successes": successes,
        "confidence": confidence,
        "method": "wilson",
    }


def _chi_square_p_value_1df(statistic: float) -> float:
    """Upper-tail p-value of a chi-square with one degree of freedom.

    For 1 dof the survival function has a closed form in terms of the
    complementary error function:

        P(X > x) = erfc(√(x/2))

    which needs only the standard library.
    """
    if statistic <= 0:
        return 1.0
    return math.erfc(math.sqrt(statistic / 2.0))


def _binomial_two_sided_p(b: int, c: int) -> float:
    """Exact two-sided binomial p-value for McNemar's discordant pairs.

    Under the null the b discordant pairs favouring A are Binomial(b+c, 0.5).
    The two-sided p-value doubles the smaller tail and clips at 1.

        p = min(1, 2 · Σ_{k=0}^{min(b,c)} C(n,k) · 0.5^n)
    """
    n = b + c
    if n == 0:
        return 1.0

    k = min(b, c)
    tail = sum(math.comb(n, i) for i in range(k + 1)) * (0.5 ** n)
    return min(1.0, 2.0 * tail)


def mcnemar_test(
    both_correct: int,
    only_a_correct: int,
    only_b_correct: int,
    both_wrong: int,
) -> Dict[str, object]:
    """McNemar's test for two models scored on the same records.

    Only the discordant pairs carry information: records both models get right,
    or both get wrong, say nothing about which is better. The statistic
    therefore uses ``only_a_correct`` (b) and ``only_b_correct`` (c) alone.

    Exact binomial when b + c < 25, chi-square with Yates' continuity
    correction above that:

        χ² = (|b − c| − 1)² / (b + c)

    Returns the p-value and the counts it came from. It does **not** return a
    verdict: significance thresholds are the reader's decision, and a p-value
    on one dataset is not a general claim about two models.
    """
    b = int(only_a_correct)
    c = int(only_b_correct)
    discordant = b + c

    if discordant == 0:
        return {
            "method": "none",
            "p_value": 1.0,
            "statistic": None,
            "both_correct": int(both_correct),
            "only_a_correct": b,
            "only_b_correct": c,
            "both_wrong": int(both_wrong),
            "discordant_pairs": 0,
            "note": "No discordant pairs; the models agree on every record.",
        }

    if discordant < _MCNEMAR_EXACT_THRESHOLD:
        method = "exact_binomial"
        statistic = None
        p_value = _binomial_two_sided_p(b, c)
    else:
        method = "chi_square_yates"
        statistic = (abs(b - c) - 1) ** 2 / discordant
        p_value = _chi_square_p_value_1df(statistic)

    return {
        # 12 decimals, not 8: a strongly significant result can have a p-value
        # below 1e-8, and rounding it to 0.0 would overstate the finding.
        "method": method,
        "p_value": round(p_value, 12),
        "statistic": round(statistic, 8) if statistic is not None else None,
        "both_correct": int(both_correct),
        "only_a_correct": b,
        "only_b_correct": c,
        "both_wrong": int(both_wrong),
        "discordant_pairs": discordant,
        "note": (
            "Discordant pairs only. A p-value is not a claim that one model is "
            "generally better; it describes these records under this prompt."
        ),
    }


def percentile(values: Sequence[float], fraction: float) -> Optional[float]:
    """Linear-interpolated percentile, matching numpy's default method.

        rank = fraction · (n − 1)

    Interpolates between the two neighbouring order statistics. Returns None
    for an empty sample rather than 0, which would read as "instant".
    """
    clean = sorted(float(value) for value in values if value is not None)
    if not clean:
        return None
    if len(clean) == 1:
        return round(clean[0], 4)

    rank = fraction * (len(clean) - 1)
    lower = math.floor(rank)
    upper = math.ceil(rank)

    if lower == upper:
        return round(clean[int(rank)], 4)

    weight = rank - lower
    return round(clean[lower] * (1 - weight) + clean[upper] * weight, 4)


def latency_summary(latencies: Sequence[Optional[float]]) -> Dict[str, Optional[float]]:
    """Operational latency statistics over the calls that produced a latency.

    Failed calls are excluded from *accuracy* elsewhere, but they are kept in
    operational reporting: a model that times out is slow, not absent. Callers
    pass in the latencies they measured, failures included.
    """
    clean = [float(value) for value in latencies if value is not None]

    if not clean:
        return {
            "count": 0,
            "mean_latency_ms": None,
            "median_latency_ms": None,
            "p95_latency_ms": None,
            "p99_latency_ms": None,
            "min_latency_ms": None,
            "max_latency_ms": None,
        }

    return {
        "count": len(clean),
        "mean_latency_ms": round(sum(clean) / len(clean), 4),
        "median_latency_ms": percentile(clean, 0.50),
        "p95_latency_ms": percentile(clean, 0.95),
        "p99_latency_ms": percentile(clean, 0.99),
        "min_latency_ms": round(min(clean), 4),
        "max_latency_ms": round(max(clean), 4),
    }


def safe_ratio(numerator: float, denominator: float, digits: int = 6) -> float:
    """Zero denominators return 0.0 rather than raising."""
    if not denominator:
        return 0.0
    return round(numerator / denominator, digits)
