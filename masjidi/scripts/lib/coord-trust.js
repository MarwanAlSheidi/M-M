/**
 * الحكم على إحداثيات المساجد: أيّها يُوثق به وأيّها كذبةٌ صريحة.
 *
 * لماذا لا يكفي `clean_mosques.py`؟ لأنه ينظّف **صفاً صفاً**: يردّ الإحداثيات
 * المقلوبة، ويرفض ما خرج عن حدود عُمان، ويعلّم ما لا إحداثيات له. وكل ذلك
 * حكمٌ على الصفّ وحده. أمّا العطب الأكبر في بيانات الوزارة فلا يُرى إلا حين
 * تُنظر السجلّات **جملةً**:
 *
 *   • النقطة 23.59768,58.42077 تحمل 154 مسجداً في 45 ولاية مختلفة. نقطةٌ واحدة
 *     لا تكون في خمسٍ وأربعين ولاية — فهي قيمةٌ افتراضية وُضعت مكان المجهول.
 *     كل صفٍّ منها يجتاز فحص الحدود وحده، ولا يفتضحه إلا جاره.
 *   • مساجد في «منح» بالداخلية إحداثياتها في **دبي**، وفي «الحمراء» إحداثيات
 *     في عرض الخليج. داخل الصندوق الفضفاض لعُمان، وخارج ولايتها بمئات الأميال.
 *
 * وأثر ذلك ليس تجميلياً: موقع المسجد هو ما يربط المصلّي بمسجده. مسجدٌ في
 * صلالة موضوعٌ في مسقط يظهر لمتطوّعٍ في مسقط على بُعد نصف كيلومتر، ويختفي عن
 * أهله في صلالة. أربعمئة مسجدٍ وأربعة عشر — 2.27٪ — على هذه الحال.
 *
 * والعلاج: لا نخمّن الموقع الصحيح، بل **نسحب ثقتنا** من الخاطئ. المسجد يعود
 * «مجهول الموقع» كإخوته الذين لا إحداثيّ لهم أصلاً: يبقى في البحث بالاسم، ويجيء في ذيل قائمة
 * القرب لا في رأسها كذباً، ويتعلّم موقعه الحقيقي حين يسجّله إمامه من عنده
 * (انظر `reviewMosqueClaim`). موقعٌ مجهول صدقٌ، وموقعٌ خاطئ يقود الناس ضلالاً.
 */

const geo = require('../../cloud/lib/geo');

/** دقّة المقارنة بين نقطتين: خمس منازل ≈ متر واحد. */
const PRECISION = 5;

/** عددٌ من المساجد على نقطةٍ واحدة داخل ولاية واحدة يتجاوز الصدفة. */
const IDENTICAL_IN_ONE_WILAYAT = 5;

/** أقلّ عدد مساجد في ولاية حتى يصحّ حساب مركزها وانتشارها. */
const MIN_FOR_CLUSTER = 5;

/** أرضيةٌ للمسافة الشاذّة: دونها لا نتّهم إحداثياً مهما ضاقت الولاية. */
const OUTLIER_FLOOR_KM = 50;

/** مضاعف الانتشار: الشاذّ أبعد من مركز ولايته بعشرة أضعاف انتشارها المعتاد. */
const OUTLIER_SPREAD_FACTOR = 10;

const pointKey = (row) => `${row.location.latitude.toFixed(PRECISION)},`
  + `${row.location.longitude.toFixed(PRECISION)}`;

const wilayatKey = (row) => `${row.governorate}|${row.wilayat}`;

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const groupBy = (rows, keyOf) => {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
};

/**
 * الحكم على كل سجلّ له إحداثيات.
 *
 * يُمرَّر عليه **الملفّ كاملاً** لا محافظةً منه: القاعدة الأولى تقوم على رؤية
 * النقطة الواحدة في ولاياتٍ شتّى، فتصفيةُ المدخل قبل الحكم تُعمي عنها.
 *
 * @param {Array} rows سجلّات المساجد كما في `data/mosques.json`
 * @returns {Map<string, {trust: string, reason: string}>} لغير الموثوق فقط
 */
