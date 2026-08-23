"""TESTS 41-45, 52: retry policy, adapters, cost, latency, secret redaction.

Every adapter is exercised through an injected client. No test in this file
needs, reads or would benefit from a real API credential.
"""

from __future__ import annotations

import json
import types

import pytest
from conftest import RecordingClient

from benchmark.model_registry import ModelConfig
from benchmark.pricing import PricingTable
from benchmark.providers import (
    AnthropicProvider,
    GeminiProvider,
    OpenAIProvider,
    normalize_usage,
)
from benchmark.rate_limiter import RateLimiter
from benchmark.redaction import REDACTED, Redactor
from benchmark.retry import PERMANENT, TRANSIENT, RetryPolicy, classify_error
from benchmark.statistics import latency_summary, percentile


# ----------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------


def openai_response(payload, prompt_tokens=100, completion_tokens=50, response_id="resp-1"):
    return types.SimpleNamespace(
        id=response_id,
        choices=[
            types.SimpleNamespace(
                message=types.SimpleNamespace(content=json.dumps(payload, ensure_ascii=False))
            )
        ],
        usage=types.SimpleNamespace(
            prompt_tokens=prompt_tokens, completion_tokens=completion_tokens
        ),
    )


def make_config(**overrides):
    base = dict(
        key="test_model",
        provider="openai",
        classifier="openai",
        model="test-model-id",
        temperature=0.0,
        max_retries=3,
        backoff_base=0.0,
        requests_per_minute=None,
    )
    base.update(overrides)
    return ModelConfig(**base)


def instant_retry(max_retries=3):
    """A retry policy that never actually sleeps, so tests stay fast."""
    return RetryPolicy(max_retries=max_retries, backoff_base=0.0, sleep=lambda _: None)


# ----------------------------------------------------------------------
# TEST 41: retry transient
# ----------------------------------------------------------------------


class RateLimitError(Exception):
    status_code = 429


class AuthenticationError(Exception):
    status_code = 401


def test_41_transient_failure_is_retried_then_succeeds():
    """TEST 41: a transient error is retried and the retry is recorded."""
    attempts = {"count": 0}

    def flaky():
        attempts["count"] += 1
        if attempts["count"] < 3:
            raise RateLimitError("rate limit exceeded")
        return "ok"

    outcome = instant_retry(max_retries=3).run(flaky)

    assert outcome.final_status == "success"
    assert outcome.attempt_count == 3
    assert outcome.result == "ok"
    assert len(outcome.retry_reason) == 2
    assert all("transient" in reason for reason in outcome.retry_reason)


def test_41b_transient_failure_exhausting_retries_reports_error():
    def always_fails():
        raise RateLimitError("rate limit exceeded")

    outcome = instant_retry(max_retries=3).run(always_fails)

    assert outcome.final_status == "error"
    assert outcome.attempt_count == 3
    assert outcome.error_category == TRANSIENT


@pytest.mark.parametrize(
    "error",
    [
        TimeoutError("timed out"),
        ConnectionError("connection reset by peer"),
        RateLimitError("429 too many requests"),
        Exception("503 service unavailable"),
        Exception("Server is overloaded"),
    ],
)
def test_41c_transient_classification(error):
    category, _ = classify_error(error)
    assert category == TRANSIENT


# ----------------------------------------------------------------------
# TEST 42: no retry on permanent failure
# ----------------------------------------------------------------------


def test_42_permanent_failure_is_not_retried():
    """TEST 42: a bad key fails once. Retrying it burns quota to no purpose."""
    attempts = {"count": 0}

    def bad_key():
        attempts["count"] += 1
        raise AuthenticationError("Incorrect API key provided")

    outcome = instant_retry(max_retries=5).run(bad_key)

    assert outcome.final_status == "error"
    assert outcome.attempt_count == 1
    assert attempts["count"] == 1
    assert outcome.error_category == PERMANENT


