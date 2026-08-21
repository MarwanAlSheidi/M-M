"""Enrich the raw production catalogue with product-page content.

The raw acquisition is immutable. This writes a **separate** enriched layer
beside it and never modifies `raw_catalog.csv`; a test asserts the raw file is
byte-for-byte unchanged after every run.

Two modes, because live retrieval is not always possible:

    python scripts/enrich_catalog.py            # attempt live retrieval
    python scripts/enrich_catalog.py --import pages.csv
    python scripts/enrich_catalog.py --report-only

The import mode is the one that matters when the environment blocks egress:
product pages collected elsewhere are merged in through the same validation and
provenance path as a live fetch, so the origin of a value is always recorded.

Nothing here invents content. A record that could not be retrieved gets
`enrichment_status=FAILED`, a machine-readable reason, and **empty** enriched
fields — never placeholder text, and never a value inferred from the title.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRODUCTION = os.path.join(PROJECT_ROOT, "data", "production")

RAW = os.path.join(PRODUCTION, "raw_catalog.csv")
ENRICHED = os.path.join(PRODUCTION, "raw_catalog_enriched.csv")
REPORT = os.path.join(PRODUCTION, "enrichment_report.json")
SOURCES = os.path.join(PRODUCTION, "sources.csv")

# Columns added by this layer. The `_page` suffix keeps every enriched value
# distinct from the original acquisition value, so nothing is ever silently
# replaced and both remain auditable side by side.
ENRICHMENT_COLUMNS = [
    "product_url_canonical",
    "product_title_page",
    "description_page",
    "category_page",
    "fabric_page",
    "color_page",
    "variant_page",
    "materials_raw",
    "features_raw",
    "price_page",
    "currency_page",
    "store_page",
    "retrieved_at_source",
    "enrichment_status",
    "enrichment_method",
    "enrichment_reason",
    "provenance_url",
    "enriched_at",
]

# Fields carried straight through from an import, unchanged. Normalized only by
# whitespace collapsing — no casing, no mapping onto the taxonomy. Raw source
# text stays raw; interpretation happens later, under human annotation.
IMPORT_PASSTHROUGH = [
    "product_title_page", "description_page", "category_page", "fabric_page",
    "color_page", "variant_page", "materials_raw", "features_raw",
    "price_page", "currency_page", "store_page", "retrieved_at_source",
]

# The import file's contract. `product_id` ties a row back to the acquisition;
# `product_url` is the page the content was read from. Everything else is
# optional — an empty cell means "the page did not state this", which is a fact
# worth recording, and is never filled in by inference.
IMPORT_TEMPLATE_COLUMNS = ["product_id", "product_url"] + IMPORT_PASSTHROUGH

IMPORT_TEMPLATE = os.path.join(PRODUCTION, "import_template.csv")

# Statuses
PENDING = "PENDING"          # never attempted
ENRICHED_OK = "ENRICHED"     # product page retrieved and parsed
FAILED = "FAILED"            # attempted, could not retrieve
SKIPPED = "SKIPPED"          # original description already adequate

# A description shorter than this is treated as title-only. Documented rather
# than tuned: the point is to flag records where an annotator would be labelling
# a product name, not product text.
MIN_DESCRIPTION_CHARS = 30

TIMEOUT_SECONDS = 20
USER_AGENT = "uae-abaya-benchmark-enrichment/1.0 (research; contact via repository)"


# ----------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------


def normalized(value: Any) -> str:
    """Whitespace-collapsed text, for coverage counting."""
    return " ".join(str(value or "").split())


def has_description(value: Any) -> bool:
    """A description counts only if it carries more than a title's worth."""
    return len(normalized(value)) >= MIN_DESCRIPTION_CHARS


def is_product_url(url: str) -> bool:
    """Product-level page, not a listing. Listing pages are never a substitute."""
    return "/products/" in (url or "") or "/product/" in (url or "")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def canonical_url(url: str) -> str:
    """Canonical form of a product URL, for duplicate detection.

    Drops the query string and fragment, lowercases the host and strips a
    trailing slash: `?variant=123` and `#reviews` address the same product page.
    The path keeps its case, because some stores use case-sensitive handles.
    """
    text = (url or "").strip()
    if not text:
        return ""
    parsed = urllib.parse.urlsplit(text)
    path = (parsed.path or "").rstrip("/")
    return urllib.parse.urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), path, "", ""))


