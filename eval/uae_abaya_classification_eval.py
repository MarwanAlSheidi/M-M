import os
import json
import time
import hashlib
import pandas as pd

from openai import OpenAI
from collections import defaultdict
from datetime import datetime


# ============================================================
# 1. CONFIGURATION
# ============================================================

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")

if not OPENAI_API_KEY:
    raise ValueError(
        "❌ لم يتم العثور على OPENAI_API_KEY في متغيرات البيئة."
    )

client = OpenAI(api_key=OPENAI_API_KEY)

MODEL = "gpt-4o-mini"
TEMPERATURE = 0.0

PROMPT_VERSION = "v0.1"
DATASET_VERSION = "v1.2"
HARNESS_VERSION = "v1.1.2"

INPUT_CSV = "UAE_CALIBRATION_DATASET_v1.2.csv"

LOCKED_GOLD_CSV = "CALIBRATION_GOLD_v1.2_LOCKED.csv"

PREDICTIONS_CSV = "AI_PREDICTIONS_v0.1.csv"
REPORT_XLSX = "EVALUATION_REPORT_v0.1.xlsx"
ERROR_MATRIX_CSV = "ERROR_MATRIX_v0.1.csv"
INVALID_PREDICTIONS_CSV = "INVALID_PREDICTIONS.csv"
METADATA_JSON = "RUN_METADATA.json"


# ============================================================
# 2. CRITICAL FIELDS (تم تثبيتها لتشمل الكثافة)
# ============================================================

CRITICAL_FIELDS = [
    "silhouette_normalized",
    "opening_type",
    "embellishment_type",
    "embellishment_intensity"   # تمت الإضافة بناءً على الملاحظة
]


# ============================================================
# 3. TAXONOMY (مع تقييد fabric_variant)
# ============================================================

ALLOWED_VALUES = {

    "silhouette": [
        "butterfly",
        "kimono",
        "cape",
        "straight",
        "a-line",
        "klosh",
        None
    ],

    "opening_type": [
        "open-front",
        "closed-front",
        None
    ],

    "fabric_family": [
        "nida",
        "crepe",
        "chiffon",
        "satin",
        "linen",
        "velvet",
        "viscose",
        "cotton",
        "jacquard",
        "organza",
        "cupro",
        "brocade",
        "wool",
        None
    ],

    # ------------------------------------------------------------
    # تم تقييد fabric_variant بقائمة أولية مستخرجة من السوق
    # لتجنب اختراع النموذج لمتغيرات وهمية.
    # ------------------------------------------------------------
    "fabric_variant": [
        "layan",
        "nova",
        "barbie",
        "luma",
        "japanese",
        "korean",
        "italian",
        "egyptian",
        "premium",
        "soft",
        "luxury",
        "standard",
        "chiffon",
        "silk",
        "wool",
        "linen",
        "cotton",
        "viscose",
        "crepe",
        "nida",
        None
    ],

    "color_normalized": [
        "black",
        "white",
        "beige",
        "navy",
        "burgundy",
        "green",
        "orange",
        "olive",
        "grey",
        "gold",
        "brown",
        "purple",
        "pink",
        "red",
        "yellow",
        None
    ],

    "embroidery_type": [
        "machine embroidery",
        "hand embroidery",
        None
    ],

    "embellishment_type": [
        "beadwork",
        "stone / crystal",
        "laser cut",
        "lace",
        "piping",
        None
    ],

    "embellishment_intensity": [
        "minimal",
        "medium",
        "heavy",
        None
    ]
}


# ============================================================
# 4. FIXED SYSTEM PROMPT v0.1
# ============================================================

