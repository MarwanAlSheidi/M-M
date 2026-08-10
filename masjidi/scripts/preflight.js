#!/usr/bin/env node
/**
 * فحص ما قبل الإطلاق — يُشغَّل مرّةً بعد النشر، قبل أوّل مستخدم.
 *
 * **لماذا يلزم:** كل اختبارات هذا المستودع تعمل على PostgreSQL، وBack4app على
 * MongoDB. فأوّل نشرٍ هو أوّل تشغيلٍ حقيقي على المحوّل الآخر — وقد كشف هذا
 * الفرق خللين فعليّين من قبل، مرّا في الاختبار وسقطا على خادمٍ حقيقي.
 *
 * وكان كلُّ ما بيد المُشغّل عند تلك اللحظة `health` التي تقول `{ok:true}`، وهي
 * لا تُثبت إلا أن الملفّ قُرئ. فهذا يُشغّل الصيغ المشبوهة على القاعدة الحيّة
 * ويُعيد نتيجة كلٍّ منها — **ويقول ما لم يفحصه.**
 *
 *   node scripts/preflight.js
 *
 * يخرج بـ0 إن نجح كلُّ فحص، وبـ1 إن سقط واحد — فيصلح في خطوة نشرٍ آلية.
 */

require('dotenv').config();
const Parse = require('parse/node');
const { announceTarget } = require('./lib/target');

const { PARSE_APP_ID, PARSE_MASTER_KEY, PARSE_SERVER_URL } = process.env;

if (!PARSE_APP_ID || !PARSE_MASTER_KEY || !PARSE_SERVER_URL) {
  console.error('✗ املأ PARSE_APP_ID وPARSE_MASTER_KEY وPARSE_SERVER_URL في .env');
  process.exit(1);
}

Parse.initialize(PARSE_APP_ID, null, PARSE_MASTER_KEY);
Parse.serverURL = PARSE_SERVER_URL;

/** يُطبع بمحاذاةٍ تجعل السقوط يُرى في لمحة، لا يُبحث عنه في سطور. */
const line = (row) => {
  console.log(`  ${row.ok ? '✓' : '✗'} ${row.name}${row.detail ? ` — ${row.detail}` : ''}`);
  if (!row.ok && row.why) console.log(`      ${row.why}`);
};

async function main() {
  announceTarget('الفحص');
  console.log('');

  const report = await Parse.Cloud.run('preflight', {}, { useMasterKey: true });

  console.log('الفحوص:');
  for (const row of report.checks) line(row);

  console.log('\nالأعداد:');
  for (const [name, value] of Object.entries(report.counts)) {
    console.log(`  ${name.replace(/_/g, ' ')}: ${value == null ? '— تعذّر العدّ' : value}`);
  }

  // يُطبع دائماً، نجح الفحص أو سقط: أخطر ما في تقريرٍ أخضر أن يُقرأ
  // «كلُّ شيء سليم» وهو لا يقول ذلك
  console.log('\nما لم يُفحص من هنا — راجعه بنفسك:');
  for (const item of report.unverifiable) console.log(`  · ${item}`);

  if (report.ok) {
    console.log('\n✓ اجتاز الخادم كلَّ ما يُفحص من هنا.');
    return;
  }
  console.error(`\n✗ سقط ${report.failed.length}: ${report.failed.join('، ')}`);
  process.exitCode = 1;
}

main().catch((error) => {
  console.error('\n✗ تعذّر الفحص:', error.message);
  console.error('  إن كانت الرسالة «Invalid function» فكود السحابة لم يُرفع بعد.');
  process.exit(1);
});
