# UAE Abaya Classification — Production Multi-Model Benchmark

منظومة تقييم متعدّدة النماذج لقياس دقّة تحويل بيانات المنتج الخام (اسم + وصف)
إلى تصنيفات موحّدة وفق Taxonomy ثابتة للعباية الإماراتية.

| | |
|---|---|
| Benchmark | `v2.0.5` |
| Prompt | `classification v0.1` |
| Dataset | `v1.2` fixture · `data/production/` فارغ |
| Tests | 344 |

> ### ⚠️ نتائج الـ Fixture ليست نتائج نموذج
> البيانات المشحونة **اصطناعية** (15 سجلاً) والمصنّف الافتراضي **وهمي بلا شبكة**.
> كل تشغيلة تُصنَّف تلقائياً `TEST_FIXTURE` أو `REAL_BENCHMARK`، ولا تصير الثانية
> إلا باجتماع شرطين: بيانات من `data/production/` **و** مزوّد حقيقي.
> أرقام الـ Fixture تصف الأداة لا النموذج، ولا تُنشر ولا تُقارن.

هذا المجلد مستقلّ عن تطبيق «الخطة المالية» في جذر المستودع. البنية مجذّرة هنا لا
في جذر المستودع لأن `scripts/` في الجذر يخصّ فحوصات تطبيق React.

---

## 1. التثبيت والتشغيل

```bash
pip install -r eval/requirements.txt
cd eval

python -m benchmark.run_benchmark --model mock            # نموذج واحد
python -m benchmark.run_benchmark --all-models            # كل نموذج مؤهّل
python -m benchmark.run_benchmark --model mock --dry-run  # تحقّق بلا أي نداء
python -m pytest                                          # 344 اختباراً
python scripts/build_manifest.py --check                  # هل البصمات محدّثة؟
```

### خيارات الـ CLI

| الخيار | الوظيفة |
|---|---|
| `--model KEY` | نموذج من `configs/models.yaml` (يتكرّر) |
| `--all-models` | كل نموذج مُفعَّل تتوفّر بيانات اعتماده |
| `--dataset` · `--gold` · `--prompt` | تجاوز مسارات الإدخال |
| `--run-id` · `--run-dir` | تثبيت هوية التشغيلة أو مجلدها |
| `--resume` | إكمال تشغيلة متوقّفة، مع الرفض عند أي انزياح |
| `--review-sample N` | إخراج N سجلاً للمراجعة البشرية |
| `--max-records N` | تقليص عدد السجلات |
| `--dry-run` | تحقّق كامل و **صفر** نداء |
| `--no-strict` | يُبلّغ عن فشل النزاهة دون إيقاف (لا يُستخدم لإصدار) |

رموز الخروج: `0` نجاح · `2` فشل نزاهة · `3` خطأ إعداد · `4` لا نموذج مؤهّل ·
`5` خطأ مصنّف.

---

## 2. متغيّرات البيئة

| المتغيّر | المزوّد |
|---|---|
| `OPENAI_API_KEY` | OpenAI |
| `ANTHROPIC_API_KEY` | Anthropic |
| `GOOGLE_API_KEY` | Google / Gemini |

**المفاتيح لا تُكتب أبداً** في الكود ولا الـ YAML ولا الـ manifest ولا السجلّات
ولا ملفّات التدقيق. `configs/models.yaml` يخزّن **اسم** المتغيّر (`api_key_env`)
لا قيمته. النموذج الوهمي لا يحتاج شيئاً، فتعمل الاختبارات و CI بلا أي بيانات
اعتماد.

---

## 3. إضافة نموذج

أضف مدخلاً في `configs/models.yaml` — **لا كود**:

```yaml
models:
  my_model:
    provider: openai          # openai · anthropic · google · local
    classifier: openai        # openai · anthropic · gemini · mock
    model: <معرّف النموذج>     # مطلوب صراحةً؛ لا قيمة افتراضية
    temperature: 0.0
    seed: 7                   # إن كان المزوّد يدعمه
    max_tokens: 512
    api_key_env: OPENAI_API_KEY
    requests_per_minute: 60
    max_retries: 3
```

ثم:

