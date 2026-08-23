"""Shared fixtures.

Tests run against the *real* configs in ``configs/`` rather than miniature
inline ones. A test suite that invents its own taxonomy passes happily while
the shipped taxonomy is broken.
"""

from __future__ import annotations

import csv
import json
import os
import sys
from typing import Any, Dict, List, Optional

import pytest

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_ROOT)

from benchmark.canonicalizer import Canonicalizer  # noqa: E402
from benchmark.evaluator import Evaluator  # noqa: E402
from benchmark.integrity_gate import CODE_FILES, IntegrityGate  # noqa: E402
from benchmark.prompt_renderer import PromptRenderer  # noqa: E402
from benchmark.utils import compute_file_hash  # noqa: E402
from benchmark.validator import Validator  # noqa: E402

CONFIGS = os.path.join(PROJECT_ROOT, "configs")
DATA = os.path.join(PROJECT_ROOT, "data")
PROMPTS = os.path.join(PROJECT_ROOT, "prompts")

TAXONOMY_PATH = os.path.join(CONFIGS, "taxonomy.yaml")
SYNONYMS_PATH = os.path.join(CONFIGS, "synonyms.yaml")
CRITICAL_FIELDS_PATH = os.path.join(CONFIGS, "critical_fields.yaml")
MODEL_CONFIG_PATH = os.path.join(CONFIGS, "model_config.yaml")
PROMPT_PATH = os.path.join(PROMPTS, "classification_v0.1.txt")

# v2.0.5
MODELS_PATH = os.path.join(CONFIGS, "models.yaml")
PRICING_PATH = os.path.join(CONFIGS, "pricing.yaml")

DATASET_COLUMNS = ["product_id", "product_name_raw", "description_raw"]
GOLD_COLUMNS = [
    "product_id",
    "silhouette_normalized",
    "opening_type",
    "fabric_family",
    "fabric_variant",
    "color_normalized",
    "embroidery_type",
    "embellishment_type",
    "embellishment_intensity",
]


# ----------------------------------------------------------------------
# component fixtures
# ----------------------------------------------------------------------


@pytest.fixture(scope="session")
def canonicalizer() -> Canonicalizer:
    return Canonicalizer(SYNONYMS_PATH)


@pytest.fixture(scope="session")
def validator(canonicalizer: Canonicalizer) -> Validator:
    return Validator(
        taxonomy_path=TAXONOMY_PATH,
        critical_fields_path=CRITICAL_FIELDS_PATH,
        canonicalizer=canonicalizer,
    )


@pytest.fixture(scope="session")
def prompt_renderer(validator: Validator) -> PromptRenderer:
    return PromptRenderer(PROMPT_PATH, validator.taxonomy)


@pytest.fixture
def evaluator(canonicalizer: Canonicalizer, validator: Validator) -> Evaluator:
    return Evaluator(
        canonicalizer=canonicalizer,
        critical_fields=validator.critical_fields,
        secondary_fields=validator.secondary_fields,
        gold_columns=validator.gold_columns,
    )


# ----------------------------------------------------------------------
# file builders
# ----------------------------------------------------------------------


def write_csv(path: str, columns: List[str], rows: List[Dict[str, Any]]) -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow({column: row.get(column, "") for column in columns})
    return path


def dataset_row(product_id: str, name: str = "Butterfly Abaya", description: str = "") -> Dict:
    return {
        "product_id": product_id,
        "product_name_raw": name,
        "description_raw": description or "Open-front butterfly abaya in black nida.",
    }


def gold_row(product_id: str, **overrides: Any) -> Dict:
    row = {
        "product_id": product_id,
        "silhouette_normalized": "butterfly",
        "opening_type": "open-front",
        "fabric_family": "nida",
        "fabric_variant": "",
        "color_normalized": "black",
        "embroidery_type": "",
        "embellishment_type": "",
        "embellishment_intensity": "",
    }
    row.update(overrides)
    return row