@pytest.mark.parametrize(
    "error",
    [
        AuthenticationError("invalid_api_key"),
        ValueError("schema violation"),
        json.JSONDecodeError("bad", "{}", 0),
        Exception("400 bad request"),
        Exception("model foo does not exist"),
    ],
)
def test_42b_permanent_classification(error):
    category, _ = classify_error(error)
    assert category == PERMANENT


def test_42c_unrecognised_errors_are_permanent():
    """Retrying an error nobody understands multiplies one bug by three."""
    category, reason = classify_error(Exception("something entirely novel"))
    assert category == PERMANENT
    assert reason == "unclassified"


def test_backoff_is_bounded_and_exponential():
    policy = RetryPolicy(max_retries=6, backoff_base=1.0, backoff_max=8.0, sleep=lambda _: None)
    delays = [policy.delay_for(attempt) for attempt in range(1, 7)]

    assert delays[:4] == [1.0, 2.0, 4.0, 8.0]
    assert all(delay <= 8.0 for delay in delays)


# ----------------------------------------------------------------------
# adapters
# ----------------------------------------------------------------------


def test_openai_adapter_returns_the_normalized_envelope():
    client = RecordingClient([openai_response({"silhouette": {"value": "butterfly"}})])
    provider = OpenAIProvider(
        make_config(), client=client, retry_policy=instant_retry(),
        rate_limiter=RateLimiter(requests_per_minute=None),
    )

    envelope = provider.classify("Butterfly Abaya", "Open-front abaya", "SYSTEM")

    assert envelope["prediction"] == {"silhouette": {"value": "butterfly"}}
    assert envelope["usage"] == {"input_tokens": 100, "output_tokens": 50, "total_tokens": 150}
    assert envelope["provider"] == "openai"
    assert envelope["model"] == "test-model-id"
    assert envelope["request_id"] == "resp-1"
    assert envelope["error"] is None
    assert envelope["final_status"] == "success"
    assert envelope["latency_ms"] >= 0
    assert envelope["attempt_count"] == 1


def test_anthropic_adapter_normalizes_content_blocks():
    response = types.SimpleNamespace(
        id="msg-1",
        content=[types.SimpleNamespace(text='{"silhouette": {"value": "kimono"}}')],
        usage=types.SimpleNamespace(input_tokens=80, output_tokens=20),
    )
    provider = AnthropicProvider(
        make_config(provider="anthropic", classifier="anthropic"),
        client=RecordingClient([response]),
        retry_policy=instant_retry(),
        rate_limiter=RateLimiter(requests_per_minute=None),
    )

    envelope = provider.classify("Kimono Abaya", "Closed-front", "SYSTEM")

    assert envelope["prediction"] == {"silhouette": {"value": "kimono"}}
    assert envelope["usage"]["input_tokens"] == 80
    assert envelope["provider"] == "anthropic"


def test_gemini_adapter_normalizes_usage_metadata():
    response = types.SimpleNamespace(
        response_id="gen-1",
        text='{"silhouette": {"value": "cape"}}',
        usage_metadata=types.SimpleNamespace(prompt_token_count=70, candidates_token_count=30),
    )
    provider = GeminiProvider(
        make_config(provider="google", classifier="gemini"),
        client=RecordingClient([response]),
        retry_policy=instant_retry(),
        rate_limiter=RateLimiter(requests_per_minute=None),
    )

    envelope = provider.classify("Cape Abaya", "Flowing", "SYSTEM")

    assert envelope["prediction"] == {"silhouette": {"value": "cape"}}
    assert envelope["usage"]["total_tokens"] == 100
    assert envelope["provider"] == "google"


