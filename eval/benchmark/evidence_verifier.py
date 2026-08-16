"""Evidence verification — does the source text actually support the answer?

A model can produce the right label for the wrong reason. For fields where the
taxonomy is only meaningful when the text says so (silhouette, embellishment),
an unsupported answer is a guess even when it happens to match gold. This
module grades that support, and the Validator turns the grade into a decision.

Four grades:

``SUPPORTED``   the value, or one of its aliases, appears in the text
``PARTIAL``     part of a multi-token value appears, or an alias token does
``UNSUPPORTED`` the text explicitly supports a *different* value of this field
``ABSENT``      the text says nothing either way
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Sequence

from .canonicalizer import AI_SYNONYMS, Canonicalizer
from .utils import normalize_null, safe_str

SUPPORTED = "SUPPORTED"
PARTIAL = "PARTIAL"
UNSUPPORTED = "UNSUPPORTED"
ABSENT = "ABSENT"

# Tokens too generic to count as partial evidence on their own.
_STOPWORDS = frozenset({"a", "an", "the", "and", "or", "of", "with", "cut", "type"})

_TOKEN_RE = re.compile(r"[^\w؀-ۿ]+", re.UNICODE)


def _tokenize(text: str) -> List[str]:
    """Split on anything that is not a word character or Arabic codepoint."""
    return [token for token in _TOKEN_RE.split(text.lower()) if token]


class EvidenceVerifier:
    """Grades how well a source text supports a predicted value."""

    def __init__(
        self,
        canonicalizer: Canonicalizer,
        taxonomy: Dict[str, Sequence[Optional[str]]],
    ) -> None:
        self.canonicalizer = canonicalizer
        self.taxonomy = taxonomy

    # ------------------------------------------------------------------

    def verify(self, value: Any, field: str, source_text: Any) -> str:
        """Return the evidence grade for ``value`` of ``field`` in the text."""
        if normalize_null(value) is None:
            return ABSENT

        text = safe_str(source_text).strip().lower()
        if not text:
            return ABSENT

        canonical = self.canonicalizer.canonicalize_ai(value, field)
        if canonical is None:
            return ABSENT

        tokens = set(_tokenize(text))

        if self._has_full_match(canonical, field, text, tokens):
            return SUPPORTED

        if self._has_partial_match(canonical, field, tokens):
            return PARTIAL

        # The text is not silent — it supports a competing value of this same
        # field. That makes the prediction contradicted, not merely unevidenced.
        if self._supports_competing_value(canonical, field, text, tokens):
            return UNSUPPORTED

        return ABSENT

    # ------------------------------------------------------------------

    def _has_full_match(
        self,
        canonical: str,
        field: str,
        text: str,
        tokens: set,
    ) -> bool:
        for alias in self.canonicalizer.aliases_for(canonical, field, AI_SYNONYMS):
            alias_tokens = _tokenize(alias)
            if not alias_tokens:
                continue
            if len(alias_tokens) == 1:
                if alias_tokens[0] in tokens:
                    return True
            elif alias in text:
                # Multi-token aliases must appear contiguously to count as full
                # support; scattered tokens are graded PARTIAL below.
                return True
        return False

    def _has_partial_match(self, canonical: str, field: str, tokens: set) -> bool:
        for alias in self.canonicalizer.aliases_for(canonical, field, AI_SYNONYMS):
            alias_tokens = [
                token
                for token in _tokenize(alias)
                if token not in _STOPWORDS and len(token) > 2
            ]
            if len(alias_tokens) < 2:
                continue
            if any(token in tokens for token in alias_tokens):
                return True
        return False

    def _supports_competing_value(
        self,
        canonical: str,
        field: str,
        text: str,
        tokens: set,
    ) -> bool:
        for candidate in self.taxonomy.get(field, []) or []:
            if candidate is None:
                continue
            candidate_canonical = str(candidate).strip().lower()
            if candidate_canonical == canonical:
                continue
            if self._has_full_match(candidate_canonical, field, text, tokens):
                return True
        return False