class GateBuilder:
    """Builds a self-consistent temp project and returns an IntegrityGate."""

    def __init__(self, tmp_path) -> None:
        self.root = str(tmp_path)
        self.dataset_path = os.path.join(self.root, "data", "dataset.csv")
        self.gold_path = os.path.join(self.root, "data", "gold.csv")
        self.training_path = os.path.join(self.root, "data", "training.csv")
        self.manifest_path = os.path.join(self.root, "manifests", "manifest.json")

    def build(
        self,
        dataset_ids: Optional[List[str]] = None,
        gold_ids: Optional[List[str]] = None,
        training_ids: Optional[List[str]] = None,
        manifest_overrides: Optional[Dict[str, Any]] = None,
        write_training: bool = True,
        prompt_hash: Optional[str] = None,
    ) -> IntegrityGate:
        dataset_ids = dataset_ids if dataset_ids is not None else ["P001", "P002", "P003"]
        gold_ids = gold_ids if gold_ids is not None else ["P001", "P002", "P003"]
        training_ids = training_ids if training_ids is not None else ["T001", "T002"]

        write_csv(
            self.dataset_path,
            DATASET_COLUMNS,
            [dataset_row(pid) for pid in dataset_ids],
        )
        write_csv(self.gold_path, GOLD_COLUMNS, [gold_row(pid) for pid in gold_ids])

        if write_training:
            write_csv(
                self.training_path,
                DATASET_COLUMNS,
                [dataset_row(pid, name=f"Training {pid}") for pid in training_ids],
            )

        manifest = {
            "version": "2.0.4-test",
            "gold_sha256": compute_file_hash(self.gold_path),
            "taxonomy_sha256": compute_file_hash(TAXONOMY_PATH),
            "synonyms_sha256": compute_file_hash(SYNONYMS_PATH),
            "critical_fields_sha256": compute_file_hash(CRITICAL_FIELDS_PATH),
            "model_config_sha256": compute_file_hash(MODEL_CONFIG_PATH),
            "prompt_sha256": prompt_hash,
            "code_hashes": {
                filename: compute_file_hash(
                    os.path.join(PROJECT_ROOT, "benchmark", filename)
                )
                for filename in CODE_FILES
                if os.path.exists(os.path.join(PROJECT_ROOT, "benchmark", filename))
            },
            "integrity_policy": {"require_evidence_verification": True},
        }
        manifest.update(manifest_overrides or {})

        os.makedirs(os.path.dirname(self.manifest_path), exist_ok=True)
        with open(self.manifest_path, "w", encoding="utf-8") as handle:
            json.dump(manifest, handle, indent=2)

        return IntegrityGate(
            manifest_path=self.manifest_path,
            gold_path=self.gold_path,
            dataset_path=self.dataset_path,
            taxonomy_path=TAXONOMY_PATH,
            synonyms_path=SYNONYMS_PATH,
            critical_fields_path=CRITICAL_FIELDS_PATH,
            training_data_path=self.training_path if write_training else None,
            code_dir=os.path.join(PROJECT_ROOT, "benchmark"),
        )


@pytest.fixture
def gate_builder(tmp_path) -> GateBuilder:
    return GateBuilder(tmp_path)


# ----------------------------------------------------------------------
# v2.0.5 fixtures
# ----------------------------------------------------------------------


@pytest.fixture(scope="session")
def registry():
    from benchmark.model_registry import ModelRegistry

    return ModelRegistry.from_yaml(MODELS_PATH)


@pytest.fixture(scope="session")
def pricing():
    from benchmark.pricing import PricingTable

    return PricingTable.from_yaml(PRICING_PATH)


@pytest.fixture
def no_credentials(monkeypatch):
    """Guarantee the test environment holds no real provider keys."""
    for name in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    return True


def write_yaml(tmp_path, name: str, payload: Dict[str, Any]) -> str:
    import yaml as _yaml

    path = os.path.join(str(tmp_path), name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        _yaml.safe_dump(payload, handle, allow_unicode=True)
    return path


class RecordingClient:
    """A stand-in provider client for unit-testing adapters offline.

    Adapters are tested through this rather than through a live API: a test
    suite that needs credentials is a test suite that does not run in CI.
    """

    def __init__(self, responses=None, error=None, error_times: int = 0):
        self.responses = list(responses or [])
        self.error = error
        self.error_times = error_times
        self.calls = []

    def _next(self, **kwargs):
        self.calls.append(kwargs)
        if self.error is not None and len(self.calls) <= self.error_times:
            raise self.error
        if self.responses:
            return self.responses.pop(0)
        raise AssertionError("RecordingClient ran out of responses")

    # OpenAI shape
    @property
    def chat(self):
        outer = self

        class _Completions:
            def create(self, **kwargs):
                return outer._next(**kwargs)

        class _Chat:
            completions = _Completions()

        return _Chat()

    # Anthropic shape
    @property
    def messages(self):
        outer = self

        class _Messages:
            def create(self, **kwargs):
                return outer._next(**kwargs)

        return _Messages()

    # Gemini shape
    @property
    def models(self):
        outer = self

        class _Models:
            def generate_content(self, **kwargs):
                return outer._next(**kwargs)

        return _Models()


def check_named(result: Dict[str, Any], name: str) -> Dict[str, Any]:
    """Pull one named check out of a gate result."""
    for check in result["checks"]:
        if check["name"] == name:
            return check
    raise AssertionError(f"No check named {name!r} in {[c['name'] for c in result['checks']]}")
