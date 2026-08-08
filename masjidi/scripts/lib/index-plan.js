/**
 * تخطيط الفهارس: ما ينقص منها، وأيّها مكانيّ.
 *
 * مفصول عن `apply_schema.js` ليكون قابلاً للاختبار بلا خادم — فالفهارس هي
 * الفرق بين استعلامٍ يقرأ سطراً وآخر يمسح ثمانية عشر ألفاً، ولا يجوز أن يبقى
 * تطبيقها بلا تغطية.
 */

/**
 * الفهرس المكاني يُعرَّف بقيمة نصّية (`"2dsphere"`) لا برقم اتجاه.
 * يُفرز لأنه يفشل حيث لا امتداد مكاني — PostgreSQL بلا PostGIS مثلاً — وفشله
 * يجب ألّا يُسقط بقية الفهارس معه.
 */
const isSpatial = (spec) => Object.values(spec).some((value) => typeof value === 'string');

/**
 * @param {object} declared فهارس الفئة كما في `schema.json`
 * @param {object} existing فهارس الفئة كما يعيدها `schema.get()`
 * @returns {{name: string, spec: object, spatial: boolean}[]} الناقص فقط
 */
function planIndexes(declared, existing) {
  const present = existing || {};
  return Object.entries(declared || {})
    .filter(([name]) => !present[name])
    .map(([name, spec]) => ({ name, spec, spatial: isSpatial(spec) }));
}

/** الناقص مرتّباً: العاديّ أولاً ليُطبَّق دفعةً، ثم المكانيّ كلٌّ على حدة. */
function splitByKind(plan) {
  return {
    plain: plan.filter((entry) => !entry.spatial),
    spatial: plan.filter((entry) => entry.spatial),
  };
}

module.exports = { planIndexes, splitByKind, isSpatial };
