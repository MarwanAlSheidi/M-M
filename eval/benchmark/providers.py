"""Provider adapters behind one normalized interface.

Every adapter returns the *same* envelope, so nothing downstream — pipeline,
validator, evaluator, cost, comparison — ever sees a provider-specific shape.
That isolation is what allows a model to be added by configuration alone.

The envelope::

    {
      "prediction":     dict,             # parsed model output, {} on failure
      "usage":          {"input_tokens": int|None,
                         "output_tokens": int|None,
                         "total_tokens": int|None},
      "latency_ms":     float,
      "model":          str,
      "provider":       str,
      "request_id":     str|None,
      "error":          str|None,         # human-readable, redacted
      "error_category": str|None,         # transient | permanent | parsing | schema
      "raw_response":   str|None,         # redacted
      "attempt_count":  int,
      "retry_reason":   list[str],
      "final_status":   "success" | "error",
      "cost":           float|None,       # None when price or usage unknown
      "currency":       str|None,
    }

Token counts are never invented. When a provider returns no usage the fields
are ``None``, which propagates to a ``None`` cost rather than a zero.
"""

from __future__ import annotations

import json
import time
import uuid
from typing import Any, Callable, Dict, Optional

from .classifier import BaseClassifier, MockClassifier
from .exceptions import ClassifierError
from .model_registry import ModelConfig
from .pricing import PricingTable
from .rate_limiter import RateLimiter
from .redaction import Redactor, default_redactor
from .retry import RetryPolicy
from .utils import safe_str

PARSING_ERROR = "parsing"
SCHEMA_ERROR = "schema"


def empty_usage() -> Dict[str, Optional[int]]:
    """Usage with everything unknown. Not zero — unknown."""
    return {"input_tokens": None, "output_tokens": None, "total_tokens": None}


def normalize_usage(
    input_tokens: Optional[int] = None,
    output_tokens: Optional[int] = None,
) -> Dict[str, Optional[int]]:
    """Build a usage block, deriving the total only when both parts are known."""
    total: Optional[int] = None
    if input_tokens is not None or output_tokens is not None:
        total = int(input_tokens or 0) + int(output_tokens or 0)

    return {
        "input_tokens": None if input_tokens is None else int(input_tokens),
        "output_tokens": None if output_tokens is None else int(output_tokens),
        "total_tokens": total,
    }


