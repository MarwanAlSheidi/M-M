"""Prompt rendering and hashing.

The rendered prompt — not the template — is what the model saw, so the rendered
text is what gets hashed. A taxonomy edit changes the render and therefore the
hash, which is exactly the coupling the manifest needs: you cannot change what
you asked the model without invalidating comparison to earlier runs.
"""

from __future__ import annotations

import hashlib
import json
import os
from typing import Any, Dict, List, Optional

from .exceptions import ConfigError


class PromptRenderer:
    """Renders the classification prompt from a template plus the taxonomy."""

    def __init__(self, template_path: str, taxonomy: Dict[str, List[str]]) -> None:
        if not os.path.exists(template_path):
            raise ConfigError(f"Prompt template not found: {template_path}")

        self.template_path = template_path
        self.taxonomy = taxonomy

        with open(template_path, "r", encoding="utf-8") as handle:
            self.template = handle.read()

        self._rendered: Optional[str] = None

    # ------------------------------------------------------------------

    def _render_taxonomy_block(self) -> str:
        lines: List[str] = []
        for field, values in self.taxonomy.items():
            allowed = ", ".join(values)
            lines.append(f"- {field}:")
            lines.append(f"  {allowed}, أو null.")
            lines.append("")
        return "\n".join(lines).rstrip()

    def _render_fields_block(self) -> str:
        return "\n".join(f"- {field}" for field in self.taxonomy)

    def _render_schema_block(self) -> str:
        schema = {
            field: {"value": "...", "confidence": 0.0, "evidence": "..."}
            for field in self.taxonomy
        }
        return json.dumps(schema, indent=2, ensure_ascii=False)

    # ------------------------------------------------------------------

    def render(self) -> str:
        """Render once and memoize; the hash must not drift within a run."""
        if self._rendered is None:
            rendered = self.template
            rendered = rendered.replace("{{TAXONOMY}}", self._render_taxonomy_block())
            rendered = rendered.replace("{{FIELDS}}", self._render_fields_block())
            rendered = rendered.replace("{{SCHEMA}}", self._render_schema_block())

            leftover = [
                token
                for token in ("{{TAXONOMY}}", "{{FIELDS}}", "{{SCHEMA}}")
                if token in rendered
            ]
            if leftover:
                raise ConfigError(f"Prompt still contains placeholders: {leftover}")

            self._rendered = rendered
        return self._rendered

    @property
    def prompt_hash(self) -> str:
        """SHA256 of the rendered prompt."""
        return hashlib.sha256(self.render().encode("utf-8")).hexdigest()

    def build_user_message(self, product_name: Any, description: Any) -> str:
        """The per-record user turn. Kept here so the format is hashable too."""
        return f"اسم المنتج: {product_name}\nالوصف: {description}"