SYSTEM_PROMPT = """
أنت خبير تصنيف أزياء خليجية متخصص في العبايات الإماراتية.

مهمتك هي تحويل بيانات المنتج الخام (الاسم والوصف) إلى
تصنيفات موحدة وفق Taxonomy محددة.

القاعدة الذهبية:

لا تخمن أبداً.

إذا لم يكن الدليل كافياً، أعد null.

القيم المسموحة:

- silhouette:
  Butterfly, Kimono, Cape, Straight, A-Line, Klosh, أو null.

- opening_type:
  Open-Front, Closed-Front, أو null.

- fabric_family:
  Nida, Crepe, Chiffon, Satin, Linen, Velvet, Viscose,
  Cotton, Jacquard, Organza, Cupro, Brocade, Wool, أو null.

- fabric_variant:
  استخدم واحداً من: Layan, Nova, Barbie, Luma, Japanese,
  Korean, Italian, Egyptian, Premium, Soft, Luxury, Standard,
  Chiffon, Silk, Wool, Linen, Cotton, Viscose, Crepe, Nida.
  إذا لم يتطابق مع أي من هذه، أعد null.

- color_normalized:
  استخدم أسماء الألوان الأساسية المسموحة،
  أو null.

- embroidery_type:
  Machine Embroidery, Hand Embroidery, أو null.

- embellishment_type:
  Beadwork, Stone / Crystal, Laser Cut, Lace, Piping,
  أو null.

- embellishment_intensity:
  Minimal, Medium, Heavy, أو null.

قواعد صارمة:

1. لا تحول Open-Front إلى Straight.
   Open-Front هو نوع الفتحة وليس Silhouette.

2. لا تحول Flowy إلى Butterfly.
   كلمة Flowy وحدها ليست دليلاً على Butterfly.

3. Klosh مسموح.
   إذا ورد Klosh أو Klosh Cut صراحة في الاسم أو الوصف،
   استخدم Klosh.

4. لا تستنتج Minimal من عدم ذكر الزخرفة.

5. لا تستنتج Embellishment Intensity من مجرد وجود زخرفة
   إلا إذا كان الوصف يعطي دليلاً كافياً.

6. افصل بين Embroidery و Embellishment:
   - Embroidery = تطريز بالخيوط.
   - Embellishment = أحجار، كريستال، خرز، ليزر، دانتيل،
     أو Piping.

7. إذا ذكر النص نوع قماش صراحة، استخدمه.

8. إذا ذكر النص Variant للقماش صراحة، احتفظ به.

9. لا تستنتج Silhouette من Style أو Neckline.

10. لا تستنتج Opening Type من مجرد كلمة "flowy" أو "structured".

11. إذا تعارضت الإشارات، استخدم الدليل الأكثر صراحة.

أخرج JSON فقط.

الصيغة المطلوبة:

{
  "silhouette": "...",
  "opening_type": "...",
  "fabric_family": "...",
  "fabric_variant": "...",
  "color_normalized": "...",
  "embroidery_type": "...",
  "embellishment_type": "...",
  "embellishment_intensity": "..."
}

استخدم null عندما لا يوجد دليل كافٍ.
"""


# ============================================================
# 5. EXPECTED OUTPUT FIELDS
# ============================================================

EXPECTED_FIELDS = list(ALLOWED_VALUES.keys())


# ============================================================
# 6. SHA256 FILE HASH
# ============================================================

def file_sha256(filepath):

    sha256 = hashlib.sha256()

    with open(filepath, "rb") as f:

        for chunk in iter(lambda: f.read(8192), b""):
            sha256.update(chunk)

    return sha256.hexdigest()


# ============================================================
# 7. NORMALIZE NULL
# ============================================================

def is_null_value(value):

    if value is None:
        return True

    try:
        if pd.isna(value):
            return True
    except Exception:
        pass

    value_str = str(value).strip().lower()

    return value_str in [
        "",
        "nan",
        "null",
        "none"
    ]


# ============================================================
# 8. VALIDATE + CLEAN AI PREDICTION (مع تقييد fabric_variant)
# ============================================================

def validate_and_clean_prediction(pred_dict):

    invalid_log = {}

    if not isinstance(pred_dict, dict):

        return (
            {
                key: None
                for key in EXPECTED_FIELDS
            },
            {
                "invalid_response_type": str(type(pred_dict))
            }
        )

    cleaned_pred = {}

    # --------------------------------------------------------
    # Ensure every expected field exists
    # --------------------------------------------------------

    for key in EXPECTED_FIELDS:

        raw_val = pred_dict.get(key)

        if is_null_value(raw_val):

            cleaned_pred[key] = None
            continue

        cleaned = str(raw_val).strip().lower()

        allowed = ALLOWED_VALUES[key]

        # ----------------------------------------------------
        # Enumerated field: الآن أصبح fabric_variant مقيداً
        # ----------------------------------------------------

        if cleaned in allowed:

            cleaned_pred[key] = cleaned

        else:

            cleaned_pred[key] = None
            invalid_log[key] = raw_val

    # --------------------------------------------------------
    # Detect unexpected fields
    # --------------------------------------------------------

    for key in pred_dict.keys():

        if key not in EXPECTED_FIELDS:

            invalid_log[f"unexpected_field:{key}"] = pred_dict[key]

    return cleaned_pred, invalid_log


