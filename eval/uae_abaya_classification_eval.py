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
HARNESS_VERSION = "v1.2.0"

INPUT_CSV = "UAE_CALIBRATION_DATASET_v1.2.csv"

LOCKED_GOLD_CSV = "CALIBRATION_GOLD_v1.2_LOCKED.csv"

PREDICTIONS_CSV = "AI_PREDICTIONS_v0.1.csv"
REPORT_XLSX = "EVALUATION_REPORT_v0.1.xlsx"
ERROR_MATRIX_CSV = "ERROR_MATRIX_v0.1.csv"
INVALID_PREDICTIONS_CSV = "INVALID_PREDICTIONS.csv"
METADATA_JSON = "RUN_METADATA.json"


# ============================================================
# 2. CRITICAL FIELDS (مع الكثافة)
# ============================================================

CRITICAL_FIELDS = [
    "silhouette_normalized",
    "opening_type",
    "embellishment_type",
    "embellishment_intensity"
]


# ============================================================
# 3. TAXONOMY (مقيدة)
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
# 4. FIXED SYSTEM PROMPT v0.1 (دون تغيير)
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
# 6. FILE HASH (SHA256)
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
# 8. GOLD TAXONOMY NORMALIZATION (مرادفات)
# ============================================================

# اسم عمود Gold ← مفتاحه في ALLOWED_VALUES (يختلفان في silhouette وحده).
GOLD_FIELD_TAXONOMY_KEY = {
    "silhouette_normalized": "silhouette",
    "opening_type": "opening_type",
    "fabric_family": "fabric_family",
    "fabric_variant": "fabric_variant",
    "color_normalized": "color_normalized",
    "embroidery_type": "embroidery_type",
    "embellishment_type": "embellishment_type",
    "embellishment_intensity": "embellishment_intensity"
}

# ------------------------------------------------------------
# المرادفات مفهرسة بالحقل، لا مسطّحة.
# خريطة واحدة مشتركة تُسرّب معاني بين الحقول: "stone" لوناً
# حقيقياً في وصف العبايات كان يصير "stone / crystal".
# ------------------------------------------------------------
GOLD_SYNONYM_MAP = {

    "silhouette_normalized": {
        "farasha": "butterfly",
        "klosh cut": "klosh"
    },

    "opening_type": {},

    "fabric_family": {},

    "fabric_variant": {},

    "color_normalized": {
        "maroon": "burgundy",
        "navy blue": "navy",
        "olive green": "olive"
    },

    "embroidery_type": {},

    "embellishment_type": {
        "stone": "stone / crystal",
        "stones": "stone / crystal",
        "crystal": "stone / crystal",
        "crystals": "stone / crystal"
    },

    "embellishment_intensity": {}
}

def normalize_gold_value(value, field_name):
    """
    تطبق التطبيع على قيمة Gold باستخدام مرادفات هذا الحقل وحده.
    إذا كانت القيمة غير معروفة، تُترك كما هي (مع تحويل إلى lowercase).
    """
    if is_null_value(value):
        return None

    raw_str = str(value).strip().lower()

    # التحقق من مرادفات هذا الحقل
    field_synonyms = GOLD_SYNONYM_MAP.get(field_name, {})

    if raw_str in field_synonyms:
        return field_synonyms[raw_str]

    # إذا كانت القيمة ضمن الـ taxonomy مباشرة
    taxonomy_key = GOLD_FIELD_TAXONOMY_KEY.get(field_name, field_name)
    allowed = ALLOWED_VALUES.get(taxonomy_key, [])
    if allowed and raw_str in allowed:
        return raw_str

    # ترك القيمة كما هي (سيتم اكتشافها لاحقاً إذا كانت خارجة عن التصنيف)
    return raw_str


# ============================================================
# 9. VALIDATE + CLEAN AI PREDICTION (مع الاحتفاظ بالـ raw)
# ============================================================

def validate_and_clean_prediction(pred_dict):

    invalid_log = {}

    if not isinstance(pred_dict, dict):

        # ثلاث قيم لا اثنتان: المستدعي يفكّ raw و cleaned و invalid.
        # الاثنتان كانتا تُطلقان ValueError داخل try فتُقيَّد كخطأ API.
        return (
            {
                key: None
                for key in EXPECTED_FIELDS
            },
            {
                key: None
                for key in EXPECTED_FIELDS
            },
            {
                "invalid_response_type": str(type(pred_dict))
            }
        )

    cleaned_pred = {}
    raw_pred = {}

    for key in EXPECTED_FIELDS:

        raw_val = pred_dict.get(key)

        # حفظ القيمة الخام (حتى لو كانت غير صالحة)
        raw_pred[key] = raw_val

        if is_null_value(raw_val):

            cleaned_pred[key] = None
            continue

        cleaned = str(raw_val).strip().lower()

        allowed = ALLOWED_VALUES[key]

        if cleaned in allowed:

            cleaned_pred[key] = cleaned

        else:

            cleaned_pred[key] = None
            invalid_log[key] = raw_val

    # كشف الحقول غير المتوقعة
    for key in pred_dict.keys():

        if key not in EXPECTED_FIELDS:

            invalid_log[f"unexpected_field:{key}"] = pred_dict[key]

    return raw_pred, cleaned_pred, invalid_log


