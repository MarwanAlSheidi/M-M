# UAE Abaya Classification — Evaluation Harness

منظومة تقييم لقياس دقّة نموذج لغوي في تحويل بيانات المنتج الخام (اسم + وصف)
إلى تصنيفات موحّدة وفق Taxonomy ثابتة للعباية الإماراتية.

| | |
|---|---|
| Harness | `v1.1.2` |
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

## 2. تجميد Gold

عند غياب `CALIBRATION_GOLD_v1.2_LOCKED.csv` يُبنى من الـ Dataset بتحويلين اثنين
فقط، ثم يُجمَّد ويُبصم بـ SHA256:

1. **تصحيح Klosh** — كل سجلّ ورد فيه `klosh` في الوصف و`silhouette_normalized`
   فيه فارغ ← `Klosh`.
2. **إسقاط Minimal الضمني** — `embellishment_intensity = minimal` بلا ذكر صريح
   لكلمة `minimal` في الاسم أو الوصف ← `NULL`.

بعد التجميد **لا يُعاد التحويل أبداً**؛ الملف المُجمّد يفوز دائماً. لإعادة اشتقاق
Gold، احذف الملف المُجمّد أو أعد تسميته — وتوقّع بصمة SHA256 جديدة تُبطل قابلية
المقارنة مع التشغيلات السابقة.

---

## 3. المخرجات

| الملف | المحتوى |
|---|---|
| `CALIBRATION_GOLD_v1.2_LOCKED.csv` | Gold المُجمّد (يُنشأ مرة واحدة) |
| `AI_PREDICTIONS_v0.1.csv` | Gold + أعمدة `ai_*` + `raw_response` |
| `EVALUATION_REPORT_v0.1.xlsx` | `Summary` · `Per_Record` · `Critical_Metrics` · `Gold_Integrity` |
| `ERROR_MATRIX_v0.1.csv` | أزواج (Gold, AI) المتعارضة وتكرارها |
| `INVALID_PREDICTIONS.csv` | القيم الخارجة عن الـ Taxonomy والحقول غير المتوقّعة |
| `RUN_METADATA.json` | البصمة والإصدارات وكل المقاييس الخام |

---

## 4. تعريف المقاييس

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

## 5. تحفّظات على القراءة — اقرأها قبل الاستشهاد بأي رقم

1. **القيم غير الصالحة تُصفَّر ولا تُحسب هلوسة.** أي قيمة يُخرجها النموذج خارج
   الـ Taxonomy تُحوَّل إلى `null` قبل التقييم. فإن كان Gold فارغاً، تُقيَّد
   `Correct_Null` بدل `False_Positive` — أي أن **FP Rate يُقلّل من تقدير
   الهلوسة**، وهو المقياس الرئيسي. اقرأ `INVALID_PREDICTIONS.csv`
   و`invalid_prediction_rate` بجانب أرقام FP دائماً، لا منفصلين عنها.

2. **تصحيح Klosh يفحص الوصف وحده.** القاعدة 3 في الـ Prompt تقبل الاسم أو الوصف،
   بينما التصحيح يمسح `description_raw` فقط. عباية ورد فيها Klosh في الاسم دون
   الوصف تبقى فارغة في Gold، فيُحتسب جواب النموذج الصحيح `klosh`
   **هلوسة على حقل حرج**.

3. **لا إعادة محاولة عند فشل الـ API.** أي خطأ عابر (429، انقطاع) يُنتج سجلاً
   كامل الفراغ يُحسب **ثمانية False_Negative**، فيهبط Macro Accuracy لسبب لا علاقة
   له بالنموذج. راجع `failed_api_calls` في `RUN_METADATA.json` قبل الوثوق بتشغيلة.

4. **Gold لا يُتحقَّق من تقيّده بالـ Taxonomy.** التحقّق يطال جواب النموذج وحده.
   فرق تنسيقي في Gold — `Stone/Crystal` مقابل المسموح `stone / crystal` — يُنتج
   `Classification_Error` على كل صف بلا استثناء.

5. **`INVALID_PREDICTIONS.csv` لا يُمسح بين التشغيلات.** لا يُكتب إلا عند وجود
   قيم غير صالحة، فقد يبقى ملف قديم من تشغيلة سابقة بينما يسرده الملخّص النهائي
   دائماً.

6. **التشغيل تسلسلي** بفاصل `0.3s` بين النداءات؛ زمن التشغيلة ≈ عدد السجلات ×
   (زمن النداء + 0.3s).
