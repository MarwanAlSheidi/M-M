"""Tests for the production enrichment layer.

The enrichment layer touches real catalogue data, so the rules it must never
break are the ones asserted here: the raw acquisition is immutable, a failed
retrieval produces no text, and every enriched value carries provenance.
"""

from __future__ import annotations

import csv
import importlib.util
import json
import os
import shutil

import pytest
from conftest import PROJECT_ROOT

SCRIPT = os.path.join(PROJECT_ROOT, "scripts", "enrich_catalog.py")
PRODUCTION = os.path.join(PROJECT_ROOT, "data", "production")
RAW = os.path.join(PRODUCTION, "raw_catalog.csv")


def load_module():
    spec = importlib.util.spec_from_file_location("enrich_catalog", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def enrich(tmp_path, monkeypatch):
    """The module with every output path redirected into a temp directory."""
    module = load_module()
    if os.path.exists(RAW):
        shutil.copy(RAW, os.path.join(str(tmp_path), "raw_catalog.csv"))
    monkeypatch.setattr(module, "PRODUCTION", str(tmp_path))
    monkeypatch.setattr(module, "RAW", os.path.join(str(tmp_path), "raw_catalog.csv"))
    monkeypatch.setattr(module, "ENRICHED", os.path.join(str(tmp_path), "enriched.csv"))
    monkeypatch.setattr(module, "REPORT", os.path.join(str(tmp_path), "report.json"))
    monkeypatch.setattr(module, "SOURCES", os.path.join(str(tmp_path), "sources.csv"))
    return module


def write_raw(module, rows):
    columns = ["product_id", "source", "source_url", "product_name_raw",
               "description_raw", "fabric_raw", "color_raw", "variant_raw", "brand"]
    with open(module.RAW, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow({c: row.get(c, "") for c in columns})


def row(pid, url="https://x.test/collections/all", desc="", **kw):
    base = {"product_id": pid, "source": "s", "source_url": url,
            "product_name_raw": f"Name {pid}", "description_raw": desc, "brand": "B"}
    base.update(kw)
    return base


# ----------------------------------------------------------------------
# immutability
# ----------------------------------------------------------------------


@pytest.mark.skipif(not os.path.exists(RAW), reason="no production catalogue present")
def test_raw_catalogue_is_byte_for_byte_unchanged_by_enrichment(enrich):
    """The raw acquisition is the record of what was received. It never moves."""
    with open(enrich.RAW, "rb") as handle:
        before = handle.read()

    enrich.main([])

    with open(enrich.RAW, "rb") as handle:
        assert handle.read() == before


@pytest.mark.skipif(not os.path.exists(RAW), reason="no production catalogue present")
def test_enrichment_writes_a_separate_layer(enrich):
    enrich.main([])
    assert os.path.exists(enrich.ENRICHED)
    assert os.path.realpath(enrich.ENRICHED) != os.path.realpath(enrich.RAW)


def test_fixture_and_production_manifests_stay_separate():
    """Enrichment must never reach the fixture pin."""
    fixture = os.path.join(PROJECT_ROOT, "manifests", "manifest.json")
    fixture_dataset = os.path.join(PROJECT_ROOT, "manifests", "dataset_manifest.json")
    raw_manifest = os.path.join(PROJECT_ROOT, "manifests", "raw_catalog_production.json")

    assert os.path.exists(fixture) and os.path.exists(fixture_dataset)
    with open(fixture_dataset, encoding="utf-8") as handle:
        assert json.load(handle)["dataset_kind"] == "fixture"

    if os.path.exists(raw_manifest):
        with open(raw_manifest, encoding="utf-8") as handle:
            production = json.load(handle)
        assert production["stage"] == "REAL_RAW_PRODUCTION_DATA"
        assert production["gold_sha256"] is None


# ----------------------------------------------------------------------
# no fabrication
# ----------------------------------------------------------------------


def test_failed_retrieval_writes_no_text(enrich):
    """A failure must leave the enriched fields empty, not filled with a guess."""
    write_raw(enrich, [row("UAE-S-aaa"), row("UAE-S-bbb")])
    enrich.main([])

    with open(enrich.ENRICHED, encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))

    assert rows and all(r["enrichment_status"] == "FAILED" for r in rows)
    for r in rows:
        for field in ("product_title_page", "description_page", "fabric_page",
                      "color_page", "variant_page", "materials_raw", "features_raw"):
            assert r[field] == "", f"{field} was populated on a failed retrieval"
        assert r["enrichment_reason"]


def test_failed_record_never_borrows_the_product_name(enrich):
    """The title must not be copied into the description to inflate coverage."""
    write_raw(enrich, [row("UAE-S-aaa")])
    enrich.main([])

    with open(enrich.ENRICHED, encoding="utf-8") as handle:
        record = next(csv.DictReader(handle))

    assert record["description_page"] == ""
    assert record["product_name_raw"] not in (record["description_page"] or "x")


def test_listing_pages_are_refused_as_product_pages(enrich):
    write_raw(enrich, [row("UAE-S-aaa", url="https://x.test/collections/all")])
    enrich.main([])

    with open(enrich.ENRICHED, encoding="utf-8") as handle:
        assert next(csv.DictReader(handle))["enrichment_reason"] == "NO_PRODUCT_URL"


# ----------------------------------------------------------------------
# import path and provenance
# ----------------------------------------------------------------------


def test_import_enriches_and_records_provenance(enrich, tmp_path):
    """Externally collected pages merge through the same provenance path."""
    write_raw(enrich, [row("UAE-S-aaa"), row("UAE-S-bbb")])

    import_path = os.path.join(str(tmp_path), "pages.csv")
    with open(import_path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["product_id", "source_url", "description_page", "fabric_page"])
        writer.writerow(["UAE-S-aaa", "https://x.test/products/aaa",
                         "A long black nida abaya with hand embroidery on the cuffs.", "nida"])

    enrich.main(["--import", import_path])

    with open(enrich.ENRICHED, encoding="utf-8") as handle:
        rows = {r["product_id"]: r for r in csv.DictReader(handle)}

    ok = rows["UAE-S-aaa"]
    assert ok["enrichment_status"] == "ENRICHED"
    assert ok["enrichment_method"] == "import"
    assert ok["provenance_url"] == "https://x.test/products/aaa"
    assert ok["enriched_at"]
    assert "nida" in ok["description_page"]
    # The original acquisition value is preserved alongside, never replaced.
    assert ok["description_raw"] == ""
    assert ok["fabric_raw"] == ""
    assert ok["fabric_page"] == "nida"

    # A record absent from the import stays failed rather than quietly enriched.
    assert rows["UAE-S-bbb"]["enrichment_status"] == "FAILED"
    assert rows["UAE-S-bbb"]["enrichment_reason"] == "NOT_IN_IMPORT"


def test_import_refuses_a_listing_url(enrich, tmp_path):
    write_raw(enrich, [row("UAE-S-aaa")])
    import_path = os.path.join(str(tmp_path), "pages.csv")
    with open(import_path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["product_id", "source_url", "description_page"])
        writer.writerow(["UAE-S-aaa", "https://x.test/collections/all", "Some long description here."])

    enrich.main(["--import", import_path])
    with open(enrich.ENRICHED, encoding="utf-8") as handle:
        assert next(csv.DictReader(handle))["enrichment_reason"] == "NO_PRODUCT_URL"


def test_import_with_empty_description_is_a_failure(enrich, tmp_path):
    write_raw(enrich, [row("UAE-S-aaa")])
    import_path = os.path.join(str(tmp_path), "pages.csv")
    with open(import_path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["product_id", "source_url", "description_page"])
        writer.writerow(["UAE-S-aaa", "https://x.test/products/aaa", "   "])

    enrich.main(["--import", import_path])
    with open(enrich.ENRICHED, encoding="utf-8") as handle:
        record = next(csv.DictReader(handle))
    assert record["enrichment_status"] == "FAILED"
    assert record["description_page"] == ""


# ----------------------------------------------------------------------
# identity rules carried over from the benchmark contract
# ----------------------------------------------------------------------


def test_literal_na_and_leading_zero_ids_survive(enrich, tmp_path):
    write_raw(enrich, [row("NA"), row("007"), row("UAE-S-aaa")])
    enrich.main([])

    with open(enrich.ENRICHED, encoding="utf-8") as handle:
        ids = [r["product_id"] for r in csv.DictReader(handle)]

    assert "NA" in ids, "literal NA id was lost or nulled"
    assert "007" in ids, "leading zeros were stripped"


def test_duplicate_product_ids_are_reported(enrich):
    """Enrichment must not launder a duplicate id into the enriched layer."""
    write_raw(enrich, [row("UAE-S-dup"), row("UAE-S-dup")])
    enrich.main([])

    with open(enrich.ENRICHED, encoding="utf-8") as handle:
        ids = [r["product_id"] for r in csv.DictReader(handle)]

    # The raw layer is the authority on rejection; enrichment must at minimum
    # not hide the collision by collapsing the rows.
    assert len(ids) == 2 and len(set(ids)) == 1


# ----------------------------------------------------------------------
# report and secrets
# ----------------------------------------------------------------------


def test_report_counts_coverage_honestly(enrich):
    write_raw(enrich, [
        row("UAE-S-aaa", desc="A genuinely long product description that clears the bar."),
        row("UAE-S-bbb"),
        row("UAE-S-ccc", desc="short"),
    ])
    enrich.main([])

    with open(enrich.REPORT, encoding="utf-8") as handle:
        report = json.load(handle)

    assert report["total_records"] == 3
    assert report["records_with_original_description"] == 1
    assert report["description_coverage_before"] == pytest.approx(1 / 3, abs=1e-3)
    assert report["gold_status"].startswith("LOCKED")
    assert report["quality_gate_met"] is False


def test_no_secret_reaches_the_enrichment_artefacts(enrich, monkeypatch):
    secret = "sk-enrich-leak-abcdefghijklmnopqrst"
    monkeypatch.setenv("OPENAI_API_KEY", secret)
    write_raw(enrich, [row("UAE-S-aaa")])
    enrich.main([])

    for path in (enrich.ENRICHED, enrich.REPORT, enrich.SOURCES):
        with open(path, encoding="utf-8") as handle:
            assert secret not in handle.read()


def test_gold_is_not_created_by_enrichment(enrich):
    write_raw(enrich, [row("UAE-S-aaa")])
    enrich.main([])
    assert not os.path.exists(os.path.join(enrich.PRODUCTION, "gold.csv"))