# ============================================================
# 9. GOLD FREEZE
# ============================================================

gold_transformations = {}

if os.path.exists(LOCKED_GOLD_CSV):

    print(
        f"🔒 تم العثور على Gold مُجمّد: "
        f"{LOCKED_GOLD_CSV}"
    )

    gold_df = pd.read_csv(
        LOCKED_GOLD_CSV
    )

    gold_transformations[
        "note"
    ] = "Existing LOCKED Gold file used. No transformations applied."

else:

    print(
        f"🔄 لم يتم العثور على Gold مُجمّد."
    )

    print(
        f"📥 إنشاء Gold من: {INPUT_CSV}"
    )

    if not os.path.exists(INPUT_CSV):

        raise FileNotFoundError(
            f"❌ الملف غير موجود: {INPUT_CSV}"
        )

    df = pd.read_csv(INPUT_CSV)

    gold_df = df.copy()

    # --------------------------------------------------------
    # Klosh correction
    # --------------------------------------------------------

    description_lower = (
        gold_df["description_raw"]
        .fillna("")
        .astype(str)
        .str.lower()
    )

    klosh_mask = (
        description_lower.str.contains(
            "klosh",
            na=False
        )
        &
        gold_df["silhouette_normalized"].isna()
    )

    gold_df.loc[
        klosh_mask,
        "silhouette_normalized"
    ] = "Klosh"

    klosh_count = int(
        klosh_mask.sum()
    )

    gold_transformations[
        "klosh_corrections"
    ] = klosh_count

    print(
        f"   ✅ تم تصحيح {klosh_count} سجلات Klosh."
    )

    # --------------------------------------------------------
    # Remove unsupported implicit Minimal
    # --------------------------------------------------------

    product_name_lower = (
        gold_df["product_name_raw"]
        .fillna("")
        .astype(str)
        .str.lower()
    )

    explicit_minimal_mask = (

        description_lower.str.contains(
            "minimal",
            na=False
        )

        |

        product_name_lower.str.contains(
            "minimal",
            na=False
        )
    )

    intensity_normalized = (
        gold_df["embellishment_intensity"]
        .fillna("")
        .astype(str)
        .str.lower()
    )

    implicit_minimal_mask = (

        intensity_normalized.eq("minimal")

        &

        ~explicit_minimal_mask
    )

    gold_df.loc[
        implicit_minimal_mask,
        "embellishment_intensity"
    ] = None

    minimal_count = int(
        implicit_minimal_mask.sum()
    )

    gold_transformations[
        "implicit_minimal_to_null"
    ] = minimal_count

    print(
        f"   ✅ تم تصحيح {minimal_count} "
        f"سجلات Minimal الضمنية إلى NULL."
    )

    # --------------------------------------------------------
    # Save immutable Gold
    # --------------------------------------------------------

    gold_df.to_csv(
        LOCKED_GOLD_CSV,
        index=False,
        encoding="utf-8-sig"
    )

    print(
        f"🔐 تم تجميد Gold في: "
        f"{LOCKED_GOLD_CSV}"
    )


# ============================================================
# 10. GOLD HASH
# ============================================================

gold_sha256 = file_sha256(
    LOCKED_GOLD_CSV
)

print(
    f"🔐 Gold SHA256:"
)
print(
    gold_sha256
)


# ============================================================
# 11. VERIFY REQUIRED GOLD COLUMNS
# ============================================================

required_gold_columns = [

    "product_id",
    "product_name_raw",
    "description_raw",

    "silhouette_normalized",
    "opening_type",
    "fabric_family",
    "fabric_variant",
    "color_normalized",
    "embroidery_type",
    "embellishment_type",
    "embellishment_intensity"
]

