"""Classifiers.

Two implementations behind one interface:

``MockClassifier``   deterministic, offline, no API key. Extracts what the text
                     explicitly says and infers a market default where the
                     field policy permits it. This is what makes the end-to-end
                     smoke test runnable in CI.
``OpenAIClassifier`` the real thing, with retry and structured JSON output.

Both return the same envelope. A per-record failure is returned as data, never
raised: the pipeline needs to score a failed record as an abstention, and an
exception would either crash the run or force a bare ``except`` at the call
site.
"""

from __future__ import annotations

import json
import time
from typing import Any, Dict, Iterable, List, Optional, Set

from .canonicalizer import AI_SYNONYMS, Canonicalizer
from .evidence_verifier import _tokenize
from .exceptions import ClassifierError
from .utils import safe_str


class BaseClassifier:
    """Interface every classifier implements."""

    name = "base"

    def classify(self, source_text: str, prompt: str, product_id: str = "") -> Dict[str, Any]:
        raise NotImplementedError("Subclasses must implement classify()")


class MockClassifier(BaseClassifier):
    """Deterministic keyword classifier used for tests and smoke runs."""

    name = "mock"

    # Fields where the mock will fall back to a market default when the text
    # is silent. Mirrors the inference_allowed policy without importing it, so
    # the classifier cannot quietly widen its own permissions.
    _DEFAULTS = {"fabric_family": "nida"}

    def __init__(
        self,
        canonicalizer: Canonicalizer,
        taxonomy: Dict[str, List[str]],
        fail_ids: Optional[Iterable[str]] = None,
        tokens_per_record: int = 220,
    ) -> None:
        self.canonicalizer = canonicalizer
        self.taxonomy = taxonomy
        self.fail_ids: Set[str] = {str(value) for value in (fail_ids or [])}
        self.tokens_per_record = tokens_per_record

    # ------------------------------------------------------------------

    def classify(self, source_text: str, prompt: str, product_id: str = "") -> Dict[str, Any]:
        if str(product_id) in self.fail_ids:
            return {
                "prediction": {},
                "usage": {},
                "error": f"simulated classifier failure for {product_id}",
            }

        text = safe_str(source_text)
        lowered = text.lower()
        tokens = set(_tokenize(lowered))

        prediction: Dict[str, Any] = {}
        for field, values in self.taxonomy.items():
            match = self._find(field, values, lowered, tokens)

            if match is not None:
                value, evidence = match
                prediction[field] = {
                    "value": value,
                    "confidence": 0.9,
                    "evidence": evidence,
                }
            elif field in self._DEFAULTS:
                prediction[field] = {
                    "value": self._DEFAULTS[field],
                    "confidence": 0.55,
                    "evidence": None,
                }
            else:
                prediction[field] = {"value": None, "confidence": 0.0, "evidence": None}

        usage = {
            "prompt_tokens": len(_tokenize(prompt)) + len(_tokenize(text)),
            "completion_tokens": self.tokens_per_record,
        }
        return {"prediction": prediction, "usage": usage}

    def _find(
        self,
        field: str,
        values: List[str],
        lowered: str,
        tokens: Set[str],
    ) -> Optional[tuple]:
        """First taxonomy value (or alias) the text mentions, with its evidence."""
        for value in values:
            for alias in self.canonicalizer.aliases_for(value, field, AI_SYNONYMS):
                alias_tokens = _tokenize(alias)
                if not alias_tokens:
                    continue
                if len(alias_tokens) == 1:
                    if alias_tokens[0] in tokens:
                        return value, alias
                elif alias in lowered:
                    return value, alias
        return None


class OpenAIClassifier(BaseClassifier):
    """Calls the OpenAI chat completions API with retry and JSON output."""

    name = "openai"

    def __init__(
        self,
        model: str,
        temperature: float = 0.0,
        max_retries: int = 3,
        base_delay: float = 1.0,
        seed: Optional[int] = None,
        api_key: Optional[str] = None,
    ) -> None:
        try:
            from openai import OpenAI  # imported lazily: tests never need it
        except ImportError as exc:  # pragma: no cover - depends on environment
            raise ClassifierError(
                "The openai package is required for OpenAIClassifier. "
                "Install it or set classifier: mock in configs/model_config.yaml"
            ) from exc

        self.client = OpenAI(api_key=api_key) if api_key else OpenAI()
        self.model = model
        self.temperature = temperature
        self.max_retries = max_retries
        self.base_delay = base_delay
        self.seed = seed

    def classify(self, source_text: str, prompt: str, product_id: str = "") -> Dict[str, Any]:
        retry_log: List[Dict[str, Any]] = []
        last_error: Optional[str] = None

        for attempt in range(self.max_retries):
            try:
                kwargs: Dict[str, Any] = {
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": prompt},
                        {"role": "user", "content": source_text},
                    ],
                    "temperature": self.temperature,
                    "response_format": {"type": "json_object"},
                }
                if self.seed is not None:
                    kwargs["seed"] = self.seed

                response = self.client.chat.completions.create(**kwargs)
                content = response.choices[0].message.content
                parsed = json.loads(content)

                if not isinstance(parsed, dict):
                    # A JSON array is a prompt-adherence failure, not a network
                    # one. Reporting it as an error would retry it three times
                    # and then file it under API failures.
                    return {
                        "prediction": {},
                        "usage": self._usage(response),
                        "raw_response": content,
                        "retry_log": retry_log,
                        "error": f"non_object_response:{type(parsed).__name__}",
                    }

                return {
                    "prediction": parsed,
                    "usage": self._usage(response),
                    "raw_response": content,
                    "retry_log": retry_log,
                }

            except Exception as exc:  # noqa: BLE001 - recorded, then retried
                last_error = str(exc)
                retry_log.append(
                    {
                        "attempt": attempt + 1,
                        "error": last_error,
                        "delay_seconds": self.base_delay * (2 ** attempt),
                    }
                )
                if attempt < self.max_retries - 1:
                    time.sleep(self.base_delay * (2 ** attempt))

        return {
            "prediction": {},
            "usage": {},
            "retry_log": retry_log,
            "error": last_error or "unknown_api_error",
        }

    @staticmethod
    def _usage(response: Any) -> Dict[str, Any]:
        usage = getattr(response, "usage", None)
        if usage is None:
            return {}
        return {
            "prompt_tokens": getattr(usage, "prompt_tokens", 0),
            "completion_tokens": getattr(usage, "completion_tokens", 0),
        }


def build_classifier(
    model_config: Dict[str, Any],
    canonicalizer: Canonicalizer,
    taxonomy: Dict[str, List[str]],
) -> BaseClassifier:
    """Construct the classifier named by ``model_config['classifier']``."""
    kind = (model_config or {}).get("classifier", "mock")

    if kind == "mock":
        return MockClassifier(canonicalizer=canonicalizer, taxonomy=taxonomy)

    if kind == "openai":
        return OpenAIClassifier(
            model=model_config.get("model", "gpt-4o-mini"),
            temperature=model_config.get("temperature", 0.0),
            max_retries=model_config.get("max_retries", 3),
            base_delay=model_config.get("retry_base_delay_seconds", 1.0),
            seed=model_config.get("seed"),
        )

    raise ClassifierError(f"Unknown classifier kind: {kind!r}")
