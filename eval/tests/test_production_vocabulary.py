"""Tests for the production taxonomy and its synonym maps.

The vocabulary is the contract between annotators and the scorer. A value an
annotator is told to use, that the canonicalizer then rejects, scores as an
error on every row it appears in — and the annotation has to be redone. These
tests exist so that cannot ship silently.
"""

from __future__ import annotations

import os

import pytest
import yaml
from conftest import PROJECT_ROOT

from benchmark.canonicalizer import Canonicalizer

TAXONOMY = os.path.join(PROJECT_ROOT, "configs", "taxonomy_production.yaml")
SYNONYMS = os.path.join(PROJECT_ROOT, "configs", "synonyms_production.yaml")


@pytest.fixture(scope="module")
def taxonomy():
    with open(TAXONOMY, encoding="utf-8") as handle:
        return yaml.safe_load(handle)["fields"]


@pytest.fixture(scope="module")
def synonyms():
    with open(SYNONYMS, encoding="utf-8") as handle:
        return yaml.safe_load(handle)


@pytest.fixture(scope="module")
def canon():
    return Canonicalizer(SYNONYMS)


# ----------------------------------------------------------------------
# closure: the vocabulary must be self-consistent
# ----------------------------------------------------------------------


def test_every_taxonomy_value_survives_canonicalization(taxonomy, canon):
    """A value that changes under canonicalization can never be scored correct."""
    offenders = []
    for field, values in taxonomy.items():
        for value in values:
            for direction in (canon.canonicalize_gold, canon.canonicalize_ai):
                got = direction(value, field)
                if got != value:
                    offenders.append(f"{field}: {value!r} -> {got!r}")
    assert not offenders, offenders


def test_every_synonym_target_is_a_real_taxonomy_value(taxonomy, synonyms):
    """A synonym pointing at a non-value silently converts one error into another."""
    offenders = []
    for direction, fields in synonyms.items():
        for field, mapping in fields.items():
            allowed = set(taxonomy[field])
            for source, target in mapping.items():
                if target not in allowed:
                    offenders.append(f"{direction}.{field}: {source} -> {target}")
    assert not offenders, offenders


def test_no_surface_form_feeds_two_fields(synonyms):
    """'stone' is a colour and an embellishment; a flat map turns one into the
    other. The maps are per field, and this asserts they stay that way."""
    for direction, fields in synonyms.items():
        seen = {}
        for field, mapping in fields.items():
            for source in mapping:
                assert seen.get(source, field) == field, (
                    f"{direction}: {source!r} appears under both {seen[source]} and {field}")
                seen[source] = field


def test_the_maps_are_split_by_direction(synonyms):
    assert set(synonyms) == {"ai_synonyms", "gold_synonyms"}
    assert set(synonyms["ai_synonyms"]) == set(synonyms["gold_synonyms"])


def test_no_identity_entries(synonyms, taxonomy):
    """x -> x is noise: a taxonomy value already passes through unchanged."""
    offenders = [f"{d}.{f}: {s}" for d, fields in synonyms.items()
                 for f, m in fields.items() for s, t in m.items() if s == t]
    assert not offenders, offenders


# ----------------------------------------------------------------------
# the semantic distinction the null set would otherwise erase
# ----------------------------------------------------------------------


def test_no_embellishment_is_a_value_not_a_null(canon):
    """"The text says there is no embellishment" and "the text is silent" are
    different claims. Collapsing them would make an abstention indistinguishable
    from a positive finding."""
    assert canon.canonicalize_gold("no_embellishment", "embellishment_type") == "no_embellishment"
    assert canon.canonicalize_ai("no_embellishment", "embellishment_type") == "no_embellishment"


def test_none_is_a_reserved_null_token_and_cannot_be_aliased(canon, synonyms):
    """`none` is folded to null before canonicalization runs, so a synonym for
    it could never fire. Shipping one would imply a safety net that does not
    exist — an annotator writing `none` silently produces an abstention."""
    assert canon.canonicalize_gold("none", "embellishment_type") is None
    for direction in synonyms.values():
        assert "none" not in direction["embellishment_type"], (
            "dead synonym: 'none' never reaches the map")


def test_other_is_a_value_not_a_null(canon):
    """`other` records "the text named something not on this list" — evidence
    of a kind. An empty cell records the absence of evidence."""
    for field in ("silhouette", "fabric_variant"):
        assert canon.canonicalize_gold("other", field) == "other"
        assert canon.canonicalize_gold("", field) is None


# ----------------------------------------------------------------------
# the values the annotation plan promises
# ----------------------------------------------------------------------