class BaseProvider(BaseClassifier):
    """Shared adapter behaviour: rate limiting, retry, timing, normalization.

    Subclasses implement :meth:`_call` only — one method, returning the raw
    text plus whatever usage the provider reported.
    """

    # Tells the Pipeline to hand over the record's fields rather than the
    # pre-joined source text, per the v2.0.5 classifier interface.
    accepts_record_fields = True

    def __init__(
        self,
        config: ModelConfig,
        pricing: Optional[PricingTable] = None,
        rate_limiter: Optional[RateLimiter] = None,
        retry_policy: Optional[RetryPolicy] = None,
        redactor: Optional[Redactor] = None,
    ) -> None:
        self.config = config
        self.pricing = pricing
        self.redactor = redactor or default_redactor()

        # A local model has no provider quota to protect, so it is never
        # throttled regardless of what the registry defaults say. Otherwise an
        # offline model inherits the conservative default and a 500-record
        # fixture run sleeps for eight minutes doing nothing.
        self.rate_limiter = rate_limiter or RateLimiter(
            requests_per_minute=None if config.is_local else config.requests_per_minute
        )
        self.retry_policy = retry_policy or RetryPolicy(
            max_retries=config.max_retries,
            backoff_base=config.backoff_base,
            backoff_max=config.backoff_max,
        )

    # ------------------------------------------------------------------

    @property
    def name(self) -> str:
        return self.config.key

    @property
    def provider(self) -> str:
        return self.config.provider

    def build_user_message(self, product_name: Any, description: Any) -> str:
        """The per-record user turn. Identical across providers by design."""
        return f"اسم المنتج: {safe_str(product_name).strip()}\nالوصف: {safe_str(description).strip()}"

    # ------------------------------------------------------------------

    def _call(self, user_message: str, system_prompt: str) -> Dict[str, Any]:
        """Perform one provider request.

        Returns ``{"raw_response": str, "usage": {...}, "request_id": str|None}``.
        Raises on failure; the retry policy decides what to do about it.
        """
        raise NotImplementedError("Provider adapters must implement _call()")

    # ------------------------------------------------------------------

    def classify(
        self,
        product_name: Any = "",
        description: Any = "",
        system_prompt: str = "",
        product_id: str = "",
        **legacy: Any,
    ) -> Dict[str, Any]:
        """Classify one record and return the normalized envelope.

        ``**legacy`` accepts the v2.0.4 ``source_text=``/``prompt=`` call shape
        so a provider can be dropped into older call sites unchanged.
        """
        if "prompt" in legacy and not system_prompt:
            system_prompt = legacy["prompt"]

        if "source_text" in legacy and not product_name and not description:
            user_message = safe_str(legacy["source_text"])
        else:
            user_message = self.build_user_message(product_name, description)

        self.rate_limiter.acquire()

        started = time.perf_counter()
        outcome = self.retry_policy.run(lambda: self._call(user_message, system_prompt))
        latency_ms = round((time.perf_counter() - started) * 1000.0, 4)

        if outcome.final_status == "error":
            return self._envelope(
                prediction={},
                usage=empty_usage(),
                latency_ms=latency_ms,
                request_id=None,
                raw_response=None,
                error=str(outcome.error),
                error_category=outcome.error_category,
                attempt_count=outcome.attempt_count,
                retry_reason=outcome.retry_reason,
                final_status="error",
            )

        result = outcome.result or {}
        raw_response = result.get("raw_response")
        usage = result.get("usage") or empty_usage()

        # Parsing happens outside the retry loop on purpose: a model that
        # returns malformed JSON at temperature 0 will return it again, and
        # retrying would spend quota to reproduce the same defect.
        prediction, parse_error, parse_category = self._parse(raw_response)

        return self._envelope(
            prediction=prediction,
            usage=usage,
            latency_ms=latency_ms,
            request_id=result.get("request_id"),
            raw_response=raw_response,
            error=parse_error,
            error_category=parse_category,
            attempt_count=outcome.attempt_count,
            retry_reason=outcome.retry_reason,
            final_status="error" if parse_error else "success",
        )

    # ------------------------------------------------------------------

    @staticmethod
    def _parse(raw_response: Optional[str]):
        """Parse the model's text into a prediction dict.

        Malformed output must never become a correct answer. It returns an
        empty prediction plus an explicit error, which the Validator turns
        into a full set of abstentions.
        """
        if raw_response is None:
            return {}, "empty_response", PARSING_ERROR

        try:
            parsed = json.loads(raw_response)
        except (json.JSONDecodeError, TypeError) as exc:
            return {}, f"json_decode_error: {exc}", PARSING_ERROR

        if not isinstance(parsed, dict):
            # A JSON array is valid JSON and an invalid answer. Recorded as a
            # schema violation so it is countable apart from a parse failure.
            return {}, f"non_object_response:{type(parsed).__name__}", SCHEMA_ERROR

        return parsed, None, None

    def _envelope(
        self,
        prediction: Dict[str, Any],
        usage: Dict[str, Optional[int]],
        latency_ms: float,
        request_id: Optional[str],
        raw_response: Optional[str],
        error: Optional[str],
        error_category: Optional[str],
        attempt_count: int,
        retry_reason,
        final_status: str,
    ) -> Dict[str, Any]:
        cost = None
        currency = None
        if self.pricing is not None:
            cost = self.pricing.cost_for(
                self.config.provider,
                self.config.model or self.config.key,
                usage.get("input_tokens"),
                usage.get("output_tokens"),
            )
            currency = self.pricing.currency_for(
                self.config.provider, self.config.model or self.config.key
            )

        return {
            "prediction": prediction,
            "usage": usage,
            "latency_ms": latency_ms,
            "model": self.config.model or self.config.key,
            "provider": self.config.provider,
            "model_key": self.config.key,
            "request_id": request_id,
            # Everything that can carry provider text is redacted before it can
            # reach an audit file.
            "error": self.redactor.redact_text(error) if error else None,
            "error_category": error_category,
            "raw_response": self.redactor.redact_text(raw_response) if raw_response else None,
            "attempt_count": attempt_count,
            "retry_reason": list(retry_reason or []),
            "final_status": final_status,
            "cost": cost,
            "currency": currency,
        }


