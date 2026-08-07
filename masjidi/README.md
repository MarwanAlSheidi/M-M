# مسجدي — Masjidi

منصة لربط أئمة المساجد في سلطنة عُمان بالمتطوعين والشركات المعتمدة، لإدارة
أعمال الصيانة بشفافية. مبنية على Parse Server، ومهيّأة مسبقاً بـ **18,214
مسجداً** من البيانات المفتوحة لوزارة الأوقاف والشؤون الدينية.

## البدء

```bash
npm install
cp .env.example .env      # املأ مفاتيح Back4app
npm test                  # اختبارات دوال السحابة — بلا خادم ولا مفاتيح
```

### 1. تجهيز البيانات

```bash
# البيانات جاهزة في data/mosques.json — أعد التوليد فقط عند تحديث الملف الحكومي
python3 scripts/clean_mosques.py "Masajid Data with geographic locations.xlsx"
```

### 2. تطبيق المخطط

```bash
node scripts/apply_schema.js
```

ثم أضف يدوياً من لوحة Back4app (Database → Indexes):
- فهرس `2dsphere` على `Mosques.location` ← **إلزامي**
- فهرس `2dsphere` على `_User.lastKnownLocation`

### 3. الاستيراد

```bash
node scripts/seed_mosques.js --limit 100   # تجربة
node scripts/seed_mosques.js               # الكامل (~18k سجل)
```

### 4. نشر Cloud Code

ارفع محتوى مجلد `cloud/` عبر لوحة Back4app أو الـ CLI، ثم تحقق:

```bash
curl -X POST https://parseapi.back4app.com/functions/health \
  -H "X-Parse-Application-Id: $PARSE_APP_ID" \
  -H "X-Parse-REST-API-Key: $PARSE_REST_KEY"
```

## قبل أي تعديل

اقرأ [`CLAUDE.md`](./CLAUDE.md) — قواعد العمل والقيود.
واقرأ [`docs/REVIEW.md`](./docs/REVIEW.md) قبل لمس المنطق المالي.

## تنبيه

مسار التبرعات مكتوب لكنه **معطّل**. جمع التبرعات للمساجد في السلطنة يخضع
لوزارة الأوقاف والشؤون الدينية ويتطلب تصريحاً. النسخة الأولى تُطلق بمسار
التطوّع العيني فقط.

## البيانات

مصدرها وزارة الأوقاف والشؤون الدينية (بيانات مفتوحة، 2025–2026).
تفاصيل التنظيف ومشاكل المصدر في [`docs/DATA.md`](./docs/DATA.md).