```bash
python scripts/build_manifest.py                       # models.yaml مبصوم
python -m benchmark.run_benchmark --model my_model --dry-run
```

**لا تُخمّن معرّف نموذج.** المعرّفات في `anthropic_claude` و `google_gemini`
عناصر نائبة (`SET_..._MODEL_ID`) والنموذجان **معطّلان** حتى يضبطهما المشغّل؛
تقرير يسمّي نموذجاً لم يُستدعَ أسوأ من تقرير ناقص.

---

## 4. عزل النماذج

كل النماذج في دفعة واحدة تتشارك **بالبناء** لا بالثقة: الـ Prompt يُرسم مرّة
واحدة وتُمرَّر بصمته نفسها لكل نموذج، وأي اختلاف يرفع `IntegrityError`. الـ
Dataset والـ Gold والـ Taxonomy والمرادفات وسياسة الحقول والـ Evaluator كائنات
مشتركة واحدة. **الفرق الوحيد المسموح هو مدخل النموذج في `models.yaml`.**

---

## 5. البنية

```
benchmark/
    # v2.0.4 (لم تتغيّر جوهرياً)
    canonicalizer · validator · evidence_verifier · evaluator
    pipeline · integrity_gate · leakage_detector · auditor
    prompt_renderer · cost_tracker · classifier · utils · exceptions
    # v2.0.5
    model_registry.py     سجلّ النماذج + بصمة إعداد كل نموذج
    providers.py          OpenAI · Anthropic · Gemini · Mock بغلاف موحّد
    pricing.py            التسعير من ملف، والمجهول = null
    retry.py              عابر ↔ دائم، وتراجع أسّي محدود
    rate_limiter.py       تباعد الطلبات
    redaction.py          حجب الأسرار
    run_context.py        هوية التشغيلة + البصمة + الاستئناف
    dataset_manifest.py   تجميد البيانات + فحص الشرائح
    statistics.py         Wilson · McNemar · مئينات
    error_analysis.py     تصنيف الأخطاء
    comparison.py         مقارنة النماذج والتوافق
    review_sample.py      عيّنة المراجعة البشرية
    reporting.py          التقارير ووسم Fixture/Real
configs/    taxonomy · synonyms · critical_fields · model_config · models · pricing
data/       dataset · gold · training_ids · validation_ids · production/
manifests/  manifest.json · dataset_manifest.json
tests/      344 اختباراً
```

---

## 6. مخرجات التشغيلة

`runs/<run_id>/` حيث `run_id` = `<UTC>_<model>_<8 حروف من البصمة>` — قابل للفرز
زمنياً، وللبحث بالنموذج، ومميّز عند تغيّر الإعداد.

| الملف | المحتوى |
|---|---|
| `metadata.json` | الهوية والبصمات وقدرة الحتمية |
| `integrity_report.json` | نتائج البوّابة |
| `predictions_raw/validated/final.jsonl` | الطبقات الأربع |
| `evaluation_results.json` | كل المقاييس |
| `cost_summary.json` | التكلفة والزمن والنجاح |
| `confusion_matrices.csv` | مصفوفات الالتباس |
| `audit.jsonl` | سجلّ التدقيق |
| `checkpoint.json` | السجلات المكتملة (للاستئناف) |

الدفعة تُخرج إضافةً: `benchmark_report.{json,csv,md}` ·
`model_comparison.{json,csv}` · `dashboard_field_metrics.csv` ·
`review_sample.jsonl`.

**جاهز للوحات:** الصفوف مسطّحة (`benchmark_report.csv` صف لكل نموذج،
`dashboard_field_metrics.csv` صف لكل نموذج×حقل) لتُقرأ مباشرة في Excel أو
Power BI أو Streamlit أو دفتر Python بلا إعادة تشكيل. وسم `result_class` مكرّر
على **كل صف** لأن الـ CSV يُرشَّح ويُلصق في العروض، ولافتة في الترويسة وحدها لا
تنجو من ذلك.

---

## 7. الاستئناف

```bash
python -m benchmark.run_benchmark --model my_model --resume
```

المفتاح المستقرّ هو `product_id`. السجلات المكتملة تُستعاد من
`predictions_raw.jsonl` بلا إعادة نداء.