# ----------------------------------------------------------------------
# Offline
# ----------------------------------------------------------------------


class MockProvider(BaseProvider):
    """Deterministic offline provider. Produces FIXTURE results only."""

    def __init__(
        self,
        config: ModelConfig,
        canonicalizer,
        taxonomy,
        pricing: Optional[PricingTable] = None,
        fail_ids=None,
        **kwargs: Any,
    ) -> None:
        super().__init__(config, pricing=pricing, **kwargs)
        # `inference_defaults: false` in the registry makes this model abstain
        # where the other guesses a market default, so two offline models
        # genuinely disagree and comparison logic has something to compare.
        use_defaults = bool(config.extra.get("inference_defaults", True))
        self._inner = MockClassifier(
            canonicalizer=canonicalizer,
            taxonomy=taxonomy,
            fail_ids=fail_ids,
            use_defaults=use_defaults,
        )

    def _call(self, user_message: str, system_prompt: str) -> Dict[str, Any]:
        product_id = self._current_product_id
        result = self._inner.classify(
            source_text=user_message, prompt=system_prompt, product_id=product_id
        )

        if result.get("error"):
            raise RuntimeError(result["error"])

        usage = result.get("usage") or {}
        return {
            "raw_response": json.dumps(result.get("prediction") or {}, ensure_ascii=False),
            "usage": normalize_usage(
                usage.get("prompt_tokens"), usage.get("completion_tokens")
            ),
            "request_id": f"mock-{uuid.uuid5(uuid.NAMESPACE_OID, product_id or user_message)}",
        }

    _current_product_id = ""

    def classify(self, product_name="", description="", system_prompt="", product_id="", **legacy):
        # The mock needs the id to honour injected failures; real providers do
        # not send it anywhere.
        self._current_product_id = str(product_id)
        return super().classify(
            product_name=product_name,
            description=description,
            system_prompt=system_prompt,
            product_id=product_id,
            **legacy,
        )


# ----------------------------------------------------------------------
# Real providers
# ----------------------------------------------------------------------


class OpenAIProvider(BaseProvider):
    """OpenAI chat completions with JSON output."""

    def __init__(self, config: ModelConfig, client: Any = None, **kwargs: Any) -> None:
        super().__init__(config, **kwargs)
        self._client = client if client is not None else self._build_client()

    def _build_client(self) -> Any:
        try:
            from openai import OpenAI
        except ImportError as exc:  # pragma: no cover - environment dependent
            raise ClassifierError(
                "The openai package is required for provider 'openai'."
            ) from exc
        return OpenAI()

    def _call(self, user_message: str, system_prompt: str) -> Dict[str, Any]:
        kwargs: Dict[str, Any] = {
            "model": self.config.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            "temperature": self.config.temperature,
            "response_format": {"type": "json_object"},
        }
        if self.config.seed is not None:
            kwargs["seed"] = self.config.seed
        if self.config.max_tokens:
            kwargs["max_tokens"] = self.config.max_tokens

        response = self._client.chat.completions.create(**kwargs)
        usage = getattr(response, "usage", None)

        return {
            "raw_response": response.choices[0].message.content,
            "usage": normalize_usage(
                getattr(usage, "prompt_tokens", None),
                getattr(usage, "completion_tokens", None),
            ),
            "request_id": getattr(response, "id", None),
        }


