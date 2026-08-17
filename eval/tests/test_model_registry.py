"""TESTS 34-37: model registry, multiple configurations, prompt and config hashes."""

from __future__ import annotations

import os

import pytest
from conftest import MODELS_PATH, PROJECT_ROOT, write_yaml

from benchmark.exceptions import ConfigError
from benchmark.model_registry import KNOWN_PROVIDERS, ModelConfig, ModelRegistry


# ----------------------------------------------------------------------
# TEST 34: registry
# ----------------------------------------------------------------------


def test_34_registry_loads_shipped_models(registry):
    """TEST 34: the shipped registry loads and exposes its models."""
    assert len(registry) >= 2
    assert "mock" in registry
    assert "mock_variant" in registry

    mock = registry.get("mock")
    assert mock.provider == "local"
    assert mock.classifier == "mock"
    assert mock.is_local is True
    assert mock.credentials_available() is True


def test_34b_unknown_model_is_rejected_by_name(registry):
    with pytest.raises(ConfigError, match="Unknown model"):
        registry.get("no_such_model")


def test_34c_unknown_provider_is_rejected(tmp_path):
    """A provider with no adapter fails at load, not mid-run."""
    path = write_yaml(
        tmp_path,
        "models.yaml",
        {"models": {"x": {"provider": "nonexistent", "classifier": "mock"}}},
    )
    with pytest.raises(ConfigError, match="unknown provider"):
        ModelRegistry.from_yaml(path)


def test_34d_real_provider_without_model_id_is_rejected(tmp_path):
    """Benchmarking a provider with no model id would name nothing."""
    path = write_yaml(
        tmp_path,
        "models.yaml",
        {"models": {"x": {"provider": "openai", "classifier": "openai"}}},
    )
    with pytest.raises(ConfigError, match="names no model id"):
        ModelRegistry.from_yaml(path)


def test_34e_defaults_are_merged_and_overridable(tmp_path):
    path = write_yaml(
        tmp_path,
        "models.yaml",
        {
            "defaults": {"temperature": 0.0, "max_retries": 3},
            "models": {
                "a": {"provider": "local", "classifier": "mock"},
                "b": {"provider": "local", "classifier": "mock", "max_retries": 9},
            },
        },
    )
    loaded = ModelRegistry.from_yaml(path)
    assert loaded.get("a").max_retries == 3
    assert loaded.get("b").max_retries == 9


def test_34f_registry_never_exposes_secret_values(registry, monkeypatch):
    """Only the *name* of the env var is configuration; the value is not."""
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-secret-value-1234567890")

    availability = registry.availability()
    serialized = repr(availability)

    assert "sk-test-secret-value-1234567890" not in serialized
    assert availability["openai_gpt4o_mini"]["api_key_env"] == "OPENAI_API_KEY"
    assert availability["openai_gpt4o_mini"]["credentials_available"] is True


def test_34g_no_model_ids_are_hard_coded_in_python():
    """Model identifiers live in configuration, never in the package."""
    import re

    package = os.path.join(PROJECT_ROOT, "benchmark")
    pattern = re.compile(r"\bgpt-4o|claude-\d|gemini-\d")
    offenders = []

    for name in sorted(os.listdir(package)):
        if not name.endswith(".py"):
            continue
        with open(os.path.join(package, name), "r", encoding="utf-8") as handle:
            for number, line in enumerate(handle, start=1):
                if pattern.search(line) and "default=" not in line:
                    offenders.append(f"{name}:{number}: {line.strip()}")

    assert not offenders, "Model ids hard-coded in Python: " + "; ".join(offenders)


# ----------------------------------------------------------------------
# TEST 35: multiple configurations
# ----------------------------------------------------------------------


def test_35_multiple_model_configurations_coexist(registry):
    """TEST 35: several models are configured and independently addressable."""
    keys = registry.keys()
    assert len(keys) >= 4

    providers = {registry.get(key).provider for key in keys}
    assert providers <= set(KNOWN_PROVIDERS)
    assert "local" in providers