def test_every_adapter_returns_the_same_envelope_keys():
    """The evaluator must never see a provider-specific shape."""
    openai = OpenAIProvider(
        make_config(), client=RecordingClient([openai_response({})]),
        retry_policy=instant_retry(), rate_limiter=RateLimiter(None),
    ).classify("a", "b", "S")

    anthropic = AnthropicProvider(
        make_config(provider="anthropic", classifier="anthropic"),
        client=RecordingClient([
            types.SimpleNamespace(id="m", content=[types.SimpleNamespace(text="{}")],
                                  usage=types.SimpleNamespace(input_tokens=1, output_tokens=1))
        ]),
        retry_policy=instant_retry(), rate_limiter=RateLimiter(None),
    ).classify("a", "b", "S")

    assert set(openai) == set(anthropic)


# ----------------------------------------------------------------------
# TEST 15 (v2.0.5 §15): malformed output never becomes correct
# ----------------------------------------------------------------------


def test_malformed_json_becomes_an_error_not_a_prediction():
    response = types.SimpleNamespace(
        id="r", choices=[types.SimpleNamespace(message=types.SimpleNamespace(content="not json{"))],
        usage=types.SimpleNamespace(prompt_tokens=5, completion_tokens=5),
    )
    provider = OpenAIProvider(
        make_config(), client=RecordingClient([response]),
        retry_policy=instant_retry(), rate_limiter=RateLimiter(None),
    )

    envelope = provider.classify("a", "b", "S")

    assert envelope["prediction"] == {}
    assert envelope["final_status"] == "error"
    assert envelope["error_category"] == "parsing"
    assert "json_decode_error" in envelope["error"]


def test_json_array_is_a_schema_error_and_is_not_retried():
    """A JSON array is valid JSON and an invalid answer — one attempt only."""
    client = RecordingClient([
        types.SimpleNamespace(
            id="r",
            choices=[types.SimpleNamespace(message=types.SimpleNamespace(content="[1,2]"))],
            usage=types.SimpleNamespace(prompt_tokens=5, completion_tokens=5),
        )
    ])
    provider = OpenAIProvider(
        make_config(), client=client, retry_policy=instant_retry(),
        rate_limiter=RateLimiter(None),
    )

    envelope = provider.classify("a", "b", "S")

    assert envelope["error_category"] == "schema"
    assert envelope["attempt_count"] == 1
    assert len(client.calls) == 1


# ----------------------------------------------------------------------
# TEST 43-44: cost
# ----------------------------------------------------------------------


def test_43_cost_is_calculated_from_configured_pricing(pricing):
    """TEST 43: cost comes from configs/pricing.yaml, not from code."""
    cost = pricing.cost_for("openai", "gpt-4o-mini", 1_000_000, 1_000_000)
    assert cost == pytest.approx(0.15 + 0.60)

    entry = pricing.lookup("openai", "gpt-4o-mini")
    assert entry.currency == "USD"


def test_43b_cost_reaches_the_envelope(pricing):
    provider = OpenAIProvider(
        make_config(model="gpt-4o-mini"),
        client=RecordingClient([openai_response({}, prompt_tokens=1_000_000, completion_tokens=0)]),
        pricing=pricing,
        retry_policy=instant_retry(),
        rate_limiter=RateLimiter(None),
    )
    envelope = provider.classify("a", "b", "S")

    assert envelope["cost"] == pytest.approx(0.15)
    assert envelope["currency"] == "USD"


def test_44_missing_pricing_yields_null_not_zero(pricing):
    """TEST 44: an unpriced model costs `null`. Zero would read as free."""
    assert pricing.lookup("anthropic", "some-unpriced-model") is None
    assert pricing.cost_for("anthropic", "some-unpriced-model", 1000, 1000) is None

    described = pricing.describe("anthropic", "some-unpriced-model")
    assert described["priced"] is False
    assert described["input_cost_per_1m"] is None


def test_44b_unpriced_model_envelope_has_null_cost(pricing):
    provider = OpenAIProvider(
        make_config(model="unpriced-model-id"),
        client=RecordingClient([openai_response({})]),
        pricing=pricing,
        retry_policy=instant_retry(),
        rate_limiter=RateLimiter(None),
    )
    envelope = provider.classify("a", "b", "S")

    assert envelope["cost"] is None
    assert envelope["usage"]["total_tokens"] == 150  # tokens known, price is not


