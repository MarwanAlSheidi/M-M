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


# ----------------------------------------------------------------------
# canonical URL, deduplication, and the full import field set
# ----------------------------------------------------------------------


IMPORT_HEADER = ["product_id", "product_url", "product_title_page", "description_page",
                 "category_page", "fabric_page", "color_page", "variant_page",
                 "materials_raw", "features_raw", "price_page", "currency_page",
                 "store_page", "retrieved_at_source"]

LONG_DESC = "A long black nida abaya with hand embroidery running along both cuffs."


def write_import(tmp_path, rows, header=IMPORT_HEADER, name="pages.csv"):
    path = os.path.join(str(tmp_path), name)
    with open(path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=header)
        writer.writeheader()
        for entry in rows:
            writer.writerow({c: entry.get(c, "") for c in header})
    return path


def enriched_rows(module):
    with open(module.ENRICHED, encoding="utf-8") as handle:
        return {r["product_id"]: r for r in csv.DictReader(handle)}


def test_import_carries_every_declared_field(enrich, tmp_path):
    """Each column the import contract declares must land in the enriched layer.

    The failure this guards against is silent: a field the collector filled in
    is dropped on merge, and the loss is invisible because the row still says
    ENRICHED.
    """
    write_raw(enrich, [row("UAE-S-aaa")])
    supplied = {
        "product_id": "UAE-S-aaa", "product_url": "https://x.test/products/aaa",
        "product_title_page": "Amira Abaya", "description_page": LONG_DESC,
        "category_page": "abaya", "fabric_page": "nida", "color_page": "black",
        "variant_page": "S / M / L", "materials_raw": "100% polyester",
        "features_raw": "hand embroidery", "price_page": "450.00",
        "currency_page": "AED", "store_page": "casbasics",
        "retrieved_at_source": "2026-08-20T09:00:00Z",
    }
    enrich.main(["--import", write_import(tmp_path, [supplied])])

    merged = enriched_rows(enrich)["UAE-S-aaa"]
    assert merged["enrichment_status"] == "ENRICHED"

    # Named literally, not read back from the module: a test that iterates the
    # code's own list agrees with it by construction and cannot notice a field
    # being quietly removed from the contract.
    expected = ["product_title_page", "description_page", "category_page",
                "fabric_page", "color_page", "variant_page", "materials_raw",
                "features_raw", "price_page", "currency_page", "store_page",
                "retrieved_at_source"]
    assert enrich.IMPORT_PASSTHROUGH == expected, "the import contract changed"
    for column in expected:
        assert merged[column] == supplied[column], f"{column} was dropped on merge"


def test_import_records_the_canonical_product_url(enrich, tmp_path):
    write_raw(enrich, [row("UAE-S-aaa")])
    enrich.main(["--import", write_import(tmp_path, [{
        "product_id": "UAE-S-aaa",
        "product_url": "https://X.Test/products/aaa/?variant=42#reviews",
        "description_page": LONG_DESC,
    }])])

    merged = enriched_rows(enrich)["UAE-S-aaa"]
    # Provenance keeps the URL exactly as supplied; the canonical form is a
    # derived key for comparison, never a replacement for the original.
    assert merged["provenance_url"] == "https://X.Test/products/aaa/?variant=42#reviews"
    assert merged["product_url_canonical"] == "https://x.test/products/aaa"


@pytest.mark.parametrize("variant", [
    "https://x.test/products/aaa",
    "https://x.test/products/aaa/",
    "https://X.TEST/products/aaa",
    "HTTPS://x.test/products/aaa?variant=9",
    "https://x.test/products/aaa#tab-details",
])
def test_canonical_url_folds_the_forms_of_one_page(enrich, variant):
    assert enrich.canonical_url(variant) == "https://x.test/products/aaa"