missing_columns = [
    col
    for col in required_gold_columns
    if col not in gold_df.columns
]

if missing_columns:

    raise ValueError(
        "❌ أعمدة Gold مفقودة: "
        + ", ".join(missing_columns)
    )


# ============================================================
# 12. API PREDICTION
# ============================================================

def get_ai_prediction(row):

    product_name = (
        row["product_name_raw"]
        if not is_null_value(
            row["product_name_raw"]
        )
        else ""
    )

    description = (
        row["description_raw"]
        if not is_null_value(
            row["description_raw"]
        )
        else ""
    )

    user_prompt = (
        f"اسم المنتج: {product_name}\n"
        f"الوصف: {description}"
    )

    try:

        response = client.chat.completions.create(

            model=MODEL,

            messages=[
                {
                    "role": "system",
                    "content": SYSTEM_PROMPT
                },
                {
                    "role": "user",
                    "content": user_prompt
                }
            ],

            temperature=TEMPERATURE,

            response_format={
                "type": "json_object"
            }
        )

        raw_response = (
            response
            .choices[0]
            .message
            .content
        )

        data = json.loads(
            raw_response
        )

        cleaned_data, invalids = (
            validate_and_clean_prediction(
                data
            )
        )

        return (
            cleaned_data,
            raw_response,
            invalids
        )

    except Exception as e:

        empty_prediction = {
            key: None
            for key in EXPECTED_FIELDS
        }

        return (
            empty_prediction,
            f"ERROR: {str(e)}",
            {
                "api_error": str(e)
            }
        )


# ============================================================
# 13. RUN EVALUATION
# ============================================================

print()
print("=" * 70)
print(
    f"🚀 بدء Evaluation"
)
print(
    f"Model: {MODEL}"
)
print(
    f"Prompt: {PROMPT_VERSION}"
)
print(
    f"Dataset: {DATASET_VERSION}"
)
print(
    f"Harness: {HARNESS_VERSION}"
)
print(
    f"Records: {len(gold_df)}"
)
print("=" * 70)
print()


predictions = []
raw_responses = []
invalid_predictions_log = []

failed_calls = 0

start_time = time.time()


for idx, row in gold_df.iterrows():

    product_id = row["product_id"]

    print(
        f"🔄 [{idx + 1}/{len(gold_df)}] "
        f"{product_id}"
    )

    pred, raw, invalids = (
        get_ai_prediction(row)
    )

    predictions.append(pred)

    raw_responses.append(raw)

    if invalids:

        invalid_predictions_log.append({

            "product_id": product_id,

            "invalid_fields": json.dumps(
                invalids,
                ensure_ascii=False
            ),

            "raw_response": raw
        })

    if raw.startswith("ERROR:"):

        failed_calls += 1

    time.sleep(0.3)


runtime_seconds = (
    time.time() - start_time
)


# ============================================================
# 14. BUILD RESULT DATAFRAME
# ============================================================

pred_df = pd.DataFrame(
    predictions
)

pred_df.columns = [
    f"ai_{col}"
    for col in pred_df.columns
]

pred_df["raw_response"] = raw_responses

result_df = pd.concat(
    [
        gold_df.reset_index(drop=True),
        pred_df.reset_index(drop=True)
    ],
    axis=1
)


result_df.to_csv(
    PREDICTIONS_CSV,
    index=False,
    encoding="utf-8-sig"
)

print()
print(
    f"✅ تم حفظ {PREDICTIONS_CSV}"
)


# ============================================================
# 15. EVALUATION
# ============================================================

print()
print("📊 حساب المقاييس...")


fields = [

    (
        "silhouette_normalized",
        "ai_silhouette"
    ),

    (
        "opening_type",
        "ai_opening_type"
    ),

    (
        "fabric_family",
        "ai_fabric_family"
    ),

    (
        "fabric_variant",
        "ai_fabric_variant"
    ),

    (
        "color_normalized",
        "ai_color_normalized"
    ),

    (
        "embroidery_type",
        "ai_embroidery_type"
    ),

    (
        "embellishment_type",
        "ai_embellishment_type"
    ),

    (
        "embellishment_intensity",
        "ai_embellishment_intensity"
    )
]


metrics = {}