def test_44c_missing_usage_yields_null_cost_not_zero(pricing):
    """Token counts are never invented, so neither is a cost."""
    entry = pricing.lookup("openai", "gpt-4o-mini")
    assert entry.cost_for(None, None) is None

    assert normalize_usage(None, None) == {
        "input_tokens": None,
        "output_tokens": None,
        "total_tokens": None,
    }


def test_44d_pricing_config_is_required_to_have_complete_entries(tmp_path):
    from benchmark.exceptions import ConfigError
    from conftest import write_yaml

    path = write_yaml(
        tmp_path, "pricing.yaml",
        {"pricing": [{"provider": "openai", "model": "x", "input_cost_per_1m": 1.0}]},
    )
    with pytest.raises(ConfigError, match="missing"):
        PricingTable.from_yaml(path)


def test_no_prices_are_hard_coded_in_python():
    """A price in code would silently outlive the config it contradicts."""
    import os
    import re
    from conftest import PROJECT_ROOT

    package = os.path.join(PROJECT_ROOT, "benchmark")
    # Decimal literals that look like per-1M token prices.
    suspicious = re.compile(r"(input|output)_cost_per_1m\s*[:=]\s*[0-9]")
    offenders = []

    for name in sorted(os.listdir(package)):
        if not name.endswith(".py"):
            continue
        with open(os.path.join(package, name), "r", encoding="utf-8") as handle:
            for number, line in enumerate(handle, start=1):
                if suspicious.search(line):
                    offenders.append(f"{name}:{number}")

    assert not offenders, "Hard-coded pricing found: " + ", ".join(offenders)


# ----------------------------------------------------------------------
# TEST 45: latency
# ----------------------------------------------------------------------


def test_45_latency_percentiles():
    """TEST 45: percentiles are linear-interpolated over the sorted sample."""
    values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    summary = latency_summary(values)

    assert summary["count"] == 10
    assert summary["mean_latency_ms"] == 55.0
    assert summary["median_latency_ms"] == 55.0
    assert summary["min_latency_ms"] == 10.0
    assert summary["max_latency_ms"] == 100.0
    assert summary["p95_latency_ms"] == pytest.approx(95.5)
    assert summary["p99_latency_ms"] == pytest.approx(99.1)


def test_45b_latency_of_empty_sample_is_null_not_zero():
    """No measurements is not the same as instant."""
    summary = latency_summary([])
    assert summary["count"] == 0
    assert summary["mean_latency_ms"] is None
    assert summary["p95_latency_ms"] is None


def test_45c_latency_ignores_missing_values():
    summary = latency_summary([10.0, None, 20.0])
    assert summary["count"] == 2
    assert summary["mean_latency_ms"] == 15.0


def test_45d_percentile_of_single_value():
    assert percentile([42.0], 0.95) == 42.0


def test_45e_provider_measures_real_latency():
    provider = OpenAIProvider(
        make_config(), client=RecordingClient([openai_response({})]),
        retry_policy=instant_retry(), rate_limiter=RateLimiter(None),
    )
    envelope = provider.classify("a", "b", "S")
    assert isinstance(envelope["latency_ms"], float)
    assert envelope["latency_ms"] >= 0.0


# ----------------------------------------------------------------------
# rate limiting
# ----------------------------------------------------------------------


def test_rate_limiter_spaces_requests():
    now = {"t": 0.0}
    slept = []

    limiter = RateLimiter(
        requests_per_minute=60,
        clock=lambda: now["t"],
        sleep=lambda seconds: (slept.append(seconds), now.__setitem__("t", now["t"] + seconds)),
    )

    assert limiter.acquire() == 0.0      # first request goes straight out
    waited = limiter.acquire()           # second must wait a full interval

    assert limiter.min_interval == 1.0
    assert waited == pytest.approx(1.0)
    assert slept == [pytest.approx(1.0)]


