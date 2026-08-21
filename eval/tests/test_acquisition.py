"""Tests for the product-page acquisition script.

The script needs outbound HTTPS, which this environment does not have. Every
part that does not need the network is a plain function, and those are what is
tested here — against fixture payloads, offline.

Each test below corresponds to a defect found in the crawler this replaces.
"""

from __future__ import annotations

import csv
import importlib.util
import json
import os
import random
import subprocess
import sys

import pytest
from conftest import PROJECT_ROOT

SCRIPT = os.path.join(PROJECT_ROOT, "scripts", "acquire_products.py")


@pytest.fixture(scope="module")
def acq():
    spec = importlib.util.spec_from_file_location("acquire_products", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PRODUCT_JSONLD = """
<html><head><title>Amira Abaya | CAS Basics</title>
<meta name="description" content="Amira Abaya | CAS Basics">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[]}
</script>
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
  {"@type":"WebPage","name":"page"},
  {"@type":"Product","name":"Amira Abaya",
   "description":"Black nida abaya with hand embroidery along both cuffs.",
   "image":["https://x.test/img/1.jpg"],
   "offers":{"@type":"Offer","price":"1,250.00","priceCurrency":"AED",
             "availability":"https://schema.org/InStock"},
   "additionalProperty":[{"name":"Colour","value":"Black"},
                         {"name":"Fabric","value":"Nida"},
                         {"name":"Embellishment","value":"Crystal stones"}]}]}
</script></head><body></body></html>
"""


# ----------------------------------------------------------------------
# BLOCKER 1 — stable identity
# ----------------------------------------------------------------------


def test_product_id_is_the_same_for_every_form_of_one_url(acq):
    forms = [
        "https://x.test/products/aaa",
        "https://x.test/products/aaa/",
        "https://X.TEST/products/aaa",
        "https://x.test/products/aaa?variant=42",
        "https://x.test/products/aaa#reviews",
        "https://x.test/products/aaa?utm_source=ig&utm_medium=cpc",
    ]
    ids = {acq.product_id_for("CAS", f) for f in forms}
    assert len(ids) == 1, f"one product produced {len(ids)} ids: {ids}"


def test_product_id_does_not_depend_on_order_or_process(acq):
    """The previous scheme numbered products by position in a set, whose
    iteration order varies per process — the same garment was CAS_001 in one
    run and CAS_003 in the next, invalidating any label bound to an id."""
    urls = [f"https://x.test/products/{n}" for n in ("aaa", "bbb", "ccc", "ddd")]
    expected = {u: acq.product_id_for("CAS", u) for u in urls}

    shuffled = list(urls)
    random.shuffle(shuffled)
    assert {u: acq.product_id_for("CAS", u) for u in shuffled} == expected

    # And across a separate interpreter, where string hashing is re-seeded.
    code = (
        "import importlib.util,json,sys;"
        f"s=importlib.util.spec_from_file_location('a',{SCRIPT!r});"
        "m=importlib.util.module_from_spec(s);s.loader.exec_module(m);"
        f"print(json.dumps({{u:m.product_id_for('CAS',u) for u in {urls!r}}}))"
    )
    for _ in range(3):
        out = subprocess.run([sys.executable, "-c", code], capture_output=True,
                             text=True, cwd=PROJECT_ROOT)
        assert json.loads(out.stdout) == expected, out.stderr


def test_product_id_distinguishes_different_products(acq):
    a = acq.product_id_for("CAS", "https://x.test/products/aaa")
    b = acq.product_id_for("CAS", "https://x.test/products/bbb")
    assert a != b


def test_product_id_carries_the_source_prefix(acq):
    assert acq.product_id_for("CAS", "https://x.test/products/a").startswith("UAE-CAS-")


# ----------------------------------------------------------------------
# BLOCKER 3 — deduplication actually deduplicates
# ----------------------------------------------------------------------


def test_five_forms_of_one_product_collapse_to_one(acq):
    """The old normalize_url matched `[?&]param=` against a query string with
    no leading `?`, so the first parameter always survived and nothing was
    stripped. Five forms of one product stayed five products."""
    forms = [
        "https://x.test/products/aaa?utm_source=ig",
        "https://x.test/products/aaa?ref=home",
        "https://X.TEST/products/aaa",
        "https://x.test/products/aaa/",
        "https://x.test/products/aaa",
    ]
    kept, duplicates = acq.dedupe_urls(forms)
    assert kept == ["https://x.test/products/aaa?utm_source=ig"]
    assert len(duplicates) == 4
    assert all(d["first_seen"] == forms[0] for d in duplicates)


def test_deduplication_keeps_distinct_products(acq):
    urls = ["https://x.test/products/aaa", "https://x.test/products/bbb",
            "https://y.test/products/aaa"]
    kept, duplicates = acq.dedupe_urls(urls)
    assert kept == urls and duplicates == []


def test_acquisition_and_ingestion_agree_on_canonical_form(acq):
    """One implementation, imported — not two that can drift apart.

    A second copy of the canonicalisation would let acquisition and ingestion
    disagree about whether two URLs are the same product, which is how a
    duplicate survives deduplication in one stage and not the other.
    """
    spec = importlib.util.spec_from_file_location(
        "enrich_catalog", os.path.join(PROJECT_ROOT, "scripts", "enrich_catalog.py"))
    enrich = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(enrich)

    assert acq.canonical_url.__module__ == "enrich_catalog", "acquisition defines its own copy"
    for url in ["https://X.TEST/products/a/?variant=1#x", "https://x.test/products/a",
                "http://y.test/collections/all/", "", "not-a-url"]:
        assert acq.canonical_url(url) == enrich.canonical_url(url)


# ----------------------------------------------------------------------
# BLOCKER 4 — every figure computed
# ----------------------------------------------------------------------


def test_duplicate_count_is_computed_not_asserted(acq):
    """The old report hardcoded duplicate_count to 0 without checking."""
    urls = ["https://x.test/products/aaa", "https://x.test/products/aaa/",
            "https://x.test/products/bbb"]
    kept, duplicates = acq.dedupe_urls(urls)
    report = acq.build_report(records=[], failures=[], discovered=len(urls),
                              duplicates=duplicates, sources_attempted=1)
    assert report["duplicate_count"] == 1
    assert report["urls_after_deduplication"] == 2


def test_coverage_uses_row_level_denominators(acq):
    records = [
        {"source": "s", "product_url": "https://x.test/products/a",
         "description_raw": "A description comfortably past the thirty character bar.",
         "price": 450.0, "color_raw": "black", "evidence_sha256": "x"},
        {"source": "s", "product_url": "https://x.test/products/b",
         "description_raw": "", "price": None, "color_raw": None,
         "evidence_sha256": "y"},
        {"source": "s", "product_url": "https://x.test/products/c",
         "description_raw": "tiny", "price": 1.0, "color_raw": None,
         "evidence_sha256": "z"},
    ]
    report = acq.build_report(records, [], 3, [], 1)
    assert report["collected_count"] == 3
    # An empty string is not coverage; a four-character one is not annotatable.
    assert report["coverage"]["description"] == pytest.approx(2 / 3, abs=1e-3)
    assert report["coverage"]["description_annotatable"] == pytest.approx(1 / 3, abs=1e-3)
    assert report["coverage"]["price"] == pytest.approx(2 / 3, abs=1e-3)


def test_report_counts_identity_collisions(acq):
    records = [
        {"source": "s", "product_url": "https://x.test/products/a", "evidence_sha256": "1"},
        {"source": "s", "product_url": "https://x.test/products/a/", "evidence_sha256": "2"},
    ]
    report = acq.build_report(records, [], 2, [], 1)
    assert report["identity_collisions"] == 1


# ----------------------------------------------------------------------
# BLOCKER 2 — the outputs reach disk
# ----------------------------------------------------------------------


def test_outputs_are_written_not_printed(acq, tmp_path):
    """`df.to_csv()` with no path returns a string and writes nothing; the
    previous version printed it, leaving an empty output directory."""
    records = [{"product_id": "UAE-CAS-abc", "source": "cas_basics",
                "product_url": "https://x.test/products/a",
                "product_name_raw": "Amira", "description_raw": "text",
                "evidence_sha256": "deadbeef"}]
    failures = [{"source": "abay", "url": "https://y.test/products/b", "stage": "fetch",
                 "http_status": 404, "reason": "HTTP_404", "retrieved_at": "now"}]
    report = acq.build_report(records, failures, 2, [], 2)

    paths = acq.write_outputs(str(tmp_path), records, failures, report)

    for path in paths.values():
        assert os.path.exists(path) and os.path.getsize(path) > 0

    with open(paths["products"], encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    assert len(rows) == 1 and rows[0]["product_id"] == "UAE-CAS-abc"

    with open(paths["failed"], encoding="utf-8") as handle:
        assert next(csv.DictReader(handle))["reason"] == "HTTP_404"

    with open(paths["report"], encoding="utf-8") as handle:
        assert json.load(handle)["collected_count"] == 1


def test_a_zero_record_run_writes_no_phantom_rows(acq, tmp_path):
    """An empty result must be an empty file, not one all-null row."""
    report = acq.build_report([], [], 0, [], 6)
    paths = acq.write_outputs(str(tmp_path), [], [], report)

    with open(paths["products"], encoding="utf-8") as handle:
        assert list(csv.DictReader(handle)) == []
    assert json.load(open(paths["report"], encoding="utf-8"))["collected_count"] == 0


def test_evidence_is_stored_as_the_bytes_received(acq, tmp_path):
    """Saving a lossy decode means the evidence is not what the server sent."""
    body = "عباية سوداء — nida fabric".encode("utf-8")
    path = acq.save_evidence(str(tmp_path), "UAE-CAS-abc", body)
    with open(path, "rb") as handle:
        assert handle.read() == body


# ----------------------------------------------------------------------
# extraction: never invent, always attribute
# ----------------------------------------------------------------------


def test_extraction_reads_the_stated_fields(acq):
    record = acq.extract_product(PRODUCT_JSONLD, "https://x.test/products/amira")
    assert record["product_name_raw"] == "Amira Abaya"
    assert record["description_raw"].startswith("Black nida abaya")
    assert record["price"] == 1250.0
    assert record["currency"] == "AED"
    assert record["color_raw"] == "Black"
    assert record["fabric_raw"] == "Nida"
    assert record["embellishment_raw"] == "Crystal stones"
    assert record["availability"] == "InStock"
    assert record["image_url"] == "https://x.test/img/1.jpg"


def test_a_product_behind_a_breadcrumb_and_inside_a_graph_is_found(acq):
    """Taking only data[0] of a JSON-LD list loses the Product whenever a
    BreadcrumbList is emitted first — the common Shopify layout."""
    record = acq.extract_product(PRODUCT_JSONLD, "https://x.test/products/amira")
    assert record["product_name_raw"] == "Amira Abaya"


def test_a_formatted_price_does_not_discard_the_rest_of_the_product(acq):
    """`float('1,250.00')` raised inside the try that wrapped the whole block,
    taking the name and description with it."""
    html = PRODUCT_JSONLD.replace('"1,250.00"', '"AED 1,250.00 incl. VAT"')
    record = acq.extract_product(html, "https://x.test/products/amira")
    assert record["product_name_raw"] == "Amira Abaya"
    assert record["description_raw"].startswith("Black nida abaya")


def test_currency_is_never_defaulted(acq):
    """A page stating no currency must not be recorded as AED."""
    html = PRODUCT_JSONLD.replace('"priceCurrency":"AED",', "")
    record = acq.extract_product(html, "https://x.test/products/amira")
    assert record["currency"] is None


def test_unstated_fields_stay_none(acq):
    html = """<html><head><title>Plain</title><script type="application/ld+json">
    {"@type":"Product","name":"Plain Abaya"}</script></head></html>"""
    record = acq.extract_product(html, "https://x.test/products/plain")
    for field in ("description_raw", "price", "currency", "color_raw", "fabric_raw",
                  "variants_raw", "set_raw", "embellishment_raw", "availability", "image_url"):
        assert record[field] is None, f"{field} was invented"


def test_every_value_records_which_extractor_produced_it(acq):
    """A description from JSON-LD and one from a meta tag are not equivalent:
    themes routinely auto-generate the meta description from the title."""
    record = acq.extract_product(PRODUCT_JSONLD, "https://x.test/products/amira")
    methods = json.loads(record["extraction_methods"])
    assert methods["description_raw"] == "JSON_LD"
    assert methods["color_raw"] == "JSON_LD_PROPERTY"

    title_only = '<html><head><title>Amira Abaya</title>' \
                 '<meta name="description" content="Amira Abaya"></head></html>'
    fallback = acq.extract_product(title_only, "https://x.test/products/amira")
    marks = json.loads(fallback["extraction_methods"])
    assert marks["product_name_raw"] == "HTML_TITLE"
    assert marks["description_raw"] == "HTML_META_DESCRIPTION"


def test_the_page_title_never_becomes_the_description(acq):
    html = "<html><head><title>Amira Abaya Black Nida Hand Embroidered</title></head></html>"
    record = acq.extract_product(html, "https://x.test/products/amira")
    assert record["product_name_raw"] == "Amira Abaya Black Nida Hand Embroidered"
    assert record["description_raw"] is None


# ----------------------------------------------------------------------
# robots: unreadable means refused
# ----------------------------------------------------------------------


def test_unreadable_robots_refuses_rather_than_proceeds(acq):
    """`RobotFileParser.read()` swallows a failed fetch and leaves an empty
    rule set that permits everything, so "could not read the rules" and "the
    rules allow this" become indistinguishable."""
    assert acq.robots_allows(None, "https://x.test/products/a") is False


def test_robots_is_checked_per_url_not_per_site(acq):
    """A site may permit `/` and forbid `/products/`."""
    import urllib.robotparser
    parser = urllib.robotparser.RobotFileParser()
    parser.parse(["User-agent: *", "Disallow: /products/"])

    assert acq.robots_allows(parser, "https://x.test/") is True
    assert acq.robots_allows(parser, "https://x.test/products/aaa") is False


def test_the_user_agent_is_attributable(acq):
    """A spoofed browser string makes the crawl untraceable by the operator,
    which contradicts a crawl that claims to respect robots.txt."""
    assert "Mozilla" not in acq.USER_AGENT
    assert "abaya-benchmark" in acq.USER_AGENT


# ----------------------------------------------------------------------
# discovery
# ----------------------------------------------------------------------


def test_sitemap_locs_are_resolved_and_filtered(acq):
    xml = """<urlset>
      <url><loc>https://x.test/products/aaa</loc></url>
      <url><loc>/products/bbb</loc></url>
      <url><loc>https://x.test/collections/all</loc></url>
      <url><loc>https://x.test/pages/about</loc></url>
    </urlset>"""
    locs = acq.locs_in(xml, "https://x.test")
    products = [u for u in locs if acq.is_product_url(u)]
    assert products == ["https://x.test/products/aaa", "https://x.test/products/bbb"]


def test_sitemap_candidates_are_unique_and_cover_pagination(acq):
    candidates = acq.sitemap_candidates("https://x.test", depth=3)
    assert len(candidates) == len(set(candidates))
    assert "https://x.test/sitemap.xml" in candidates
    assert "https://x.test/sitemap_products_3.xml.gz" in candidates
