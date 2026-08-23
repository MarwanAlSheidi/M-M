# Production onboarding report — PRODUCTION_RAW

**Verdict: `NOT_READY`.** The dataset named in the onboarding brief was not
found. This report validates what `data/production/` actually contains.

Every figure below is computed from the files on disk. Nothing is carried over
from `acquisition_report.json` — that file does not exist — and nothing is
taken from `enrichment_report.json`.

---

## 1. Dataset identity

| | |
|---|---|
| label | `PRODUCTION_RAW` |
| version | v1.0-candidate |
| gold status | **LOCKED** — no `gold.csv` exists, none created |
| evaluation status | no benchmark run, no predictions, no scores |
| authoritative file | `data/production/raw_catalog.csv` |
| sha256 | `3438adf2fa1cddbeb89a9f04a52f5aeb4e751f26f84f8e05d18ebd56bebbd6d5` |

## 2. Acquisition timestamp

Per-record `extracted_at`, present on 78/78 rows. No acquisition report exists
to corroborate it, so it is recorded as the source's claim, not as verified.

## 3. Sources

Three, not the six the brief anticipates: `cas_basics` (35), `abay` (33),
`zadina` (10). **`Infinite Vibes`, `Effa Fashion` and `Noorai Dubai` are
entirely absent** — zero rows, not zero-yield.

## 4. File inventory

| file | bytes | rows | encoding | delimiter | sha256[:12] |
|---|---|---|---|---|---|
| `raw_catalog.csv` | 17,672 | 78 | utf-8 | `,` | `3438adf2fa1c` |
| `raw_catalog_enriched.csv` | — | 78 | utf-8 | `,` | derived |
| `annotation_queue.csv` | 9,395 | 78 | utf-8 | `,` | `90ed5aea7532` |
| `validation_ids.csv` | 308 | 13 | utf-8 | `,` | `1dfa255cabb9` |
| `sources.csv` | 268 | 3 | utf-8 | `,` | `eba6dd159e07` |
| `import_template.csv` | 193 | 0 | utf-8 | `,` | header-only, by design |
| `enrichment_report.json` | 12,499 | valid JSON | utf-8 | — | derived |
| `README.md` | 17,061 | — | utf-8 | — | input contract |

No duplicate files (no two share a sha256). No malformed files. No JSON
parse failures. No `raw_text/` directory.

### Files named in the brief

| expected | found |
|---|---|
| `abaya_production_products.csv` | **ABSENT** |
| `abaya_production_variants.csv` | **ABSENT** |
| `abaya_production_images.csv` | **ABSENT** |
| `abaya_production_failed.csv` | **ABSENT** |
| `acquisition_report.json` | **ABSENT** |
| `raw_text/` | **ABSENT** |

Nothing was deleted or overwritten to reach this state; the files were never
delivered. Uploads for this session contain one file, the original
`raw_catalog.csv` ingested earlier.

## 5. Row counts

78 records, 17 columns, one row per `product_id`, zero duplicate ids.

## 6. URL validation

| status | count | share |
|---|---|---|
| `COLLECTION_URL` | 66 | 84.6% |
| `INVALID_URL` | 10 | 12.8% |
| `VALID_PRODUCT_URL` | **2** | **2.6%** |
| `CATEGORY_URL` / `SEARCH_URL` / `MISSING_URL` / `BLOCKED_URL` / `DUPLICATE_PRODUCT_URL` | 0 | 0% |

The 10 `INVALID_URL` rows are all `zadinaabayas.com/uae/abayas` — a listing
route that does not match a documented product-detail pattern. They are listing
pages by content; they are reported separately from `COLLECTION_URL` only
because the route shape is non-Shopify. **76 of 78 rows point at a listing
page.**

## 7. Deduplication

| check | result |
|---|---|
| duplicate `product_id` | 0 |
| duplicate `(source, source_product_id)` | 0 |
| distinct canonical URLs | **5**, for 78 records |
| distinct canonical *product* URLs | **2** |
| unresolved identity conflicts | **0** |

Three canonical URLs are shared by many rows — 35, 31 and 10 — but all three
are listing pages. Rows sharing a *listing* page are not duplicate products, so
this is not an identity conflict; it is 76 records with no per-record evidence.
Full breakdown in `duplicate_report.csv`.

## 8. Coverage (denominator 78 in every row)

| field | present | coverage |
|---|---|---|
| price | 78 | 100.00% |
| currency | 78 | 100.00% |
| category | 78 | 100.00% |
| availability | 78 | 100.00% |
| brand | 78 | 100.00% |
| color | 61 | 78.21% |
| fabric | 24 | 30.77% |
| image | 6 | 7.69% |
| variant | 2 | 2.56% |
| **description** | **1** | **1.28%** |
| description ≥ 30 chars (annotatable) | 1 | 1.28% |
| embellishment | 0 | 0% — no source column |
| includes / set | 0 | 0% — no source column |
| size options | 0 | 0% — no source column |
| colour variants | 0 | 0% — no source column |

## 9. Missing data

