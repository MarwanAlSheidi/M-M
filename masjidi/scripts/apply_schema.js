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

const schemaFile = path.join(__dirname, '..', 'cloud', 'schema.json');

/** أخطاء Parse قد تصل بلا `message` — الرمز وحده خيرٌ من كلمة «undefined». */
const reason = (error) => (error && error.message)
  || (error && error.code !== undefined && `رمز الخطأ ${error.code}`)
  || String(error);

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

  for (const definition of classes) {
    const schema = new Parse.Schema(definition.className);
    let existing = null;
    try {
      existing = await schema.get();
    } catch (_) {
      // الفئة غير موجودة بعد
    }

    const existingFields = existing ? existing.fields : {};

    for (const [name, spec] of Object.entries(definition.fields || {})) {
      if (existingFields[name]) continue;
      const options = {};
      if (spec.required) options.required = true;
      if (spec.defaultValue !== undefined) options.defaultValue = spec.defaultValue;

      if (spec.type === 'Pointer') schema.addPointer(name, spec.targetClass, options);
      else schema[`add${spec.type}`](name, options);
    }

    if (definition.classLevelPermissions) {
      schema.setCLP(definition.classLevelPermissions);
    }

    const { plain, spatial } = splitByKind(
      planIndexes(definition.indexes, existing && existing.indexes),
    );
    for (const { name, spec } of plain) schema.addIndex(name, spec);

    try {
      existing ? await schema.update() : await schema.save();
      console.log(`✓ ${definition.className}${plain.length ? ` (+${plain.length} فهرساً)` : ''}`);
    } catch (error) {
      console.error(`✗ ${definition.className}: ${reason(error)}`);
      // فهرسٌ واحدٌ فاسد كان يُسقط الفئة كلّها ومعها بقية فهارسها — نعيد
      // المحاولة واحداً واحداً ليُعرف الفاسد ويمرّ السليم
      for (const { name, spec } of plain) {
        const retry = new Parse.Schema(definition.className);
        retry.addIndex(name, spec);
        await retry.update()
          .then(() => console.log(`  ✓ فهرس ${name}`))
          .catch((e) => console.error(`  ✗ فهرس ${name}: ${reason(e)}`));
      }
    }

    // المكانيّ على حدة: يفشل حيث لا امتداد مكاني، وفشله لا يعني فشل الفئة
    for (const { name, spec } of spatial) {
      const geoSchema = new Parse.Schema(definition.className);
      geoSchema.addIndex(name, spec);
      await geoSchema.update()
        .then(() => console.log(`  ✓ فهرس مكاني ${name}`))
        .catch((e) => console.warn(`  ⚠ فهرس مكاني ${name} لم يُطبَّق: ${reason(e)}`));
    }

    applied += plain.length;
  }

  console.log(`\n✓ الفهارس المطبَّقة في هذه الجولة: ${applied}`);
  console.log('الفهارس المكانية (2dsphere) تحتاج MongoDB أو PostGIS؛ القرب يعمل');
  console.log('بدونها على صندوق الإحاطة — انظر cloud/lib/geo.js.');
  console.log('التفرّد الحقيقي على externalId يبقى فهرساً يدوياً من لوحة Back4app.');
}

main().catch((e) => { console.error(e); process.exit(1); });
