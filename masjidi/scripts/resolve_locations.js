#!/usr/bin/env node
/**
 * استخراج مواقع المساجد المجهولة من OpenStreetMap — **بلا مفتاح وبلا فاتورة**.
 *
 * 430 مسجداً بلا موقعٍ يُوثق به — ستة عشر بلا إحداثيّ في بيانات الوزارة، و414
 * سُحبت ثقتنا من إحداثيّها الكاذب. وأهلها خارج البحث بالقرب وفرصهم في ذيل
 * القائمة. وانتظارُ أن يقف عندها أئمّتها يؤخّرها إلى أجلٍ غير معلوم.
 *
 * **لماذا OSM لا خرائط جوجل:** البحث النصّي في Places مدفوعٌ بالطلب — 430 طلباً
 * تعني فاتورة. وOpenStreetMap مفتوحة بترخيص ODbL: تنزيلٌ واحد مجاني يأتي بكل
 * مساجد السلطنة دفعةً واحدة، ثم تجري المطابقة **على الجهاز** بلا شبكة. فلا
 * مفتاح، ولا حساب، ولا عدّاد طلبات — وإعادة التشغيل لا تكلّف شيئاً.
 *
 * والترخيص يشترط النسبة: «© مساهمو OpenStreetMap» — وهي مكتوبة في كل ملفٍّ
 * يُخرجه هذا السكربت.
 *
 * **ولا يكتب في القاعدة.** يُخرج ملفّ تراكبٍ مراجَعاً — `data/resolved_locations.json`
 * — يقرؤه الاستيراد، ويُعيد فحصه قبل أن يكتبه.
 *
 * وقواعد القبول في `lib/place-match.js` — نتيجةُ أي مصدرٍ مرشَّحٌ لا حقيقة.
 *
 *   node scripts/resolve_locations.js --fetch     # التنزيل: الخطوة الوحيدة التي تحتاج شبكة
 *   node scripts/resolve_locations.js             # المطابقة، بلا شبكة
 *   node scripts/resolve_locations.js --report    # ماذا خرج ولماذا رُدّ
 */

const fs = require('fs');
const path = require('path');

const { prepare } = require('./lib/mosque-record');
const { chooseLocation, PLAUSIBLE_KM } = require('./lib/place-match');
const geo = require('../cloud/lib/geo');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'mosques.json');
const OSM_FILE = path.join(DATA_DIR, 'osm-mosques.json');
const OUT_FILE = path.join(DATA_DIR, 'resolved_locations.json');

/**
 * مرايا Overpass — تُجرَّب بالترتيب.
 *
 * الخدمة تطوّعية ومجانية، وقد تكون إحداها مثقلةً أو محجوبة عنك. والتنزيل مرّةٌ
 * واحدة لا تتكرّر، فلا يُثقلها هذا.
 */
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
];

/** كل بيوت الصلاة الإسلامية داخل حدود سلطنة عُمان. */
const QUERY = `[out:json][timeout:180];
area["ISO3166-1"="OM"][admin_level=2]->.oman;
nwr["amenity"="place_of_worship"]["religion"="muslim"](area.oman);
out center tags;`;

/** أقلّ عددٍ يُصدَّق: أقلُّ منه يعني استعلاماً بُتر أو حدوداً لم تُطابَق. */
const MIN_SANE = 200;

const args = process.argv.slice(2);
const fetchOnly = args.includes('--fetch');
const reportOnly = args.includes('--report');

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/**
 * ردُّ Overpass → نقاطٌ مُقلَّمة إلى ما نحتاجه: اسمٌ وإحداثيّ.
 *
 * منفصلةٌ عن التنزيل قصداً: **الشبكة محجوبة في بيئة تطوير هذا المستودع**، فلا
 * سبيل إلى تشغيل `--fetch` هنا. وأكثرُ ما يُخطئ في مثل هذا هو شكلُ العنصر —
 * فـ`node` يحمل `lat`/`lon` مباشرةً، و`way` و`relation` يحملانهما في `center`
 * (ولا يحملانهما إطلاقاً بلا `out center`). فصارت هذه دالّةً نقيّةً تحت
 * الاختبار، ليبقى خارج التغطية النقلُ وحده لا الفهم.
 */
