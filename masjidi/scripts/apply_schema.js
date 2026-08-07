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

const schemaFile = path.join(__dirname, '..', 'cloud', 'schema.json');

async function main() {
  const { PARSE_APP_ID, PARSE_MASTER_KEY, PARSE_JS_KEY, PARSE_SERVER_URL } = process.env;
  if (!PARSE_APP_ID || !PARSE_MASTER_KEY || !PARSE_SERVER_URL) {
    console.error('✗ متغيرات البيئة ناقصة (.env).');
    process.exit(1);
  }
  Parse.initialize(PARSE_APP_ID, PARSE_JS_KEY || '', PARSE_MASTER_KEY);
  Parse.serverURL = PARSE_SERVER_URL;

  const { classes } = JSON.parse(fs.readFileSync(schemaFile, 'utf8'));

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

    try {
      existing ? await schema.update() : await schema.save();
      console.log(`✓ ${definition.className}`);
    } catch (error) {
      console.error(`✗ ${definition.className}: ${error.message}`);
    }
  }

  console.log('\nملاحظة: فهارس 2dsphere والفهارس المركّبة تُضاف من لوحة Back4app');
  console.log('(Database → Indexes) أو عبر MongoDB shell — Parse SDK لا يديرها.');
}

main().catch((e) => { console.error(e); process.exit(1); });
