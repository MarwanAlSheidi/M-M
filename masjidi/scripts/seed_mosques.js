#!/usr/bin/env node
/**
 * استيراد بيانات المساجد (18,214 سجلاً) إلى Parse.
 *
 * قابل لإعادة التشغيل (idempotent): يعتمد على externalId، فإعادة التشغيل
 * تُحدّث ولا تُكرّر. يستخدم Master Key، لذا يُشغّل من جهازك أو من CI فقط.
 *
 *   node scripts/seed_mosques.js            # استيراد كامل
 *   node scripts/seed_mosques.js --limit 100  # تجربة سريعة
 *   node scripts/seed_mosques.js --dry-run
 *   node scripts/seed_mosques.js --verify   # فحص التكرار بلا كتابة
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Parse = require('parse/node');
const { tokenize } = require('./lib/tokenize');

const BATCH_SIZE = 200; // Parse.Object.saveAll يتعامل داخلياً بدفعات — نبقيها معتدلة
const DATA_FILE = path.join(__dirname, '..', 'data', 'mosques.json');

const args = process.argv.slice(2);
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
const dryRun = args.includes('--dry-run');
const verifyOnly = args.includes('--verify');
const allowDuplicates = args.includes('--allow-duplicates');

function initParse() {
  const { PARSE_APP_ID, PARSE_MASTER_KEY, PARSE_JS_KEY, PARSE_SERVER_URL } = process.env;
  if (!PARSE_APP_ID || !PARSE_MASTER_KEY || !PARSE_SERVER_URL) {
    console.error('✗ متغيرات البيئة ناقصة. انسخ .env.example إلى .env واملأه.');
    process.exit(1);
  }
  Parse.initialize(PARSE_APP_ID, PARSE_JS_KEY || '', PARSE_MASTER_KEY);
  Parse.serverURL = PARSE_SERVER_URL;
}

/**
 * خريطة `externalId` → `objectId` لكل مسجد مخزَّن، ومعها ما تكرّر منها.
 *
 * التكرار يُرصد هنا لأننا نمرّ على كل سجل أصلاً فلا يكلّف شيئاً. وبلا رصده
 * كانت `found.set` تحتفظ بآخر نسخة وتُسقط ما قبلها: النسخة المهجورة لا تُحدَّث
 * أبداً، وتبقى تظهر في البحث وتُطلَب ملكيتها بينما الطلبات تُنشأ على أختها.
 * وفهرس `externalId_lookup` فهرس بحث لا قيد تفرّد، فلا شيء يمنع ذلك في القاعدة.
 */
async function existingIds() {
  const found = new Map();
  const duplicates = new Map();
  const query = new Parse.Query('Mosques');
  query.select('externalId');
  query.limit(1000);
  let cursor = null;
  for (;;) {
    if (cursor) query.greaterThan('objectId', cursor);
    const page = await query.ascending('objectId').find({ useMasterKey: true });
    if (page.length === 0) break;
    for (const mosque of page) {
      const key = mosque.get('externalId');
      if (found.has(key)) {
        const seen = duplicates.get(key) || [found.get(key)];
        seen.push(mosque.id);
        duplicates.set(key, seen);
      } else {
        found.set(key, mosque.id);
      }
    }
    cursor = page[page.length - 1].id;
    if (page.length < 1000) break;
  }
  return { found, duplicates };
}

/** يطبع التكرار ويعيد `true` إن وُجد — القرار للمُشغّل لا للسكربت. */
function reportDuplicates(duplicates) {
  if (duplicates.size === 0) return false;
  console.error(`\n✗ ${duplicates.size} معرّفاً خارجياً مكرّراً في القاعدة:`);
  for (const [key, ids] of [...duplicates].slice(0, 20)) {
    console.error(`   ${key} → ${ids.join('، ')}`);
  }
  if (duplicates.size > 20) console.error(`   … و${duplicates.size - 20} غيرها`);
  console.error('\nالاستيراد يُحدّث نسخةً واحدة ويترك البقية مهجورةً تظهر في البحث.');
  console.error('احذف الزائد يدوياً ثم أعد التشغيل، أو تجاوز بـ--allow-duplicates.');
  return true;
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const records = raw.slice(0, limit);
  console.log(`→ ${records.length} سجلاً جاهزاً للاستيراد`);

  if (dryRun) {
    console.log(JSON.stringify(records[0], null, 2));
    console.log('✓ تجربة جافة — لم يُكتب شيء.');
    return;
  }

  initParse();
  const Mosque = Parse.Object.extend('Mosques');
  const { found: known, duplicates } = await existingIds();
  console.log(`→ موجود مسبقاً: ${known.size}`);

  const hasDuplicates = reportDuplicates(duplicates);
  if (verifyOnly) {
    if (!hasDuplicates) console.log('✓ لا تكرار في المعرّفات الخارجية.');
    process.exit(hasDuplicates ? 1 : 0);
  }
  // الكتابة فوق قاعدة مكرّرة تُرسّخ التكرار ولا تصلحه — نقف افتراضياً
  if (hasDuplicates && !allowDuplicates) process.exit(1);

  let created = 0;
  let updated = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE).map((row) => {
      const mosque = new Mosque();
      if (known.has(row.externalId)) {
        mosque.id = known.get(row.externalId);
        updated += 1;
      } else {
        created += 1;
      }

      mosque.set('externalId', row.externalId);
      mosque.set('mosqueNumber', row.mosqueNumber);
      mosque.set('name', row.name);
      mosque.set('nameNormalized', row.nameNormalized);
      mosque.set('nameTokens', tokenize(row.nameNormalized, row.village));
      mosque.set('type', row.type);
      mosque.set('typeSlug', row.typeSlug);
      mosque.set('governorate', row.governorate);
      mosque.set('governorateSlug', row.governorateSlug);
      mosque.set('wilayat', row.wilayat);
      mosque.set('village', row.village);
      mosque.set('hasLocation', row.hasLocation);
      mosque.set('source', row.source);
      mosque.set('dataQuality', row.dataQuality);

      if (row.location) {
        mosque.set('location', new Parse.GeoPoint({
          latitude: row.location.latitude,
          longitude: row.location.longitude,
        }));
        // نسخة رقمية مسطّحة: البحث بالقرب يعمل عليها بصندوق إحاطة، فلا يتوقّف
        // على فهرس 2dsphere الذي يُضاف يدوياً — انظر cloud/lib/geo.js
        mosque.set('lat', row.location.latitude);
        mosque.set('lng', row.location.longitude);
      }

      // لا نلمس الحقول التشغيلية عند التحديث حتى لا نمسح رصيداً أو ملكية
      if (!known.has(row.externalId)) {
        mosque.set('isClaimed', false);
        mosque.set('walletBalance', 0);
        mosque.set('openRequestsCount', 0);
      }

      return mosque;
    });

    await Parse.Object.saveAll(batch, { useMasterKey: true });
    process.stdout.write(`\r  ${Math.min(i + BATCH_SIZE, records.length)}/${records.length}`);
  }

  console.log(`\n✓ تم. جديد: ${created} — محدّث: ${updated}`);
}

main().catch((error) => {
  console.error('\n✗ فشل الاستيراد:', error.message);
  process.exit(1);
});