def test_canonical_url_keeps_distinct_pages_distinct(enrich):
    """Folding must not go so far that two products become one."""
    forms = [
        "https://x.test/products/aaa",
        "https://x.test/products/bbb",
        "https://y.test/products/aaa",
        "https://x.test/collections/all/products/aaa",
    ]
    assert len({enrich.canonical_url(f) for f in forms}) == len(forms)


def test_two_records_may_not_be_enriched_from_one_page(enrich, tmp_path):
    """One product page cannot be the evidence for two products.

    Allowing it would give two records identical text, and every field scored
    against that text would agree by construction — a duplicate dressed up as a
    corroboration.
    """
    write_raw(enrich, [row("UAE-S-aaa"), row("UAE-S-bbb")])
    path = write_import(tmp_path, [
        {"product_id": "UAE-S-aaa", "product_url": "https://x.test/products/shared",
         "description_page": LONG_DESC},
        {"product_id": "UAE-S-bbb", "product_url": "https://x.test/products/shared?variant=2",
         "description_page": LONG_DESC},
    ])
    enrich.main(["--import", path])

    rows = enriched_rows(enrich)
    assert rows["UAE-S-aaa"]["enrichment_status"] == "ENRICHED"
    assert rows["UAE-S-bbb"]["enrichment_status"] == "FAILED"
    assert rows["UAE-S-bbb"]["enrichment_reason"] == "DUPLICATE_PRODUCT_URL"
    # The rejected record keeps no borrowed text.
    assert rows["UAE-S-bbb"]["description_page"] == ""


def test_duplicate_claim_is_resolved_by_catalogue_order_not_import_order(enrich, tmp_path):
    """The winner must not depend on how the import file happens to be sorted."""
    write_raw(enrich, [row("UAE-S-aaa"), row("UAE-S-bbb")])
    reversed_import = write_import(tmp_path, [
        {"product_id": "UAE-S-bbb", "product_url": "https://x.test/products/shared",
         "description_page": LONG_DESC},
        {"product_id": "UAE-S-aaa", "product_url": "https://x.test/products/shared",
         "description_page": LONG_DESC},
    ])
    enrich.main(["--import", reversed_import])

    rows = enriched_rows(enrich)
    assert rows["UAE-S-aaa"]["enrichment_status"] == "ENRICHED"
    assert rows["UAE-S-bbb"]["enrichment_reason"] == "DUPLICATE_PRODUCT_URL"


def test_identical_repeated_import_rows_collapse(enrich, tmp_path):
    """Two rows asserting exactly the same thing are one assertion."""
    write_raw(enrich, [row("UAE-S-aaa")])
    entry = {"product_id": "UAE-S-aaa", "product_url": "https://x.test/products/aaa",
             "description_page": LONG_DESC, "fabric_page": "nida"}
    enrich.main(["--import", write_import(tmp_path, [entry, dict(entry)])])

    merged = enriched_rows(enrich)["UAE-S-aaa"]
    assert merged["enrichment_status"] == "ENRICHED"
    assert merged["fabric_page"] == "nida"


def test_conflicting_import_rows_are_refused_outright(enrich, tmp_path):
    """Two rows disagreeing about one product: the import is wrong, not the data.

    Keeping the first would silently decide which claim is true. The import is
    rejected so the conflict is fixed at source.
    """
    path = write_import(tmp_path, [
        {"product_id": "UAE-S-aaa", "product_url": "https://x.test/products/aaa",
         "description_page": LONG_DESC, "fabric_page": "nida"},
        {"product_id": "UAE-S-aaa", "product_url": "https://x.test/products/aaa",
         "description_page": LONG_DESC, "fabric_page": "crepe"},
    ])
    write_raw(enrich, [row("UAE-S-aaa")])

    with pytest.raises(ValueError) as raised:
        enrich.main(["--import", path])

    assert "UAE-S-aaa" in str(raised.value)
    # Nothing may be written from an import that was refused.
    assert not os.path.exists(enrich.ENRICHED)