function parseOverpass(body) {
  return (body.elements || [])
    .map((element) => {
      const tags = element.tags || {};
      const centre = element.center || {};
      return {
        // `name:ar` أدقّ حين يوجد: كثيرٌ من المساجد مسجَّلٌ بالإنجليزية أيضاً
        name: tags['name:ar'] || tags.name || '',
        lat: element.lat != null ? element.lat : centre.lat,
        lng: element.lon != null ? element.lon : centre.lon,
      };
    })
    // بلا اسمٍ لا مطابقة، وبلا إحداثيٍّ لا موقع — وكلاهما يقع في OSM
    .filter((place) => place.name && geo.validCoordinates(place.lat, place.lng));
}

/** تنزيلٌ واحد، مُقلَّمٌ إلى ما نحتاجه: اسمٌ ونقطة. */
async function download() {
  let lastError = null;

  for (const mirror of MIRRORS) {
    process.stdout.write(`→ ${new URL(mirror).host} … `);
    try {
      const response = await fetch(mirror, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: QUERY }),
      });
      if (!response.ok) throw new Error(`ردّ ${response.status}`);

      const places = parseOverpass(await response.json());

      console.log(`${places.length} مسجداً`);
      // ملفٌّ ناقصٌ أسوأ من لا ملفّ: المطابقة عليه تردّ الجميع بلا سببٍ ظاهر
      if (places.length < MIN_SANE) {
        throw new Error(`العدد أقلّ من أن يكون صحيحاً (${places.length})`);
      }

      fs.writeFileSync(OSM_FILE, `${JSON.stringify({
        fetchedAt: new Date().toISOString(),
        source: 'OpenStreetMap via Overpass API',
        licence: 'ODbL — © مساهمو OpenStreetMap',
        mirror,
        count: places.length,
        places,
      }, null, 2)}\n`, 'utf8');

      console.log(`✓ ${path.relative(process.cwd(), OSM_FILE)}`);
      return;
    } catch (error) {
      console.log(`أخفقت (${error.message})`);
      lastError = error;
    }
  }

  throw new Error(`تعذّر التنزيل من كل المرايا. آخر خطأ: ${lastError && lastError.message}`);
}

/**
 * تضييق نقاط OSM إلى محيط كل ولاية.
 *
 * ليس تحسيناً للسرعة وحده: «مصلى العيدين» اسمٌ لـ369 مسجداً في السلطنة،
 * فمطابقةُ الاسم على القائمة كلّها تعطي عشرات المرشّحين فيُردّ الكلُّ للبس.
 * والتضييق يترك مرشّحي الولاية وحدهم — وهم من يُحتمل أن يكون مسجدُنا فيهم.
 */
function candidatesByWilayat(places, knownByWilayat, allKnown) {
  const scoped = new Map();
  const nearby = new Map();
  const inBox = (box, point) => point.lat >= box.minLat && point.lat <= box.maxLat
    && point.lng >= box.minLng && point.lng <= box.maxLng;

  for (const [key, known] of knownByWilayat) {
    const centre = { lat: median(known.map((p) => p.lat)), lng: median(known.map((p) => p.lng)) };
    const box = geo.boundingBox(centre.lat, centre.lng, PLAUSIBLE_KM);

    scoped.set(key, places
      .filter((place) => inBox(box, place))
      // كلّها بيوت صلاة — الاستعلام لم يجلب غيرها، والوسم يُقال صراحةً
      .map((place) => ({ ...place, types: ['mosque'] })));

    // معلومُ الولايات **الأخرى** في الصندوق: به يُفحص «مأخوذ» و«لمن هذا الموضع».
    // والحدود الإدارية لا تعني الخرائط شيئاً، لكنها تعني أيَّ مسجدٍ نتكلّم عنه.
    nearby.set(key, allKnown.filter((point) => point.key !== key && inBox(box, point)));
  }

  return { scoped, nearby };
}