`description_raw` is empty on 77 of 78 rows. This is the binding constraint:
the evidence verifier grades answers against source text, so a record with no
text yields an abstention on every strict field regardless of model quality.
Measured earlier on this same data: **369 of 390 strict-field predictions
(94.6%) abstain by construction.**

## 10. Blocked sources

Outbound HTTPS is blocked in this environment (`casbasics.com`, `abay.com` →
`000`). One record's fetch failed as `NETWORK_BLOCKED`; the other 76 failed as
`NO_PRODUCT_URL` — a data property, not a network one. **Unblocking the network
would raise usable records from 0 to at most 2.**

## 11. Fabrication audit

| check | result |
|---|---|
| values not present in source fields | none — every enriched column is empty |
| invented fabric / colour / garment type / embellishment / closure / set | none |
| currency conversions | none — `currency` carried through verbatim |
| translated text presented as raw | none |
| inferred values | none |
| records enriched without provenance | 0 of 0 |

`raw_catalog_enriched.csv` carries 0 `ENRICHED` rows, so there is no derived
content to audit. RAW and `_page` columns are separate by construction: no
enrichment value can overwrite an acquisition value.

One documented, content-defined repair remains from ingestion: nine rows
arrived with a wrong field count and were realigned using closed-set membership
(`available`/`sold_out`) and a date pattern, with `legacy_product_id`
preserving the original id. Six Zadina rows carrying `+5 variants` in
`image_url` were **left untouched** — moving them would be interpretation.

## 12. Schema compatibility

See `schema_mapping_report.md`. Every field in the brief now has a home.
Two changes were required: `embellishment_page` added as a column (it is the
evidence for three scored gold fields), and `extra_fields_json` added so a
supplied column with no contract home is preserved rather than dropped.

## 13. Integrity gate

Manifest routing verified empirically, not assumed:

| dataset | kind | manifest resolved |
|---|---|---|
| fixture default | `fixture` | `manifests/manifest.json` |
| `data/production/*.csv` | `production` | `manifests/manifest_production.json` |

**No fixture leak.** The RC-001 fix holds; an explicit `--dataset-manifest`
still overrides. `--dataset-manifest`, `--validation`, `--dataset`, `--gold`
and `--dry-run` are all present.

The gate was **not run against this data**, because it requires `gold.csv` and
none exists. That is the correct state, not a failure.

## 14. Leakage / splits

Classified `PRODUCTION_RAW`. No train/evaluation assignment made.
`validation_ids.csv` holds 13 ids frozen *before* annotation. No score may be
produced until gold exists, an evaluation split exists, leakage rules pass, the
manifest is rebuilt and the gate passes — none of which has happened.

## 15. Gold readiness

| criterion | required | actual | met |
|---|---|---|---|
| valid unique product pages | ≥ 300 | **2** | ✗ |
| valid product URL ratio | ≥ 80% | **2.6%** | ✗ |
| description coverage | ≥ 70% | **1.3%** | ✗ |
| independent sources | ≥ 5 | **3** | ✗ |
| unresolved identity conflicts | 0 | 0 | ✓ |

**`NOT_READY`.** Four of five criteria fail, and three fail by two orders of
magnitude. The one that passes does so vacuously: there are no identity
conflicts because there are only two product URLs to conflict.

Per the brief, `gold_annotation_plan.md` is produced only at
`READY_FOR_ANNOTATION`. It is **not** produced here.

**STEP 13 (`production_audit_sample.csv`) is not produced either.** A stratified
sample of 100 requires 100 records; 78 exist. More decisively, the sample's
purpose is auditing a record against its source evidence, and 76 of 78 records
have no product page to audit against — the sample would be unauditable by
construction. Fabricating strata over absent data would misrepresent the
dataset as richer than it is.

## 16. Recommended next step

**Acquire product-page URLs. Nothing else unblocks this.**

The gap is 2 valid product pages against a 300 threshold. It cannot be closed
by re-running enrichment, by network access, or by a better model — the URLs in
hand do not address individual products.

1. Run discovery on a machine with egress. For Shopify storefronts
   (`casbasics`, `abay`), `/sitemap_products_1.xml` and
   `/products.json?limit=250&page=N` enumerate product handles directly, no
   crawling and no rendering, subject to each site's robots.txt. Zadina needs a
   rendering browser.
2. Add the three missing sources — `Infinite Vibes`, `Effa Fashion`,
   `Noorai Dubai` contribute zero rows today, and 5 independent sources is a
   readiness criterion.
3. Deliver a CSV matching `import_template.csv` (or the acquisition names in
   `schema_mapping_report.md` — both import). Minimum: `product_id`, `source`,
   `product_url`.
4. Re-run `scripts/enrich_catalog.py --import <file>` and regenerate this
   report.

Target for the next gate: ≥ 300 valid unique product pages across ≥ 5 sources
with ≥ 70% description coverage.

---

*No gold created. No benchmark run. No predictions generated. No fixture data,
fixture manifest or release artefact modified. `raw_catalog.csv` unchanged at
`3438adf2…bebbd6d5`.*
