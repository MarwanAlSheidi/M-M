# UAE Abaya Classification — Evaluation Harness

منظومة تقييم لقياس دقّة نموذج لغوي في تحويل بيانات المنتج الخام (اسم + وصف)
إلى تصنيفات موحّدة وفق Taxonomy ثابتة للعباية الإماراتية.

| | |
|---|---|
| Harness | `v1.2.0` |
| Prompt | `v0.1` |
| Dataset | `v1.2` |
| Model | `gpt-4o-mini` · `temperature = 0.0` |

هذا المجلد مستقلّ تماماً عن تطبيق «الخطة المالية» في جذر المستودع؛ لا يشترك معه
في كود ولا في اعتماديات.

---

## 1. التشغيل

```bash
pip install -r eval/requirements.txt
export OPENAI_API_KEY=...

cd eval                      # المخرجات تُكتب في مجلد العمل الحالي
python uae_abaya_classification_eval.py
```

**الملفات المطلوبة في مجلد العمل** (غير مُدرجة في المستودع — بيانات منتجات):

- `UAE_CALIBRATION_DATASET_v1.2.csv` — يُقرأ فقط عند غياب Gold المُجمّد.
- `CALIBRATION_GOLD_v1.2_LOCKED.csv` — إن وُجد، يُستخدم كما هو بلا أي تحويل.

الأعمدة الإلزامية في Gold:

```
product_id · product_name_raw · description_raw
silhouette_normalized · opening_type · fabric_family · fabric_variant
color_normalized · embroidery_type · embellishment_type · embellishment_intensity
```

---

## 2. أساس التقييم: RAW لا Cleaned

كل تنبّؤ يُحفظ مرّتين:

| الأعمدة | المحتوى |
|---|---|
| `raw_*` | ما أخرجه النموذج حرفياً، قبل أي تحقّق |
| `cleaned_*` | بعد التحقّق: كل قيمة خارج الـ Taxonomy تصير `null` |

**كل المقاييس تُحسب على `raw_*`.** هذا مقصود: لو حُسبت على `cleaned_*` لصارت
القيمة المخترَعة أمام Gold فارغ `Correct_Null` بدل `False_Positive` — أي أن
النموذج يخترع والمقياس يكافئه. أعمدة `cleaned_*` تبقى للاطّلاع ولقياس التزام
النموذج بالـ Taxonomy، ولا تدخل أي رقم.

`INVALID_PREDICTIONS.csv` يسرد ما رُفض في مسار التنظيف، ونسبته في
`invalid_prediction_rate`.

---

## 3. تجميد Gold

عند غياب `CALIBRATION_GOLD_v1.2_LOCKED.csv` يُبنى من الـ Dataset بثلاثة تحويلات،
ثم يُجمَّد ويُبصم بـ SHA256:

1. **تصحيح Klosh** — كل سجلّ ورد فيه `klosh` **في الاسم أو الوصف**
   و`silhouette_normalized` فيه فارغ ← `Klosh`. (الفحص يشمل الحقلين مطابقةً
   للقاعدة 3 في الـ Prompt.)
2. **إسقاط Minimal الضمني** — `embellishment_intensity = minimal` بلا ذكر صريح
   لكلمة `minimal` في الاسم أو الوصف ← `NULL`.
3. **تطبيع مرادفات Gold** — `farasha` ← `butterfly`، `maroon` ← `burgundy`،
   `stone` ← `stone / crystal` … إلخ، ثم توحيد حالة الأحرف.
   **المرادفات مفهرسة بالحقل** لا مسطّحة: `stone` لون قائم بذاته في
   `color_normalized`، وزخرفة في `embellishment_type`. خريطة مشتركة واحدة كانت
   تسرّب المعنى بين الحقلين.

بعد التجميد **لا يُعاد التحويل أبداً**؛ الملف المُجمّد يفوز دائماً.

> **تنبيه ترقية:** Gold مُجمّد بـ `v1.1.2` **لا يستفيد** من تصحيح Klosh عبر الاسم
> ولا من التطبيع — الملف الموجود يُقرأ كما هو ويُتخطّى القسم كلّه بصمت. لأخذ
> تحويلات `v1.2.0` احذف الملف المُجمّد أو أعد تسميته، وتوقّع بصمة SHA256 جديدة
> تُبطل قابلية المقارنة مع التشغيلات السابقة.

---

## 4. المخرجات

