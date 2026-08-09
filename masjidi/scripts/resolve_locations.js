#!/usr/bin/env node
/**
 * استخراج مواقع المساجد المجهولة من خرائط جوجل.
 *
 * 430 مسجداً بلا موقعٍ يُوثق به — ستة عشر بلا إحداثيّ في بيانات الوزارة،
 * و414 سُحبت ثقتنا من إحداثيّها الكاذب. وأهلها خارج البحث بالقرب وفرصهم في ذيل
 * القائمة. وانتظارُ أن يقف عندها أئمّتها يؤخّرها إلى أجلٍ غير معلوم، ومواقعُها
 * موجودة في خرائط جوجل بأسمائها.
 *
 * **لا يكتب في القاعدة.** يُخرج ملفّ تراكبٍ مراجَعاً — `data/resolved_locations.json`
 * — يقرؤه الاستيراد. فالنتيجة تُقرأ وتُراجَع قبل أن تصير موقع مسجدٍ على
 * الخريطة، ويبقى الملفّ في المستودع فيُعاد الاستيراد بلا مفتاحٍ ولا كلفة.
 *
 * وقواعد القبول في `lib/place-match.js` — نتيجة جوجل مرشَّحٌ لا حقيقة.
 *
 * الكلفة: البحث النصّي في Places مدفوع (نحو 32 دولاراً للألف طلب وقت الكتابة)،
 * فأربعمئة وثلاثون طلباً ≈ 14 دولاراً. جرّب بـ`--limit` أولاً.
 *
 *   GOOGLE_MAPS_API_KEY=... node scripts/resolve_locations.js --limit 20
 *   GOOGLE_MAPS_API_KEY=... node scripts/resolve_locations.js
 *   node scripts/resolve_locations.js --report      # ما في الملفّ، بلا شبكة
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const { prepare } = require('./lib/mosque-record');
const { chooseLocation } = require('./lib/place-match');

const DATA_FILE = path.join(__dirname, '..', 'data', 'mosques.json');
const OUT_FILE = path.join(__dirname, '..', 'data', 'resolved_locations.json');
const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

const args = process.argv.slice(2);
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
const reportOnly = args.includes('--report');

/** مهلةٌ بين الطلبات: البحث النصّي محدود المعدّل، والتسرّع يردّ 429. */
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * بحثٌ نصّي واحد.
 *
 * `locationBias` يوجّه البحث إلى محيط الولاية بدل السلطنة كلّها — فاسمٌ متكرّر
 * يعود بمرشّحي المنطقة لا بمسجدٍ في الطرف الآخر. وهو **توجيهٌ لا قيد**، فما
 * جاء بعيداً يردّه `chooseLocation` لا الاستعلام.
 */
async function searchText(query, centre, apiKey) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.displayName,places.location,places.formattedAddress,places.types',
    },
    body: JSON.stringify({
      textQuery: query,
      languageCode: 'ar',
      regionCode: 'OM',
      maxResultCount: 10,
      locationBias: { circle: { center: { latitude: centre.lat, longitude: centre.lng }, radius: 40000 } },
    }),
  });

  if (!response.ok) {
    throw new Error(`جوجل ردّ ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const body = await response.json();
  return (body.places || []).map((place) => ({
    name: (place.displayName && place.displayName.text) || '',
    lat: place.location && place.location.latitude,
    lng: place.location && place.location.longitude,
    address: place.formattedAddress || '',
    // التصنيف يفصل «مسجد النور» عن «صيدلية النور» — والاسم وحده لا يفصلهما
    types: place.types || [],
  })).filter((hit) => typeof hit.lat === 'number' && typeof hit.lng === 'number');
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

function main() {
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const { records } = prepare(raw);

  const located = records.filter((row) => row.location);
  const missing = records.filter((row) => !row.location);

  /** نقاط المساجد المعلومة، مجمّعةً بالولاية — بها تُقاس معقولية المرشّح. */
  const byWilayat = new Map();
  for (const row of located) {
    const key = `${row.governorate}|${row.wilayat}`;
    if (!byWilayat.has(key)) byWilayat.set(key, []);
    byWilayat.get(key).push({ lat: row.location.latitude, lng: row.location.longitude });
  }

  if (reportOnly) {
    if (!fs.existsSync(OUT_FILE)) {
      console.log(`لا ملفّ تراكب بعد (${path.relative(process.cwd(), OUT_FILE)}).`);
      console.log(`المساجد المجهولة موقعُها: ${missing.length}`);
      return Promise.resolve();
    }
    const overlay = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
    const resolved = Object.keys(overlay.resolved || {}).length;
    console.log(`مُستخرَج: ${resolved} من ${missing.length}`);
    const reasons = new Map();
    for (const { reason } of overlay.rejected || []) {
      reasons.set(reason, (reasons.get(reason) || 0) + 1);
    }
    for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(count).padStart(4)}  ${reason}`);
    }
    return Promise.resolve();
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.error('✗ GOOGLE_MAPS_API_KEY غير مضبوط. ضعه في .env أو في البيئة.');
    console.error('  ويحتاج تفعيل Places API (New) على المشروع — والبحث النصّي مدفوع.');
    process.exit(1);
  }

  return resolveAll(missing.slice(0, limit), byWilayat, apiKey);
}

