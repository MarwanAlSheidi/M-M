# Production dataset

Empty on purpose. This repository ships **no real catalogue data**.

Anything placed here is classified `PRODUCTION` by
`benchmark.run_benchmark.classify_dataset_kind`, and only results from this
directory — scored by a live provider — are ever labelled `REAL_BENCHMARK`.

Required files:

| file | required columns |
|---|---|
| `dataset.csv` | `product_id`, `product_name_raw`, `description_raw` |
| `gold.csv` | `product_id` + every taxonomy field |
| `training_ids.csv` | `product_id` (optional, but leakage is unverifiable without it) |
| `validation_ids.csv` | `product_id` (optional) |

The gate enforces: dataset IDs == gold IDs, no duplicates, no empty IDs, and no
overlap between training/validation and evaluation.

After adding files:

```bash
cd eval
python scripts/build_manifest.py --production
python -m benchmark.run_benchmark --model <key> --dataset data/production/dataset.csv \
    --gold data/production/gold.csv --dry-run
```