| الملف | المحتوى |
|---|---|
| `CALIBRATION_GOLD_v1.2_LOCKED.csv` | Gold المُجمّد (يُنشأ مرة واحدة) |
| `AI_PREDICTIONS_v0.1.csv` | Gold + `raw_*` + `cleaned_*` + `raw_response` |
| `EVALUATION_REPORT_v0.1.xlsx` | `Summary` · `Per_Record` · `Critical_Metrics` · `Gold_Integrity` |
| `ERROR_MATRIX_v0.1.csv` | أزواج (Gold, AI) المتعارضة وتكرارها |
| `INVALID_PREDICTIONS.csv` | القيم الخارجة عن الـ Taxonomy والحقول غير المتوقّعة |
| `RUN_METADATA.json` | البصمات والإصدارات وسجلّ إعادة المحاولات وكل المقاييس الخام |

ثلاث بصمات تُسجَّل في كل تشغيلة: Gold والـ Input CSV والـ script نفسه.

---

## 5. تعريف المقاييس

لكل حقل، تُصنَّف كل مقارنة إلى واحدة من خمس:

| الحالة | Gold | AI |
|---|---|---|
| `Correct_Null` | فارغ | فارغ |
| `Correct_Match` | قيمة | القيمة نفسها |
| `False_Positive (Hallucination)` | فارغ | قيمة |
| `False_Negative (Missed)` | قيمة | فارغ |
| `Classification_Error` | قيمة | قيمة مختلفة |

- **Critical Hallucination Rate (v1)** — متوسّط ماكرو لـ FP Rate على أربعة حقول:
  `silhouette_normalized`, `opening_type`, `embellishment_type`,
  `embellishment_intensity`.
- **Overall Field-Level FP Rate** — متوسّط ميكرو على كل الحقول الثمانية.
- **Klosh Detection Rate** — نسبة سجلّات Klosh في Gold التي أصابها النموذج.

المقارنة تتمّ بعد `strip().lower()` على الطرفين.

---

## 6. إعادة المحاولة

كل نداء يُعاد حتى ثلاث مرات بتأخير متضاعف (1s، 2s، 4s). السجلّ لا يُحسب
`failed_api_call` إلا بعد فشل المحاولات الثلاث، وعندها تُملأ حقوله الثمانية
بالفراغ وتُقيَّد `False_Negative`.

كل محاولة فاشلة تُسجَّل في `retry_events` داخل `RUN_METADATA.json`، وعددها في
`records_with_retries`. راجع `failed_api_calls` قبل الوثوق بأي تشغيلة: صفر يعني
أن الأرقام تخصّ النموذج وحده.

---

## 7. تحفّظات باقية

1. **أسماء ملفات المخرجات تحمل إصدار الـ Prompt لا الـ Harness.** تشغيلة
   `v1.2.0` تكتب فوق مخرجات `v1.1.2` بالاسم نفسه، والأرقام **غير قابلة للمقارنة**
   بينهما لأن أساس التقييم تغيّر من Cleaned إلى Raw. احفظ نسخة من المخرجات قبل
   إعادة التشغيل بإصدار Harness مختلف؛ `script_sha256` في الـ metadata هو ما
   يميّزهما.

2. **`is_null_value` لا يعرف `n/a` ولا `-`.** بما أن التقييم يقرأ Raw، فجواب مثل
   `"N/A"` — وهو نيّة فراغ لا قيمة — يُقيَّد `False_Positive` أمام Gold فارغ.
   لم يُضَف إلى قائمة الفراغ لأنه يغيّر دلالة المقياس ويستوجب إصداراً جديداً.

3. **Gold لا يُرفض عند خروجه عن الـ Taxonomy.** التطبيع يعالج المرادفات
   المعروفة، لكن قيمة Gold غير معروفة تماماً تمرّ كما هي وتظهر لاحقاً
   `Classification_Error` على كل صف. لا فحص يوقف التشغيل عندها.

4. **`INVALID_PREDICTIONS.csv` لا يُمسح بين التشغيلات.** لا يُكتب إلا عند وجود
   قيم غير صالحة، فقد يبقى ملف قديم من تشغيلة سابقة بينما يسرده الملخّص النهائي
   دائماً.

5. **التشغيل تسلسلي** بفاصل `0.3s` بين النداءات؛ زمن التشغيلة ≈ عدد السجلات ×
   (زمن النداء + 0.3s)، ويزيد مع كل إعادة محاولة.
