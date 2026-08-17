"""Client-side rate limiting.

Defaults are deliberately conservative. A benchmark that saturates a provider's
limit spends its run retrying 429s, and the latency numbers it reports then
describe the queue rather than the model.

The clock and sleep function are injectable so the limiter is testable without
a test that actually waits.
"""

from __future__ import annotations

import time
from typing import Callable, Dict, Optional


class RateLimiter:
    """Spaces requests to stay under ``requests_per_minute``.

    A simple minimum-interval spacer rather than a token bucket: bursts are
    exactly what trips provider limits, and the benchmark has no deadline that
    a burst would help it meet.
    """

    def __init__(
        self,
        requests_per_minute: Optional[float] = 60.0,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.requests_per_minute = requests_per_minute
        self._clock = clock
        self._sleep = sleep
        self._last_request: Optional[float] = None
        self.total_wait_seconds = 0.0
        self.request_count = 0

    @property
    def min_interval(self) -> float:
        """Seconds that must separate two requests. Zero disables spacing."""
        if not self.requests_per_minute or self.requests_per_minute <= 0:
            return 0.0
        return 60.0 / float(self.requests_per_minute)

    def acquire(self) -> float:
        """Block until the next request may go out. Returns seconds waited."""
        self.request_count += 1
        interval = self.min_interval

        if interval <= 0 or self._last_request is None:
            self._last_request = self._clock()
            return 0.0

        elapsed = self._clock() - self._last_request
        wait = interval - elapsed

        if wait > 0:
            self._sleep(wait)
            self.total_wait_seconds += wait
            self._last_request = self._clock()
            return round(wait, 6)

        self._last_request = self._clock()
        return 0.0

    def summary(self) -> Dict[str, object]:
        return {
            "requests_per_minute": self.requests_per_minute,
            "min_interval_seconds": round(self.min_interval, 6),
            "requests": self.request_count,
            "total_wait_seconds": round(self.total_wait_seconds, 4),
        }
