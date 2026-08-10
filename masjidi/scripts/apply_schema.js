#!/usr/bin/env node
/**
 * تطبيق مخطط قاعدة البيانات من cloud/schema.json على Parse Server.
 * يُنشئ الفئات والحقول والفهارس الناقصة. لا يحذف شيئاً.
 *
 *   node scripts/apply_schema.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Parse = require('parse/node');
const { planIndexes, splitByKind } = require('./lib/index-plan');
const { announceTarget } = require('./lib/target');

/**
 * ملفّ المخطط — ويُبدَّل من البيئة ليُختبر مسارُ العطب على خادمٍ حقيقي.
 *
 * بلا ذلك لا سبيل إلى قياس ما يقع حين يسقط فهرس إلا بتعديل `cloud/schema.json`
 * أثناء الاختبار، وهو تلويثٌ للمستودع إن انقطع التشغيل. ومسارُ العطب هو
 * **الوحيد الذي يهمّ هنا**: الطريق السليم يمرّ في كل تشغيلة تكامل أصلاً.
 */
const schemaFile = process.env.MASJIDI_SCHEMA_FILE
  || path.join(__dirname, '..', 'cloud', 'schema.json');

/** أخطاء Parse قد تصل بلا `message` — الرمز وحده خيرٌ من كلمة «undefined». */
const reason = (error) => (error && error.message)
  || (error && error.code !== undefined && `رمز الخطأ ${error.code}`)
  || String(error);

/**
 * يضع الحقول الناقصة والصلاحيات على كائن مخطط — **بلا فهارس**.
 *
 * فُصلت لتُستدعى مرّتين: مرّةً مع الفهارس في المحاولة الأولى، ومرّةً وحدها في
 * محاولة الإنقاذ. وما يجمعهما أن **الصلاحيات لا تُترك خلف فهرس**.
 */
function describe(schema, definition, existingFields) {
  for (const [name, spec] of Object.entries(definition.fields || {})) {
    if (existingFields[name]) continue;
    const options = {};
    if (spec.required) options.required = true;
    if (spec.defaultValue !== undefined) options.defaultValue = spec.defaultValue;

    if (spec.type === 'Pointer') schema.addPointer(name, spec.targetClass, options);
    else schema[`add${spec.type}`](name, options);
  }

  if (definition.classLevelPermissions) schema.setCLP(definition.classLevelPermissions);
  return schema;
}