def test_import_row_without_any_url_fails_with_its_own_reason(enrich, tmp_path):
    write_raw(enrich, [row("UAE-S-aaa")])
    enrich.main(["--import", write_import(tmp_path, [
        {"product_id": "UAE-S-aaa", "description_page": LONG_DESC},
    ])])

    merged = enriched_rows(enrich)["UAE-S-aaa"]
    assert merged["enrichment_reason"] == "NO_URL"
    assert merged["description_page"] == ""


def test_report_counts_missing_urls_duplicates_and_failures(enrich, tmp_path):
    write_raw(enrich, [
        row("UAE-S-aaa"),
        row("UAE-S-bbb"),
        row("UAE-S-ccc", url=""),
    ])
    enrich.main(["--import", write_import(tmp_path, [
        {"product_id": "UAE-S-aaa", "product_url": "https://x.test/products/shared",
         "description_page": LONG_DESC},
        {"product_id": "UAE-S-bbb", "product_url": "https://x.test/products/shared/",
         "description_page": LONG_DESC},
    ])])

    with open(enrich.REPORT, encoding="utf-8") as handle:
        report = json.load(handle)

    assert report["missing_url_count"] == 1
    assert report["duplicate_count"] == 1
    reasons = {entry["product_id"]: entry["reason"] for entry in report["failed_urls"]}
    assert reasons == {"UAE-S-bbb": "DUPLICATE_PRODUCT_URL", "UAE-S-ccc": "NOT_IN_IMPORT"}


def test_report_counts_distinct_pages_not_records(enrich):
    """Records sharing one collection page must not read as per-record evidence."""
    write_raw(enrich, [
        row("UAE-S-aaa", url="https://x.test/collections/all"),
        row("UAE-S-bbb", url="https://x.test/collections/all/"),
        row("UAE-S-ccc", url="https://x.test/products/ccc"),
    ])
    enrich.main([])

    with open(enrich.REPORT, encoding="utf-8") as handle:
        report = json.load(handle)

    assert report["total_records"] == 3
    assert report["distinct_canonical_urls"] == 2
    assert report["distinct_canonical_product_urls"] == 1


# ----------------------------------------------------------------------
# import template
# ----------------------------------------------------------------------


def test_import_template_is_headers_only(enrich, tmp_path):
    """A template must carry no example rows — invented examples become data."""
    target = os.path.join(str(tmp_path), "template.csv")
    assert enrich.main(["--write-import-template", target]) == 0

    with open(target, encoding="utf-8", newline="") as handle:
        rows = list(csv.reader(handle))

    assert len(rows) == 1, f"template contains {len(rows) - 1} data rows"
    assert rows[0] == enrich.IMPORT_TEMPLATE_COLUMNS
    assert rows[0][:2] == ["product_id", "product_url"]


def test_import_template_round_trips_through_the_importer(enrich, tmp_path):
    """The template's columns must be exactly what the importer reads."""
    target = os.path.join(str(tmp_path), "template.csv")
    enrich.main(["--write-import-template", target])

    with open(target, encoding="utf-8", newline="") as handle:
        columns = next(csv.reader(handle))

    write_raw(enrich, [row("UAE-S-aaa")])
    filled = os.path.join(str(tmp_path), "filled.csv")
    with open(filled, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        writer.writerow({c: "" for c in columns} | {
            "product_id": "UAE-S-aaa",
            "product_url": "https://x.test/products/aaa",
            "description_page": LONG_DESC,
        })

    enrich.main(["--import", filled])
    assert enriched_rows(enrich)["UAE-S-aaa"]["enrichment_status"] == "ENRICHED"


def test_writing_a_template_touches_nothing_else(enrich, tmp_path):
    """The template flag exits before any enrichment output is produced."""
    write_raw(enrich, [row("UAE-S-aaa")])
    enrich.main(["--write-import-template", os.path.join(str(tmp_path), "t.csv")])

    assert not os.path.exists(enrich.ENRICHED)
    assert not os.path.exists(enrich.REPORT)
