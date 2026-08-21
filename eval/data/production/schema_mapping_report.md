# Schema mapping report — acquisition schema → ingestion contract

**STEP 10 deliverable.** Every field named in the onboarding brief, mapped to the
column `scripts/enrich_catalog.py` reads. Nothing is dropped: a supplied column
with no contract home is preserved verbatim in `extra_fields_json`.

Generated against `scripts/enrich_catalog.py` at 415 passing tests.

## Mapped directly

| brief field | contract column | accepted names |
|---|---|---|
| `product_id` | `product_id` | key; must match `raw_catalog.csv` exactly |
| `product_url` | `product_url_canonical` + `provenance_url` | `product_url`, `source_url`, `provenance_url` |
| `source` | `store_page` | `store_page`, `store`, `source` |
| `product_name_raw` | `product_title_page` | `product_title_page`, `product_name_raw`, `product_name`, `title` |
| `description_raw` | `description_page` | `description_page`, `description_raw`, `description`, `body_html` |
| `price` | `price_page` | `price_page`, `price` |
| `currency` | `currency_page` | `currency_page`, `currency` |
| `color_raw` | `color_page` | `color_page`, `color_raw`, `color`, `colour_raw`, `colour` |
| `fabric_raw` | `fabric_page` | `fabric_page`, `fabric_raw`, `fabric`, `material` |
| `category_raw` | `category_page` | `category_page`, `category_raw`, `category`, `product_type` |
| `variants_raw` | `variant_page` | `variant_page`, `variants_raw`, `variant_raw`, `variants`, `variant` |
| `size_options_raw` | `variant_page` | added as a lower-priority alias — size options *are* variants |
| `includes_raw` | `set_page` | `set_page`, `set_raw`, `set`, `includes_raw`, `includes` |
| `embellishment_raw` | `embellishment_page` | **new column** — see below |
| `availability` | `availability_page` | `availability_page`, `availability`, `available` |
| `image_url` | `image_url_page` | `image_url_page`, `image_url`, `image` |
| `retrieved_at` | `retrieved_at_source` | `retrieved_at_source`, `retrieved_at` |

## Changes this report required

**`embellishment_page` is a new column.** The brief lists `embellishment_raw`;
the contract had nowhere to put it. It is not a minor field — it is the source
evidence for three scored gold fields (`embroidery_type`,
`embellishment_type`, `embellishment_intensity`), so folding it into another
column would have destroyed the evidence for a quarter of the taxonomy.

**`extra_fields_json` preserves everything else.** The brief's `price_raw` and
`color_variants_raw` have no contract column and deliberately did not get one:
`price_raw` is a display string, not the numeric `price`, and a colour-variant
list is not the product's colour. Forcing either into an existing column would
move a value between fields, which the alias rules forbid. They are instead
kept verbatim, alongside any other column a collector supplies:

```json
{"color_variants_raw": "black; navy; beige", "price_raw": "AED 450.00"}
```

Unmapped columns count towards identity: two import rows that agree on every
mapped field but disagree in `extra_fields_json` are a conflict and fail the
import. Without that, a preserved-but-unmapped field would be a silent channel
for two rows to disagree and still collapse.

## Not mapped, by design

| name | why |
|---|---|
| `product_url_raw` | the brief's alternative name for provenance; `provenance_url` already holds the URL exactly as supplied |

## Aliases rename only

No alias moves a value between fields, and no name feeds two fields — both are
asserted, not assumed. In particular no title alias reaches the description:
a row carrying only `product_name_raw` fails as `IMPORT_NO_DESCRIPTION` rather
than presenting a product name as product text.
