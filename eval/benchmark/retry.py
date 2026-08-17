"""Retry policy.

The distinction that matters: a *transient* failure is one where the identical
request might succeed later — a timeout, a rate limit, a 503. A *permanent*
failure is one where it never will: a bad key, a malformed request, a model
that does not exist. Retrying a permanent failure burns quota and, worse,
files a configuration error under "flaky network" in the report.

Classification is by exception type name and message rather than by importing
each provider's exception classes, so this module has no provider dependencies
and stays unit-testable without any SDK installed.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

TRANSIENT = "transient"
PERMANENT = "permanent"

# Retryable: the same request may succeed on a later attempt.
_TRANSIENT_TYPES = frozenset(
    {
        "timeout",
        "timeouterror",
        "connectionerror",
        "connectionreseterror",
        "apiconnectionerror",
        "apitimeouterror",
        "ratelimiterror",
        "internalservererror",
        "serviceunavailable",
        "serviceunavailableerror",
        "overloadederror",
        "apistatuserror",
        "readtimeout",
        "remotedisconnected",
    }
)

# Never retryable: the request itself is wrong.
_PERMANENT_TYPES = frozenset(
    {
        "authenticationerror",
        "permissiondeniederror",
        "notfounderror",
        "badrequesterror",
        "invalidrequesterror",
        "unprocessableentityerror",
        "jsondecodeerror",
        "validationerror",
        "typeerror",
        "valueerror",
        "keyerror",
        "integrityerror",
        "leakageerror",
        "configerror",
    }
)

_TRANSIENT_PATTERNS = [
    re.compile(r"(?i)\brate.?limit"),
    re.compile(r"(?i)\btimed?.?out\b"),
    re.compile(r"(?i)\btemporarily unavailable\b"),
    re.compile(r"(?i)\boverloaded\b"),
    re.compile(r"(?i)\bconnection (reset|refused|aborted|error)\b"),
    re.compile(r"(?i)\b(429|500|502|503|504)\b"),
]

_PERMANENT_PATTERNS = [
    re.compile(r"(?i)\binvalid[_ ]?api[_ ]?key\b"),
    re.compile(r"(?i)\bincorrect api key\b"),
    re.compile(r"(?i)\bauthentication\b"),
    re.compile(r"(?i)\bunauthorized\b"),
    re.compile(r"(?i)\bpermission denied\b"),
    re.compile(r"(?i)\bmodel .* (does not exist|not found)\b"),
    re.compile(r"(?i)\b(400|401|403|404|422)\b"),
]

# HTTP status codes, when the exception exposes one directly.
_TRANSIENT_STATUS = frozenset({408, 409, 425, 429, 500, 502, 503, 504})
_PERMANENT_STATUS = frozenset({400, 401, 403, 404, 405, 410, 422})


def classify_error(error: BaseException) -> Tuple[str, str]:
    """Return ``(TRANSIENT | PERMANENT, reason)`` for a provider exception.

    Status code first (most reliable), then exception type, then message text.
    Anything unrecognised is PERMANENT: retrying an error nobody understands
    is how a benchmark spends an afternoon multiplying the same bug by three.
    """
    status = getattr(error, "status_code", None) or getattr(error, "code", None)
    if isinstance(status, int):
        if status in _TRANSIENT_STATUS:
            return TRANSIENT, f"http_{status}"
        if status in _PERMANENT_STATUS:
            return PERMANENT, f"http_{status}"

    type_name = type(error).__name__.lower()
    if type_name in _PERMANENT_TYPES:
        return PERMANENT, f"exception_type:{type(error).__name__}"
    if type_name in _TRANSIENT_TYPES:
        return TRANSIENT, f"exception_type:{type(error).__name__}"

    message = str(error)
    for pattern in _PERMANENT_PATTERNS:
        if pattern.search(message):
            return PERMANENT, f"message_match:{pattern.pattern}"
    for pattern in _TRANSIENT_PATTERNS:
        if pattern.search(message):
            return TRANSIENT, f"message_match:{pattern.pattern}"

    return PERMANENT, "unclassified"


@dataclass
class RetryOutcome:
    """What happened across all attempts for one request."""

    final_status: str  # "success" | "error"
    attempt_count: int
    result: Any = None
    error: Optional[BaseException] = None
    error_category: Optional[str] = None
    retry_reason: List[str] = field(default_factory=list)

    def as_dict(self) -> Dict[str, Any]:
        return {
            "final_status": self.final_status,
            "attempt_count": self.attempt_count,
            "retry_reason": list(self.retry_reason),
            "error_category": self.error_category,
        }


@dataclass
class RetryPolicy:
    """Bounded exponential backoff over transient failures only."""

    max_retries: int = 3
    backoff_base: float = 1.0
    backoff_max: float = 30.0
    sleep: Callable[[float], None] = time.sleep

    def delay_for(self, attempt: int) -> float:
        """Delay before attempt ``attempt`` (1-indexed), capped at backoff_max."""
        return min(self.backoff_base * (2 ** (attempt - 1)), self.backoff_max)

    def run(self, operation: Callable[[], Any]) -> RetryOutcome:
        """Call ``operation`` until it succeeds, is permanent, or runs out."""
        attempts = max(1, int(self.max_retries))
        reasons: List[str] = []

        for attempt in range(1, attempts + 1):
            try:
                result = operation()
            except BaseException as exc:  # noqa: BLE001 - classified, never swallowed
                category, reason = classify_error(exc)
                reasons.append(f"attempt_{attempt}:{category}:{reason}")

                if category == PERMANENT or attempt == attempts:
                    return RetryOutcome(
                        final_status="error",
                        attempt_count=attempt,
                        error=exc,
                        error_category=category,
                        retry_reason=reasons,
                    )

                self.sleep(self.delay_for(attempt))
                continue

            return RetryOutcome(
                final_status="success",
                attempt_count=attempt,
                result=result,
                retry_reason=reasons,
            )

        # Unreachable: the loop always returns. Kept explicit so a future edit
        # to the loop bounds cannot fall through to None.
        raise AssertionError("RetryPolicy.run exhausted its loop without returning")
