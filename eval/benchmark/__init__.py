"""UAE abaya classification benchmark.

Public surface, in the order a run uses it:

``IntegrityGate``    pre-flight verification; FAIL blocks the run
``PromptRenderer``   renders and hashes the prompt actually sent
``Canonicalizer``    the single authority on whether two values agree
``Validator``        taxonomy + evidence -> PREDICT / ABSTAIN / UNKNOWN
``Pipeline``         classification and the four prediction layers
``Evaluator``        metrics at every layer
``CostTracker``      token spend joined to correctness
"""

from __future__ import annotations

from .version import __version__

from .auditor import Auditor
from .canonicalizer import AI_SYNONYMS, GOLD_SYNONYMS, Canonicalizer
from .classifier import BaseClassifier, MockClassifier, OpenAIClassifier, build_classifier
from .cost_tracker import CostTracker
from .evaluator import LEVELS, NULL_LABEL, Evaluator
from .evidence_verifier import ABSENT, PARTIAL, SUPPORTED, UNSUPPORTED, EvidenceVerifier
from .exceptions import (
    BenchmarkError,
    ClassifierError,
    ConfigError,
    IntegrityError,
    LeakageError,
)
from .integrity_gate import FAIL, INFO, PASS, WARN, IntegrityGate
from .leakage_detector import LeakageDetector, load_training_ids, normalize_id
from .pipeline import Pipeline
from .prompt_renderer import PromptRenderer
from .validator import ABSTAIN, PREDICT, UNKNOWN, Validator

__all__ = [
    "__version__",
    "ABSENT",
    "ABSTAIN",
    "AI_SYNONYMS",
    "Auditor",
    "BaseClassifier",
    "BenchmarkError",
    "Canonicalizer",
    "ClassifierError",
    "ConfigError",
    "CostTracker",
    "Evaluator",
    "EvidenceVerifier",
    "FAIL",
    "GOLD_SYNONYMS",
    "INFO",
    "IntegrityError",
    "IntegrityGate",
    "LEVELS",
    "LeakageDetector",
    "LeakageError",
    "MockClassifier",
    "NULL_LABEL",
    "OpenAIClassifier",
    "PARTIAL",
    "PASS",
    "PREDICT",
    "Pipeline",
    "PromptRenderer",
    "SUPPORTED",
    "UNKNOWN",
    "UNSUPPORTED",
    "Validator",
    "WARN",
    "build_classifier",
    "load_training_ids",
    "normalize_id",
]
