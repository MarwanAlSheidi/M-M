/**
 * قبولُ موقعٍ من خرائط جوجل — أو ردُّه.
 *
 * 430 مسجداً بلا موقعٍ يُوثق به، وانتظارُ أن يقف عندها أئمّتها يؤخّرها إلى أجلٍ
 * غير معلوم. ومواقع المساجد موجودة في خرائط جوجل بأسمائها، فهي المصدر المتاح.
 *
 * **لكن نتيجة جوجل مرشَّحٌ لا حقيقة.** هذا هو الدرس الذي كلّفنا 414 إحداثياً
 * كاذباً في بيانات الوزارة: مصدرٌ رسميٌّ أُخذ على علّاته. ولو أخذنا أوّل نتيجةٍ
 * يردّها البحث لوقعنا فيه من بابٍ آخر — «مصلى العيدين» في الولاية الواحدة
 * سبعةٌ وثمانون، فأيُّها مسجدُنا؟ **وموقعٌ خاطئ يقود الناس ضلالاً، ومجهولٌ
 * صدق.**
 *
 * فلا يُقبل المرشّح إلا باجتماع أربعة:
 *
 *   1. **هو بيت صلاةٍ واسمُه يطابق** — تصنيف جوجل يقول مسجداً، أو اسمُه يقوله؛
 *      ثم كلماتُ اسمنا المميِّزة كلُّها في اسمه. و«مسجد» و«جامع» و«مصلى» لا
 *      تميّز شيئاً فتُطرح من المقارنة — ولذلك لزم شرط بيت الصلاة قبلها،
 *      وإلا طابقت «صيدلية النور» مسجدَ النور.
 *   2. **الموضع معقول، وهو في ولايتنا لا في جارتها** — قريبٌ من مساجد ولايته
 *      المعلومة (القاعدة المقيسة في `cloud/functions/mosques.js`: أقصى بُعدٍ
 *      بين مسجدٍ وأقرب جارٍ له في ولايته 73.4 كم، فثمانون فوق أقصى الواقع)،
 *      **وأقربُ مسجدٍ معلومٍ إليه من ولايتنا لا من غيرها**. فالثمانون حاجزٌ
 *      أمام الكوارث (850 كم) لا فاصلٌ بين ولايتين متجاورتين، والأسماء تتكرّر
 *      عبر الحدود: «الغفار جل جلاله» في صلالة وفي رخيوت، وبينهما 74 كم.
 *   3. **الموضع غير مأخوذ** — ليس على مسجدٍ نعرف موقعه أصلاً، **في أيّ ولاية**.
 *      وإلا نسخنا إحداثيَّ جارِه فصار مسجدان في نقطةٍ واحدة — وهو عين العطب
 *      الذي خرجنا منه. والحدود الإدارية لا تعني الخرائط شيئاً: «الحجرة» في
 *      منح و«الحجرة» في سمائل اسمان متطابقان لمسجدين متجاورين، والفحص داخل
 *      الولاية وحدها يُجيز نسخَ أحدهما فوق الآخر.
 *   4. **لا لبس** — مرشّحٌ واحدٌ يجتاز الثلاثة. فإن اجتازها اثنان فنحن لا نعرف
 *      أيُّهما، والتخمين هنا كذبٌ مُوثَّق.
 *
 * وما رُدّ يبقى مجهول الموقع، وسببُ ردّه مكتوبٌ ليُراجَع.
 */

const geo = require('../../cloud/lib/geo');
const { normalizeArabic } = require('../../cloud/lib/arabic');

/** كلماتٌ في كل اسمٍ تقريباً، فلا تميّز مسجداً عن آخر. */
const GENERIC = new Set(['مسجد', 'جامع', 'مصلي', 'مصلى', 'بن', 'ابن', 'ال', 'في']);

/** ما يدلّ على أن المكان مسجدٌ أصلاً — بالكلمة أو بتصنيف جوجل. */
const WORSHIP_WORDS = ['مسجد', 'جامع', 'مصلي'];
const WORSHIP_TYPES = ['mosque', 'place_of_worship'];

/** أبعد ما يُقبل بين المرشّح وأقرب مسجدٍ معلومٍ في ولايته — مقيسٌ لا مُخمَّن. */
const PLAUSIBLE_KM = 80;

/** ما دونه يُعدّ المرشّح واقعاً على مسجدٍ نعرفه، لا على مسجدنا المجهول. */
const TAKEN_KM = 0.15;

/** كلمات الاسم المميِّزة — مطبَّعةً، بلا العامّ ولا الحرف الواحد. */
function distinctiveWords(name) {
  return normalizeArabic(name || '')
    .split(' ')
    .filter((word) => word.length >= 2 && !GENERIC.has(word));
}

/**
 * أيُطابق اسمُ المرشّح اسمَنا؟
 *
 * الشرط في اتجاهٍ واحد: كلماتُنا المميِّزة كلُّها فيه. فاسم جوجل أطول عادةً
 * («جامع السلطان قابوس الأكبر») ولا يضرّ زيادتُه، أمّا نقصُ كلمةٍ من اسمنا
 * فيعني مسجداً آخر.
 */
