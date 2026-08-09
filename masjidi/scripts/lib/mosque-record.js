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
const { stripTatweel } = require('../../cloud/lib/arabic');
const { assessCoordinates, withdrawUntrusted } = require('./coord-trust');

const OVERLAY_FILE = path.join(__dirname, '..', '..', 'data', 'resolved_locations.json');

/**
 * ما استُخرج من خرائط جوجل للمساجد المجهولة — إن وُجد.
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

  const records = rows.map((row) => {
    const judged = withdrawUntrusted(row, verdicts.get(row.externalId));
    if (judged.location) return { ...judged, locationSource: 'ministry' };

    // ما استُخرج من جوجل يملأ الفراغ وحده — لا ينسخ فوق إحداثيٍّ موثوق.
    // والمصدر يُقال، فمن يقرأ الحقل لاحقاً يعرف من أين جاء الموقع.
    const found = overlay[row.externalId];
    if (!found) return judged;
    return {
      ...judged,
      location: { __type: 'GeoPoint', latitude: found.lat, longitude: found.lng },
      hasLocation: true,
      locationSource: 'google',
      dataQuality: { ...(judged.dataQuality || {}), coordinates: 'resolved_from_places' },
    };
  });

  return { verdicts, records };
}

/**
 * الحقول الوصفية كما تُكتب في `Mosques`.
 *
 * لا تشمل الموقع ولا الحقول التشغيلية (الرصيد والملكية): الأوّل له تعامله عند
 * التحديث — لا يُمسح موقعٌ تعلّمه المسجد من إمامه — والثانية لا تُلمس أصلاً.
 */
function descriptiveFields(row) {
  return {
    externalId: row.externalId, // هويّة السجلّ: لا تُنظَّف ولا تُغيَّر
    mosqueNumber: row.mosqueNumber,
    name: stripTatweel(row.name),
    nameNormalized: stripTatweel(row.nameNormalized),
    nameTokens: tokenize(row.nameNormalized, row.village),
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