async function main() {
  const { PARSE_APP_ID, PARSE_MASTER_KEY, PARSE_JS_KEY, PARSE_SERVER_URL } = process.env;
  if (!PARSE_APP_ID || !PARSE_MASTER_KEY || !PARSE_SERVER_URL) {
    console.error('✗ متغيرات البيئة ناقصة (.env).');
    process.exit(1);
  }
  Parse.initialize(PARSE_APP_ID, PARSE_JS_KEY || '', PARSE_MASTER_KEY);
  Parse.serverURL = PARSE_SERVER_URL;
  announceTarget('تطبيق المخطط');

  const { classes } = JSON.parse(fs.readFileSync(schemaFile, 'utf8'));
  let applied = 0;
  /** أصنافٌ لم تصل حقولها وصلاحياتها — أوّل أمرٍ في النشر لا يجوز أن يكذب فيها. */
  const missing = [];
  /** أصنافٌ قامت وينقصها فهرس — تعمل، وبطيئةً على ثمانية عشر ألف مسجد. */
  const degraded = [];

  for (const definition of classes) {
    const { className } = definition;
    const schema = new Parse.Schema(className);
    let existing = null;
    try {
      existing = await schema.get();
    } catch (_) {
      // الفئة غير موجودة بعد
    }

    const existingFields = existing ? existing.fields : {};
    describe(schema, definition, existingFields);

    const { plain, spatial } = splitByKind(
      planIndexes(definition.indexes, existing && existing.indexes),
    );
    for (const { name, spec } of plain) schema.addIndex(name, spec);

    try {
      existing ? await schema.update() : await schema.save();
      applied += plain.length;
      console.log(`✓ ${className}${plain.length ? ` (+${plain.length} فهرساً)` : ''}`);
    } catch (error) {
      console.error(`✗ ${className}: ${reason(error)}`);

      /*
       * **الحقول والصلاحيات أولاً، وحدها.**
       *
       * كانت المحاولة الثانية تُعيد الفهارس واحداً واحداً ولا تُعيد الحقول ولا
       * الصلاحيات. وقِيس على خادمٍ حقيقي بحقن فهرسٍ على حقلٍ غير معرَّف في
       * `ServiceRequests`:
       *
       *     ✗ ServiceRequests: Field … does not exist, cannot add index.
       *       ✗ فهرس status_mosque: Class ServiceRequests does not exist.
       *
       * أي أن الصنف **لم يُنشأ أصلاً**: لا حقوله ولا قفلُه. وهو أحد الثلاثة
       * المقفلة للكتابة من العميل عبر CLP — وصنفٌ غائب يُنشئه أوّل عميلٍ يكتب
       * فيه بصلاحياتٍ افتراضية. فالفهرس تحسينٌ يُؤجَّل، والقفل شرطُ التشغيل،
       * ولا يُعلَّق الثاني على الأول.
       */
      /*
       * وتُقرأ الحالة من جديد قبل الإنقاذ: `update` يضيف الحقول ثم الفهارس بلا
       * معاملة، فقد تكون الحقول ثبتت وسقط الفهرس. وإعادةُ حقلٍ ثابتٍ خطأ يُسقط
       * الإنقاذ كلَّه — فنبني على ما في القاعدة الآن لا على ما كان قبل المحاولة.
       */
      let current = null;
      try { current = await new Parse.Schema(className).get(); } catch (_) { /* لم يقم */ }

      const rescue = describe(
        new Parse.Schema(className), definition, current ? current.fields : {},
      );
      let standing = false;
      try {
        current ? await rescue.update() : await rescue.save();
        standing = true;
        console.log('  ✓ الحقول والصلاحيات (بلا فهارس)');
      } catch (e) {
        console.error(`  ✗ الحقول والصلاحيات: ${reason(e)}`);
      }

      const lost = [];
      // الفهارس واحداً واحداً ليُعرف الفاسد ويمرّ السليم — وبعد أن قام الصنف
      for (const { name, spec } of standing ? plain : []) {
        const retry = new Parse.Schema(className);
        retry.addIndex(name, spec);
        await retry.update()
          .then(() => { applied += 1; console.log(`  ✓ فهرس ${name}`); })
          .catch((e) => { lost.push(name); console.error(`  ✗ فهرس ${name}: ${reason(e)}`); });
      }

      if (!standing) missing.push(className);
      else if (lost.length) degraded.push(`${className} (${lost.join('، ')})`);
    }

    // المكانيّ على حدة: يفشل حيث لا امتداد مكاني، وفشله لا يعني فشل الفئة
    for (const { name, spec } of spatial) {
      const geoSchema = new Parse.Schema(className);
      geoSchema.addIndex(name, spec);
      await geoSchema.update()
        .then(() => console.log(`  ✓ فهرس مكاني ${name}`))
        .catch((e) => console.warn(`  ⚠ فهرس مكاني ${name} لم يُطبَّق: ${reason(e)}`));
    }
  }

  /*
   * **ولا يُطبع سطرُ نجاحٍ فوق عطب.** كان الأمر يخرج بصفرٍ مهما سقط، وينتهي
   * بسطرٍ أخضر يعدّ فهارس لم تُطبَّق: قِيس ١٧ والمطبَّق ١٤. ومن يقرأ
   * `docs/DEPLOY.md` يُشغّل هذا أوّلاً ثم يمضي.
   */
  if (missing.length || degraded.length) {
    console.error('\n✗ لم يُطبَّق المخطط كما هو مكتوب.');
    if (missing.length) {
      console.error(`  أصنافٌ لم تقم: ${missing.join('، ')}`);
      console.error('  **لا تُشغّل شيئاً بعدها**: صنفٌ غائب لا صلاحيات له،');
      console.error('  ويُنشئه أوّل من يكتب فيه بصلاحياتٍ مفتوحة.');
    }
    if (degraded.length) console.error(`  أصنافٌ بلا بعض فهارسها: ${degraded.join('، ')}`);
    console.error('\n  صحّح ما ذُكر أعلاه وأعد التشغيل — الأمر لا يحذف شيئاً فإعادته آمنة.');
    process.exitCode = 1;
    return;
  }

  console.log(`\n✓ الفهارس المطبَّقة في هذه الجولة: ${applied}`);
  console.log('الفهارس المكانية (2dsphere) تحتاج MongoDB أو PostGIS؛ القرب يعمل');
  console.log('بدونها على صندوق الإحاطة — انظر cloud/lib/geo.js.');
  console.log('التفرّد الحقيقي على externalId يبقى فهرساً يدوياً من لوحة Back4app.');
}

main().catch((e) => { console.error(e); process.exit(1); });
