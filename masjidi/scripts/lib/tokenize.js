/**
 * كلمات الاسم والقرية للبحث المفهرس.
 *
 * تُحسب عند الاستيراد لا في `clean_mosques.py`: مشتقّة بالكامل من
 * `nameNormalized` الموجود أصلاً، فحسابها هنا يُجنّب إعادة توليد 11 ميغابايت من
 * البيانات لأجل حقل مشتقّ. الكلمات القصيرة تُستبعد لأنها أدوات لا تُميّز.
 *
 * مشتركة بين `seed_mosques.js` واختبار التكامل: لو انفصلتا لصار اختبار البحث
 * يتحقّق من كلماتٍ ليست هي التي تُستورَد فعلاً.
 */
const { stripTatweel } = require('../../cloud/lib/arabic');

function tokenize(...values) {
  const words = values
    .filter(Boolean)
    // التطويل زخرفةٌ لا معنى: «زايــد» و«زايد» كلمةٌ واحدة، فلا تكونان كلمتَي
    // بحثٍ مختلفتين. والتجريد هنا يُبقي المِرقاة والاستيراد متطابقَين بلا اتفاق.
    .flatMap((value) => stripTatweel(String(value)).split(/\s+/))
    .map((word) => word.trim())
    .filter((word) => word.length >= 2);

  return [...new Set(words)].slice(0, 12);
}

module.exports = { tokenize };