error_matrix = defaultdict(
    lambda: defaultdict(int)
)

per_record_status = []


# ============================================================
# 16. RECORD-LEVEL STATUS
# ============================================================

for idx, row in result_df.iterrows():

    record_status = {
        "product_id": row["product_id"]
    }

    for g_col, a_col in fields:

        g = row[g_col]
        a = row[a_col]

        g_null = is_null_value(g)
        a_null = is_null_value(a)

        if g_null and a_null:

            status = "Correct_Null"

        elif g_null and not a_null:

            status = (
                "False_Positive (Hallucination)"
            )

        elif not g_null and a_null:

            status = (
                "False_Negative (Missed)"
            )

        elif (
            str(g).strip().lower()
            ==
            str(a).strip().lower()
        ):

            status = "Correct_Match"

        else:

            status = (
                "Classification_Error"
            )

            error_matrix[g_col][
                f"Gold: {g}, AI: {a}"
            ] += 1

        record_status[
            f"{g_col}_status"
        ] = status

    per_record_status.append(
        record_status
    )


# ============================================================
# 17. FIELD METRICS
# ============================================================

field_fp_rates = {}


for g_col, a_col in fields:

    g_vals = result_df[g_col]
    a_vals = result_df[a_col]

    total = len(g_vals)

    correct = 0
    fp = 0
    fn = 0
    class_err = 0

    for g, a in zip(
        g_vals,
        a_vals
    ):

        g_null = is_null_value(g)
        a_null = is_null_value(a)

        if g_null and a_null:

            correct += 1

        elif g_null and not a_null:

            fp += 1

        elif not g_null and a_null:

            fn += 1

        elif (
            str(g).strip().lower()
            ==
            str(a).strip().lower()
        ):

            correct += 1

        else:

            class_err += 1

    accuracy = (
        correct / total
        if total > 0
        else 0
    )

    fp_rate = (
        fp / total
        if total > 0
        else 0
    )

    fn_rate = (
        fn / total
        if total > 0
        else 0
    )

    class_err_rate = (
        class_err / total
        if total > 0
        else 0
    )

    metrics[g_col] = {

        "accuracy": accuracy,

        "correct": correct,

        "total": total,

        "fp": fp,

        "fn": fn,

        "classification_error": class_err,

        "fp_rate": fp_rate,

        "fn_rate": fn_rate,

        "class_err_rate": class_err_rate
    }

    field_fp_rates[
        g_col
    ] = fp_rate


# ============================================================
# 18. KLOSH DETECTION RATE
# ============================================================

klosh_gold = result_df[
    result_df[
        "silhouette_normalized"
    ]
    .fillna("")
    .astype(str)
    .str.lower()
    .eq("klosh")
]


klosh_rate = None

if len(klosh_gold) > 0:

    ai_values = (
        klosh_gold[
            "ai_silhouette"
        ]
        .fillna("")
        .astype(str)
        .str.lower()
    )

    klosh_detected = (
        ai_values.eq("klosh").sum()
    )

    klosh_rate = (
        klosh_detected
        /
        len(klosh_gold)
    )


# ============================================================
# 19. OVERALL HALLUCINATION
# ============================================================

total_fp = sum(
    m["fp"]
    for m in metrics.values()
)

total_observations = sum(
    m["total"]
    for m in metrics.values()
)

overall_fp_rate = (

    total_fp
    /
    total_observations

    if total_observations > 0

    else 0
)


# ============================================================
# 20. CRITICAL HALLUCINATION (تشمل الكثافة الآن)
# ============================================================

critical_fp_rates = [

    metrics[field]["fp_rate"]

    for field in CRITICAL_FIELDS

    if field in metrics
]


critical_hallucination_rate = (

    sum(critical_fp_rates)
    /
    len(critical_fp_rates)

    if critical_fp_rates

    else 0
)


# ============================================================
# 21. MACRO ACCURACY
# ============================================================

macro_accuracy = (

    sum(
        m["accuracy"]
        for m in metrics.values()
    )

    /

    len(metrics)

    if metrics

    else 0
)


# ============================================================
# 22. ADDITIONAL RUN QUALITY METRICS
# ============================================================

total_records = len(gold_df)

