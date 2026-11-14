"""Validate human gold annotations before they are accepted as gold.

    python scripts/validate_gold.py annotations.csv
    python scripts/validate_gold.py --compare annotator_a.csv annotator_b.csv
    python scripts/validate_gold.py --compare a.csv b.csv --disagreements out.csv

This runs BEFORE annotation is merged, not after: 350 rows x 8 fields x 2
annotators is 5,600 human judgements, and a vocabulary mistake discovered after
they are made has to be fixed 5,600 times. Every rule here is one the scorer
will silently enforce later; this surfaces the breakage while it is still one
annotator's afternoon rather than the dataset's provenance.

Checks, single file:
  STRUCTURE   required columns present, ids unique and non-empty
  STATUS      annotation_status is one of the three declared states, and the
              states mean what they say: an UNANNOTATED row carries no values
  VOCABULARY  every non-empty cell canonicalizes (gold direction) into the
              production taxonomy — a value that does not scores as an error
              on every row it appears in
  NULL_TOKEN  a cell literally spelled none/null/n|a/nan/- is refused: those
              fold to null before canonicalization, so "the text says no
              embellishment" silently becomes "the text is silent"
  EVIDENCE    a row with values needs a non-empty evidence_quote, and each
              quote fragment (split on " | ") must occur verbatim in the row's
              source text
  CONSISTENCY rows sharing one description must carry identical values —
              the same text cannot support two different readings

Compare mode adds per-field percent agreement and Cohen's kappa over rows both
annotators marked ANNOTATED, with null as a real category: "no evidence" is a
scored answer, and two annotators disagreeing about whether evidence exists is
exactly the disagreement the kappa must count.
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import os
import sys
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from benchmark.canonicalizer import Canonicalizer  # noqa: E402
from benchmark.validator import Validator  # noqa: E402

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DEFAULT_TAXONOMY = os.path.join(PROJECT_ROOT, "configs", "taxonomy_production.yaml")
DEFAULT_SYNONYMS = os.path.join(PROJECT_ROOT, "configs", "synonyms_production.yaml")
CRITICAL_FIELDS = os.path.join(PROJECT_ROOT, "configs", "critical_fields.yaml")

STATUSES = {"UNANNOTATED", "ANNOTATED", "NEEDS_REVIEW"}

# Spellings that normalize_null folds to null BEFORE canonicalization runs.
# An annotator who writes one of these has said something ambiguous: they may
# have meant "no evidence" (then the cell should be empty) or "the text says
# none" (then the cell should be no_embellishment). The file cannot record
# which, so the cell is refused rather than guessed at.
RESERVED_NULL_TOKENS = {"none", "null", "nan", "n/a", "na", "-", "<na>", "nat"}

# Agreement thresholds, per field. One global number cannot serve: the binary
# fields clear 0.85 almost by construction, while fabric_variant offers 15
# categories plus null and will not. These are the defaults the report judges
# against; --threshold field=value overrides any of them.
DEFAULT_KAPPA_THRESHOLDS = {
    "silhouette": 0.75,
    "opening_type": 0.85,
    "fabric_family": 0.80,
    "fabric_variant": 0.70,
    "color_normalized": 0.80,
    "embroidery_type": 0.85,
    "embellishment_type": 0.75,
    "embellishment_intensity": 0.70,
}

NULL = "∅"  # display form of a null label in reports


def build_components(taxonomy_path: str, synonyms_path: str):
    canonicalizer = Canonicalizer(synonyms_path)
    validator = Validator(taxonomy_path=taxonomy_path,
                          critical_fields_path=CRITICAL_FIELDS,
                          canonicalizer=canonicalizer)
    columns = {field: validator.gold_column(field) for field in validator.taxonomy}
    return canonicalizer, validator, columns


def normalized_text(value: Any) -> str:
    """Whitespace-collapsed, entity-unescaped, casefolded — for quote matching."""
    return " ".join(html.unescape(str(value or "")).split()).casefold()


def read_rows(path: str) -> List[Dict[str, str]]:
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    with open(path, "r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def load_source_texts(rows: List[Dict[str, str]], master_path: Optional[str]) -> Dict[str, str]:
    """product_id -> the text an evidence quote must come from.

    Preferred source is the annotation file itself (the template carries
    product_name_raw and description_raw precisely so the annotator and this
    check read the same text); --master covers files that dropped them.
    """
    texts: Dict[str, str] = {}
    for row in rows:
        combined = " ".join(filter(None, (row.get("product_name_raw"),
                                          row.get("description_raw"))))
        if combined.strip():
            texts[row["product_id"]] = combined
    if master_path:
        for row in read_rows(master_path):
            texts.setdefault(row["product_id"],
                             " ".join(filter(None, (row.get("product_name_raw"),
                                                    row.get("description_raw")))))
    return texts


# ----------------------------------------------------------------------
# single-file validation
# ----------------------------------------------------------------------


def validate_file(path: str, taxonomy_path: str, synonyms_path: str,
                  master_path: Optional[str] = None) -> Dict[str, Any]:
    canon, validator, columns = build_components(taxonomy_path, synonyms_path)
    rows = read_rows(path)
    violations: List[Dict[str, str]] = []
    warnings: List[Dict[str, str]] = []

    def flag(kind: str, product_id: str, detail: str, warn: bool = False) -> None:
        (warnings if warn else violations).append(
            {"check": kind, "product_id": product_id, "detail": detail})

    # STRUCTURE ---------------------------------------------------------
    supplied = set(rows[0].keys()) if rows else set()
    required = {"product_id", "annotation_status", "evidence_quote"} | set(columns.values())
    for column in sorted(required - supplied):
        flag("STRUCTURE", "", f"required column missing: {column}")
    if required - supplied:
        return {"file": path, "rows": len(rows), "violations": violations,
                "warnings": warnings, "annotated": 0}

    seen_ids: Dict[str, int] = {}
    for index, row in enumerate(rows, start=2):
        product_id = (row.get("product_id") or "").strip()
        if not product_id:
            flag("STRUCTURE", f"(line {index})", "empty product_id")
            continue
        if product_id in seen_ids:
            flag("STRUCTURE", product_id,
                 f"duplicate product_id (lines {seen_ids[product_id]} and {index})")
        seen_ids[product_id] = index

    texts = load_source_texts(rows, master_path)
    by_description: Dict[str, List[Tuple[str, Tuple]]] = {}
    annotated = 0

    for row in rows:
        product_id = (row.get("product_id") or "").strip() or "(missing id)"
        status = (row.get("annotation_status") or "").strip()
        values = {field: (row.get(column) or "").strip()
                  for field, column in columns.items()}
        filled = {field: value for field, value in values.items() if value}

        # STATUS ----------------------------------------------------------
        if status not in STATUSES:
            flag("STATUS", product_id, f"unknown annotation_status: {status!r}")
        if status == "UNANNOTATED" and filled:
            flag("STATUS", product_id,
                 f"UNANNOTATED but carries values in: {', '.join(sorted(filled))}")
        if status == "ANNOTATED" and not filled:
            # Legal — every field can honestly lack evidence — but rare enough
            # on records whose eligibility required 50+ chars of text that a
            # human should look.
            flag("STATUS", product_id, "ANNOTATED with every field empty", warn=True)
        if status != "ANNOTATED":
            continue
        annotated += 1

        # NULL_TOKEN / VOCABULARY ------------------------------------------
        canonical: Dict[str, Optional[str]] = {}
        for field, value in values.items():
            if value.casefold() in RESERVED_NULL_TOKENS:
                flag("NULL_TOKEN", product_id,
                     f"{columns[field]}: {value!r} folds to null before the synonym "
                     f"maps run — leave the cell empty for 'no evidence'"
                     + (", or write no_embellishment for 'the text says none'"
                        if field == "embellishment_type" else ""))
                continue
            got = canon.canonicalize_gold(value, field)
            canonical[field] = got
            if value and got not in set(validator.taxonomy[field]) and got is not None:
                flag("VOCABULARY", product_id,
                     f"{columns[field]}: {value!r} is not in the taxonomy and no "
                     f"synonym folds it (canonicalizes to {got!r})")

        # EVIDENCE ---------------------------------------------------------
        quote = (row.get("evidence_quote") or "").strip()
        if filled and not quote:
            flag("EVIDENCE", product_id,
                 f"{len(filled)} field(s) filled with no evidence_quote")
        elif quote:
            source = texts.get(product_id)
            if source is None:
                flag("EVIDENCE", product_id,
                     "no source text to verify the quote against "
                     "(file lacks description_raw; pass --master)", warn=True)
            else:
                haystack = normalized_text(source)
                for fragment in (f.strip() for f in quote.split(" | ")):
                    if fragment and normalized_text(fragment) not in haystack:
                        flag("EVIDENCE", product_id,
                             f"quote fragment not found in source text: {fragment[:60]!r}")

        # CONSISTENCY ------------------------------------------------------
        description = normalized_text(row.get("description_raw"))
        if description:
            signature = tuple(sorted((f, canonical.get(f)) for f in columns))
            by_description.setdefault(description, []).append((product_id, signature))

    for description, members in by_description.items():
        if len(members) > 1 and len({m[1] for m in members}) > 1:
            ids = ", ".join(m[0] for m in members)
            flag("CONSISTENCY", ids,
                 "identical description annotated differently — the same text "
                 "cannot support two different readings")

    return {"file": path, "rows": len(rows), "annotated": annotated,
            "violations": violations, "warnings": warnings}


# ----------------------------------------------------------------------
# agreement
# ----------------------------------------------------------------------


def cohens_kappa(pairs: List[Tuple[str, str]]) -> Optional[float]:
    """Exact Cohen's kappa; None when chance agreement is 1 (no variation)."""
    if not pairs:
        return None
    n = len(pairs)
    observed = sum(1 for a, b in pairs if a == b) / n
    categories = {label for pair in pairs for label in pair}
    expected = sum((sum(1 for a, _ in pairs if a == c) / n)
                   * (sum(1 for _, b in pairs if b == c) / n)
                   for c in categories)
    if expected >= 1.0:
        return None
    return (observed - expected) / (1 - expected)