class AnthropicProvider(BaseProvider):
    """Anthropic messages API."""

    def __init__(self, config: ModelConfig, client: Any = None, **kwargs: Any) -> None:
        super().__init__(config, **kwargs)
        self._client = client if client is not None else self._build_client()

    def _build_client(self) -> Any:
        try:
            import anthropic
        except ImportError as exc:  # pragma: no cover - environment dependent
            raise ClassifierError(
                "The anthropic package is required for provider 'anthropic'."
            ) from exc
        return anthropic.Anthropic()

    def _call(self, user_message: str, system_prompt: str) -> Dict[str, Any]:
        response = self._client.messages.create(
            model=self.config.model,
            system=system_prompt,
            messages=[{"role": "user", "content": user_message}],
            temperature=self.config.temperature,
            max_tokens=self.config.max_tokens or 512,
        )

        blocks = getattr(response, "content", None) or []
        text = "".join(getattr(block, "text", "") for block in blocks)

        usage = getattr(response, "usage", None)
        return {
            "raw_response": text,
            "usage": normalize_usage(
                getattr(usage, "input_tokens", None),
                getattr(usage, "output_tokens", None),
            ),
            "request_id": getattr(response, "id", None),
        }


class GeminiProvider(BaseProvider):
    """Google Gemini generate_content."""

    def __init__(self, config: ModelConfig, client: Any = None, **kwargs: Any) -> None:
        super().__init__(config, **kwargs)
        self._client = client if client is not None else self._build_client()

    def _build_client(self) -> Any:
        try:
            from google import genai
        except ImportError as exc:  # pragma: no cover - environment dependent
            raise ClassifierError(
                "The google-genai package is required for provider 'google'."
            ) from exc
        return genai.Client()

    def _call(self, user_message: str, system_prompt: str) -> Dict[str, Any]:
        response = self._client.models.generate_content(
            model=self.config.model,
            contents=f"{system_prompt}\n\n{user_message}",
            config={
                "temperature": self.config.temperature,
                "max_output_tokens": self.config.max_tokens or 512,
                "response_mime_type": "application/json",
            },
        )

        metadata = getattr(response, "usage_metadata", None)
        return {
            "raw_response": getattr(response, "text", None),
            "usage": normalize_usage(
                getattr(metadata, "prompt_token_count", None),
                getattr(metadata, "candidates_token_count", None),
            ),
            "request_id": getattr(response, "response_id", None),
        }


# ----------------------------------------------------------------------
# Construction
# ----------------------------------------------------------------------

_PROVIDER_CLASSES: Dict[str, Callable[..., BaseProvider]] = {
    "mock": MockProvider,
    "openai": OpenAIProvider,
    "anthropic": AnthropicProvider,
    "gemini": GeminiProvider,
}


def build_provider(
    config: ModelConfig,
    canonicalizer=None,
    taxonomy=None,
    pricing: Optional[PricingTable] = None,
    client: Any = None,
    redactor: Optional[Redactor] = None,
    **kwargs: Any,
) -> BaseProvider:
    """Construct the adapter named by ``config.classifier``."""
    factory = _PROVIDER_CLASSES.get(config.classifier)
    if factory is None:
        raise ClassifierError(
            f"Unknown classifier {config.classifier!r} for model {config.key!r}; "
            f"known: {', '.join(sorted(_PROVIDER_CLASSES))}"
        )

    if config.classifier == "mock":
        if canonicalizer is None or taxonomy is None:
            raise ClassifierError(
                "The mock provider needs a canonicalizer and a taxonomy"
            )
        return MockProvider(
            config,
            canonicalizer=canonicalizer,
            taxonomy=taxonomy,
            pricing=pricing,
            redactor=redactor,
            **kwargs,
        )

    return factory(config, client=client, pricing=pricing, redactor=redactor, **kwargs)