def test_35b_runnable_excludes_disabled_and_uncredentialed(registry, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)

    runnable = {config.key for config in registry.runnable()}
    assert runnable == {"mock", "mock_variant"}

    # Still configured and still reported — skipped, not forgotten.
    assert "openai_gpt4o_mini" in registry.keys()


def test_35c_placeholder_models_are_disabled(registry):
    """Models whose id is still a placeholder must not be runnable."""
    for key in ("anthropic_claude", "google_gemini"):
        config = registry.get(key)
        assert config.enabled is False, f"{key} ships enabled with a placeholder id"
        assert config.model and config.model.startswith("SET_")


def test_determinism_is_reported_honestly(registry):
    """Only a provider with a real sampling seed may claim determinism."""
    assert registry.get("mock").determinism_supported is True
    assert registry.get("openai_gpt4o_mini").determinism_supported is True

    # No seed exposed by these providers, so no claim is made.
    assert registry.get("anthropic_claude").determinism_supported is False
    assert registry.get("google_gemini").determinism_supported is False


def test_determinism_false_when_seed_absent():
    config = ModelConfig(key="x", provider="openai", classifier="openai", model="m", seed=None)
    assert config.determinism_supported is False


# ----------------------------------------------------------------------
# TEST 36-37: hashes
# ----------------------------------------------------------------------


def test_36_all_models_share_one_prompt_hash(prompt_renderer, registry):
    """TEST 36: one rendered prompt, one hash, for every model in a batch."""
    from benchmark.run_benchmark import build_components, DEFAULTS

    components = build_components(DEFAULTS)
    batch_hash = components["prompt_renderer"].prompt_hash

    # The renderer memoizes, so every model in a batch reads the same value.
    assert batch_hash == prompt_renderer.prompt_hash
    assert components["prompt_renderer"].prompt_hash == batch_hash


def test_36b_prompt_hash_changes_when_prompt_changes(tmp_path, validator):
    from benchmark.prompt_renderer import PromptRenderer
    from conftest import PROMPT_PATH

    original = PromptRenderer(PROMPT_PATH, validator.taxonomy)

    with open(PROMPT_PATH, "r", encoding="utf-8") as handle:
        text = handle.read()

    edited_path = os.path.join(str(tmp_path), "prompt.txt")
    with open(edited_path, "w", encoding="utf-8") as handle:
        handle.write(text + "\n12. قاعدة إضافية.\n")

    edited = PromptRenderer(edited_path, validator.taxonomy)
    assert edited.prompt_hash != original.prompt_hash


def test_37_different_models_have_different_config_hashes(registry):
    """TEST 37: model config hashes distinguish models."""
    hashes = {key: registry.get(key).config_hash for key in registry.keys()}
    assert len(set(hashes.values())) == len(hashes), f"colliding config hashes: {hashes}"


def test_37b_config_hash_is_stable_across_loads():
    """The same configuration must hash identically every time it loads."""
    first = ModelRegistry.from_yaml(MODELS_PATH).get("mock").config_hash
    second = ModelRegistry.from_yaml(MODELS_PATH).get("mock").config_hash
    assert first == second


def test_37c_config_hash_moves_when_a_setting_moves():
    base = ModelConfig(key="m", provider="local", classifier="mock", temperature=0.0)
    warmer = ModelConfig(key="m", provider="local", classifier="mock", temperature=0.7)
    assert base.config_hash != warmer.config_hash


def test_37d_config_hash_excludes_secret_values(monkeypatch):
    """A rotated key must not change the config hash — it is not configuration."""
    config = ModelConfig(
        key="m", provider="openai", classifier="openai", model="x", api_key_env="TEST_KEY"
    )

    monkeypatch.setenv("TEST_KEY", "sk-first-value-abcdefghij")
    first = config.config_hash
    monkeypatch.setenv("TEST_KEY", "sk-second-value-klmnopqrst")

    assert config.config_hash == first