**الرفض عند الانزياح:** الاستئناف يقارن تسع بصمات (dataset · gold · prompt ·
taxonomy · synonyms · critical_fields · model config · pricing · code). أي
اختلاف يرفع `IntegrityError` ويسمّي ما تغيّر. إلحاق سجلات صُنِّفت تحت Prompt جديد
بسجلات صُنِّفت تحت القديم ليس تشغيلة ناقصة بل نتيجة لم يُنتجها أي إعداد.

فحص التسرّب يُعاد على السجلات المستعادة أيضاً: سجلّ مسرَّب لا ينجو لأنه كان
رخيصاً.

---

## 8. قراءة المقاييس

| المقياس | التعريف |
|---|---|
| Field accuracy | الصحيح ÷ إجمالي السجلات |
| Exact match | السجلّ صحيح فقط إذا صحّت **كل** الحقول |
| Critical exact match | صحّت كل الحقول **الحرجة** |
| Abstention rate | `ABSTAIN` ÷ إجمالي تنبّؤات الحقول |
| Selective accuracy | الدقّة بين ما لم يمتنع فقط |
| Evidence support rate | (SUPPORTED أو PARTIAL) ÷ النهائي غير الفارغ |
| Evidence-conditioned accuracy | الصحيح بين حاملي الدليل |
| Critical field error rate | الخطأ في الحقول الحرجة ÷ إجماليها |

تُحسب على الطبقات الأربع (`raw` · `validated` · `canonical` · `final`).
**الفجوة بينها هي النتيجة**، لا تطابقها.

### فترات الثقة

Wilson عند 95٪ للدقّة والمطابقة التامّة. اختير Wilson لا التقريب الطبيعي لأن
دقّات المعايير تسكن قرب 0 و1، حيث ينتج التقريب الطبيعي حدوداً خارج [0,1]
وينكمش إلى عرض صفري عند 100/100 — أي يدّعي يقيناً تامّاً من مئة مشاهدة.

> **تداخل فترتين ليس اختباراً إحصائياً، وعدم تداخلهما ليس اختباراً أيضاً.**
> الرقم الاستدلالي الوحيد هو **McNemar المزدوج**: بينوميال مضبوط عند أقل من 25
> زوجاً متنافراً، ومربّع كاي بتصحيح ييتس فوقها. وهو يصف **هذه السجلات تحت هذا
> الـ Prompt**، لا ترتيباً عامّاً بين نموذجين.

### التوافق ليس صواباً

التقرير يعدّ صراحةً الحالة المهمّة: **إجماع النماذج على إجابة خاطئة**
(`unanimous_but_incorrect`). الإجماع لا يُعامل Gold أبداً.

---

## 9. التكلفة والزمن

التسعير في `configs/pricing.yaml` وحده — **لا سعر في الكود** (اختبار يمنع ذلك).

**السعر المجهول = `null` لا صفر.** سعر ناقص يُعرض 0.00 يُقرأ «مجاني»، وهو أغلى
خطأ يرتكبه تقرير تكلفة. وكذلك عدّاد الرموز: مزوّد لا يُرجع `usage` يعطي `null`
لا صفراً، ولا يُختلق رقم.

المقاييس: `total_cost` · `cost_per_record` · `cost_per_correct_record` ·
`cost_per_critical_correct_record` · `cost_per_exact_match` ·
`cost_per_1_percent_accuracy` — وكلها `null` إن كانت التشغيلة بلا تسعير.

الزمن: المتوسّط والوسيط و p95 و p99 والحدّان، مع `success_rate` و`failure_rate`
و`retry_rate`. النداءات الفاشلة **تُستبعد من الدقّة وتبقى في المقاييس
التشغيلية**: نموذج يتجاوز المهلة بطيء لا غائب.

---

## 10. النزاهة

17 فحصاً. **أي `FAIL` واحد يوقف التشغيل** عبر `IntegrityError`.

v2.0.4: بصمة Gold · مخطّط Dataset و Gold · تطابق المعرّفات · التكرار · الفراغ ·
التسرّب · بصمات Taxonomy والمرادفات والحقول الحرجة والـ Prompt وإعداد النموذج
والكود · توفّر مُتحقّق الدليل.