function assessCoordinates(rows) {
  const located = rows.filter((row) => row.hasLocation && row.location);
  const verdicts = new Map();

  // (1) القيمة الافتراضية: نقطةٌ يتشاركها مسجدان في ولايتين، أو خمسةٌ في ولاية
  for (const [, atPoint] of groupBy(located, pointKey)) {
    if (atPoint.length < 2) continue;
    const wilayat = new Set(atPoint.map(wilayatKey));
    if (wilayat.size > 1) {
      for (const row of atPoint) {
        verdicts.set(row.externalId, {
          trust: 'placeholder',
          // صيغة «تسمية: عدد» تتفادى مطابقة المعدود بالعربية، وهي تتغيّر بتغيّر
          // العدد (مسجدان/مساجد/مسجداً) والعدد هنا متغيّر لا يُعرف مسبقاً
          reason: `النقطة نفسها مشتركة — مساجد: ${atPoint.length}، ولايات: ${wilayat.size}`,
        });
      }
    } else if (atPoint.length >= IDENTICAL_IN_ONE_WILAYAT) {
      for (const row of atPoint) {
        verdicts.set(row.externalId, {
          trust: 'placeholder',
          reason: `النقطة نفسها مشتركة داخل ولاية ${row.wilayat} — مساجد: ${atPoint.length}`,
        });
      }
    }
  }

  // (2) الشاذّ عن عنقود ولايته. يُحسب المركز بعد استبعاد ما حُكم عليه في (1)،
  // وإلا جذبت النقطةُ الافتراضية المركزَ إليها فبرّأت نفسها واتّهمت الصحيح.
  const trusted = located.filter((row) => !verdicts.has(row.externalId));
  for (const [, inWilayat] of groupBy(trusted, wilayatKey)) {
    if (inWilayat.length < MIN_FOR_CLUSTER) continue;

    // الوسيط لا المتوسّط: نقطةٌ شاردة تسحب المتوسّط إليها فيصير المركز خطأً
    const centreLat = median(inWilayat.map((row) => row.location.latitude));
    const centreLng = median(inWilayat.map((row) => row.location.longitude));
    const distances = inWilayat.map((row) => geo.distanceKm(
      centreLat, centreLng, row.location.latitude, row.location.longitude,
    ));

    // الانتشار المعتاد للولاية نفسها: «ثمريت» صحراءُ مترامية و«منح» قريةٌ
    // مجتمعة، فعتبةٌ واحدة بالكيلومترات تظلم إحداهما أو تُعمي عن الأخرى
    const threshold = Math.max(OUTLIER_FLOOR_KM, OUTLIER_SPREAD_FACTOR * median(distances));

    inWilayat.forEach((row, index) => {
      if (distances[index] <= threshold) return;
      verdicts.set(row.externalId, {
        trust: 'outlier',
        reason: `بعيد عن مركز ولاية ${row.wilayat} — ${Math.round(distances[index])} كم`,
      });
    });
  }

  return verdicts;
}

/**
 * نسخةٌ من السجلّ بلا الإحداثيات التي لا يُوثق بها.
 *
 * لا يُمسّ السجلّ الأصلي: `data/mosques.json` سجلٌّ أمينٌ لما أصدرته الوزارة،
 * وحكمُنا عليه طبقةٌ فوقه لا تصحيحٌ له.
 */
function withdrawUntrusted(row, verdict) {
  if (!verdict) return row;
  return {
    ...row,
    location: null,
    hasLocation: false,
    dataQuality: {
      ...(row.dataQuality || {}),
      coordinates: verdict.trust,
      coordinatesReason: verdict.reason,
    },
  };
}

module.exports = {
  assessCoordinates,
  withdrawUntrusted,
  PRECISION,
  IDENTICAL_IN_ONE_WILAYAT,
  MIN_FOR_CLUSTER,
  OUTLIER_FLOOR_KM,
  OUTLIER_SPREAD_FACTOR,
};
