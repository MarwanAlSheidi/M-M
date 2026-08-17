# Production dataset — input contract

**Empty on purpose.** This repository ships **no real catalogue data**. Anything
placed here is classified `PRODUCTION` by
`benchmark.run_benchmark.classify_dataset_kind`, and only results from this
directory — scored by a live provider, with the integrity gate passing — are
ever labelled `REAL_BENCHMARK`.

Everything below is a contract the benchmark enforces at run time. A dataset
that violates it is rejected before any model is called, not silently scored.

---

## 1. Files

| file | required | purpose |
|---|---|---|
| `dataset.csv` | yes | the records to classify |
| `gold.csv` | yes | the reference labels |
| `training_ids.csv` | strongly recommended | prompt-development records, excluded from evaluation |
| `validation_ids.csv` | optional | threshold/policy-tuning records, excluded from evaluation |

Without `training_ids.csv` leakage is **unverifiable**, not clean. The gate
reports `WARN` in that case, and a warning means "unknown", never "safe".

---

## 2. `dataset.csv`

| column | type | required | notes |
|---|---|---|---|
| `product_id` | string | yes | see §4 |
| `product_name_raw` | string | yes | may be empty; the field must exist |
| `description_raw` | string | yes | may be empty; the field must exist |

Extra columns are permitted and ignored. They are not hashed into the record
identity, but they **are** part of `dataset_sha256`, so adding one invalidates
the manifest and requires a rebuild.

## 3. `gold.csv`

| column | required |
|---|---|
| `product_id` | yes |
| `silhouette_normalized` | yes |
| `opening_type` | yes |
| `fabric_family` | yes |
| `fabric_variant` | yes |
| `color_normalized` | yes |
| `embroidery_type` | yes |
| `embellishment_type` | yes |
| `embellishment_intensity` | yes |

Gold values should be taxonomy values from `configs/taxonomy.yaml`. Known
spelling variants are folded by `gold_synonyms` in `configs/synonyms.yaml`; a
value that matches neither passes through unchanged and will score as a
classification error on every row it appears in. Add the variant to
`gold_synonyms` rather than editing the labels one by one.

An empty cell means **"no evidence for this field"** and is a legitimate,
scored answer — not missing data. See §6.

---

## 4. `product_id`

- **Type:** string. Read with `dtype=str, keep_default_na=False`, so `1` stays
  `"1"` (never `1.0`), `007` keeps its zeros, and an id literally spelled `NA`
  stays the string `"NA"` instead of becoming a null.
- **Uniqueness:** unique within `dataset.csv` and within `gold.csv`. Duplicates
  are a hard failure — a duplicated id makes a record's score ambiguous.
- **Non-empty:** empty and whitespace-only ids are a hard failure.
- **Whitespace:** surrounding whitespace is stripped before comparison, so
  `" P1 "` and `"P1"` are the same record.
- **Alignment:** the id set of `dataset.csv` must equal the id set of
  `gold.csv` exactly — no extras on either side.
- **Stability:** ids are the resume key. An id that changes between runs is a
  different record, and a resumed run will re-classify it.

## 5. Encoding and format

- **Encoding:** UTF-8. A BOM is tolerated on read. Arabic and Latin text may be
  mixed freely in the raw fields.
- **Format:** RFC 4180 CSV. Quote any field containing a comma, quote or
  newline. Line endings may be LF or CRLF, but changing them changes
  `dataset_sha256` — see §8.
- **Header:** required, exact column names as above.

## 6. Missing-value semantics

The benchmark distinguishes three things that CSV tends to blur:

| in the file | meaning |
|---|---|
| empty cell in **gold** | no evidence for this field; a null answer is *correct* |
| empty cell in `product_name_raw` / `description_raw` | no text; the record is still evaluated |
| empty `product_id` | corruption — hard failure |

`""`, whitespace, `nan`, `null`, `none`, `<NA>` and `NaT` all normalize to a
single null before any comparison. This is deliberate: gold read as `NaN` and a
prediction of `None` must not score as a mismatch.

**Do not** encode "unknown" as a sentinel string like `N/A`, `-` or `unknown`.
Those are not in the null set, so they would be scored as real label values and
counted as errors.

## 7. Record granularity

**One row = one sellable product.** Not a variant, not a size, not an image.

If your catalogue splits a product across colour or size rows, collapse them
first: two rows describing the same garment in two colours will both be scored
against whichever gold row shares their id, and a joint accuracy figure over
near-duplicate rows overstates confidence in exactly the way a benchmark
exists to prevent.

`product_name_raw` and `description_raw` should carry the text a human would
see on the product page — the evidence verifier grades answers against that
text, so trimming it changes what counts as supported.

## 8. Manifest procedure

```bash
cd eval
python scripts/build_manifest.py --production
```

This writes `manifests/dataset_manifest_production.json` with
`dataset_sha256`, `gold_sha256`, `record_count`, `product_id_hash`, the config
hashes and the prompt hash. **Never type a hash by hand** — the script computes
all of them.

`product_id_hash` is order-independent, so comparing it against
`dataset_sha256` distinguishes two different events:

| dataset_sha256 | product_id_hash | meaning |
|---|---|---|
| changed | unchanged | the file was regenerated: re-quoted, reordered, re-encoded |
| changed | changed | the evaluation set itself changed |

Rebuild the manifest whenever the data legitimately changes, and treat the new
hash as a new dataset version: results across different hashes are not
comparable, and a resume across them is refused.

## 9. Splits

```
training  ∩ evaluation = ∅     enforced, hard failure
validation ∩ evaluation = ∅    enforced, hard failure
training  ∩ validation         permitted — it never touches what is scored
```

Any record used to write or tune the prompt, the taxonomy, the synonym maps or
the field policy belongs in `training_ids.csv` or `validation_ids.csv`. A
second layer re-checks every record during execution, including records
restored from a checkpoint, and also compares source-text hashes to catch the
same record re-published under a new id.

## 10. Privacy and security

- **This directory is gitignored** (`eval/data/production/*.csv`). Real
  catalogue data must not be committed. Verify with `git status` before every
  commit.
- **Do not put credentials in the data.** API keys are read from environment
  variables only, and never from files here.
- **Raw text is echoed into artefacts.** `predictions_raw.jsonl`,
  `review_sample.jsonl` and the audit log contain `product_name_raw` and
  `description_raw` verbatim. Anything you would not want in a run directory
  must not be in the source text — strip customer names, internal SKUs,
  supplier terms and free-text notes before loading.
- **Run directories inherit the data's sensitivity.** `runs/` is gitignored;
  treat its contents as the same classification as the input.
- Redaction covers *credentials*, not personal data. It removes known secret
  values and credential-shaped strings; it does not anonymise text.

## 11. Before the first production run

```bash
cd eval

# 1. contract check + integrity, zero model calls
python -m benchmark.run_benchmark --model <key> \
    --dataset data/production/dataset.csv \
    --gold data/production/gold.csv \
    --dry-run

# 2. small paid smoke test before committing to the full set
python -m benchmark.run_benchmark --model <key> \
    --dataset data/production/dataset.csv \
    --gold data/production/gold.csv \
    --max-records 20

# 3. full run
python -m benchmark.run_benchmark --model <key> \
    --dataset data/production/dataset.csv \
    --gold data/production/gold.csv
```

A `REAL_BENCHMARK` label additionally requires: the model enabled in
`configs/models.yaml`, its credentials present, its provider not `local`, and
the integrity gate at `PASS`. If any of those is missing the report is labelled
`TEST_FIXTURE` and says which condition failed.