v2.0.5: **الشرائح** (تدريب ∩ تقييم، تحقّق ∩ تقييم → FAIL؛ تدريب ∩ تحقّق مسموح
لأنه لا يلوّث ما يُقيَّم) · **بصمة الـ Dataset** · **بصمة التسعير** · **بصمة سجلّ
النماذج**.

`product_id_hash` مستقلّ عن ترتيب الصفوف، فيميّز «أُعيد توليد الملف» عن «تغيّرت
مجموعة السجلات» — والتقرير يقول أيّهما وقع.

البصمة تُبنى **يدوياً** بـ `scripts/build_manifest.py`. بناؤها مع كل تشغيلة يجعل
البوّابة تتحقّق من أن الملفات تطابق نفسها.

---

## 11. الحتمية — بصدق

`determinism_supported` يصف **المزوّد** لا هذه الأداة:

| النموذج | مدعوم | السبب |
|---|---|---|
| `mock` · `mock_variant` | ✅ | محلّي وحتمي بالكامل |
| `openai_*` | ✅ | يقبل `seed` |
| `anthropic_*` · `google_*` | ❌ | لا بذرة معلنة |

**درجة حرارة صفر ليست حتمية.** ترجّح فكّ الترميز الجشع ولا تضمنه، والمزوّدون
يمتنعون صراحةً عن وعد مخرَج متطابق. ادّعاء العكس أشدّ ما يمكن أن يُضلّل في قسم
قابلية التكرار.

تشغيلتان للنموذج الوهمي تنتجان أرقاماً متطابقة (اختبار). الزمن مُستثنى لأنه
ساعة حائط.

---

## 12. الأمان

- المفاتيح تُقرأ من البيئة، ولا تدخل ملفاً ولا Git.
- **طبقتا حجب:** القيم المسجَّلة (تلتقط مفتاحاً معاداً داخل رسالة خطأ) + أنماط
  الشكل (تلتقط مفتاحاً لم تُخبَر به الأداة قطّ).
- ترويسات `Authorization` و`X-Api-Key` وأخواتها تُحذف بالكامل.
- كل كتابة عبر `Auditor` تمرّ بالحجب — عند الحدّ لا عند كل نداء قد يُنسى.
- اختبارات تُثبت أن سرّاً حقيقياً لا ينجو في أي مخرَج، **بشكل مفتاح وبدونه**.

---

## 13. الحدود

1. **لا بيانات إنتاج.** `data/production/` فارغ عمداً. النتائج المشحونة Fixture.
2. **معرّفا Anthropic و Gemini نائبان** والنموذجان معطّلان.
3. **التزامن غير مُفعَّل.** `concurrency` مقروء ومسجَّل، والتنفيذ تسلسلي؛ الأمان
   قبل السرعة، ورقم مسجَّل لا يُنفَّذ خير من تسارع غير مُختبَر.
4. **الأسعار مُدخَلة يدوياً** وتتغيّر؛ تحقّق منها قبل الاستشهاد.
5. **المصنّف الوهمي يستخرج كلمات مفتاحية** ولا يشبه نموذجاً لغوياً.
6. **لم يُختبر مزوّد حقيقي فعلياً**: المحوّلات مُختبَرة بعملاء محقونين، وهو يثبت
   العقد لا سلوك الشبكة.
7. **بطاقات ومقاييس الـ Taxonomy** ورثت حدود v1.2.0 نفسها.

---

## 14. قابلية التكرار

كل تشغيلة تخزّن تسع بصمات: dataset · gold · prompt · taxonomy · synonyms ·
critical_fields · model config · pricing · code — مع `run_id` يحمل ثمانية أحرف
منها. البصمة نفسها هي شرط الاستئناف.

---

## 15. الإصدارات السابقة

- `uae_abaya_classification_eval.py` — harness أحادي الملف `v1.2.0`، محفوظ للرجوع.
- v2.0.4 — نواة النزاهة والطبقات الأربع، **قائمة كما هي**؛ 181 اختباراً منها
  تعمل دون تعديل. غُيّر سطر تأكيد واحد فقط (`run.version` من `2.0.4` إلى
  `2.0.5`) لأن الإصدار رُقّي عمداً، لا لأن سلوكاً تحرّك.