async function resolveAll(targets, byWilayat, apiKey) {
  console.log(`→ ${targets.length} مسجداً مجهول الموقع`);

  const resolved = {};
  const rejected = [];
  let failed = 0;

  for (const [index, row] of targets.entries()) {
    const key = `${row.governorate}|${row.wilayat}`;
    const known = byWilayat.get(key) || [];
    // مركز الولاية بالوسيط: نقطةٌ شاردة تسحب المتوسّط فيوجَّه البحث إلى فراغ
    const centre = known.length > 0
      ? { lat: median(known.map((p) => p.lat)), lng: median(known.map((p) => p.lng)) }
      : null;

    if (!centre) {
      rejected.push({ externalId: row.externalId, name: row.name, reason: 'لا مسجد معلوم في الولاية يُقاس إليه' });
      continue;
    }

    const query = [row.name, row.village, row.wilayat, 'عُمان'].filter(Boolean).join('، ');

    let candidates;
    try {
      candidates = await searchText(query, centre, apiKey);
    } catch (error) {
      // الفشل الشبكي ليس حكماً على المسجد: يُعدّ ولا يُكتب في المرفوض، فإعادة
      // التشغيل تحاوله من جديد
      failed += 1;
      console.error(`\n  ✗ ${row.name}: ${error.message}`);
      await sleep(1000);
      continue;
    }

    const verdict = chooseLocation(row, candidates, known);
    if (verdict.accepted) {
      resolved[row.externalId] = {
        ...verdict.accepted,
        name: row.name,
        wilayat: row.wilayat,
        governorate: row.governorate,
        query,
      };
    } else {
      rejected.push({
        externalId: row.externalId,
        name: row.name,
        wilayat: row.wilayat,
        reason: verdict.rejected,
        sawCandidates: candidates.length,
      });
    }

    if (index % 10 === 0) process.stdout.write(`\r  ${index + 1}/${targets.length}`);
    await sleep(120);
  }

  const found = Object.keys(resolved).length;

  // مفتاحٌ خاطئ أو شبكةٌ منقطعة تُخفق كلَّ الطلبات، والكتابة حينها تمحو تشغيلةً
  // ناجحةً سابقة وتضع مكانها ملفّاً فارغاً — خسارةٌ صامتة بكلفةٍ مدفوعة
  if (failed === targets.length && targets.length > 0) {
    console.error(`\n✗ أخفقت الطلبات كلُّها (${failed}). لم يُكتب شيء — تحقّق من المفتاح.`);
    process.exit(1);
  }

  fs.writeFileSync(OUT_FILE, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: 'Google Places API (New) — searchText',
    attempted: targets.length,
    resolvedCount: found,
    resolved,
    rejected,
  }, null, 2)}\n`, 'utf8');

  console.log(`\n✓ استُخرج ${found} من ${targets.length}`
    + `، ورُدّ ${rejected.length}${failed > 0 ? `، وأخفق ${failed} شبكياً` : ''}`);
  console.log(`  ${path.relative(process.cwd(), OUT_FILE)} — راجعه قبل الاستيراد.`);
}

main().catch((error) => {
  console.error('\n✗ فشل الاستخراج:', error.message);
  process.exit(1);
});