def test_rate_limiter_disabled_when_unset():
    limiter = RateLimiter(requests_per_minute=None)
    assert limiter.min_interval == 0.0
    assert limiter.acquire() == 0.0
    assert limiter.acquire() == 0.0


def test_default_rate_limit_is_conservative():
    from benchmark.model_registry import ModelRegistry
    from conftest import MODELS_PATH

    loaded = ModelRegistry.from_yaml(MODELS_PATH)
    assert loaded.get("openai_gpt4o_mini").requests_per_minute <= 60
    assert loaded.get("openai_gpt4o_mini").concurrency == 1


# ----------------------------------------------------------------------
# TEST 52: secret redaction
# ----------------------------------------------------------------------


SECRET = "sk-live-abcdefghijklmnopqrstuvwxyz0123456789"


def test_52_registered_secret_is_redacted_from_text():
    """TEST 52: a key echoed inside an error message never survives."""
    redactor = Redactor([SECRET])
    message = f"Authentication failed for key {SECRET} on request 42"

    result = redactor.redact_text(message)

    assert SECRET not in result
    assert REDACTED in result
    assert "request 42" in result


def test_52b_secret_is_redacted_from_nested_structures():
    redactor = Redactor([SECRET])
    payload = {
        "error": f"bad key {SECRET}",
        "nested": [{"detail": SECRET}],
        "headers": {"Authorization": f"Bearer {SECRET}"},
    }

    result = redactor.redact(payload)

    assert not redactor.contains_secret(result)
    assert result["headers"]["Authorization"] == REDACTED


def test_52c_key_shapes_are_redacted_even_when_unregistered():
    """A key this process was never told about is still recognisable."""
    redactor = Redactor()
    for shape in (
        "sk-abcdefghijklmnopqrstuvwxyz012345",
        "sk-ant-abcdefghijklmnopqrstuvwxyz01",
        "AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234",
    ):
        assert REDACTED in redactor.redact_text(f"token: {shape}")


def test_52d_short_values_are_not_registered_as_secrets():
    """Redacting a 3-character value would corrupt ordinary text."""
    redactor = Redactor()
    assert redactor.register("abc") is False
    assert redactor.register("") is False
    assert redactor.secret_count == 0


def test_52e_env_registration_never_stores_the_name_with_the_value(monkeypatch):
    monkeypatch.setenv("TEST_PROVIDER_KEY", SECRET)
    redactor = Redactor()
    registered = redactor.register_env("TEST_PROVIDER_KEY", "ABSENT_KEY")

    assert registered == ["TEST_PROVIDER_KEY"]
    assert redactor.redact_text(SECRET) == REDACTED


def test_52f_overlapping_secrets_are_fully_masked():
    """A short secret inside a longer one must not leave a readable remainder."""
    long_secret = "sk-live-abcdefghijklmnop-EXTRA-TAIL"
    short_secret = "sk-live-abcdefghijklmnop"
    redactor = Redactor([short_secret, long_secret])

    result = redactor.redact_text(f"key={long_secret}")
    assert "EXTRA-TAIL" not in result


def test_52g_provider_redacts_secrets_out_of_error_messages():
    """End to end: a provider error carrying a key reaches the envelope clean."""
    redactor = Redactor([SECRET])
    provider = OpenAIProvider(
        make_config(),
        client=RecordingClient(error=AuthenticationError(f"invalid_api_key: {SECRET}"), error_times=1),
        retry_policy=instant_retry(max_retries=1),
        rate_limiter=RateLimiter(None),
        redactor=redactor,
    )

    envelope = provider.classify("a", "b", "S")

    assert envelope["final_status"] == "error"
    assert SECRET not in json.dumps(envelope)
    assert REDACTED in envelope["error"]
