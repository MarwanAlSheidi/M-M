"""Exception hierarchy for the benchmark.

Every exception here signals a condition that must stop the run. Nothing in
this module is used for control flow over expected outcomes: an abstention, an
invalid taxonomy value or a classifier error are *data*, not exceptions.
"""

from __future__ import annotations


class BenchmarkError(Exception):
    """Base class for every benchmark failure."""


class IntegrityError(BenchmarkError):
    """Raised when the benchmark cannot vouch for what it is measuring.

    Hash mismatch, dataset/gold divergence, duplicate evaluation IDs. Always
    fatal: a benchmark that continues past this point reports numbers about an
    artefact nobody can identify.
    """


class LeakageError(IntegrityError):
    """Raised when training data overlaps the evaluation set.

    A subclass of IntegrityError because leakage invalidates the measurement in
    exactly the same way, and callers guarding against corruption should catch
    both with one clause.
    """


class ConfigError(BenchmarkError):
    """Raised when configuration is missing, malformed or self-inconsistent."""


class ClassifierError(BenchmarkError):
    """Raised for unrecoverable classifier setup problems.

    Per-record classifier failures are *not* raised: they are returned as an
    error payload so the record can be scored as an abstention.
    """