PLAN = {
    "silhouette": ["coat", "bisht", "farasha", "kimono", "layered", "klosh",
                   "a-line", "other"],
    "opening_type": ["open-front", "closed-front"],
    "fabric_family": ["nida", "crepe", "jacquard", "linen", "chiffon", "organza",
                      "satin", "cotton", "velvet", "wool", "tweed", "mesh", "silk"],
    "fabric_variant": ["nada", "barbie", "fukuro", "japanese_cotton", "monalisa",
                       "linen_mesh", "burnout_velvet", "crepe_twill", "cey", "cobra",
                       "dantil", "fusus", "korean_marina", "bogatti", "other"],
    "color_normalized": ["black", "white", "beige", "brown", "grey", "navy", "blue",
                         "green", "pink", "purple", "red", "yellow", "maroon", "gold",
                         "multi_color"],
    "embroidery_type": ["hand embroidery", "machine embroidery"],
    "embellishment_type": ["beads", "pearls", "sequins", "crystals", "lace",
                           "piping", "no_embellishment"],
    "embellishment_intensity": ["heavy", "medium", "subtle"],
}


@pytest.mark.parametrize("field", sorted(PLAN))
def test_every_value_the_annotation_plan_offers_is_accepted(field, taxonomy, canon):
    """Named literally, not read from the taxonomy: a test that loads the same
    file it is checking agrees with it by construction. This is the list handed
    to human annotators, and it must match what the scorer accepts."""
    allowed = set(taxonomy[field])
    rejected = [v for v in PLAN[field] if canon.canonicalize_gold(v, field) not in allowed]
    assert not rejected, f"{field}: annotators would be told to use {rejected}"


def test_the_taxonomy_offers_nothing_the_plan_omits(taxonomy):
    """A value in the taxonomy but not on the annotator's sheet can never be
    produced, so it is dead vocabulary that inflates the apparent label space."""
    for field, values in taxonomy.items():
        assert set(values) == set(PLAN[field]), f"{field} drifted from the plan"


# ----------------------------------------------------------------------
# spellings the real catalogue actually uses
# ----------------------------------------------------------------------


@pytest.mark.parametrize("field,written,expected", [
    ("opening_type", "front_open", "open-front"),
    ("opening_type", "open front", "open-front"),
    ("opening_type", "front_closed", "closed-front"),
    ("embroidery_type", "hand_embroidery", "hand embroidery"),
    ("embroidery_type", "machine_embroidery", "machine embroidery"),
    ("embellishment_type", "beadwork", "beads"),
    ("embellishment_type", "stone / crystal", "crystals"),
    ("embellishment_intensity", "minimal", "subtle"),
    ("embellishment_intensity", "light", "subtle"),
    ("color_normalized", "gray", "grey"),
    ("color_normalized", "burgundy", "maroon"),
    ("color_normalized", "multi colour", "multi_color"),
    ("fabric_variant", "japanese cotton", "japanese_cotton"),
    ("fabric_variant", "korean marina", "korean_marina"),
    ("silhouette", "coat style", "coat"),
    ("silhouette", "farashah", "farasha"),
    # Added from the annotator-facing synonym list.
    ("opening_type", "open_front", "open-front"),
    ("opening_type", "closed_front", "closed-front"),
    ("embroidery_type", "hand-embroidery", "hand embroidery"),
    ("embroidery_type", "machine-embroidery", "machine embroidery"),
    ("embellishment_intensity", "low", "subtle"),
    ("embellishment_intensity", "light embellishment", "subtle"),
    ("color_normalized", "multicolour", "multi_color"),
    ("color_normalized", "rose", "pink"),
    ("color_normalized", "light blue", "blue"),
    ("color_normalized", "dark blue", "blue"),
])
def test_observed_spellings_fold_onto_the_canonical_value(field, written, expected, canon):
    assert canon.canonicalize_gold(written, field) == expected
    assert canon.canonicalize_ai(written, field) == expected


@pytest.mark.parametrize("written,expected", [
    # The catalogue writes "kloosh" (51 occurrences); the taxonomy value is
    # spelled "klosh". Under the previous vocabulary that mismatch reported
    # zero occurrences and the value looked absent from the data entirely.
    ("kloosh", "klosh"),
    ("kloosh style", "klosh"),
    ("klosh", "klosh"),
    ("a line", "a-line"),
    ("aline", "a-line"),
    ("a-line", "a-line"),
])
def test_the_catalogue_spelling_reaches_its_taxonomy_value(written, expected, canon):
    """Both directions: a model answering `kloosh` has read the page correctly
    and must not be scored against a value it never had a way to spell."""
    assert canon.canonicalize_gold(written, "silhouette") == expected
    assert canon.canonicalize_ai(written, "silhouette") == expected


