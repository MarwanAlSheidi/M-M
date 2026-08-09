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

const { tokenize } = require('./tokenize');
const { stripTatweel } = require('../../cloud/lib/arabic');
const { assessCoordinates, withdrawUntrusted } = require('./coord-trust');

/**
 * الملفّ الخام → سجلّات جاهزة للاستيراد، ومعها الحكم على كل إحداثيّ.
 *
 * يُمرَّر عليه **الملفّ كاملاً**: قاعدة «النقطة الواحدة في ولاياتٍ شتّى» لا
 * تُرى إلا فيه، فتصفيةُ المدخل قبل الحكم تُعمي عنها. صفِّ الناتج لا المدخل.
 */
function prepare(rows) {
  const verdicts = assessCoordinates(rows);
  return {
    verdicts,
    records: rows.map((row) => withdrawUntrusted(row, verdicts.get(row.externalId))),
  };
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

module.exports = { prepare, descriptiveFields };