# ============================================================
# 10. GOLD FREEZE (مع التطبيع الموسع)
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
    # 10-a. Klosh correction (مع البحث في الاسم والوصف)
    # --------------------------------------------------------

    description_lower = (
        gold_df["description_raw"]
        .fillna("")
        .astype(str)
        .str.lower()
    )

    product_name_lower = (
        gold_df["product_name_raw"]
        .fillna("")
        .astype(str)
        .str.lower()
    )

    # البحث في أي من الحقلين عن "klosh"
    klosh_evidence = (
        description_lower.str.contains("klosh", na=False)
        |
        product_name_lower.str.contains("klosh", na=False)
    )

    klosh_mask = (
        klosh_evidence
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
        f"   ✅ تم تصحيح {klosh_count} سجلات Klosh (من الاسم أو الوصف)."
    )

    # --------------------------------------------------------
    # 10-b. Remove unsupported implicit Minimal
    # --------------------------------------------------------

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
    # 10-c. Gold Taxonomy Normalization (مرادفات)
    # --------------------------------------------------------

    gold_fields_to_normalize = [
        "silhouette_normalized",
        "opening_type",
        "fabric_family",
        "fabric_variant",
        "color_normalized",
        "embroidery_type",
        "embellishment_type",
        "embellishment_intensity"
    ]

    normalization_log = {}

    for field in gold_fields_to_normalize:

        if field not in gold_df.columns:
            continue

        original_values = gold_df[field].copy()

        gold_df[field] = gold_df[field].apply(
            lambda v: normalize_gold_value(v, field)
        )

        # تسجيل التغييرات
        changed_mask = (original_values != gold_df[field]) & (~original_values.isna())
        if changed_mask.sum() > 0:
            normalization_log[field] = {
                "changed_count": int(changed_mask.sum()),
                "examples": [
                    {
                        "original": str(original_values.loc[i]),
                        "normalized": str(gold_df[field].loc[i])
                    }
                    for i in changed_mask[changed_mask].index[:3]  # أول 3 أمثلة
                ]
            }

    if normalization_log:
        gold_transformations["gold_taxonomy_normalization"] = normalization_log
        print(
            f"   ✅ تم تطبيع {sum(v['changed_count'] for v in normalization_log.values())} "
            f"قيم Gold وفق مرادفات التصنيف."
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
# 11. GOLD HASH + INPUT HASH + SCRIPT HASH
# ============================================================

gold_sha256 = file_sha256(
    LOCKED_GOLD_CSV
)

input_sha256 = file_sha256(
    INPUT_CSV
) if os.path.exists(INPUT_CSV) else None

script_sha256 = file_sha256(
    __file__
) if os.path.exists(__file__) else None

print(
    f"🔐 Gold SHA256: {gold_sha256}"
)


# ============================================================
# 12. VERIFY REQUIRED GOLD COLUMNS
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
# 13. API PREDICTION (مع Retry)
# ============================================================

def get_ai_prediction_with_retry(row, max_retries=3, base_delay=1.0):

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

    retry_log = []
    last_error = None

    for attempt in range(max_retries):

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

            raw_pred, cleaned_pred, invalids = (
                validate_and_clean_prediction(
                    data
                )
            )

            # نجاح
            return (
                raw_pred,
                cleaned_pred,
                raw_response,
                invalids,
                retry_log  # فارغ إذا لم نحتاج لإعادة المحاولة
            )

        except Exception as e:

            last_error = str(e)

            retry_log.append({
                "attempt": attempt + 1,
                "error": last_error,
                "delay_seconds": base_delay * (2 ** attempt)
            })

            if attempt < max_retries - 1:

                time.sleep(
                    base_delay * (2 ** attempt)
                )

    # فشل بعد كل المحاولات
    empty_raw = {
        key: None
        for key in EXPECTED_FIELDS
    }

    empty_cleaned = {
        key: None
        for key in EXPECTED_FIELDS
    }

    return (
        empty_raw,
        empty_cleaned,
        f"ERROR: {last_error}",
        {
            "api_error": last_error
        },
        retry_log
    )


# ============================================================
# 14. RUN EVALUATION
# ============================================================

print()
print("=" * 70)
print(
    f"🚀 بدء Evaluation"
)
print(
    f"Harness: {HARNESS_VERSION}"
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
    f"Records: {len(gold_df)}"
)
print("=" * 70)
print()


raw_predictions = []
cleaned_predictions = []
raw_responses = []
invalid_predictions_log = []
retry_logs = []

failed_calls = 0

start_time = time.time()


for idx, row in gold_df.iterrows():

    product_id = row["product_id"]

    print(
        f"🔄 [{idx + 1}/{len(gold_df)}] "
        f"{product_id}"
    )

    raw_pred, cleaned_pred, raw_response, invalids, retry_log = (
        get_ai_prediction_with_retry(row)
    )

    raw_predictions.append(raw_pred)
    cleaned_predictions.append(cleaned_pred)
    raw_responses.append(raw_response)

    if retry_log:
        retry_logs.append({
            "product_id": product_id,
            "retry_log": retry_log
        })

    if invalids:

        invalid_predictions_log.append({

            "product_id": product_id,

            "invalid_fields": json.dumps(
                invalids,
                ensure_ascii=False
            ),

            "raw_response": raw_response
        })

    if raw_response.startswith("ERROR:"):

        failed_calls += 1

    time.sleep(0.3)


runtime_seconds = (
    time.time() - start_time
)


# ============================================================
# 15. BUILD RESULT DATAFRAME (مع raw و cleaned)
# ============================================================

# قوائم الأعمدة
raw_columns = [f"raw_{col}" for col in EXPECTED_FIELDS]
cleaned_columns = [f"cleaned_{col}" for col in EXPECTED_FIELDS]

# DataFrame للتوقعات الخام
raw_pred_df = pd.DataFrame(raw_predictions)
raw_pred_df.columns = raw_columns

# DataFrame للتوقعات النظيفة
cleaned_pred_df = pd.DataFrame(cleaned_predictions)
cleaned_pred_df.columns = cleaned_columns

# دمج كل شيء
result_df = pd.concat(
    [
        gold_df.reset_index(drop=True),
        raw_pred_df,
        cleaned_pred_df,
        pd.DataFrame({"raw_response": raw_responses})
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
# 16. EVALUATION (باستخدام RAW prediction فقط)
# ============================================================

print()
print("📊 حساب المقاييس (باستخدام RAW prediction)...")


fields = [

    (
        "silhouette_normalized",
        "raw_silhouette"
    ),

    (
        "opening_type",
        "raw_opening_type"
    ),

    (
        "fabric_family",
        "raw_fabric_family"
    ),

    (
        "fabric_variant",
        "raw_fabric_variant"
    ),

    (
        "color_normalized",
        "raw_color_normalized"
    ),

    (
        "embroidery_type",
        "raw_embroidery_type"
    ),

    (
        "embellishment_type",
        "raw_embellishment_type"
    ),

    (
        "embellishment_intensity",
        "raw_embellishment_intensity"
    )
]


metrics = {}

error_matrix = defaultdict(
    lambda: defaultdict(int)
)

per_record_status = []


# ============================================================
# 17. RECORD-LEVEL STATUS (باستخدام RAW)
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
# 18. FIELD METRICS (باستخدام RAW)
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
# 19. KLOSH DETECTION RATE (باستخدام RAW)
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
            "raw_silhouette"
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
# 20. OVERALL HALLUCINATION
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
# 21. CRITICAL HALLUCINATION (تشمل الكثافة)
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
# 22. MACRO ACCURACY
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
# 23. ADDITIONAL RUN QUALITY METRICS
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
# 24. EXPORT EXCEL REPORT
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
            "Metric": "Input CSV SHA256",
            "Value": input_sha256
        },

        {
            "Metric": "Script SHA256",
            "Value": script_sha256
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
# 25. ERROR MATRIX
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
# 26. INVALID PREDICTIONS
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
# 27. RUN METADATA
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

    "input_csv_sha256":
        input_sha256,

    "script_sha256":
        script_sha256,

    "gold_transformations_applied":
        gold_transformations,

    "critical_fields_definition":
        CRITICAL_FIELDS,

    "critical_hallucination_definition":
        "Macro-average FP rate across silhouette_normalized, opening_type, "
        "embellishment_type, and embellishment_intensity using RAW predictions.",

    "evaluation_basis":
        "RAW predictions (before taxonomy validation) are used for all metrics. "
        "Cleaned predictions are provided for reference and taxonomy adherence.",

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

    "records_with_retries":
        len(retry_logs),

    "retry_events":
        retry_logs,

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
# 28. FINAL SUMMARY
# ============================================================

print()
print("=" * 70)
print("🎯 اكتمل التشغيل بنجاح")
print("=" * 70)

print(
    f"Harness: {HARNESS_VERSION}"
)

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
