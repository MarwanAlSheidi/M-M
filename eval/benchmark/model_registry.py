"""Model registry — every model difference lives in configuration, not code.

The registry is what makes a multi-model comparison defensible: models differ
only in their entry here, and everything else (dataset, gold, taxonomy,
synonyms, field policy, prompt, evaluation) is shared by construction. If a
model needed a code change to run, the comparison would no longer be
like-for-like and nothing in the report could say so.

No model identifiers are hard-coded in this module. Whatever the operator puts
in ``configs/models.yaml`` is what runs.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import yaml

from .exceptions import ConfigError
from .utils import compute_dict_hash

# Providers with an adapter in this repository. Adding one means adding an
# adapter; the registry refuses unknown providers rather than failing later
# with an obscure attribute error mid-run.
KNOWN_PROVIDERS = ("openai", "anthropic", "google", "local")

# Providers that accept a seed and document reproducible sampling. Anything
# absent here reports determinism_supported=false, which is a statement about
# the provider, not about this benchmark's own determinism.
_SEED_CAPABLE_PROVIDERS = frozenset({"openai", "local"})

_CONSERVATIVE_RPM = 60.0


@dataclass(frozen=True)
class ModelConfig:
    """One model's complete, hashable configuration."""

    key: str
    provider: str
    classifier: str
    model: Optional[str] = None
    temperature: float = 0.0
    seed: Optional[int] = None
    max_tokens: Optional[int] = None
    api_key_env: Optional[str] = None
    requests_per_minute: Optional[float] = _CONSERVATIVE_RPM
    concurrency: int = 1
    max_retries: int = 3
    backoff_base: float = 1.0
    backoff_max: float = 30.0
    enabled: bool = True
    notes: Optional[str] = None
    extra: Dict[str, Any] = field(default_factory=dict)

    # ------------------------------------------------------------------

    @property
    def determinism_supported(self) -> bool:
        """Whether the *provider* offers reproducible sampling.

        Temperature 0 is not determinism. It makes greedy decoding likely, not
        guaranteed, and providers explicitly decline to promise identical
        output across calls. Claiming otherwise in a reproducibility section
        would be the single most misleading thing this benchmark could do.
        """
        return self.provider in _SEED_CAPABLE_PROVIDERS and self.seed is not None

    @property
    def is_local(self) -> bool:
        """True for offline models that need no credentials."""
        return self.provider == "local"

    def credentials_available(self) -> bool:
        """True when this model can actually be called right now."""
        if self.is_local:
            return True
        if not self.api_key_env:
            return False
        return bool(os.environ.get(self.api_key_env))

    def as_dict(self) -> Dict[str, Any]:
        """Configuration as plain data. Contains no secrets — only the *name*
        of the environment variable a key would come from."""
        return {
            "key": self.key,
            "provider": self.provider,
            "classifier": self.classifier,
            "model": self.model,
            "temperature": self.temperature,
            "seed": self.seed,
            "max_tokens": self.max_tokens,
            "api_key_env": self.api_key_env,
            "requests_per_minute": self.requests_per_minute,
            "concurrency": self.concurrency,
            "max_retries": self.max_retries,
            "backoff_base": self.backoff_base,
            "backoff_max": self.backoff_max,
            "determinism_supported": self.determinism_supported,
            "extra": dict(self.extra),
        }

    @property
    def config_hash(self) -> str:
        """SHA256 of this model's configuration.

        Two models must produce different hashes, and the same model across
        runs must produce the same one — that is what lets a resumed run prove
        it is continuing the same experiment.
        """
        return compute_dict_hash(self.as_dict())