failed_call_rate = (

    failed_calls
    /
    total_records

    if total_records > 0

    else 0
)

invalid_prediction_rate = (

    len(invalid_predictions_log)
    /
    total_records

    if total_records > 0

    else 0
)


successful_calls = (
    total_records
    -
    failed_calls
)


# ============================================================
# 23. EXPORT EXCEL REPORT
# ============================================================

print()
print("📁 إنشاء التقرير النهائي...")


with pd.ExcelWriter(
    REPORT_XLSX,
    engine="openpyxl"
) as writer:

    # --------------------------------------------------------
    # Summary
    # --------------------------------------------------------

    summary_data = []

    for field, m in metrics.items():

        summary_data.append({

            "Field": field,

            "Accuracy": (
                f"{m['accuracy'] * 100:.1f}%"
            ),

            "Correct": m["correct"],

            "Total": m["total"],

            "FP (Hallucination)": m["fp"],

            "FN (Missed)": m["fn"],

            "Classification Error":
                m["classification_error"],

            "FP Rate": (
                f"{m['fp_rate'] * 100:.1f}%"
            ),

            "FN Rate": (
                f"{m['fn_rate'] * 100:.1f}%"
            )
        })

    pd.DataFrame(
        summary_data
    ).to_excel(
        writer,
        sheet_name="Summary",
        index=False
    )


    # --------------------------------------------------------
    # Per Record
    # --------------------------------------------------------

    pd.DataFrame(
        per_record_status
    ).to_excel(
        writer,
        sheet_name="Per_Record",
        index=False
    )


    # --------------------------------------------------------
    # Critical Metrics
    # --------------------------------------------------------

    critical_data = [

        {
            "Metric":
                "Klosh Detection Rate",

            "Value":
                (
                    f"{klosh_rate * 100:.1f}%"
                    if klosh_rate is not None
                    else "N/A"
                )
        },

        {
            "Metric":
                "Overall Field-Level FP Rate",

            "Value":
                f"{overall_fp_rate * 100:.1f}%"
        },

        {
            "Metric":
                "Critical Hallucination Rate (v1)",

            "Value":
                f"{critical_hallucination_rate * 100:.1f}%"
        },

        {
            "Metric":
                "Silhouette FP Rate",

            "Value":
                f"{field_fp_rates.get('silhouette_normalized', 0) * 100:.1f}%"
        },

        {
            "Metric":
                "Opening Type FP Rate",

            "Value":
                f"{field_fp_rates.get('opening_type', 0) * 100:.1f}%"
        },

        {
            "Metric":
                "Embellishment Type FP Rate",

            "Value":
                f"{field_fp_rates.get('embellishment_type', 0) * 100:.1f}%"
        },

        {
            "Metric":
                "Embellishment Intensity FP Rate",

            "Value":
                f"{field_fp_rates.get('embellishment_intensity', 0) * 100:.1f}%"
        },

        {
            "Metric":
                "Macro Field Accuracy",

            "Value":
                f"{macro_accuracy * 100:.1f}%"
        },

        {
            "Metric":
                "Failed API Call Rate",

            "Value":
                f"{failed_call_rate * 100:.1f}%"
        },

        {
            "Metric":
                "Invalid Prediction Rate",

            "Value":
                f"{invalid_prediction_rate * 100:.1f}%"
        }
    ]

    pd.DataFrame(
        critical_data
    ).to_excel(
        writer,
        sheet_name="Critical_Metrics",
        index=False
    )


    # --------------------------------------------------------
    # Gold Integrity
    # --------------------------------------------------------

    gold_integrity_data = [

        {
            "Metric": "Gold File",
            "Value": LOCKED_GOLD_CSV
        },

        {
            "Metric": "Gold SHA256",
            "Value": gold_sha256
        },

        {
            "Metric": "Dataset Version",
            "Value": DATASET_VERSION
        },

        {
            "Metric": "Prompt Version",
            "Value": PROMPT_VERSION
        },

        {
            "Metric": "Harness Version",
            "Value": HARNESS_VERSION
        },

        {
            "Metric": "Total Records",
            "Value": total_records
        },

        {
            "Metric": "Critical Fields (Definition)",
            "Value": ", ".join(CRITICAL_FIELDS)
        }
    ]

    pd.DataFrame(
        gold_integrity_data
    ).to_excel(
        writer,
        sheet_name="Gold_Integrity",
        index=False
    )


