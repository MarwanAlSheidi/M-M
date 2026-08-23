"""Validation — turns a raw model answer into a decision the benchmark trusts.

The Validator answers three questions per field, in order:

1. Is this a value at all? (null, or a type that cannot be a label)
2. Is it in the taxonomy, once canonicalized?
3. Does the source text support it, and is this a field where that matters?

The output never overwrites the raw answer. It carries the raw value, the
canonical form, the evidence grade, the confidence after any cap, and a
decision of PREDICT, ABSTAIN or UNKNOWN.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional, Sequence

import yaml

from .canonicalizer import Canonicalizer
from .evidence_verifier import ABSENT, PARTIAL, SUPPORTED, UNSUPPORTED, EvidenceVerifier
from .exceptions import ConfigError
from .utils import normalize_null

PREDICT = "PREDICT"
ABSTAIN = "ABSTAIN"
UNKNOWN = "UNKNOWN"

# Types that can carry a taxonomy label. Anything else (list, dict, bool) is a
# schema violation, not a wrong answer, and must be distinguishable from one.
_SUPPORTED_TYPES = (str, int, float)

_DEFAULT_CAPS = {"PARTIAL": 0.7, "UNSUPPORTED": 0.3, "INFERRED": 0.6}


def _load_yaml(path: str, label: str) -> Dict[str, Any]:
    if not os.path.exists(path):
        raise ConfigError(f"{label} file not found: {path}")
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = yaml.safe_load(handle)
    except yaml.YAMLError as exc:
        raise ConfigError(f"Malformed {label} YAML at {path}: {exc}") from exc
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise ConfigError(f"{label} YAML must be a mapping, got {type(data).__name__}")
    return data


class Validator:
    """Validates predictions field by field against taxonomy and evidence."""

    def __init__(
        self,
        taxonomy_path: str,
        critical_fields_path: str,
        canonicalizer: Canonicalizer,
        evidence_verifier: Optional[EvidenceVerifier] = None,
    ) -> None:
        self.taxonomy_path = taxonomy_path
        self.critical_fields_path = critical_fields_path
        self.canonicalizer = canonicalizer

        taxonomy_raw = _load_yaml(taxonomy_path, "Taxonomy")
        fields = taxonomy_raw.get("fields")
        if not isinstance(fields, dict) or not fields:
            raise ConfigError(f"Taxonomy at {taxonomy_path} declares no fields")

        # Lowercased on load so nothing downstream has to remember to do it.
        self.taxonomy: Dict[str, List[str]] = {
            field: [str(value).strip().lower() for value in (values or [])]
            for field, values in fields.items()
        }
        self.gold_columns: Dict[str, str] = {
            field: taxonomy_raw.get("gold_columns", {}).get(field, field)
            for field in self.taxonomy
        }

        policy = _load_yaml(critical_fields_path, "Critical fields")
        self.critical_fields: List[str] = list(policy.get("critical_fields") or [])
        self.secondary_fields: List[str] = list(policy.get("secondary_fields") or [])
        self.evidence_required = set(policy.get("evidence_required") or [])
        self.inference_allowed = set(policy.get("inference_allowed") or [])

        caps = dict(_DEFAULT_CAPS)
        caps.update(policy.get("confidence_caps") or {})
        self.confidence_caps = {key: float(value) for key, value in caps.items()}

        unknown = (set(self.critical_fields) | set(self.secondary_fields)) - set(self.taxonomy)
        if unknown:
            raise ConfigError(
                "Field policy references fields absent from the taxonomy: "
                + ", ".join(sorted(unknown))
            )

        self.evidence_verifier = evidence_verifier or EvidenceVerifier(
            canonicalizer, self.taxonomy
        )

    # ------------------------------------------------------------------

    @property
    def fields(self) -> List[str]:
        """Evaluated fields, critical first, in a stable order."""
        ordered = [f for f in self.critical_fields if f in self.taxonomy]
        ordered += [f for f in self.secondary_fields if f in self.taxonomy]
        ordered += [f for f in self.taxonomy if f not in ordered]
        return ordered

    def gold_column(self, field: str) -> str:
        return self.gold_columns.get(field, field)

    # ------------------------------------------------------------------

    def validate_field(
        self,
        field: str,
        value: Any,
        confidence: Any = None,
        evidence: Any = None,
        source_text: Any = "",
    ) -> Dict[str, Any]:
        """Validate one field's prediction. Always returns the full record."""
        original_confidence = self._coerce_confidence(confidence)

        if field not in self.taxonomy:
            # Not a field this benchmark measures; nothing can be said about it.
            return self._record(
                value=value,
                confidence=0.0,
                evidence=evidence,
                valid=False,
                reason="unknown_field",
                evidence_status=ABSENT,
                confidence_penalty=original_confidence,
                canonical_value=None,
                decision=UNKNOWN,
            )

        # 1. Null is a legitimate answer: the model declining to guess.
        if normalize_null(value) is None:
            return self._record(
                value=None,
                confidence=0.0,
                evidence=evidence,
                valid=True,
                reason="null_prediction",
                evidence_status=ABSENT,
                confidence_penalty=original_confidence,
                canonical_value=None,
                decision=ABSTAIN,
            )

        # 2. A container or bool cannot be a label. Schema violation, not a
        #    wrong answer — keep the two countable apart.
        if isinstance(value, bool) or not isinstance(value, _SUPPORTED_TYPES):
            return self._record(
                value=value,
                confidence=0.0,
                evidence=evidence,
                valid=False,
                reason=f"unsupported_type:{type(value).__name__}",
                evidence_status=ABSENT,
                confidence_penalty=original_confidence,
                canonical_value=None,
                decision=ABSTAIN,
            )

        # 3-5. Canonicalize, then require membership in the taxonomy.
        canonical = self.canonicalizer.canonicalize_ai(value, field)
        if canonical is None or canonical not in self.taxonomy[field]:
            return self._record(
                value=value,
                confidence=0.0,
                evidence=evidence,
                valid=False,
                reason="invalid_taxonomy_value",
                evidence_status=ABSENT,
                confidence_penalty=original_confidence,
                canonical_value=None,
                decision=ABSTAIN,
            )

        # 6-7. Evidence grading, then the field's policy for that grade.
        evidence_text = evidence if normalize_null(evidence) is not None else source_text
        status = self.evidence_verifier.verify(canonical, field, evidence_text)

        if status == ABSENT and normalize_null(evidence) is not None:
            # The model quoted evidence that does not support its own answer.
            # Re-check against the full source before concluding it is absent.
            status = self.evidence_verifier.verify(canonical, field, source_text)

        decision, final_confidence, reason = self._apply_policy(
            field, status, original_confidence
        )

        return self._record(
            value=value,
            confidence=final_confidence,
            evidence=evidence,
            valid=True,
            reason=reason,
            evidence_status=status,
            confidence_penalty=round(original_confidence - final_confidence, 6),
            canonical_value=canonical,
            decision=decision,
        )

    # ------------------------------------------------------------------

    def _apply_policy(
        self,
        field: str,
        status: str,
        confidence: float,
    ) -> tuple:
        """Map an evidence grade onto a decision and a confidence ceiling."""
        if status == SUPPORTED:
            return PREDICT, confidence, "evidence_supported"

        if status == PARTIAL:
            return (
                PREDICT,
                min(confidence, self.confidence_caps["PARTIAL"]),
                "evidence_partial",
            )

        if status == UNSUPPORTED:
            return (
                PREDICT,
                min(confidence, self.confidence_caps["UNSUPPORTED"]),
                "evidence_unsupported",
            )

        # status == ABSENT. Inference-allowed fields may still answer; every
        # other field abstains. The default is strict on purpose: a new field
        # must opt in to guessing.
        if field in self.inference_allowed:
            return (
                PREDICT,
                min(confidence, self.confidence_caps["INFERRED"]),
                "inferred_without_evidence",
            )

        return ABSTAIN, 0.0, "evidence_absent"

    @staticmethod
    def _coerce_confidence(confidence: Any) -> float:
        """Clamp anything the model called a confidence into [0, 1]."""
        if normalize_null(confidence) is None:
            return 0.0
        try:
            value = float(confidence)
        except (TypeError, ValueError):
            return 0.0
        if value != value:  # NaN
            return 0.0
        return max(0.0, min(1.0, value))

    @staticmethod
    def _record(**kwargs: Any) -> Dict[str, Any]:
        """Assemble the validation record with a fixed key order."""
        return {
            "value": kwargs["value"],
            "confidence": kwargs["confidence"],
            "evidence": kwargs["evidence"],
            "valid": kwargs["valid"],
            "reason": kwargs["reason"],
            "evidence_status": kwargs["evidence_status"],
            "confidence_penalty": kwargs["confidence_penalty"],
            "canonical_value": kwargs["canonical_value"],
            "decision": kwargs["decision"],
        }

    # ------------------------------------------------------------------

    def validate_prediction(
        self,
        prediction: Dict[str, Any],
        source_text: Any = "",
    ) -> Dict[str, Dict[str, Any]]:
        """Validate every taxonomy field of one record's prediction."""
        if not isinstance(prediction, dict):
            prediction = {}

        validated: Dict[str, Dict[str, Any]] = {}
        for field in self.fields:
            entry = prediction.get(field)

            if isinstance(entry, dict):
                value = entry.get("value")
                confidence = entry.get("confidence")
                evidence = entry.get("evidence")
            else:
                # Bare value form: {"silhouette": "butterfly"}
                value = entry
                confidence = None
                evidence = None

            validated[field] = self.validate_field(
                field=field,
                value=value,
                confidence=confidence,
                evidence=evidence,
                source_text=source_text,
            )
        return validated

    def abstained_prediction(self, reason: str = "classifier_error") -> Dict[str, Dict[str, Any]]:
        """A fully-abstained structure, used when the classifier fails.

        Scored exactly like a model that declined to answer, so a failed record
        depresses recall rather than vanishing from the denominator.
        """
        return {
            field: self._record(
                value=None,
                confidence=0.0,
                evidence=None,
                valid=True,
                reason=reason,
                evidence_status=ABSENT,
                confidence_penalty=0.0,
                canonical_value=None,
                decision=ABSTAIN,
            )
            for field in self.fields
        }

    def taxonomy_as_dict(self) -> Dict[str, Sequence[str]]:
        """The loaded taxonomy, for hashing by the integrity gate."""
        return self.taxonomy
