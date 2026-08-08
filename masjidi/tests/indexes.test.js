/**
 * تطبيق الفهارس.
 *
 * كان `apply_schema.js` يتجاهل كتلة `indexes` كلّها ويعتذر بأن «Parse SDK لا
 * يديرها» — وهي تديرها منذ نسخ. النتيجة: ستة عشر فهرساً معلَناً وصفرٌ مطبَّق،
 * فكل استعلامٍ ضُبط ليستفيد من فهرسه كان يمسح المجموعة في الواقع.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { planIndexes, splitByKind, isSpatial } = require('../scripts/lib/index-plan');

const schema = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'cloud', 'schema.json'), 'utf8'),
);
const classOf = (name) => schema.classes.find((c) => c.className === name);

test('تخطيط الفهارس', async (t) => {
  await t.test('الموجود لا يُعاد تطبيقه', () => {
    const plan = planIndexes(
      { a: { x: 1 }, b: { y: 1 } },
      { a: { x: 1 }, _id_: { _id: 1 } },
    );
    assert.deepEqual(plan.map((entry) => entry.name), ['b']);
  });

  await t.test('غياب الفهارس أو الموجود لا يُسقط التخطيط', () => {
    assert.deepEqual(planIndexes(undefined, undefined), []);
    assert.deepEqual(planIndexes({}, null), []);
    assert.equal(planIndexes({ a: { x: 1 } }, null).length, 1);
  });

  await t.test('المكانيّ يُميَّز بقيمته النصّية لا باسمه', () => {
    assert.equal(isSpatial({ location: '2dsphere' }), true);
    assert.equal(isSpatial({ lat: 1, lng: 1 }), false,
      'صندوق الإحاطة ليس مكانياً — عدُّه كذلك يُسقط الفهرس الذي يعمل بلا PostGIS');
  });

  await t.test('المكانيّ يُفرز ليُطبَّق وحده', () => {
    const { plain, spatial } = splitByKind(planIndexes(classOf('Mosques').indexes, {}));

    assert.deepEqual(spatial.map((e) => e.name), ['geo']);
    assert.ok(plain.some((e) => e.name === 'geo_box'),
      'صندوق الإحاطة يجب أن يُطبَّق: عليه يقوم القرب حيث لا فهرس مكاني');
    assert.equal(plain.some((e) => e.spatial), false);
  });
});

test('فهارس المخطط', async (t) => {
  const declared = schema.classes.flatMap((c) =>
    Object.entries(c.indexes || {}).map(([name, spec]) => ({ cls: c.className, name, spec })));

  await t.test('كل فهرس يشير إلى حقول معرّفة في فئته', () => {
    const BUILT_IN = new Set(['createdAt', 'updatedAt', 'objectId']);
    for (const { cls, name, spec } of declared) {
      const fields = classOf(cls).fields;
      for (const key of Object.keys(spec)) {
        assert.ok(fields[key] || BUILT_IN.has(key),
          `${cls}.${name} يفهرس حقلاً غير معرّف: ${key} — فهرسٌ لا يُطبَّق أبداً`);
      }
    }
  });

  await t.test('الاستعلامات المضبوطة على الفهارس لها فهارسها', () => {
    const names = new Set(declared.map((entry) => `${entry.cls}.${entry.name}`));
    // كلٌّ منها ورد في مراجعة سابقة بوصفه «يستفيد من الفهرس»
    for (const required of ['Mosques.name_tokens', 'Mosques.name_search',
      'Mosques.geo_box', 'ServiceRequests.open_feed', 'AuditLog.trail']) {
      assert.ok(names.has(required), `${required} غاب فسقط ما بُني عليه`);
    }
  });

  await t.test('اسم الفهرس لا يَعِد بتفرّدٍ لا يفرضه', () => {
    for (const { cls, name } of declared) {
      assert.equal(/unique/i.test(name), false,
        `${cls}.${name}: Parse لا يعبّر عن التفرّد، فالاسم يَعِد بما لا يقع`);
    }
  });
});