def read_raw() -> Tuple[List[Dict[str, str]], List[str]]:
    if not os.path.exists(RAW):
        raise FileNotFoundError(f"Raw catalogue not found: {RAW}")
    with open(RAW, "r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        return list(reader), list(reader.fieldnames or [])


# ----------------------------------------------------------------------
# retrieval
# ----------------------------------------------------------------------


def check_robots(base: str) -> Tuple[bool, str]:
    """Fetch and honour robots.txt. A robots file we cannot read is a refusal.

    Erring towards "not allowed" is deliberate: proceeding because the rules
    could not be read is exactly the behaviour a crawl policy exists to prevent.
    """
    robots_url = urllib.parse.urljoin(base, "/robots.txt")
    try:
        request = urllib.request.Request(robots_url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            body = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        return False, f"ROBOTS_HTTP_{exc.code}"
    except urllib.error.URLError as exc:
        return False, f"NETWORK_BLOCKED:{exc.reason}"
    except Exception as exc:  # noqa: BLE001 - reason is recorded, never swallowed
        return False, f"ROBOTS_ERROR:{type(exc).__name__}"

    # Minimal parse: a Disallow: / under a wildcard agent blocks us outright.
    agent_applies = False
    for line in body.splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        key, _, value = line.partition(":")
        key, value = key.strip().lower(), value.strip()
        if key == "user-agent":
            agent_applies = value in ("*", USER_AGENT)
        elif key == "disallow" and agent_applies and value == "/":
            return False, "ROBOTS_DISALLOWED"
    return True, "ROBOTS_OK"


def fetch_product_page(url: str) -> Tuple[Optional[str], str]:
    """Retrieve one product page. Returns (html, reason)."""
    try:
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            return response.read().decode("utf-8", errors="replace"), "OK"
    except urllib.error.HTTPError as exc:
        return None, f"HTTP_{exc.code}"
    except urllib.error.URLError as exc:
        return None, f"NETWORK_BLOCKED:{exc.reason}"
    except Exception as exc:  # noqa: BLE001
        return None, f"FETCH_ERROR:{type(exc).__name__}"


_TAG = re.compile(r"<[^>]+>")


def extract_from_html(html: str) -> Dict[str, str]:
    """Pull only explicitly stated fields out of a product page.

    Deliberately conservative. It reads the page's own title and description
    metadata and nothing else: no keyword matching against the taxonomy, no
    "looks like a fabric" heuristics. Anything not stated outright stays empty,
    because a guess recorded here would become gold later.
    """
    out = {key: "" for key in ("product_title_page", "description_page",
                               "materials_raw", "features_raw")}

    title = re.search(r"<title[^>]*>(.*?)</title>", html, re.S | re.I)
    if title:
        out["product_title_page"] = normalized(_TAG.sub(" ", title.group(1)))

    meta = re.search(
        r'<meta[^>]+(?:name|property)=["\'](?:description|og:description)["\'][^>]+'
        r'content=["\'](.*?)["\']', html, re.S | re.I)
    if meta:
        out["description_page"] = normalized(meta.group(1))

    return out


# ----------------------------------------------------------------------
# enrichment
# ----------------------------------------------------------------------


def blank_enrichment(status: str, method: str, reason: str) -> Dict[str, str]:
    """An unenriched row. Every value empty — no placeholder, no invention."""
    row = {key: "" for key in ENRICHMENT_COLUMNS}
    row.update({
        "enrichment_status": status,
        "enrichment_method": method,
        "enrichment_reason": reason,
        "enriched_at": utc_now(),
    })
    return row


def enrich_live(records: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """Attempt live retrieval, honouring robots.txt, bypassing nothing."""
    robots_cache: Dict[str, Tuple[bool, str]] = {}
    results = []

    for record in records:
        url = (record.get("source_url") or "").strip()

        if has_description(record.get("description_raw")):
            results.append(blank_enrichment(SKIPPED, "none", "ORIGINAL_DESCRIPTION_ADEQUATE"))
            continue

        if not url:
            results.append(blank_enrichment(FAILED, "live_http", "NO_URL"))
            continue

        if not is_product_url(url):
            # A listing page is not a substitute for a product page.
            results.append(blank_enrichment(FAILED, "live_http", "NO_PRODUCT_URL"))
            continue

        parsed = urllib.parse.urlparse(url)
        base = f"{parsed.scheme}://{parsed.netloc}"
        if base not in robots_cache:
            robots_cache[base] = check_robots(base)
        allowed, robots_reason = robots_cache[base]

        if not allowed:
            results.append(blank_enrichment(FAILED, "live_http", robots_reason))
            continue

        html, reason = fetch_product_page(url)
        if html is None:
            results.append(blank_enrichment(FAILED, "live_http", reason))
            continue

        extracted = extract_from_html(html)
        if not extracted["description_page"]:
            results.append(blank_enrichment(FAILED, "live_http", "PARSE_NO_DESCRIPTION"))
            continue

        row = blank_enrichment(ENRICHED_OK, "live_http", "OK")
        row.update(extracted)
        row["provenance_url"] = url
        results.append(row)

    return results


def import_url(row: Dict[str, str]) -> str:
    """The product-page URL of an import row, under any of its accepted names."""
    for column in ("product_url", "source_url", "provenance_url"):
        value = normalized(row.get(column))
        if value:
            return value
    return ""


def import_payload(row: Dict[str, str]) -> Tuple[str, ...]:
    """Everything an import row asserts. Two rows with equal payloads are the
    same statement about the same product, so collapsing them loses nothing."""
    return tuple([import_url(row)] + [normalized(row.get(k)) for k in IMPORT_PASSTHROUGH])


def read_import(path: str) -> Dict[str, Dict[str, str]]:
    """Load an import file, keyed by product_id.

    Duplicate rows for one product_id are resolved by **identity, not order**:
    byte-equal assertions collapse into one, while two rows that disagree about
    the same product are refused outright. Silently keeping the first would
    decide which of two conflicting claims is true, which is not a decision this
    script is entitled to make.
    """
    if not os.path.exists(path):
        raise FileNotFoundError(f"Import file not found: {path}")

    supplied: Dict[str, Dict[str, str]] = {}
    conflicting: List[str] = []

    with open(path, "r", encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            key = (row.get("product_id") or "").strip()
            if not key:
                continue
            previous = supplied.get(key)
            if previous is None:
                supplied[key] = row
            elif import_payload(previous) != import_payload(row):
                conflicting.append(key)

    if conflicting:
        raise ValueError(
            "import file contains conflicting rows for the same product_id: "
            + ", ".join(sorted(set(conflicting)))
            + " — resolve them at source; this script will not pick a winner"
        )
    return supplied


def enrich_from_import(records: List[Dict[str, str]], path: str) -> List[Dict[str, str]]:
    """Merge externally collected product pages by product_id.

    The import path exists so a collection run performed outside this
    environment can be folded in without weakening any rule: the same status,
    reason and provenance are recorded, and a row absent from the import stays
    FAILED rather than quietly becoming enriched.

    Two records may not be enriched from one product page. The first record in
    catalogue order claims the canonical URL; any later record pointing at the
    same page is FAILED as `DUPLICATE_PRODUCT_URL`, because one page cannot be
    the evidence for two products and picking one silently would fabricate the
    distinction between them.
    """
    supplied = read_import(path)
    claimed: Dict[str, str] = {}
    results = []

    for record in records:
        product_id = record["product_id"]

        if has_description(record.get("description_raw")):
            results.append(blank_enrichment(SKIPPED, "none", "ORIGINAL_DESCRIPTION_ADEQUATE"))
            continue

        incoming = supplied.get(product_id)
        if incoming is None:
            results.append(blank_enrichment(FAILED, "import", "NOT_IN_IMPORT"))
            continue

        url = import_url(incoming)
        canonical = canonical_url(url)

        def failed(reason: str) -> Dict[str, str]:
            row = blank_enrichment(FAILED, "import", reason)
            row["product_url_canonical"] = canonical
            return row

        if not url:
            results.append(failed("NO_URL"))
            continue

        if not is_product_url(url):
            results.append(failed("NO_PRODUCT_URL"))
            continue

        if claimed.get(canonical, product_id) != product_id:
            results.append(failed("DUPLICATE_PRODUCT_URL"))
            continue

        description = normalized(incoming.get("description_page"))
        if not description:
            results.append(failed("IMPORT_NO_DESCRIPTION"))
            continue

        row = blank_enrichment(ENRICHED_OK, "import", "OK")
        for key in IMPORT_PASSTHROUGH:
            row[key] = normalized(incoming.get(key))
        row["description_page"] = description
        row["product_url_canonical"] = canonical
        row["provenance_url"] = url
        results.append(row)
        claimed[canonical] = product_id

    return results


# ----------------------------------------------------------------------
# reporting
# ----------------------------------------------------------------------


def coverage(rows: List[Dict[str, str]], *fields: str) -> float:
    if not rows:
        return 0.0
    hit = sum(1 for r in rows if any(normalized(r.get(f)) for f in fields))
    return round(hit / len(rows), 4)


def build_report(records, enrichment, merged) -> Dict[str, Any]:
    total = len(records)
    with_original = sum(1 for r in records if has_description(r.get("description_raw")))
    statuses: Dict[str, int] = {}
    reasons: Dict[str, int] = {}
    for row in enrichment:
        statuses[row["enrichment_status"]] = statuses.get(row["enrichment_status"], 0) + 1
        if row["enrichment_status"] == FAILED:
            reasons[row["enrichment_reason"]] = reasons.get(row["enrichment_reason"], 0) + 1

    with_product_url = sum(1 for r in records if is_product_url(r.get("source_url", "")))

    by_source: Dict[str, Dict[str, Any]] = {}
    for record, row in zip(records, enrichment):
        bucket = by_source.setdefault(record["source"], {"records": 0, "enriched": 0,
                                                         "failed": 0, "product_urls": 0})
        bucket["records"] += 1
        bucket["enriched"] += row["enrichment_status"] == ENRICHED_OK
        bucket["failed"] += row["enrichment_status"] == FAILED
        bucket["product_urls"] += is_product_url(record.get("source_url", ""))

    after = sum(1 for r in merged
                if has_description(r.get("description_raw")) or has_description(r.get("description_page")))

    # The URL a record was actually attempted with: the import's URL when one
    # was supplied, otherwise the URL the acquisition recorded.
    def attempted(record, row) -> str:
        return normalized(row.get("product_url_canonical")) or normalized(record.get("source_url"))

    missing_url = sum(1 for r in records if not normalized(r.get("source_url")))
    duplicate_count = sum(1 for row in enrichment
                          if row["enrichment_reason"] == "DUPLICATE_PRODUCT_URL")

    # How many distinct pages the catalogue actually points at. Far below
    # total_records means many records share one collection page, and a shared
    # page cannot be per-record evidence.
    canonical_urls = [canonical_url(r.get("source_url", "")) for r in records]
    product_canonical = {c for c, r in zip(canonical_urls, records)
                         if c and is_product_url(r.get("source_url", ""))}

    failed_urls = [
        {"product_id": record["product_id"],
         "url": attempted(record, row),
         "reason": row["enrichment_reason"]}
        for record, row in zip(records, enrichment)
        if row["enrichment_status"] == FAILED
    ]

    return {
        "stage": "REAL_RAW_PRODUCTION_DATA — ENRICHMENT",
        "gold_status": "LOCKED — no annotation performed, no gold.csv created",
        "generated_at": utc_now(),
        "total_records": total,
        "records_with_original_description": with_original,
        "records_without_original_description": total - with_original,
        "records_successfully_enriched": statuses.get(ENRICHED_OK, 0),
        "records_failed": statuses.get(FAILED, 0),
        "records_skipped_already_adequate": statuses.get(SKIPPED, 0),
        "records_with_product_page": with_product_url,
        "records_without_product_page": total - with_product_url,
        "description_coverage_before": round(with_original / total, 4) if total else 0.0,
        "description_coverage_after": round(after / total, 4) if total else 0.0,
        "fabric_coverage": coverage(merged, "fabric_raw", "fabric_page"),
        "color_coverage": coverage(merged, "color_raw", "color_page"),
        "variant_coverage": coverage(merged, "variant_raw", "variant_page"),
        "materials_coverage": coverage(merged, "materials_raw"),
        "missing_url_count": missing_url,
        "duplicate_count": duplicate_count,
        "distinct_canonical_urls": len({c for c in canonical_urls if c}),
        "distinct_canonical_product_urls": len(product_canonical),
        "source_breakdown": by_source,
        "failure_reasons": dict(sorted(reasons.items(), key=lambda kv: -kv[1])),
        "failed_urls": failed_urls,
        "min_description_chars": MIN_DESCRIPTION_CHARS,
        "quality_gate_target": 0.80,
        "quality_gate_met": (after / total if total else 0.0) >= 0.80,
    }


def write_sources(records, enrichment) -> None:
    """Per-source registry: what was reachable, and why not."""
    rollup: Dict[str, Dict[str, Any]] = {}
    for record, row in zip(records, enrichment):
        bucket = rollup.setdefault(record["source"], {
            "source": record["source"], "brand": record.get("brand", ""),
            "records": 0, "product_urls": 0, "enriched": 0, "failed": 0,
            "urls": set(), "reasons": set(),
        })
        bucket["records"] += 1
        bucket["product_urls"] += is_product_url(record.get("source_url", ""))
        bucket["enriched"] += row["enrichment_status"] == ENRICHED_OK
        bucket["failed"] += row["enrichment_status"] == FAILED
        bucket["urls"].add(record.get("source_url", ""))
        if row["enrichment_status"] == FAILED:
            bucket["reasons"].add(row["enrichment_reason"])

    with open(SOURCES, "w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["source", "brand", "records", "product_urls", "enriched",
                         "failed", "distinct_urls", "failure_reasons"])
        for key in sorted(rollup):
            b = rollup[key]
            writer.writerow([b["source"], b["brand"], b["records"], b["product_urls"],
                             b["enriched"], b["failed"], len(b["urls"]),
                             "; ".join(sorted(b["reasons"]))])


def write_import_template(path: str) -> str:
    """Emit the import contract as a header-only CSV.

    Zero rows, deliberately. A template pre-filled with plausible examples is
    the single easiest way for invented content to end up in a dataset, so the
    file that gets handed round carries column names and nothing else.
    """
    with open(path, "w", encoding="utf-8", newline="") as handle:
        csv.writer(handle).writerow(IMPORT_TEMPLATE_COLUMNS)
    return path


# ----------------------------------------------------------------------
# main
# ----------------------------------------------------------------------


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Enrich the raw production catalogue")
    parser.add_argument("--import", dest="import_path", default=None,
                        help="Merge externally collected product pages (CSV keyed by product_id)")
    parser.add_argument("--report-only", action="store_true",
                        help="Recompute the report from the existing enriched file")
    parser.add_argument("--write-import-template", nargs="?", const=IMPORT_TEMPLATE,
                        default=None, metavar="PATH",
                        help="Write a header-only import template and exit")
    args = parser.parse_args(argv)

    if args.write_import_template:
        target = write_import_template(args.write_import_template)
        print(f"  import template written : {target}")
        print(f"  columns                 : {', '.join(IMPORT_TEMPLATE_COLUMNS)}")
        return 0

    records, raw_columns = read_raw()

    if args.report_only:
        if not os.path.exists(ENRICHED):
            print(f"❌ No enriched file at {ENRICHED}")
            return 1
        with open(ENRICHED, "r", encoding="utf-8", newline="") as handle:
            merged = list(csv.DictReader(handle))
        enrichment = [{k: r.get(k, "") for k in ENRICHMENT_COLUMNS} for r in merged]
    else:
        enrichment = (enrich_from_import(records, args.import_path)
                      if args.import_path else enrich_live(records))
        merged = [{**record, **row} for record, row in zip(records, enrichment)]

        with open(ENRICHED, "w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=raw_columns + ENRICHMENT_COLUMNS)
            writer.writeheader()
            writer.writerows(merged)

    report = build_report(records, enrichment, merged)
    with open(REPORT, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, ensure_ascii=False)
    write_sources(records, enrichment)

    print(f"  records                     : {report['total_records']}")
    print(f"  description coverage before : {report['description_coverage_before']*100:.1f}%")
    print(f"  enriched                    : {report['records_successfully_enriched']}")
    print(f"  failed                      : {report['records_failed']}")
    print(f"  description coverage after  : {report['description_coverage_after']*100:.1f}%")
    print(f"  quality gate (>=80%)        : {'MET' if report['quality_gate_met'] else 'NOT MET'}")
    if report["failure_reasons"]:
        print("  failure reasons:")
        for reason, count in report["failure_reasons"].items():
            print(f"    {count:>4}  {reason}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
