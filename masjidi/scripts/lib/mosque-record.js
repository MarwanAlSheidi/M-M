/**
 * تحضير سجلّ المسجد للاستيراد — المصدر الواحد لما يدخل القاعدة.
 *
 * **لماذا وُجد هذا الملفّ:** كان `seed_mosques.js` ومِرقاةُ اختبار التكامل
 * يكتبان الحقول كلٌّ على حدة. فحين طُبّق سحبُ الثقة من الإحداثيات على
 * الاستيراد وحده، صارت المِرقاة تزرع في القاعدة إحداثياتٍ لا يزرعها الاستيراد
 * أبداً — فالاختبار يتحقّق من بياناتٍ لا وجود لها في الإنتاج. وهي أخطر أنواع
 * الاختبار: خضراءُ عن شيءٍ آخر.
 *
 * والفرق بين الملفّ الخام وما يدخل القاعدة طبقتان، كلتاهما هنا:
 *
 *   1. **الحكم على الإحداثيات** (`coord-trust.js`) — يحتاج الملفّ كاملاً، فلا
 *      يصحّ أن يُحسب على شريحةٍ منه.
 *   2. **تنظيف النصّ** (`cloud/lib/arabic.js`) — تجريد التطويل من كل ما يُقرأ أو
 *      يُطابَق.
 *
 * و`data/mosques.json` يبقى سجلّاً أميناً لما أصدرته الوزارة (القاعدة 11 في
 * `CLAUDE.md`): الطبقتان فوقه لا فيه.
 */

const fs = require('fs');
const path = require('path');

const { tokenize } = require('./tokenize');
const { stripTatweel, normalizeArabic } = require('../../cloud/lib/arabic');
const { assessCoordinates, withdrawUntrusted } = require('./coord-trust');
const { nearestKm, PLAUSIBLE_KM } = require('./place-match');
const geo = require('../../cloud/lib/geo');

const OVERLAY_FILE = path.join(__dirname, '..', '..', 'data', 'resolved_locations.json');

/**
 * رقمٌ من مدخلةٍ محرَّرة بيد — أو `NaN`.
 *
 * `Number(null)` يساوي **صفراً** لا `NaN`، و`Number('')` كذلك. فحقلٌ حُذفت
 * قيمتُه في التحرير يصير إحداثيّ (0,0) — نقطةً في المحيط الأطلسي قبالة غانا،
 * وهي إحداثيٌّ «صالح» في كل فحصٍ للمدى. والمصادفةُ وحدها تُنجينا منها هنا
 * (تردّها قاعدةُ البُعد عن الولاية)، والاعتماد على المصادفة ليس فحصاً.
 */
const asNumber = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
};

/**
 * ما استُخرج من OpenStreetMap للمساجد المجهولة — إن وُجد.
 *
 * ملفٌّ اختياريّ: غيابه يعني أن `resolve_locations.js` لم يُشغَّل بعد، وهي
 * الحالة الافتراضية في مستودعٍ بلا مفتاح. ووجودُه لا يُلزم أحداً بشبكة —
 * الاستيراد يقرؤه كما يقرأ البيانات.
 */
function readOverlay(file = OVERLAY_FILE) {
  if (!fs.existsSync(file)) return {};
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return parsed.resolved || {};
}

/**
 * الملفّ الخام → سجلّات جاهزة للاستيراد، ومعها الحكم على كل إحداثيّ.
 *
 * يُمرَّر عليه **الملفّ كاملاً**: قاعدة «النقطة الواحدة في ولاياتٍ شتّى» لا
 * تُرى إلا فيه، فتصفيةُ المدخل قبل الحكم تُعمي عنها. صفِّ الناتج لا المدخل.
 */