/** المطابقة — محليّةٌ بالكامل، بلا شبكة. */
function match() {
  if (!fs.existsSync(OSM_FILE)) {
    console.error(`✗ لا ملفّ OSM بعد. شغّل أوّلاً: node ${path.basename(__filename)} --fetch`);
    process.exit(1);
  }

  const { places } = readJson(OSM_FILE);
  const { records } = prepare(readJson(DATA_FILE), {}); // بلا تراكبٍ سابق: نحن نولّده
  const located = records.filter((row) => row.location);
  const missing = records.filter((row) => !row.location);

  console.log(`→ ${missing.length} مسجداً مجهول الموقع، و${places.length} نقطة في OSM`);

  const knownByWilayat = new Map();
  for (const row of located) {
    const key = `${row.governorate}|${row.wilayat}`;
    if (!knownByWilayat.has(key)) knownByWilayat.set(key, []);
    knownByWilayat.get(key).push({ lat: row.location.latitude, lng: row.location.longitude });
  }

  const allKnown = located.map((row) => ({
    lat: row.location.latitude,
    lng: row.location.longitude,
    key: `${row.governorate}|${row.wilayat}`,
  }));
  const { scoped, nearby } = candidatesByWilayat(places, knownByWilayat, allKnown);
  const resolved = {};
  const rejected = [];

  for (const row of missing) {
    const key = `${row.governorate}|${row.wilayat}`;
    const verdict = chooseLocation(
      row, scoped.get(key) || [], knownByWilayat.get(key) || [], nearby.get(key) || [],
    );

    if (verdict.accepted) {
      resolved[row.externalId] = {
        ...verdict.accepted,
        name: row.name,
        wilayat: row.wilayat,
        governorate: row.governorate,
      };
    } else {
      rejected.push({
        externalId: row.externalId,
        name: row.name,
        wilayat: row.wilayat,
        reason: verdict.rejected,
        sawCandidates: (scoped.get(key) || []).length,
      });
    }
  }

  fs.writeFileSync(OUT_FILE, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: 'OpenStreetMap via Overpass API',
    licence: 'ODbL — © مساهمو OpenStreetMap',
    attempted: missing.length,
    resolvedCount: Object.keys(resolved).length,
    resolved,
    rejected,
  }, null, 2)}\n`, 'utf8');

  console.log(`  ${path.relative(process.cwd(), OUT_FILE)} — راجعه قبل الاستيراد.`);
  report();
}

function report() {
  if (!fs.existsSync(OUT_FILE)) {
    const { records } = prepare(readJson(DATA_FILE), {});
    console.log('لا ملفّ تراكب بعد.');
    console.log(`المساجد المجهولة موقعُها: ${records.filter((row) => !row.location).length}`);
    return;
  }

  const overlay = readJson(OUT_FILE);
  console.log(`\n✓ استُخرج ${overlay.resolvedCount} من ${overlay.attempted}`
    + `، ورُدّ ${(overlay.rejected || []).length}`);

  const reasons = new Map();
  for (const { reason } of overlay.rejected || []) {
    // الأعداد داخل السبب تُوحَّد حتى لا يصير كل عددٍ سطراً في التقرير
    const key = reason.replace(/\(\d+\)/, '(…)');
    reasons.set(key, (reasons.get(key) || 0) + 1);
  }
  if (reasons.size > 0) console.log('أسباب الردّ:');
  for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}  ${reason}`);
  }
}

async function main() {
  if (reportOnly) return report();
  if (fetchOnly) return download();
  return match();
}

// تُصدَّر للاختبار وحده — السكربت يعمل بالتشغيل المباشر لا بالاستيراد
module.exports = { parseOverpass, candidatesByWilayat, QUERY, MIRRORS, MIN_SANE };

if (require.main === module) {
  main().catch((error) => {
    console.error('\n✗ فشل:', error.message);
    process.exit(1);
  });
}