def compare_files(path_a: str, path_b: str, taxonomy_path: str, synonyms_path: str,
                  thresholds: Dict[str, float]) -> Dict[str, Any]:
    canon, validator, columns = build_components(taxonomy_path, synonyms_path)
    rows_a = {r["product_id"]: r for r in read_rows(path_a)}
    rows_b = {r["product_id"]: r for r in read_rows(path_b)}

    only_a = sorted(set(rows_a) - set(rows_b))
    only_b = sorted(set(rows_b) - set(rows_a))

    def is_done(row: Dict[str, str]) -> bool:
        return (row.get("annotation_status") or "").strip() == "ANNOTATED"

    both = sorted(pid for pid in rows_a
                  if pid in rows_b and is_done(rows_a[pid]) and is_done(rows_b[pid]))

    fields_report: Dict[str, Any] = {}
    disagreements: List[Dict[str, str]] = []
    for field, column in columns.items():
        pairs: List[Tuple[str, str]] = []
        for pid in both:
            a = canon.canonicalize_gold((rows_a[pid].get(column) or "").strip(), field)
            b = canon.canonicalize_gold((rows_b[pid].get(column) or "").strip(), field)
            label_a, label_b = a if a is not None else NULL, b if b is not None else NULL
            pairs.append((label_a, label_b))
            if label_a != label_b:
                disagreements.append({"product_id": pid, "field": column,
                                      "annotator_a": label_a, "annotator_b": label_b})
        kappa = cohens_kappa(pairs)
        agreement = (sum(1 for a, b in pairs if a == b) / len(pairs)) if pairs else None
        threshold = thresholds[field]
        fields_report[column] = {
            "pairs": len(pairs),
            "agreement": round(agreement, 4) if agreement is not None else None,
            "kappa": round(kappa, 4) if kappa is not None else None,
            "kappa_note": None if kappa is not None else
                ("no variation: a single label on both sides — agreement is "
                 "perfect but kappa is undefined" if pairs else "no pairs"),
            "threshold": threshold,
            "met": (kappa is not None and kappa >= threshold) or
                   (kappa is None and bool(pairs) and agreement == 1.0),
        }

    return {"annotator_a": path_a, "annotator_b": path_b,
            "rows_compared": len(both), "only_in_a": only_a, "only_in_b": only_b,
            "fields": fields_report, "disagreements": disagreements,
            "disagreement_rows": len({d["product_id"] for d in disagreements})}


