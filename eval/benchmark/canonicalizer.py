"""Canonicalization — the single source of truth for correctness.

Nothing else in the benchmark is allowed to decide whether two values agree.
Every comparison funnels through :meth:`Canonicalizer.is_correct`, because the
moment a second implementation of "are these the same?" exists, the two drift
and the benchmark reports a number nobody can reproduce.

Gold and predictions get *separate* synonym maps. They drift differently: gold
carries whatever the annotator typed, predictions carry whatever the model
emitted, and a shared map leaks one vocabulary into the other. The maps are
also keyed per field, because ``stone`` is a colour under ``color_normalized``
and an embellishment under ``embellishment_type``.
"""

from __future__ import annotations

import os
from typing import Any, Dict, Optional

import yaml

from .exceptions import ConfigError
from .utils import normalize_null

AI_SYNONYMS = "ai_synonyms"
GOLD_SYNONYMS = "gold_synonyms"


class Canonicalizer:
    """Maps raw values onto their canonical taxonomy form."""

    def __init__(self, synonyms_path: str) -> None:
        self.synonyms_path = synonyms_path
        self._maps = self._load(synonyms_path)

    # ------------------------------------------------------------------
    # loading
    # ------------------------------------------------------------------

    @staticmethod
    def _load(path: str) -> Dict[str, Dict[str, Dict[str, str]]]:
        if not os.path.exists(path):
            raise ConfigError(f"Synonyms file not found: {path}")

        try:
            with open(path, "r", encoding="utf-8") as handle:
                raw = yaml.safe_load(handle)
        except yaml.YAMLError as exc:
            raise ConfigError(f"Malformed synonyms YAML at {path}: {exc}") from exc

        if raw is None:
            raw = {}
        if not isinstance(raw, dict):
            raise ConfigError(f"Synonyms YAML must be a mapping, got {type(raw).__name__}")

        maps: Dict[str, Dict[str, Dict[str, str]]] = {}
        for map_type in (AI_SYNONYMS, GOLD_SYNONYMS):
            section = raw.get(map_type) or {}
            if not isinstance(section, dict):
                raise ConfigError(f"Synonyms section '{map_type}' must be a mapping")

            per_field: Dict[str, Dict[str, str]] = {}
            for field, entries in section.items():
                if entries is None:
                    per_field[field] = {}
                    continue
                if not isinstance(entries, dict):
                    raise ConfigError(
                        f"Synonyms['{map_type}']['{field}'] must be a mapping"
                    )
                # Keys are normalized on load so lookup never has to guess.
                per_field[field] = {
                    str(key).strip().lower(): str(value).strip().lower()
                    for key, value in entries.items()
                }
            maps[map_type] = per_field

        return maps

    # ------------------------------------------------------------------
    # canonicalization
    # ------------------------------------------------------------------

    def canonicalize(
        self,
        value: Any,
        field: str,
        map_type: str = AI_SYNONYMS,
    ) -> Optional[str]:
        """Return the canonical form of ``value`` for ``field``, or ``None``.

        Order matters: null check, safe stringification, strip, lowercase, then
        the field's synonym map. A value with no synonym entry returns its
        normalized lowercase self rather than ``None`` — an unknown value is
        still a value, and swallowing it here would turn a wrong answer into an
        abstention.
        """
        if map_type not in (AI_SYNONYMS, GOLD_SYNONYMS):
            raise ValueError(f"Unknown synonym map type: {map_type!r}")

        if normalize_null(value) is None:
            return None

        if isinstance(value, (list, tuple, set, dict)):
            # Containers are never valid taxonomy values. Stringifying one
            # would invent a label like "['a', 'b']" and score it as a wrong
            # answer instead of a malformed one, so refuse it outright.
            return None

        text = str(value).strip().lower()
        if not text:
            return None

        return self._maps.get(map_type, {}).get(field, {}).get(text, text)

    def canonicalize_gold(self, value: Any, field: str) -> Optional[str]:
        """Canonicalize an annotator-written gold value."""
        return self.canonicalize(value, field, GOLD_SYNONYMS)

    def canonicalize_ai(self, value: Any, field: str) -> Optional[str]:
        """Canonicalize a model-written prediction."""
        return self.canonicalize(value, field, AI_SYNONYMS)

    # ------------------------------------------------------------------
    # correctness
    # ------------------------------------------------------------------

    def is_correct(self, gold: Any, prediction: Any, field: str) -> bool:
        """The benchmark's only definition of a correct prediction.

        ``None == None`` is correct: gold says there is no evidence for this
        field and the model agreed. ``None`` against anything else is wrong in
        both directions — a hallucination one way, a miss the other.
        """
        gold_canonical = self.canonicalize_gold(gold, field)
        prediction_canonical = self.canonicalize_ai(prediction, field)

        if gold_canonical is None and prediction_canonical is None:
            return True
        if gold_canonical is None or prediction_canonical is None:
            return False

        return gold_canonical == prediction_canonical

    # ------------------------------------------------------------------
    # introspection (used by the integrity gate and the evidence verifier)
    # ------------------------------------------------------------------

    def aliases_for(self, canonical_value: str, field: str, map_type: str = AI_SYNONYMS):
        """Every surface form that canonicalizes to ``canonical_value``.

        The evidence verifier needs these: a description saying "farasha" is
        evidence for a prediction of "butterfly".
        """
        target = str(canonical_value).strip().lower()
        field_map = self._maps.get(map_type, {}).get(field, {})
        aliases = {target}
        aliases.update(alias for alias, canon in field_map.items() if canon == target)
        return sorted(aliases)

    def as_dict(self) -> Dict[str, Dict[str, Dict[str, str]]]:
        """The loaded maps, for hashing by the integrity gate."""
        return self._maps
