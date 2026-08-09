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
 *   node scripts/seed_mosques.js --governorate muscat   # محافظة واحدة
 *   node scripts/seed_mosques.js --governorates         # ما المتاح منها
 *   node scripts/seed_mosques.js --coord-report         # الإحداثيات المرفوضة
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Parse = require('parse/node');
const { tokenize } = require('./lib/tokenize');
const { assessCoordinates, withdrawUntrusted } = require('./lib/coord-trust');

const BATCH_SIZE = 200; // Parse.Object.saveAll يتعامل داخلياً بدفعات — نبقيها معتدلة
const DATA_FILE = path.join(__dirname, '..', 'data', 'mosques.json');

const args = process.argv.slice(2);
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
const dryRun = args.includes('--dry-run');
const verifyOnly = args.includes('--verify');
const listGovernorates = args.includes('--governorates');
const coordReport = args.includes('--coord-report');
/**
 * تجربةٌ ميدانية في محافظة واحدة أقرب إلى الواقع من أوّل مئة سجلّ: `--limit`
 * يأخذ أوائل الملفّ وهي ترتيبٌ لا معنى له، فيخرج المتطوّع يبحث حوله فلا يجد
 * مسجده. والتصفية تقلّل كلفة الاستيراد على الباقة المجانية كذلك.
 */
const governorate = args.includes('--governorate')
  ? (args[args.indexOf('--governorate') + 1] || '').trim()
  : null;
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
  // `locationSource` لازم هنا: مسجدٌ تعلّم موقعه من إمامه لا يُمسح موقعه في
  // إعادة استيرادٍ لاحقة، حتى لو بقيت الوزارة على إحداثيّها الخاطئ
  query.select('externalId', 'locationSource');
  query.limit(1000);
  let cursor = null;
  for (;;) {
    if (cursor) query.greaterThan('objectId', cursor);
    const page = await query.ascending('objectId').find({ useMasterKey: true });
    if (page.length === 0) break;
    for (const mosque of page) {
      const key = mosque.get('externalId');
      if (found.has(key)) {
        const seen = duplicates.get(key) || [found.get(key).id];
        seen.push(mosque.id);
        duplicates.set(key, seen);
      } else {
        found.set(key, { id: mosque.id, learnedLocation: mosque.get('locationSource') === 'claim' });
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

  // الحكم على الإحداثيات قبل أي تصفية: قاعدة «النقطة الواحدة في ولايات شتّى»
  // لا تُرى إلا في الملفّ كاملاً، فتمريرُ محافظةٍ وحدها يُخفيها
  const verdicts = assessCoordinates(raw);
  const all = raw.map((row) => withdrawUntrusted(row, verdicts.get(row.externalId)));

  if (coordReport) {
    const counts = new Map();
    for (const { trust } of verdicts.values()) counts.set(trust, (counts.get(trust) || 0) + 1);
    console.log(`إحداثيات لا يُوثق بها: ${verdicts.size} من ${raw.length}`);
    for (const [trust, count] of counts) console.log(`  ${trust.padEnd(12)} ${count}`);
    console.log('\nأمثلة:');
    for (const row of all.filter((r) => verdicts.has(r.externalId)).slice(0, 25)) {
      const { reason } = verdicts.get(row.externalId);
      console.log(`  ${row.governorate}/${row.wilayat} — ${row.name} — ${reason}`);
    }
    return;
  }

  if (listGovernorates) {
    const counts = new Map();
    for (const row of raw) {
      const key = `${row.governorateSlug}\t${row.governorate}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    console.log(`المحافظات المتاحة (${raw.length} مسجداً إجمالاً):\n`);
    for (const [key, count] of [...counts].sort((a, b) => b[1] - a[1])) {
      const [slug, name] = key.split('\t');
      console.log(`  ${slug.padEnd(18)} ${name.padEnd(16)} ${count}`);
    }
    return;
  }

  let pool = all;
  if (governorate) {
    const wanted = governorate.toLowerCase();
    pool = all.filter((row) => row.governorateSlug === wanted || row.governorate === governorate);
    if (pool.length === 0) {
      console.error(`✗ لا محافظة باسم «${governorate}». استعمل --governorates لعرض المتاح.`);
      process.exit(1);
    }
    console.log(`→ محافظة ${pool[0].governorate}: ${pool.length} مسجداً`);
  }

  const records = pool.slice(0, limit);
  console.log(`→ ${records.length} سجلاً جاهزاً للاستيراد`);

  const withdrawn = records.filter((row) => verdicts.has(row.externalId)).length;
  const unlocated = records.filter((row) => !row.hasLocation).length;
  if (withdrawn > 0) {
    console.log(`→ سُحبت الثقة من إحداثيات ${withdrawn} مسجداً (--coord-report للتفصيل)`);
  }
  console.log(`→ مجهول الموقع بعد الفحص: ${unlocated} — يظهر بالاسم ويتعلّم موقعه من إمامه`);

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
      const prior = known.get(row.externalId) || null;
      if (prior) {
        mosque.id = prior.id;
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
      mosque.set('source', row.source);
      mosque.set('dataQuality', row.dataQuality);

      // موقعٌ تعلّمه المسجد من إمامه أصدق من فراغٍ خلّفه سحبُ الثقة، فلا تمسحه
      // إعادةُ الاستيراد — وإلا عاد المسجد مجهولاً كلّما شُغّل السكربت، وضاع ما
      // أثبته إمامه بوقوفه عنده. أمّا إن جاءت الوزارة بإحداثيٍّ موثوقٍ فهو
      // المرجع ويحلّ محلّ التقدير.
      const keepLearned = prior && prior.learnedLocation && !row.location;

      if (row.location) {
        mosque.set('hasLocation', true);
        mosque.set('location', new Parse.GeoPoint({
          latitude: row.location.latitude,
          longitude: row.location.longitude,
        }));
        // نسخة رقمية مسطّحة: البحث بالقرب يعمل عليها بصندوق إحاطة، فلا يتوقّف
        // على فهرس 2dsphere الذي يُضاف يدوياً — انظر cloud/lib/geo.js
        mosque.set('lat', row.location.latitude);
        mosque.set('lng', row.location.longitude);
        mosque.set('locationSource', 'ministry');
      } else if (!keepLearned) {
        // الحذف لا الترك: استيرادٌ سابق ربما كتب الإحداثيّ الخاطئ في القاعدة،
        // فتركُ الحقل على حاله يُبقي مسجد صلالة في مسقط إلى الأبد
        mosque.set('hasLocation', false);
        mosque.unset('location');
        mosque.unset('lat');
        mosque.unset('lng');
        mosque.unset('locationSource');
      }

      // لا نلمس الحقول التشغيلية عند التحديث حتى لا نمسح رصيداً أو ملكية
      if (!prior) {
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
