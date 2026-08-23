"""Secret redaction for everything the benchmark writes to disk.

Two layers, because either alone leaks:

1. **Known values.** Any string registered as a secret (read from the
   environment at run start) is replaced wherever it appears. This catches a
   key echoed back inside a provider error message, which no pattern would
   recognise as a key.
2. **Shape patterns.** Common credential formats, for secrets this process was
   never told about — a key pasted into a description field, a bearer token in
   a response header.

Registration reads the *value* out of the environment and never stores the
variable name alongside it in output.
"""

from __future__ import annotations

import os
import re
from typing import Any, Dict, Iterable, List, Optional, Pattern, Set

REDACTED = "[REDACTED]"

# Header names whose values are never safe to record.
SENSITIVE_HEADERS = frozenset(
    {
        "authorization",
        "x-api-key",
        "api-key",
        "proxy-authorization",
        "cookie",
        "set-cookie",
        "openai-organization",
        "x-goog-api-key",
    }
)

# Shapes of credentials, for values this process was never handed directly.
_PATTERNS: List[Pattern] = [
    re.compile(r"\bsk-[A-Za-z0-9_\-]{16,}\b"),           # OpenAI style
    re.compile(r"\bsk-ant-[A-Za-z0-9_\-]{16,}\b"),       # Anthropic style
    re.compile(r"\bAIza[A-Za-z0-9_\-]{20,}\b"),          # Google API keys
    re.compile(r"\bghp_[A-Za-z0-9]{20,}\b"),             # GitHub tokens
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._\-]{16,}"),  # Bearer tokens
]

# Minimum length before a registered value is treated as a secret. Redacting a
# 3-character value would corrupt ordinary text everywhere it appeared.
_MIN_SECRET_LENGTH = 8


class Redactor:
    """Removes secret values and credential-shaped strings from any payload."""

    def __init__(self, secrets: Optional[Iterable[str]] = None) -> None:
        self._secrets: Set[str] = set()
        for secret in secrets or []:
            self.register(secret)

    # ------------------------------------------------------------------

    def register(self, value: Optional[str]) -> bool:
        """Register a literal secret value. Returns True if it was accepted."""
        if not value or not isinstance(value, str):
            return False
        stripped = value.strip()
        if len(stripped) < _MIN_SECRET_LENGTH:
            return False
        self._secrets.add(stripped)
        return True

    def register_env(self, *names: str) -> List[str]:
        """Register the values of the named environment variables.

        Returns the names that actually held a usable secret, so callers can
        report which credentials are configured without printing the values.
        """
        registered = []
        for name in names:
            if self.register(os.environ.get(name)):
                registered.append(name)
        return registered

    @property
    def secret_count(self) -> int:
        return len(self._secrets)

    # ------------------------------------------------------------------

    def redact_text(self, text: str) -> str:
        """Replace every known secret and credential shape in ``text``."""
        if not isinstance(text, str) or not text:
            return text

        result = text
        # Longest first: a short secret that is a substring of a longer one
        # must not partially mask it and leave the remainder readable.
        for secret in sorted(self._secrets, key=len, reverse=True):
            if secret in result:
                result = result.replace(secret, REDACTED)

        for pattern in _PATTERNS:
            result = pattern.sub(REDACTED, result)

        return result

    def redact(self, obj: Any) -> Any:
        """Recursively redact strings inside any JSON-shaped structure."""
        if isinstance(obj, str):
            return self.redact_text(obj)

        if isinstance(obj, dict):
            redacted: Dict[Any, Any] = {}
            for key, value in obj.items():
                if isinstance(key, str) and key.lower() in SENSITIVE_HEADERS:
                    redacted[key] = REDACTED
                else:
                    redacted[key] = self.redact(value)
            return redacted

        if isinstance(obj, list):
            return [self.redact(value) for value in obj]

        if isinstance(obj, tuple):
            return tuple(self.redact(value) for value in obj)

        return obj

    def contains_secret(self, obj: Any) -> bool:
        """True if any registered secret survives anywhere in ``obj``.

        Used by the tests that prove audit output is clean.
        """
        if not self._secrets:
            return False

        def _walk(value: Any) -> bool:
            if isinstance(value, str):
                return any(secret in value for secret in self._secrets)
            if isinstance(value, dict):
                return any(_walk(key) or _walk(item) for key, item in value.items())
            if isinstance(value, (list, tuple, set)):
                return any(_walk(item) for item in value)
            return False

        return _walk(obj)


# A process-wide default so the Auditor redacts even when no one wired one up.
# Registration is explicit; this instance starts empty and knows only shapes.
_default = Redactor()


def default_redactor() -> Redactor:
    return _default


def redact(obj: Any) -> Any:
    """Redact using the process default redactor."""
    return _default.redact(obj)
