#!/usr/bin/env node
/**
 * تصديرُ سجلّ المنصّة إلى ملفّ — قبل أن يحذفه التقليم.
 *
 * **العطب الذي يسدّه:** `pruneAuditLog` مُجدوَلٌ أسبوعياً في `docs/DEPLOY.md`،
 * ويحذف نهائياً ما تجاوز 180 يوماً. وكُتب في `docs/REVIEW.md`: «التقليم يحذف
 * ولا يؤرشف… فالتصدير قبل الحذف **مسؤولية خارجية**». وقِيس: لا سكربت تصدير في
 * المستودع، ولا ذكرَ لنسخةٍ احتياطية في دليل النشر.
 *
 * فالمنصّة تَعِد بالشفافية، وتُجدوِل حذفَ دليلها، ولا تُعطي وسيلةً لحفظه.
 *
 * **وما يُصدَّر لا يُستعاد بهذا السكربت.** هو نسخةٌ للمساءلة والانتقال — تُقرأ
 * بعينٍ أو تُحمَّل في أداةٍ أخرى — لا استرجاعٌ آليّ. وقولُ ذلك صراحةً خيرٌ من
 * ملفٍّ يُظنّ به ما ليس فيه.
 *
 *   node scripts/export_records.js                 # إلى backups/
 *   node scripts/export_records.js --out /path.json
 *   node scripts/export_records.js --class AuditLog
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Parse = require('parse/node');
const { announceTarget } = require('./lib/target');

/**
 * ما يُصدَّر — وما لا يُصدَّر ولماذا.
 *
 * `_User` **مستثنىً قصداً**: فيه هواتف الأئمة والمتطوّعين، وتصديرُه يُنشئ ملفّاً
 * نصّياً ببيانات الناس الشخصية يُنسخ ويُرسل ويُنسى على قرص. وسجلّ التدقيق نفسه
 * مبنيٌّ على أن **الفاعل يُذكر بصفته لا باسمه** — فتصديرُ الحسابات معه ينقض
 * ذلك من الباب الخلفي.
 *
 * و`Notifications` مستثنىً لأنه خبرٌ عاجل لا سجلّ: الأثر الدائم في `AuditLog`.
 */
const CLASSES = [
  // ملكية المساجد: قرارٌ بشريّ لا يُستعاد من ملفّ البيانات
  'MosqueClaims',
  // ما جرى في المساجد — وهو أداة الشفافية التي يحذفها التقليم
  'AuditLog',
  'ServiceRequests',
  'TaskInterests',
  'Transactions',
];

const SKIPPED = {
  _User: 'فيه هواتف الناس — وسجلّ التدقيق يذكر الصفة لا الهوية قصداً',
  Mosques: 'يُعاد بناؤه من `data/mosques.json` بالاستيراد — عدا ما تعلّمه من الأئمة',
  Notifications: 'خبرٌ عاجل لا سجلّ — والأثر الدائم في `AuditLog`',
};

/**
 * حجم الصفحة — ويُضبط من البيئة ليُختبر التصفّح فعلاً.
 *
 * بلا ذلك لا يُقاس التصفّح إلا بستّمئة صفٍّ حقيقي في كل تشغيل، فيُترك بلا
 * حارس — **وهو أخطر ما في السكربت**.
 */
const PAGE = Math.max(Number(process.env.MASJIDI_EXPORT_PAGE) || 500, 1);

const args = process.argv.slice(2);
const only = args.includes('--class') ? args[args.indexOf('--class') + 1] : null;
const outArg = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;

/**
 * يقرأ صنفاً كاملاً بالصفحات.
 *
 * **والترتيب بمفتاحين لا بواحد.** كان بـ`createdAt` وحده، وفوقه تعليقٌ يقول إن
 * ذلك يمنع أن «يتكرّر صفٌّ ويسقط آخر بلا أن يُعرف». **ولم يمنعه**: الطابع ليس
 * فريداً — وصفوفٌ تُكتب دفعةً واحدة (`saveAll` في `closeInterests`
 * و`warnImamsOfWorkerLoss`) تحمل الطابع نفسه، وترتيبُ المتساويَين غير معرَّف.
 *
 * وقِيس على خادمٍ حقيقي بأربعين قيداً كُتبت دفعةً:
 *
 *     بالتصفّح: 56 صفّاً، منها 50 فريداً — **مفقود 6**
 *     وبإضافة `objectId`: 56 من 56، مفقود 0
 *
 * **وضياعٌ صامتٌ في نسخةٍ احتياطية أسوأ ما يكون**: لا يُكتشف إلا يوم يُحتاج
 * إليها، وحينها لا يُعرف ما الذي ضاع أصلاً.
 */
async function readAll(className) {
  const rows = [];
  let skip = 0;

  for (;;) {
    const page = await new Parse.Query(className)
      .ascending('createdAt').addAscending('objectId').skip(skip).limit(PAGE)
      .find({ useMasterKey: true });

    rows.push(...page.map((row) => row.toJSON()));
    if (page.length < PAGE) break;
    skip += PAGE;
    process.stdout.write(`  ${className}: ${rows.length}…\r`);
  }
  return rows;
}

async function main() {
  const { PARSE_APP_ID, PARSE_MASTER_KEY, PARSE_JS_KEY, PARSE_SERVER_URL } = process.env;
  if (!PARSE_APP_ID || !PARSE_MASTER_KEY || !PARSE_SERVER_URL) {
    console.error('✗ متغيرات البيئة ناقصة. انسخ .env.example إلى .env واملأه.');
    process.exit(1);
  }
  Parse.initialize(PARSE_APP_ID, PARSE_JS_KEY || '', PARSE_MASTER_KEY);
  Parse.serverURL = PARSE_SERVER_URL;
  announceTarget('التصدير');

  const wanted = only ? [only] : CLASSES;
  if (only && !CLASSES.includes(only)) {
    console.error(`✗ «${only}» ليس من الأصناف المصدَّرة: ${CLASSES.join('، ')}`);
    process.exit(1);
  }

  const data = {};
  const counts = {};
  for (const className of wanted) {
    const rows = await readAll(className);
    data[className] = rows;
    counts[className] = rows.length;
    console.log(`  ${className}: ${rows.length} سجلاً`);
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const out = outArg || path.join(__dirname, '..', 'backups', `masjidi-${stamp}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });

  fs.writeFileSync(out, `${JSON.stringify({
    exportedAt: new Date().toISOString(),
    server: PARSE_SERVER_URL,
    counts,
    // ما لم يُصدَّر يُذكر **في الملفّ نفسه**: من يفتحه بعد سنةٍ لا يقرأ هذا
    // السكربت، ونسخةٌ لا تقول ما ينقصها تُقرأ كاملة.
    skipped: SKIPPED,
    note: 'نسخةٌ للمساءلة والانتقال — لا يستعيدها هذا السكربت آلياً.',
    data,
  }, null, 2)}\n`, 'utf8');

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  console.log(`\n✓ صُدّر ${total} سجلاً إلى ${out}`);
  if (total === 0) console.log('  (خادمٌ فارغ — أو الأصناف لم تُطبَّق بعد)');
}

/*
 * والخروج صريح: عميل Parse قد يُبقي وصلةً مفتوحة بعد آخر استعلام، فتنتهي
 * العملية عملاً ولا تنتهي حالاً — **وفي مهمّةٍ مجدولة يعني ذلك وظيفةً لا
 * تنتهي**. فالخروج يُقال ولا يُترك لسلوك المكتبة.
 */
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`✗ فشل التصدير: ${(error && error.message) || error}`);
    process.exit(1);
  });