print(
    f"✅ تم حفظ {REPORT_XLSX}"
)


# ============================================================
# 24. ERROR MATRIX
# ============================================================

error_rows = []

for field, errors in error_matrix.items():

    for error_description, count in errors.items():

        error_rows.append({

            "Field": field,

            "Error_Detail":
                error_description,

            "Count": count
        })


error_df = pd.DataFrame(
    error_rows
)

error_df.to_csv(
    ERROR_MATRIX_CSV,
    index=False,
    encoding="utf-8-sig"
)

print(
    f"✅ تم حفظ {ERROR_MATRIX_CSV}"
)


# ============================================================
# 25. INVALID PREDICTIONS
# ============================================================

if invalid_predictions_log:

    pd.DataFrame(
        invalid_predictions_log
    ).to_csv(
        INVALID_PREDICTIONS_CSV,
        index=False,
        encoding="utf-8-sig"
    )

    print(
        f"⚠️ تم حفظ {INVALID_PREDICTIONS_CSV}"
    )

else:

    print(
        "ℹ️ لا توجد توقعات غير صالحة."
    )


# ============================================================
# 26. RUN METADATA
# ============================================================

metadata = {

    "run_timestamp":
        datetime.now().isoformat(),

    "harness_version":
        HARNESS_VERSION,

    "model":
        MODEL,

    "temperature":
        TEMPERATURE,

    "prompt_version":
        PROMPT_VERSION,

    "dataset_version":
        DATASET_VERSION,

    "gold_reference_file":
        LOCKED_GOLD_CSV,

    "gold_sha256":
        gold_sha256,

    "gold_transformations_applied":
        gold_transformations,

    "critical_fields_definition":
        CRITICAL_FIELDS,

    "critical_hallucination_definition":
        "Macro-average FP rate across silhouette_normalized, opening_type, "
        "embellishment_type, and embellishment_intensity.",

    "total_records":
        total_records,

    "successful_api_calls":
        successful_calls,

    "failed_api_calls":
        failed_calls,

    "failed_call_rate":
        failed_call_rate,

    "invalid_predictions_count":
        len(invalid_predictions_log),

    "invalid_prediction_rate":
        invalid_prediction_rate,

    "runtime_seconds":
        runtime_seconds,

    "overall_macro_accuracy":
        macro_accuracy,

    "overall_field_fp_rate":
        overall_fp_rate,

    "critical_hallucination_rate_v1":
        critical_hallucination_rate,

    "klosh_detection_rate":
        klosh_rate,

    "field_fp_rates":
        field_fp_rates,

    "field_metrics":
        metrics
}


with open(
    METADATA_JSON,
    "w",
    encoding="utf-8"
) as f:

    json.dump(
        metadata,
        f,
        indent=2,
        ensure_ascii=False
    )


print(
    f"✅ تم حفظ {METADATA_JSON}"
)


# ============================================================
# 27. FINAL SUMMARY
# ============================================================

print()
print("=" * 70)
print("🎯 اكتمل التشغيل بنجاح")
print("=" * 70)

print(
    f"Records: {total_records}"
)

print(
    f"Failed API calls: {failed_calls}"
)

print(
    f"Macro Accuracy: "
    f"{macro_accuracy * 100:.2f}%"
)

print(
    f"Overall FP Rate: "
    f"{overall_fp_rate * 100:.2f}%"
)

print(
    f"Critical Hallucination Rate: "
    f"{critical_hallucination_rate * 100:.2f}%"
)

if klosh_rate is not None:

    print(
        f"Klosh Detection Rate: "
        f"{klosh_rate * 100:.2f}%"
    )

print()
print("📂 الملفات الناتجة:")

print(
    f"1. {LOCKED_GOLD_CSV}"
)

print(
    f"2. {PREDICTIONS_CSV}"
)

print(
    f"3. {REPORT_XLSX}"
)

print(
    f"4. {ERROR_MATRIX_CSV}"
)

print(
    f"5. {INVALID_PREDICTIONS_CSV}"
)

print(
    f"6. {METADATA_JSON}"
)

print("=" * 70)
