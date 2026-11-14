"""Tests for scripts/validate_gold.py.

The validator is the gate between 5,600 human judgements and the gold file. A
check that silently passes bad input costs a re-annotation; each test here
corresponds to a way that has happened or measurably could.
"""

from __future__ import annotations

import csv
import importlib.util
import os

import pytest
from conftest import PROJECT_ROOT

SCRIPT = os.path.join(PROJECT_ROOT, "scripts", "validate_gold.py")

GOLD_COLS = ["silhouette_normalized", "opening_type", "fabric_family", "fabric_variant",
             "color_normalized", "embroidery_type", "embellishment_type",
             "embellishment_intensity"]
HEADER = (["product_id", "source", "product_url", "product_name_raw", "description_raw",
           "annotation_status"] + GOLD_COLS +
          ["evidence_quote", "annotator_1", "annotator_2", "adjudicator",
           "agreement_flag", "needs_review", "annotation_timestamp"])

DESC = "Black bisht style abaya in nida fabric with crystal stones on the cuffs."


@pytest.fixture(scope="module")
def vg():
    spec = importlib.util.spec_from_file_location("validate_gold", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def row(pid, status="ANNOTATED", desc=DESC, quote="bisht style abaya", **cells):
    base = {c: "" for c in HEADER}
    base.update({"product_id": pid, "source": "cas", "product_url": f"https://x.test/products/{pid}",
                 "product_name_raw": f"Name {pid}", "description_raw": desc,
                 "annotation_status": status, "evidence_quote": quote})
    base.update(cells)
    return base


def write(tmp_path, rows, name="ann.csv", header=HEADER):
    path = os.path.join(str(tmp_path), name)
    with open(path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=header)
        writer.writeheader()
        writer.writerows(rows)
    return path


def run(vg, tmp_path, rows, **kw):
    return vg.validate_file(write(tmp_path, rows), vg.DEFAULT_TAXONOMY,
                            vg.DEFAULT_SYNONYMS, **kw)


def kinds(report):
    return [v["check"] for v in report["violations"]]


# ----------------------------------------------------------------------
# a clean file is clean
# ----------------------------------------------------------------------


def test_a_valid_file_passes(vg, tmp_path):
    report = run(vg, tmp_path, [
        row("P1", silhouette_normalized="bisht", fabric_family="nida",
            color_normalized="black", embellishment_type="crystals"),
        row("P2", status="UNANNOTATED", quote=""),
    ])
    assert report["violations"] == []
    assert report["annotated"] == 1


def test_synonym_spellings_are_accepted_not_flagged(vg, tmp_path):
    """The maps exist so annotators may write what the catalogue writes."""
    report = run(vg, tmp_path, [
        row("P1", desc="Kloosh style abaya with hand embroidery, light blue crepe.",
            quote="kloosh style abaya",
            silhouette_normalized="kloosh", embroidery_type="hand_embroidery",
            color_normalized="light blue", embellishment_intensity="minimal"),
    ])
    assert [v for v in report["violations"] if v["check"] == "VOCABULARY"] == []


# ----------------------------------------------------------------------
# vocabulary
# ----------------------------------------------------------------------


def test_a_value_outside_the_taxonomy_is_flagged(vg, tmp_path):
    report = run(vg, tmp_path, [row("P1", fabric_family="polyester")])
    offences = [v for v in report["violations"] if v["check"] == "VOCABULARY"]
    assert len(offences) == 1 and "polyester" in offences[0]["detail"]


def test_the_old_vocabulary_is_rejected_with_the_field_named(vg, tmp_path):
    """`beadwork` folds via synonym; `laser cut` has no home and must be caught."""
    report = run(vg, tmp_path, [
        row("P1", embellishment_type="beadwork"),       # folds to beads: fine
        row("P2", embellishment_type="laser cut"),       # dropped value: flagged
    ])
    offences = [v for v in report["violations"] if v["check"] == "VOCABULARY"]
    assert [o["product_id"] for o in offences] == ["P2"]


# ----------------------------------------------------------------------
# the reserved null tokens
# ----------------------------------------------------------------------


@pytest.mark.parametrize("token", ["none", "None", "NONE", "null", "n/a", "-"])
def test_a_literal_null_token_is_refused_not_silently_nulled(vg, tmp_path, token):
    """normalize_null folds these before canonicalization, so writing them is
    ambiguous between 'no evidence' and 'the text says none'. The scorer would
    silently pick the first; the validator refuses to let the ambiguity in."""
    report = run(vg, tmp_path, [row("P1", embellishment_type=token)])
    offences = [v for v in report["violations"] if v["check"] == "NULL_TOKEN"]
    assert len(offences) == 1
    assert "no_embellishment" in offences[0]["detail"]


def test_an_empty_cell_is_not_a_violation(vg, tmp_path):
    """Empty means 'no evidence' and is a legitimate, scored answer."""
    report = run(vg, tmp_path, [row("P1", silhouette_normalized="bisht")])
    assert [v for v in report["violations"] if v["check"] == "NULL_TOKEN"] == []


# ----------------------------------------------------------------------
# status semantics
# ----------------------------------------------------------------------


def test_an_unannotated_row_carrying_values_is_flagged(vg, tmp_path):
    report = run(vg, tmp_path, [row("P1", status="UNANNOTATED",
                                    color_normalized="black", quote="")])
    assert "STATUS" in kinds(report)


def test_an_annotated_row_with_every_field_empty_is_a_warning_not_an_error(vg, tmp_path):
    report = run(vg, tmp_path, [row("P1", quote="")])
    assert "STATUS" not in kinds(report)
    assert any(w["check"] == "STATUS" for w in report["warnings"])


def test_an_unknown_status_is_flagged(vg, tmp_path):
    report = run(vg, tmp_path, [row("P1", status="DONE")])
    assert "STATUS" in kinds(report)


# ----------------------------------------------------------------------
# evidence
# ----------------------------------------------------------------------


def test_values_without_a_quote_are_flagged(vg, tmp_path):
    report = run(vg, tmp_path, [row("P1", quote="", color_normalized="black")])
    assert "EVIDENCE" in kinds(report)


def test_a_quote_absent_from_the_source_text_is_flagged(vg, tmp_path):
    """The quote rule is auditable or it is decoration."""
    report = run(vg, tmp_path, [row("P1", quote="hand embroidered silk panels",
                                    color_normalized="black")])
    offences = [v for v in report["violations"] if v["check"] == "EVIDENCE"]
    assert len(offences) == 1


def test_quote_matching_survives_case_whitespace_and_entities(vg, tmp_path):
    """The catalogue carries `&amp;` and erratic spacing; a byte-exact match
    would flag honest quotes."""
    report = run(vg, tmp_path, [
        row("P1", desc="Set of 2: Abaya &amp; Sheila.  Black   nida fabric.",
            quote="Abaya & Sheila | black nida", color_normalized="black"),
    ])
    assert [v for v in report["violations"] if v["check"] == "EVIDENCE"] == []


def test_each_quote_fragment_is_checked_separately(vg, tmp_path):
    report = run(vg, tmp_path, [
        row("P1", quote="bisht style | woven from moonlight", color_normalized="black"),
    ])
    offences = [v for v in report["violations"] if v["check"] == "EVIDENCE"]
    assert len(offences) == 1 and "moonlight" in offences[0]["detail"]


def test_missing_source_text_is_a_warning_not_a_pass(vg, tmp_path):
    """A quote that cannot be verified must not be reported as verified."""
    rows = [row("P1", desc="", color_normalized="black", quote="black fabric")]
    header = [c for c in HEADER]
    path = write(tmp_path, rows, header=header)
    # blank out the name too, leaving no source text at all
    with open(path, encoding="utf-8") as handle:
        lines = handle.read().replace("Name P1", "")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(lines)
    vg_report = vg.validate_file(path, vg.DEFAULT_TAXONOMY, vg.DEFAULT_SYNONYMS)
    assert any(w["check"] == "EVIDENCE" for w in vg_report["warnings"])


# ----------------------------------------------------------------------
# identical descriptions, identical values
# ----------------------------------------------------------------------


def test_one_description_annotated_two_ways_is_flagged(vg, tmp_path):
    report = run(vg, tmp_path, [
        row("P1", color_normalized="black"),
        row("P2", color_normalized="navy"),
    ])
    assert "CONSISTENCY" in kinds(report)


def test_one_description_annotated_identically_is_fine(vg, tmp_path):
    report = run(vg, tmp_path, [
        row("P1", color_normalized="black"),
        row("P2", color_normalized="black"),
    ])
    assert "CONSISTENCY" not in kinds(report)


def test_synonym_spellings_do_not_fake_a_consistency_conflict(vg, tmp_path):
    """gray and grey are one value; comparing raw strings would flag them."""
    report = run(vg, tmp_path, [
        row("P1", color_normalized="grey"),
        row("P2", color_normalized="gray"),
    ])
    assert "CONSISTENCY" not in kinds(report)


# ----------------------------------------------------------------------
# structure
# ----------------------------------------------------------------------


def test_duplicate_ids_are_flagged(vg, tmp_path):
    report = run(vg, tmp_path, [row("P1"), row("P1")])
    assert "STRUCTURE" in kinds(report)


def test_a_missing_gold_column_fails_fast(vg, tmp_path):
    header = [c for c in HEADER if c != "fabric_family"]
    rows = [{k: v for k, v in row("P1").items() if k != "fabric_family"}]
    path = write(tmp_path, rows, header=header)
    report = vg.validate_file(path, vg.DEFAULT_TAXONOMY, vg.DEFAULT_SYNONYMS)
    offences = [v for v in report["violations"] if v["check"] == "STRUCTURE"]
    assert len(offences) == 1 and "fabric_family" in offences[0]["detail"]


# ----------------------------------------------------------------------
# agreement
# ----------------------------------------------------------------------


def test_kappa_perfect_agreement(vg):
    assert vg.cohens_kappa([("a", "a"), ("b", "b"), ("c", "c")]) == 1.0


def test_kappa_no_variation_is_none_not_one(vg):
    """All labels identical on both sides: agreement is trivially perfect and
    kappa is undefined — reporting 1.0 would claim reliability that was never
    tested."""
    assert vg.cohens_kappa([("a", "a"), ("a", "a")]) is None


def test_kappa_chance_level_is_zero(vg):
    pairs = [("a", "a"), ("a", "b"), ("b", "a"), ("b", "b")]
    assert vg.cohens_kappa(pairs) == pytest.approx(0.0)


def test_compare_counts_null_as_a_real_category(vg, tmp_path):
    """Two annotators disagreeing about whether evidence EXISTS is exactly the
    disagreement the kappa must count, so null is a label, not a gap."""
    a = write(tmp_path, [row("P1", color_normalized="black"),
                         row("P2", color_normalized="")], name="a.csv")
    b = write(tmp_path, [row("P1", color_normalized="black"),
                         row("P2", color_normalized="black")], name="b.csv")
    report = vg.compare_files(a, b, vg.DEFAULT_TAXONOMY, vg.DEFAULT_SYNONYMS,
                              dict(vg.DEFAULT_KAPPA_THRESHOLDS))
    entry = report["fields"]["color_normalized"]
    assert entry["pairs"] == 2 and entry["agreement"] == 0.5
    assert any(d["product_id"] == "P2" and vg.NULL in (d["annotator_a"], d["annotator_b"])
               for d in report["disagreements"])


def test_compare_canonicalizes_before_comparing(vg, tmp_path):
    """gray vs grey is agreement, not disagreement."""
    a = write(tmp_path, [row("P1", color_normalized="gray")], name="a.csv")
    b = write(tmp_path, [row("P1", color_normalized="grey")], name="b.csv")
    report = vg.compare_files(a, b, vg.DEFAULT_TAXONOMY, vg.DEFAULT_SYNONYMS,
                              dict(vg.DEFAULT_KAPPA_THRESHOLDS))
    assert report["disagreements"] == []


def test_compare_only_uses_rows_annotated_on_both_sides(vg, tmp_path):
    a = write(tmp_path, [row("P1", color_normalized="black"),
                         row("P2", status="UNANNOTATED", quote="")], name="a.csv")
    b = write(tmp_path, [row("P1", color_normalized="black"),
                         row("P2", color_normalized="navy")], name="b.csv")
    report = vg.compare_files(a, b, vg.DEFAULT_TAXONOMY, vg.DEFAULT_SYNONYMS,
                              dict(vg.DEFAULT_KAPPA_THRESHOLDS))
    assert report["rows_compared"] == 1
    assert report["disagreements"] == []


def test_the_cli_exit_codes_distinguish_clean_from_dirty(vg, tmp_path):
    clean = write(tmp_path, [row("P1", color_normalized="black")], name="clean.csv")
    dirty = write(tmp_path, [row("P2", fabric_family="polyester")], name="dirty.csv")
    assert vg.main([clean]) == 0
    assert vg.main([dirty]) == 1