class ModelRegistry:
    """Loads and serves model configurations from ``configs/models.yaml``."""

    def __init__(self, models: Dict[str, ModelConfig], source_path: Optional[str] = None) -> None:
        self._models = models
        self.source_path = source_path

    # ------------------------------------------------------------------

    @classmethod
    def from_yaml(cls, path: str) -> "ModelRegistry":
        if not os.path.exists(path):
            raise ConfigError(f"Model registry not found: {path}")

        try:
            with open(path, "r", encoding="utf-8") as handle:
                raw = yaml.safe_load(handle) or {}
        except yaml.YAMLError as exc:
            raise ConfigError(f"Malformed model registry YAML at {path}: {exc}") from exc

        if not isinstance(raw, dict):
            raise ConfigError("Model registry must be a mapping")

        section = raw.get("models")
        if not isinstance(section, dict) or not section:
            raise ConfigError(f"Model registry at {path} declares no models")

        defaults = raw.get("defaults") or {}
        if not isinstance(defaults, dict):
            raise ConfigError("Model registry 'defaults' must be a mapping")

        models: Dict[str, ModelConfig] = {}
        for key, entry in section.items():
            models[str(key)] = cls._build(str(key), entry, defaults, path)

        return cls(models, source_path=path)

    @staticmethod
    def _build(
        key: str,
        entry: Any,
        defaults: Dict[str, Any],
        path: str,
    ) -> ModelConfig:
        if not isinstance(entry, dict):
            raise ConfigError(f"Model '{key}' in {path} must be a mapping")

        merged: Dict[str, Any] = {**defaults, **entry}

        provider = merged.get("provider")
        if not provider:
            raise ConfigError(f"Model '{key}' has no provider")
        if provider not in KNOWN_PROVIDERS:
            raise ConfigError(
                f"Model '{key}' uses unknown provider {provider!r}; "
                f"known providers: {', '.join(KNOWN_PROVIDERS)}"
            )

        classifier = merged.get("classifier")
        if not classifier:
            raise ConfigError(f"Model '{key}' has no classifier")

        if provider != "local" and not merged.get("model"):
            raise ConfigError(
                f"Model '{key}' targets provider {provider!r} but names no model id"
            )

        known_keys = {
            "provider",
            "classifier",
            "model",
            "temperature",
            "seed",
            "max_tokens",
            "api_key_env",
            "requests_per_minute",
            "concurrency",
            "max_retries",
            "backoff_base",
            "backoff_max",
            "enabled",
            "notes",
        }
        extra = {k: v for k, v in merged.items() if k not in known_keys}

        return ModelConfig(
            key=key,
            provider=str(provider),
            classifier=str(classifier),
            model=merged.get("model"),
            temperature=float(merged.get("temperature", 0.0)),
            seed=merged.get("seed"),
            max_tokens=merged.get("max_tokens"),
            api_key_env=merged.get("api_key_env"),
            requests_per_minute=merged.get("requests_per_minute", _CONSERVATIVE_RPM),
            concurrency=int(merged.get("concurrency", 1)),
            max_retries=int(merged.get("max_retries", 3)),
            backoff_base=float(merged.get("backoff_base", 1.0)),
            backoff_max=float(merged.get("backoff_max", 30.0)),
            enabled=bool(merged.get("enabled", True)),
            notes=merged.get("notes"),
            extra=extra,
        )

    # ------------------------------------------------------------------

    def __contains__(self, key: str) -> bool:
        return key in self._models

    def __len__(self) -> int:
        return len(self._models)

    def get(self, key: str) -> ModelConfig:
        if key not in self._models:
            raise ConfigError(
                f"Unknown model {key!r}. Configured models: {', '.join(sorted(self._models))}"
            )
        return self._models[key]

    def keys(self) -> List[str]:
        return sorted(self._models)

    def all(self) -> List[ModelConfig]:
        return [self._models[key] for key in self.keys()]

    def enabled(self) -> List[ModelConfig]:
        """Every model marked enabled, whether or not credentials are present."""
        return [config for config in self.all() if config.enabled]

    def runnable(self) -> List[ModelConfig]:
        """Enabled models that can actually be called right now.

        Kept separate from :meth:`enabled` so ``--all-models`` skips models
        whose credentials are absent instead of failing the whole batch, while
        the report still records that they were configured and skipped.
        """
        return [config for config in self.enabled() if config.credentials_available()]

    def availability(self) -> Dict[str, Dict[str, Any]]:
        """Per-model readiness, for dry-run output. Never includes key values."""
        report: Dict[str, Dict[str, Any]] = {}
        for config in self.all():
            report[config.key] = {
                "provider": config.provider,
                "model": config.model,
                "classifier": config.classifier,
                "enabled": config.enabled,
                "requires_credentials": not config.is_local,
                "api_key_env": config.api_key_env,
                "credentials_available": config.credentials_available(),
                "determinism_supported": config.determinism_supported,
                "config_sha256": config.config_hash,
            }
        return report

    def secret_env_names(self) -> List[str]:
        """Every environment variable the configured models read secrets from."""
        return sorted({c.api_key_env for c in self.all() if c.api_key_env})
