"""Acquire individual product pages from UAE abaya storefronts.

Discovery → retrieval → evidence → extraction → deduplication → report.

Written to run somewhere with outbound HTTPS; this repository's environment has
none, so every part that does not need the network is a plain function and is
tested offline against fixture payloads.

    python scripts/acquire_products.py --out data/acquisition_v1
    python scripts/acquire_products.py --source cas_basics --max 50
    python scripts/acquire_products.py --dry-run     # discovery only, no pages

Standard library only, matching scripts/enrich_catalog.py: no requests, no
bs4, no pandas. That is not minimalism for its own sake — it removes an install
step from the machine that will run this, and it lets the extraction be tested
in an environment where those packages are absent.

Nothing here invents a value. A field the page does not state stays None, and
every extracted field records which extractor produced it, so a value read from
JSON-LD is never confused with one guessed from a meta tag.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from enrich_catalog import canonical_url, is_product_url  # noqa: E402

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# An honest, attributable agent. A spoofed browser string would make the crawl
# untraceable by the site operator, which is the opposite of what a crawl
# claiming to respect robots.txt should be.
USER_AGENT = "uae-abaya-benchmark-acquisition/1.0 (research; contact via repository)"

TIMEOUT_SECONDS = 15
MAX_RETRIES = 3
DELAY_MIN, DELAY_MAX = 0.5, 1.2

SOURCES = [
    {"key": "cas_basics",     "name": "CAS Basics",     "home": "https://casbasics.com",        "prefix": "CAS",      "max": 400},
    {"key": "abay",           "name": "ABAY",           "home": "https://abay.com",             "prefix": "ABAY",     "max": 150},
    {"key": "zadina",         "name": "Zadina Abayas",  "home": "https://www.zadinaabayas.com", "prefix": "ZADINA",   "max": 150},
    {"key": "infinite_vibes", "name": "Infinite Vibes", "home": "https://infinitevibes.ae",     "prefix": "INFINITE", "max": 150},
    {"key": "effa",           "name": "Effa Fashion",   "home": "https://www.effa.ae",          "prefix": "EFFA",     "max": 75},
    {"key": "noorai",         "name": "Noorai Dubai",   "home": "https://nooraidubai.com",      "prefix": "NOORAI",   "max": 75},
]

PRODUCT_COLUMNS = [
    "product_id", "source", "product_url", "product_url_canonical", "provenance_url",
    "product_name_raw", "description_raw", "price", "currency", "price_raw",
    "color_raw", "fabric_raw", "category_raw", "variants_raw", "set_raw",
    "embellishment_raw", "availability", "image_url", "retrieved_at",
    "http_status", "evidence_path", "evidence_sha256", "extraction_methods",
]

FAILURE_COLUMNS = ["source", "url", "stage", "http_status", "reason", "retrieved_at"]

MIN_DESCRIPTION_CHARS = 30


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ----------------------------------------------------------------------
# BLOCKER 1 — identity derived from the page, never from position
# ----------------------------------------------------------------------


def product_id_for(prefix: str, url: str) -> str:
    """A stable id for one product page.

    Derived from the canonical URL, so the same page yields the same id on
    every run, from any machine, in any order. The previous scheme numbered
    products by their position in a `set`, whose iteration order varies between
    processes — the same garment was `CAS_001` in one run and `CAS_003` in the
    next, which silently invalidates every gold label bound to an id.
    """
    digest = hashlib.sha256(canonical_url(url).encode("utf-8")).hexdigest()[:12]
    return f"UAE-{prefix}-{digest}"


# ----------------------------------------------------------------------
# network
# ----------------------------------------------------------------------


def fetch(url: str, timeout: int = TIMEOUT_SECONDS) -> Dict[str, Any]:
    """Retrieve one URL. Returns the raw bytes; never decodes for storage."""
    last = "UNKNOWN"
    for attempt in range(MAX_RETRIES):
        try:
            request = urllib.request.Request(url, headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml,application/json",
                "Accept-Language": "en,ar",
            })
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = response.read()
                # A .xml.gz sitemap arrives as gzip bytes with no
                # Content-Encoding, so urllib does not unwrap it.
                if body[:2] == b"\x1f\x8b":
                    try:
                        body = gzip.decompress(body)
                    except OSError:
                        pass
                return {"ok": True, "status": response.getcode(), "body": body,
                        "sha256": hashlib.sha256(body).hexdigest(), "reason": "OK"}
        except urllib.error.HTTPError as exc:
            last = f"HTTP_{exc.code}"
            if exc.code == 429 or exc.code >= 500:
                time.sleep(1 + attempt * 2)
                continue
            return {"ok": False, "status": exc.code, "body": None,
                    "sha256": None, "reason": last}
        except urllib.error.URLError as exc:
            last = f"NETWORK:{exc.reason}"
            time.sleep(1 + attempt)
        except Exception as exc:  # noqa: BLE001 — the reason is recorded, never swallowed
            last = f"ERROR:{type(exc).__name__}"
            time.sleep(1 + attempt)
    return {"ok": False, "status": 0, "body": None, "sha256": None, "reason": last}


def robots_for(home: str) -> Tuple[Optional[urllib.robotparser.RobotFileParser], str]:
    """Fetch and parse robots.txt. A file we cannot read is a refusal.

    `RobotFileParser.read()` swallows a failed fetch and leaves an empty rule
    set that permits everything, so the fetch is done here instead: "could not
    read the rules" and "the rules allow this" must not look the same.
    """
    result = fetch(urllib.parse.urljoin(home, "/robots.txt"), timeout=10)
    if not result["ok"]:
        return None, f"ROBOTS_UNREADABLE:{result['reason']}"
    parser = urllib.robotparser.RobotFileParser()
    parser.parse(result["body"].decode("utf-8", errors="replace").splitlines())
    return parser, "ROBOTS_OK"


def robots_allows(parser: Optional[urllib.robotparser.RobotFileParser], url: str) -> bool:
    """Per-URL check. A site may permit `/` and forbid `/products/`."""
    if parser is None:
        return False
    return parser.can_fetch(USER_AGENT, url)


# ----------------------------------------------------------------------
# discovery
# ----------------------------------------------------------------------


_LOC = re.compile(r"<loc>\s*(.*?)\s*</loc>", re.I | re.S)
_HREF = re.compile(r'<a[^>]+href=["\'](.*?)["\']', re.I)


def sitemap_candidates(home: str, depth: int = 20) -> List[str]:
    names = ["/sitemap.xml", "/sitemap_index.xml", "/sitemap_products_1.xml"]
    for index in range(1, depth + 1):
        names.append(f"/sitemap_products_{index}.xml")
        names.append(f"/sitemap_products_{index}.xml.gz")
    seen, out = set(), []
    for name in names:
        url = urllib.parse.urljoin(home, name)
        if url not in seen:
            seen.add(url)
            out.append(url)
    return out


def locs_in(xml_text: str, base: str) -> List[str]:
    return [urllib.parse.urljoin(base, loc) for loc in _LOC.findall(xml_text)]


def links_in(html_text: str, base: str) -> List[str]:
    return [urllib.parse.urljoin(base, href) for href in _HREF.findall(html_text)]


# ----------------------------------------------------------------------
# BLOCKER 3 — deduplication on the repository's canonical form
# ----------------------------------------------------------------------


def dedupe_urls(urls: List[str]) -> Tuple[List[str], List[Dict[str, str]]]:
    """Collapse the forms of one page, keeping the first occurrence.

    Uses `enrich_catalog.canonical_url` rather than a second implementation, so
    acquisition and ingestion cannot disagree about whether two URLs are the
    same product. The previous regex stripped nothing — it matched `[?&]param=`
    against a query string that has no leading `?`, so the first parameter
    always survived and five forms of one product stayed five products.
    """
    kept: List[str] = []
    claimed: Dict[str, str] = {}
    duplicates: List[Dict[str, str]] = []

    for url in urls:
        key = canonical_url(url)
        if key in claimed:
            duplicates.append({"url": url, "canonical_url": key, "first_seen": claimed[key]})
            continue
        claimed[key] = url
        kept.append(url)
    return kept, duplicates


# ----------------------------------------------------------------------
# extraction
# ----------------------------------------------------------------------


_JSONLD = re.compile(
    r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', re.I | re.S)
_TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
_META = re.compile(
    r'<meta[^>]+name=["\']description["\'][^>]+content=["\'](.*?)["\']', re.I | re.S)
_TAG = re.compile(r"<[^>]+>")


def collapse(value: Any) -> Optional[str]:
    text = " ".join(str(value or "").split())
    return text or None


def parse_price(value: Any) -> Optional[float]:
    """A price we cannot parse is unknown, not zero — and not fatal.

    Previously this ran inside the try that wrapped the whole JSON-LD block, so
    a price written `1,250.00` raised and discarded the product's name and
    description along with it.
    """
    if value is None:
        return None
    text = str(value).strip().replace(",", "")
    text = re.sub(r"[^\d.\-]", "", text)
    try:
        return float(text)
    except ValueError:
        return None


def iter_jsonld_products(html_text: str):
    """Every Product node in the page, including inside @graph.

    Taking only the first element of a JSON-LD list loses the Product whenever
    a BreadcrumbList is emitted first, which is the common Shopify layout.
    """
    for block in _JSONLD.findall(html_text):
        try:
            data = json.loads(block.strip())
        except (ValueError, TypeError):
            continue
        stack = [data]
        while stack:
            node = stack.pop()
            if isinstance(node, list):
                stack.extend(node)
            elif isinstance(node, dict):
                if "@graph" in node:
                    stack.append(node["@graph"])
                node_type = node.get("@type")
                types = node_type if isinstance(node_type, list) else [node_type]
                if "Product" in types:
                    yield node


def extract_product(html_text: str, url: str) -> Dict[str, Any]:
    """Read only what the page states. Everything else stays None.

    `extraction_methods` records the origin of each value, so a description
    taken from JSON-LD is distinguishable from one taken from a meta tag —
    themes frequently auto-generate the meta description from the title, and a
    product name presented as product text would poison annotation.
    """
    record: Dict[str, Any] = {key: None for key in (
        "product_name_raw", "description_raw", "price", "currency", "price_raw",
        "color_raw", "fabric_raw", "category_raw", "variants_raw", "set_raw",
        "embellishment_raw", "availability", "image_url")}
    methods: Dict[str, str] = {}

    def put(field: str, value: Any, method: str) -> None:
        value = collapse(value) if not isinstance(value, float) else value
        if value is not None and record.get(field) is None:
            record[field] = value
            methods[field] = method

    for node in iter_jsonld_products(html_text):
        put("product_name_raw", node.get("name"), "JSON_LD")
        put("description_raw", node.get("description"), "JSON_LD")

        images = node.get("image")
        if isinstance(images, list) and images:
            put("image_url", images[0], "JSON_LD")
        elif isinstance(images, str):
            put("image_url", images, "JSON_LD")

        put("category_raw", node.get("category"), "JSON_LD")
        put("color_raw", node.get("color"), "JSON_LD")
        put("fabric_raw", node.get("material"), "JSON_LD")

        offers = node.get("offers")
        if isinstance(offers, list):
            offers = offers[0] if offers else None
        if isinstance(offers, dict):
            price = parse_price(offers.get("price"))
            if price is not None and record["price"] is None:
                record["price"] = price
                methods["price"] = "JSON_LD"
            if offers.get("price") is not None:
                put("price_raw", offers.get("price"), "JSON_LD")
            # No default currency. A page that does not state one leaves this
            # None; assuming AED would be an invented value on every row.
            put("currency", offers.get("priceCurrency"), "JSON_LD")
            availability = str(offers.get("availability") or "")
            if "InStock" in availability:
                put("availability", "InStock", "JSON_LD")
            elif "OutOfStock" in availability:
                put("availability", "OutOfStock", "JSON_LD")

        for prop in node.get("additionalProperty") or []:
            if not isinstance(prop, dict):
                continue
            name = (prop.get("name") or "").lower()
            value = prop.get("value")
            if "colour" in name or "color" in name:
                put("color_raw", value, "JSON_LD_PROPERTY")
            elif "fabric" in name or "material" in name:
                put("fabric_raw", value, "JSON_LD_PROPERTY")
            elif "size" in name or "variant" in name:
                put("variants_raw", value, "JSON_LD_PROPERTY")
            elif "embellish" in name or "embroider" in name:
                put("embellishment_raw", value, "JSON_LD_PROPERTY")
            elif "set" in name or "include" in name:
                put("set_raw", value, "JSON_LD_PROPERTY")

    title = _TITLE.search(html_text)
    if title:
        put("product_name_raw", _TAG.sub(" ", title.group(1)), "HTML_TITLE")

    meta = _META.search(html_text)
    if meta:
        put("description_raw", meta.group(1), "HTML_META_DESCRIPTION")

    record["extraction_methods"] = json.dumps(methods, sort_keys=True) if methods else ""
    return record


# ----------------------------------------------------------------------
# BLOCKER 4 — every figure computed from the rows
# ----------------------------------------------------------------------


def build_report(records, failures, discovered, duplicates, sources_attempted) -> Dict[str, Any]:
    total = len(records)

    def present(field: str) -> int:
        return sum(1 for r in records if str(r.get(field) or "").strip())

    def ratio(count: int) -> float:
        return round(count / total, 4) if total else 0.0

    annotatable = sum(1 for r in records
                      if len(str(r.get("description_raw") or "").split()) and
                      len(" ".join(str(r.get("description_raw") or "").split())) >= MIN_DESCRIPTION_CHARS)

    by_source: Dict[str, Dict[str, Any]] = {}
    for record in records:
        bucket = by_source.setdefault(record["source"], {
            "collected": 0, "description": 0, "price": 0, "color": 0,
            "fabric": 0, "image": 0})
        bucket["collected"] += 1
        for field, key in (("description_raw", "description"), ("price", "price"),
                           ("color_raw", "color"), ("fabric_raw", "fabric"),
                           ("image_url", "image")):
            if str(record.get(field) or "").strip():
                bucket[key] += 1

    failure_reasons: Dict[str, int] = {}
    for failure in failures:
        failure_reasons[failure["reason"]] = failure_reasons.get(failure["reason"], 0) + 1

    canonicals = {canonical_url(r["product_url"]) for r in records}
    non_product = [r["product_url"] for r in records if not is_product_url(r["product_url"])]

    return {
        "stage": "REAL_RAW_PRODUCTION_DATA — ACQUISITION",
        "gold_status": "LOCKED — no annotation performed, no gold.csv created",
        "generated_at": utc_now(),
        "sources_attempted": sources_attempted,
        "sources_yielding": len(by_source),
        "urls_discovered": discovered,
        "urls_after_deduplication": discovered - len(duplicates),
        "duplicate_count": len(duplicates),
        "collected_count": total,
        "distinct_canonical_urls": len(canonicals),
        "identity_collisions": total - len(canonicals),
        "non_product_urls_collected": len(non_product),
        "failed_count": len(failures),
        "coverage": {
            "description": ratio(present("description_raw")),
            "description_annotatable": ratio(annotatable),
            "price": ratio(present("price")),
            "currency": ratio(present("currency")),
            "color": ratio(present("color_raw")),
            "fabric": ratio(present("fabric_raw")),
            "category": ratio(present("category_raw")),
            "variants": ratio(present("variants_raw")),
            "embellishment": ratio(present("embellishment_raw")),
            "availability": ratio(present("availability")),
            "image": ratio(present("image_url")),
        },
        "min_description_chars": MIN_DESCRIPTION_CHARS,
        "source_breakdown": by_source,
        "failure_reasons": dict(sorted(failure_reasons.items(), key=lambda kv: -kv[1])),
        "evidence_bound": sum(1 for r in records if r.get("evidence_sha256")),
    }


# ----------------------------------------------------------------------
# BLOCKER 2 — the outputs are written to disk
# ----------------------------------------------------------------------


def write_outputs(out_dir: str, records, failures, report) -> Dict[str, str]:
    """Write the deliverables. `to_csv()` with no path returns a string and
    writes nothing; the previous version printed it and exited, leaving an
    empty output directory and nothing to hand over."""
    os.makedirs(out_dir, exist_ok=True)
    paths = {
        "products": os.path.join(out_dir, "abaya_production_products.csv"),
        "failed": os.path.join(out_dir, "abaya_production_failed.csv"),
        "report": os.path.join(out_dir, "acquisition_report.json"),
    }

    with open(paths["products"], "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=PRODUCT_COLUMNS)
        writer.writeheader()
        for record in records:
            writer.writerow({c: record.get(c, "") for c in PRODUCT_COLUMNS})

    with open(paths["failed"], "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FAILURE_COLUMNS)
        writer.writeheader()
        for failure in failures:
            writer.writerow({c: failure.get(c, "") for c in FAILURE_COLUMNS})

    with open(paths["report"], "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, ensure_ascii=False)

    return paths


def save_evidence(evidence_dir: str, product_id: str, body: bytes) -> str:
    """Store exactly what the server sent — bytes, not a lossy decode."""
    os.makedirs(evidence_dir, exist_ok=True)
    path = os.path.join(evidence_dir, f"{product_id}.html")
    with open(path, "wb") as handle:
        handle.write(body)
    return path


# ----------------------------------------------------------------------
# orchestration
# ----------------------------------------------------------------------


def discover(source: Dict[str, Any], parser, failures: List[Dict[str, str]]) -> List[str]:
    found: List[str] = []
    home = source["home"]

    for sitemap in sitemap_candidates(home):
        if not robots_allows(parser, sitemap):
            continue
        result = fetch(sitemap, timeout=10)
        if not result["ok"]:
            continue
        text = result["body"].decode("utf-8", errors="replace")
        for loc in locs_in(text, home):
            if is_product_url(loc):
                found.append(loc)
        if len(found) >= source["max"]:
            break

    if not found:
        result = fetch(home)
        if result["ok"]:
            text = result["body"].decode("utf-8", errors="replace")
            found = [u for u in links_in(text, home) if is_product_url(u)]
        else:
            failures.append({"source": source["key"], "url": home, "stage": "discovery",
                             "http_status": result["status"], "reason": result["reason"],
                             "retrieved_at": utc_now()})
    return found


def acquire(selected, out_dir: str, limit: Optional[int], dry_run: bool, quiet: bool):
    evidence_dir = os.path.join(out_dir, "evidence", "raw_html")
    records: List[Dict[str, Any]] = []
    failures: List[Dict[str, str]] = []
    discovered_total = 0
    all_duplicates: List[Dict[str, str]] = []

    for source in selected:
        if not quiet:
            print(f"[+] {source['name']}")

        parser, robots_reason = robots_for(source["home"])
        if parser is None:
            failures.append({"source": source["key"], "url": source["home"],
                             "stage": "robots", "http_status": 0,
                             "reason": robots_reason, "retrieved_at": utc_now()})
            if not quiet:
                print(f"    refused: {robots_reason}")
            continue

        found = discover(source, parser, failures)
        discovered_total += len(found)
        unique, duplicates = dedupe_urls(found)
        all_duplicates.extend(duplicates)

        cap = min(limit or source["max"], source["max"])
        unique = unique[:cap]
        if not quiet:
            print(f"    discovered {len(found)}, unique {len(unique)}, duplicates {len(duplicates)}")

        if dry_run:
            continue

        for url in unique:
            if not robots_allows(parser, url):
                failures.append({"source": source["key"], "url": url, "stage": "robots",
                                 "http_status": 0, "reason": "ROBOTS_DISALLOWED",
                                 "retrieved_at": utc_now()})
                continue

            result = fetch(url)
            if not result["ok"]:
                failures.append({"source": source["key"], "url": url, "stage": "fetch",
                                 "http_status": result["status"], "reason": result["reason"],
                                 "retrieved_at": utc_now()})
                continue

            product_id = product_id_for(source["prefix"], url)
            path = save_evidence(evidence_dir, product_id, result["body"])
            record = extract_product(result["body"].decode("utf-8", errors="replace"), url)
            record.update({
                "product_id": product_id,
                "source": source["key"],
                "product_url": url,
                "product_url_canonical": canonical_url(url),
                "provenance_url": url,
                "retrieved_at": utc_now(),
                "http_status": result["status"],
                "evidence_path": os.path.relpath(path, out_dir),
                "evidence_sha256": result["sha256"],
            })
            records.append(record)
            time.sleep(random.uniform(DELAY_MIN, DELAY_MAX))

    report = build_report(records, failures, discovered_total,
                          all_duplicates, len(selected))
    paths = write_outputs(out_dir, records, failures, report)

    # Every record must bind to a file that exists. An unbound record is a row
    # with no evidence, which is the thing this pipeline exists to prevent.
    for record in records:
        evidence = os.path.join(out_dir, record["evidence_path"])
        if not os.path.exists(evidence):
            raise AssertionError(f"no evidence file for {record['product_id']}: {evidence}")

    return report, paths


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Acquire individual abaya product pages")
    parser.add_argument("--out", default=os.path.join(PROJECT_ROOT, "data", "acquisition"),
                        help="Output directory (default: eval/data/acquisition)")
    parser.add_argument("--source", action="append", default=None,
                        help="Restrict to one source key; repeatable")
    parser.add_argument("--max", type=int, default=None, dest="limit",
                        help="Cap products per source")
    parser.add_argument("--dry-run", action="store_true",
                        help="Discovery only — no product pages fetched")
    parser.add_argument("--quiet", action="store_true")
    parser.add_argument("--list-sources", action="store_true")
    args = parser.parse_args(argv)

    if args.list_sources:
        for source in SOURCES:
            print(f"  {source['key']:16} {source['name']:16} {source['home']}")
        return 0

    selected = SOURCES
    if args.source:
        keys = set(args.source)
        selected = [s for s in SOURCES if s["key"] in keys]
        unknown = keys - {s["key"] for s in SOURCES}
        if unknown:
            print(f"Unknown source(s): {', '.join(sorted(unknown))}", file=sys.stderr)
            return 2
        if not selected:
            return 2

    report, paths = acquire(selected, args.out, args.limit, args.dry_run, args.quiet)

    print()
    print(f"  sources attempted        : {report['sources_attempted']}")
    print(f"  sources yielding         : {report['sources_yielding']}")
    print(f"  urls discovered          : {report['urls_discovered']}")
    print(f"  duplicates removed       : {report['duplicate_count']}")
    print(f"  products collected       : {report['collected_count']}")
    print(f"  identity collisions      : {report['identity_collisions']}")
    print(f"  failed                   : {report['failed_count']}")
    print(f"  description coverage     : {report['coverage']['description']*100:.1f}%")
    print(f"  annotatable (>= {MIN_DESCRIPTION_CHARS} chars) : {report['coverage']['description_annotatable']*100:.1f}%")
    print(f"  evidence-bound records   : {report['evidence_bound']}/{report['collected_count']}")
    if report["failure_reasons"]:
        print("  failure reasons:")
        for reason, count in report["failure_reasons"].items():
            print(f"    {count:>4}  {reason}")
    print()
    for label, path in paths.items():
        print(f"  {label:9} -> {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