function nameMatches(ours, theirs) {
  const mine = distinctiveWords(ours);
  if (mine.length === 0) return false; // اسمٌ كلُّه عامّ لا يُطابَق به شيء
  const words = new Set(distinctiveWords(theirs));
  return mine.every((word) => words.has(word));
}

/**
 * أهو مسجدٌ أصلاً؟
 *
 * المطابقة بالكلمات المميِّزة وحدها لا تكفي: «صيدلية النور» تحمل كلمة «النور»
 * كما يحملها «مسجد النور»، فتجتاز المطابقة. ولو كانت وحدها في النتائج لصار
 * موقع الصيدلية موقعَ المسجد — وهو الخطأ الذي نتحاماه كلَّه.
 *
 * فيُشترط دليلٌ على أنه بيت صلاة: تصنيف جوجل إن ورد، وإلا فكلمةٌ في اسمه.
 */
function isWorshipPlace(candidate) {
  const types = candidate.types || [];
  if (types.length > 0) return types.some((type) => WORSHIP_TYPES.includes(type));

  const words = normalizeArabic(candidate.name || '').split(' ');
  return words.some((word) => WORSHIP_WORDS.includes(word));
}

/** أقصر مسافةٍ بين نقطةٍ وقائمة نقاط، أو `Infinity` إن خلت. */
function nearestKm(point, points) {
  let best = Infinity;
  for (const other of points) {
    const km = geo.distanceKm(point.lat, point.lng, other.lat, other.lng);
    if (km < best) best = km;
  }
  return best;
}

/**
 * الحكم على مرشّحي مسجدٍ واحد.
 *
 * @param {object}  mosque        سجلّ المسجد المجهول موقعه (يلزم منه `name`)
 * @param {Array}   candidates    نتائج جوجل: `{ name, lat, lng, types }`
 * @param {Array}   knownInWilayat نقاط المساجد المعلومة في الولاية نفسها
 * @param {Array}   [otherNearby]  معلومُ الولايات المجاورة — لفحص «مأخوذ» و«لمن هو»
 * @returns {{ accepted?: object, rejected?: string }}
 */
function chooseLocation(mosque, candidates, knownInWilayat, otherNearby = []) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { rejected: 'لا نتيجة من جوجل' };
  }
  if (knownInWilayat.length === 0) {
    // بلا مساجد معلومة في الولاية لا مقياسَ للمعقولية. وقبولُ المرشّح بلا
    // قياسٍ يعيدنا إلى أخذ المصدر على علّاته.
    return { rejected: 'لا مسجد معلوم في الولاية يُقاس إليه' };
  }

  const worship = candidates.filter(isWorshipPlace);
  if (worship.length === 0) return { rejected: 'لا نتيجة هي بيت صلاة' };

  const named = worship.filter((hit) => nameMatches(mosque.name, hit.name));
  if (named.length === 0) return { rejected: 'لا اسم يطابق' };

  const plausible = named.filter((hit) => nearestKm(hit, knownInWilayat) <= PLAUSIBLE_KM);
  if (plausible.length === 0) return { rejected: 'كلّها بعيدة عن الولاية' };

  // الفحص على الجوار كلِّه لا على الولاية وحدها: نقطةٌ مأخوذة مأخوذةٌ أياً كانت
  // ولاية صاحبها. جرّبتُ الأولى فقبلَت 24 موقعاً من 32 كلُّها على بُعد صفرٍ من
  // مسجدٍ معلومٍ في الولاية المجاورة — أي أنها نسخُ مساجدَ أخرى لا اكتشافُ مسجدنا.
  const everyone = [...knownInWilayat, ...otherNearby];
  const free = plausible.filter((hit) => nearestKm(hit, everyone) > TAKEN_KM);
  if (free.length === 0) return { rejected: 'الموضع مأخوذ بمسجدٍ معلوم' };

  // ولمن هذا الموضع؟ أقربُ مسجدٍ معلومٍ إليه يقول في أيّ ولاية هو. فإن كان من
  // ولايةٍ أخرى فالموضع هناك لا هنا، والاسمُ تكرّر عبر الحدود لا أكثر.
  const ours = free.filter((hit) => nearestKm(hit, knownInWilayat) <= nearestKm(hit, otherNearby));
  if (ours.length === 0) return { rejected: 'الموضع في ولايةٍ أخرى' };

  if (ours.length > 1) {
    return { rejected: `مرشّحون متعدّدون (${ours.length}) — لا يُعرف أيُّهم` };
  }

  const [hit] = ours;
  return {
    accepted: {
      lat: hit.lat,
      lng: hit.lng,
      placeName: hit.name,
      nearestKnownKm: Math.round(nearestKm(hit, knownInWilayat) * 1000) / 1000,
    },
  };
}

module.exports = {
  chooseLocation, nameMatches, isWorshipPlace, distinctiveWords, nearestKm,
  PLAUSIBLE_KM, TAKEN_KM, GENERIC, WORSHIP_TYPES,
};