@pytest.mark.parametrize("written", ["butterfly", "cape"])
def test_a_named_but_unlisted_silhouette_becomes_other_not_null(written, canon):
    """`butterfly` (4) and `cape` (1) are named in the catalogue but too rare to
    enumerate. They map to `other` — "a silhouette was stated, and it is not one
    of ours" — never to null, which would claim the text said nothing."""
    assert canon.canonicalize_gold(written, "silhouette") == "other"
    assert canon.canonicalize_ai(written, "silhouette") == "other"


def test_a_sleeve_descriptor_is_not_a_silhouette(canon, taxonomy):
    """`straight` occurs 112 times in the catalogue, almost always as "straight
    sleeves". It describes a sleeve, not a silhouette, and must not be folded
    into any silhouette value — including `other`, which would assert that the
    text named a silhouette when it did not."""
    assert canon.canonicalize_gold("straight", "silhouette") not in set(taxonomy["silhouette"])
    assert canon.canonicalize_ai("straight", "silhouette") not in set(taxonomy["silhouette"])


def test_a_shade_qualifier_does_not_survive_into_the_colour(canon):
    """"light blue" and "dark blue" are both `blue`; the shade is not a colour
    in this taxonomy and must not leak through as one."""
    assert canon.canonicalize_gold("light blue", "color_normalized") == "blue"
    assert canon.canonicalize_gold("dark blue", "color_normalized") == "blue"


def test_light_means_different_things_in_different_fields(canon):
    """`light` is an intensity under embellishment_intensity and a shade
    qualifier under color_normalized. A flat synonym map would turn one into
    the other; these maps are per field, and this is what that buys."""
    assert canon.canonicalize_gold("light", "embellishment_intensity") == "subtle"
    assert canon.canonicalize_gold("light blue", "color_normalized") == "blue"
    # `light` alone is not a colour and must not become one.
    assert canon.canonicalize_gold("light", "color_normalized") != "blue"


# ----------------------------------------------------------------------
# fields vs gold columns — two namespaces that differ for exactly one field
# ----------------------------------------------------------------------


def test_the_production_taxonomy_declares_its_gold_columns():
    """Omitting `gold_columns` silently renames a column.

    Without it `gold_column()` falls back to the field name, so the scorer
    reads `silhouette` while every annotation sheet is headed
    `silhouette_normalized` — the column is present, populated, and invisible.
    This was a real defect in the first cut of this file, caught only because
    two templates generated hours apart disagreed on one header.
    """
    import yaml

    with open(TAXONOMY, encoding="utf-8") as handle:
        loaded = yaml.safe_load(handle)

    assert "gold_columns" in loaded, "production taxonomy declares no gold columns"
    assert loaded["gold_columns"]["silhouette"] == "silhouette_normalized"
    assert set(loaded["gold_columns"]) == set(loaded["fields"])


def test_both_taxonomies_agree_on_gold_column_names():
    """A gold file must be readable under either vocabulary.

    The two files list different *values* on purpose; the *column names* are
    the interface, and they must not drift.
    """
    import os

    import yaml

    fixture_path = os.path.join(PROJECT_ROOT, "configs", "taxonomy.yaml")
    with open(fixture_path, encoding="utf-8") as handle:
        fixture = yaml.safe_load(handle)
    with open(TAXONOMY, encoding="utf-8") as handle:
        production = yaml.safe_load(handle)

    assert fixture["gold_columns"] == production["gold_columns"]


def test_field_names_and_gold_columns_are_not_interchangeable():
    """`silhouette` is the field; `silhouette_normalized` is the header.

    Code that indexes the taxonomy by the column name finds nothing, and a
    template built from the field names produces a sheet the scorer ignores.
    """
    from benchmark.canonicalizer import Canonicalizer as _C
    from benchmark.validator import Validator

    validator = Validator(taxonomy_path=TAXONOMY,
                          critical_fields_path=os.path.join(
                              PROJECT_ROOT, "configs", "critical_fields.yaml"),
                          canonicalizer=_C(SYNONYMS))

    assert "silhouette" in validator.taxonomy
    assert "silhouette_normalized" not in validator.taxonomy
    assert validator.gold_column("silhouette") == "silhouette_normalized"


def test_alined_reaches_a_line(canon):
    assert canon.canonicalize_gold("alined", "silhouette") == "a-line"
    assert canon.canonicalize_ai("alined", "silhouette") == "a-line"