# ----------------------------------------------------------------------
# cli
# ----------------------------------------------------------------------


def print_single(report: Dict[str, Any]) -> None:
    print(f"  rows        : {report['rows']}  (ANNOTATED: {report['annotated']})")
    print(f"  violations  : {len(report['violations'])}")
    print(f"  warnings    : {len(report['warnings'])}")
    for entry in report["violations"]:
        print(f"    [{entry['check']}] {entry['product_id']}: {entry['detail']}")
    for entry in report["warnings"]:
        print(f"    (warn) [{entry['check']}] {entry['product_id']}: {entry['detail']}")


def print_compare(report: Dict[str, Any]) -> None:
    print(f"  rows compared : {report['rows_compared']}"
          f"   (only in A: {len(report['only_in_a'])}, only in B: {len(report['only_in_b'])})")
    print(f"  {'field':26} {'pairs':>5} {'agree':>7} {'kappa':>7} {'need':>6}  verdict")
    for column, entry in report["fields"].items():
        kappa = "-" if entry["kappa"] is None else f"{entry['kappa']:.3f}"
        agree = "-" if entry["agreement"] is None else f"{entry['agreement']*100:.1f}%"
        print(f"  {column:26} {entry['pairs']:>5} {agree:>7} {kappa:>7}"
              f" {entry['threshold']:>6.2f}  {'PASS' if entry['met'] else 'FAIL'}")
        if entry["kappa_note"]:
            print(f"      note: {entry['kappa_note']}")
    print(f"  rows with any disagreement: {report['disagreement_rows']}"
          f"  ({len(report['disagreements'])} field-level)")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Validate gold annotation files")
    parser.add_argument("files", nargs="+", help="annotation CSV (or two with --compare)")
    parser.add_argument("--compare", action="store_true",
                        help="agreement between two annotators' files")
    parser.add_argument("--master", default=None,
                        help="master catalogue CSV supplying source text for quote checks")
    parser.add_argument("--taxonomy", default=DEFAULT_TAXONOMY)
    parser.add_argument("--synonyms", default=DEFAULT_SYNONYMS)
    parser.add_argument("--threshold", action="append", default=[], metavar="FIELD=KAPPA",
                        help="override a per-field kappa threshold; repeatable")
    parser.add_argument("--report", default=None, help="write the full report as JSON")
    parser.add_argument("--disagreements", default=None,
                        help="(compare) write field-level disagreements as CSV for the adjudicator")
    args = parser.parse_args(argv)

    thresholds = dict(DEFAULT_KAPPA_THRESHOLDS)
    for item in args.threshold:
        field, _, value = item.partition("=")
        if field not in thresholds:
            print(f"unknown field in --threshold: {field}", file=sys.stderr)
            return 2
        thresholds[field] = float(value)

    if args.compare:
        if len(args.files) != 2:
            print("--compare needs exactly two files", file=sys.stderr)
            return 2
        report = compare_files(args.files[0], args.files[1],
                               args.taxonomy, args.synonyms, thresholds)
        print_compare(report)
        if args.disagreements:
            with open(args.disagreements, "w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=["product_id", "field",
                                                            "annotator_a", "annotator_b"])
                writer.writeheader()
                writer.writerows(report["disagreements"])
        if args.report:
            with open(args.report, "w", encoding="utf-8") as handle:
                json.dump(report, handle, indent=2, ensure_ascii=False)
        failed = [c for c, e in report["fields"].items() if not e["met"]]
        return 1 if failed or report["only_in_a"] or report["only_in_b"] else 0

    exit_code = 0
    reports = []
    for path in args.files:
        print(path)
        report = validate_file(path, args.taxonomy, args.synonyms, args.master)
        print_single(report)
        reports.append(report)
        if report["violations"]:
            exit_code = 1
    if args.report:
        with open(args.report, "w", encoding="utf-8") as handle:
            json.dump(reports if len(reports) > 1 else reports[0],
                      handle, indent=2, ensure_ascii=False)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