function prepare(rows, overlay = readOverlay()) {
  const verdicts = assessCoordinates(rows);
  const judgedAll = rows.map((row) => withdrawUntrusted(row, verdicts.get(row.externalId)));

  /** نقاط المساجد الموثوقة، مجمّعةً بالولاية — بها يُعاد فحص التراكب. */
  const knownByWilayat = new Map();
  for (const row of judgedAll) {
    if (!row.location) continue;
    const key = `${row.governorate}|${row.wilayat}`;
    if (!knownByWilayat.has(key)) knownByWilayat.set(key, []);
    knownByWilayat.get(key).push({ lat: row.location.latitude, lng: row.location.longitude });
  }

  /**
   * فحصُ مدخلة التراكب من جديد عند الاستيراد.
   *
   * `resolve_locations.js` فحصها ساعةَ استخرجها، لكنّ الملفّ **يُراجَع بيدٍ
   * بشرية** قبل إيداعه — وهذا ما نوصي به صراحةً — وقد يُحرَّر. ومدخلةٌ محرَّرة
   * تُكتب في `Mosques.location` مباشرةً بلا مارٍّ آخر عليها: رقمان مقلوبان أو
   * فاصلةٌ زائدة تضع مسجداً في البحر.
   *
   * فيُعاد الفحص هنا بالقاعدة نفسها، كما يُعاد قياس طلب الإشراف لحظةَ اعتماده
   * لا لحظةَ تقديمه. **آخرُ من يلمس البيانات قبل القاعدة يفحصها.**
   */
  const acceptOverlay = (row, found) => {
    if (!found) return null;
    const lat = asNumber(found.lat);
    const lng = asNumber(found.lng);
    if (!geo.validCoordinates(lat, lng)) return { reason: 'إحداثيات غير صالحة' };

    const known = knownByWilayat.get(`${row.governorate}|${row.wilayat}`) || [];
    if (known.length === 0) return { reason: 'لا مسجد معلوم في الولاية يُقاس إليه' };
    if (nearestKm({ lat, lng }, known) > PLAUSIBLE_KM) {
      return { reason: `بعيد عن ولاية ${row.wilayat}` };
    }
    return { lat, lng };
  };

  const overlayRejected = [];
  const records = judgedAll.map((judged) => {
    // ما استُخرج من OSM يملأ الفراغ وحده — لا ينسخ فوق إحداثيٍّ موثوق.
    // والمصدر يُقال، فمن يقرأ الحقل لاحقاً يعرف من أين جاء الموقع.
    if (judged.location) return { ...judged, locationSource: 'ministry' };

    const verdict = acceptOverlay(judged, overlay[judged.externalId]);
    if (!verdict) return judged;
    if (verdict.reason) {
      overlayRejected.push({ externalId: judged.externalId, name: judged.name, ...verdict });
      return judged;
    }

    return {
      ...judged,
      location: { __type: 'GeoPoint', latitude: verdict.lat, longitude: verdict.lng },
      hasLocation: true,
      locationSource: 'osm',
      dataQuality: { ...(judged.dataQuality || {}), coordinates: 'resolved_from_osm' },
    };
  });

  return { verdicts, records, overlayRejected };
}

/**
 * الحقول الوصفية كما تُكتب في `Mosques`.
 *
 * لا تشمل الموقع ولا الحقول التشغيلية (الرصيد والإشراف): الأوّل له تعامله عند
 * التحديث — لا يُمسح موقعٌ تعلّمه المسجد من إمامه — والثانية لا تُلمس أصلاً.
 */
function descriptiveFields(row) {
  return {
    externalId: row.externalId, // هويّة السجلّ: لا تُنظَّف ولا تُغيَّر
    mosqueNumber: row.mosqueNumber,
    name: stripTatweel(row.name),
    nameNormalized: stripTatweel(row.nameNormalized),
    /*
     * **والنوع من كلمات البحث.**
     *
     * الاسم المخزَّن علَمٌ مجرَّد: «العلوية»، «المجيب». والنوع في حقلٍ آخر —
     * و**14,339 مسجداً من 18,214 نوعُها «مسجد»، ولا يحمل اسمَها الكلمةَ إلا
     * 10٪**. فمن يبحث عن مسجده كما يسمّيه («مسجد العلوية») يكتب كلمةً ليست في
     * الفهرس، و`containsAll` تشترط الكلَّ — فيُردّ بلا نتيجة واحدة.
     *
     * وقِيس على خادمٍ حقيقي بثلاثة آلاف مسجد:
     *
     *     بحث «العلوية»        → 2 نتيجة · وجده
     *     بحث «مسجد العلوية»   → **0 نتيجة**
     *
     * وأربعٌ من ستّ أنواعٍ جُرّبت أعطت صفراً تامّاً. وهذا أوّل باب المنصّة:
     * إمامٌ لا يجد مسجده لا يسجّله، ولا يصل إليه متطوّع.
     *
     * **والنوع يُطبَّع قبل أن يُفهرَس**: `normalizeArabic('مصلى')` تُعيد
     * `'مصلي'`، والاستعلام يُطبَّع كذلك — فلو أُضيف خاماً لَما طابق أبداً،
     * ولَبقي العطبُ قائماً بإصلاحٍ يبدو أنه وقع.
     *
     * ويجيء آخراً: سقف الكلمات اثنتا عشرة، وما يبلغه سجلّان من 18,214 — فلا
     * يُزاح اسمٌ من أجله، وإن أُزيح فالعلَم أولى بالبقاء.
     */
    nameTokens: tokenize(row.nameNormalized, row.village, normalizeArabic(row.type)),
    type: stripTatweel(row.type),
    typeSlug: row.typeSlug,
    governorate: stripTatweel(row.governorate),
    governorateSlug: row.governorateSlug,
    wilayat: stripTatweel(row.wilayat),
    village: stripTatweel(row.village),
    source: row.source,
    dataQuality: row.dataQuality,
  };
}

module.exports = { prepare, descriptiveFields, readOverlay, OVERLAY_FILE };
