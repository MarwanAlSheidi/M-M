/**
 * محمولية الاستعلامات بين محوّلَي MongoDB وPostgreSQL.
 *
 * **لماذا يلزم هذا الملفّ:** الاختبارات كلّها تعمل على PostgreSQL، وBack4app
 * يعمل على MongoDB. وقد كشف هذا الفرق خللين فعليّين حتى الآن — `equalTo` على
 * حقل مصفوفة، والفهارس المكانية — وكلاهما مرّ في الاختبار وسقط على خادم حقيقي.
 *
 * ولا سبيل إلى تشغيل MongoDB في بيئة التطوير هذه (منافذ التنزيل محجوبة). فبدل
 * ادّعاء تغطيةٍ غير موجودة، هذا **سلكُ تعثّر**: يمسح `cloud/` ويرفض أي صيغة
 * استعلام لم تُراجَع محموليتها. لا يُثبت أن الموجود يعمل على MongoDB — يمنع
 * أن يدخل جديدٌ بلا قرار.
 *
 * حين تُضيف صيغةً جديدة سيسقط هذا الاختبار. لا تُضِفها إلى القائمة لتسكيته:
 * ابحث عن سلوكها في المحوّلين، ثم أضِفها بملاحظتها أو استبدلها.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CLOUD = path.join(__dirname, '..', 'cloud');

/** صيغ راجعتُ سلوكها في المحوّلين، ولكلٍّ سبب بقائها. */
const REVIEWED = {
  equalTo: 'محمولة — إلا على حقل مصفوفة، فمحوّل PostgreSQL يرمي. البديل containsAll، ويحرسه البديل في الذاكرة.',
  notEqualTo: 'محمولة — تُترجَم إلى $ne في المحوّلين، ولا تُطابِق الحقل الغائب في أيّهما.',
  greaterThan: 'محمولة — المقارنة العددية والزمنية متطابقة في المحوّلين.',
  lessThan: 'محمولة — كنظيرتها، وعليها يقوم تقليم السجلّ بالتاريخ.',
  greaterThanOrEqualTo: 'محمولة — وعليها يقوم صندوق الإحاطة في lib/geo.js.',
  lessThanOrEqualTo: 'محمولة — الطرف الآخر من صندوق الإحاطة.',
  containedIn: 'محمولة — $in في المحوّلين، وعليها يقوم فرز الحالات في الاستعلامات.',
  containsAll: 'محمولة — $all على MongoDB، ويخدمها فهرس المصفوفة نفسه.',
  doesNotExist: 'محمولة — الحقل الغائب لا القيمة null. تُميّز عن equalTo(null).',
  startsWith: 'محمولة — regex مثبّت من البداية، فيستفيد من الفهرس في الاثنين.',
  contains: 'محمولة، **ومكلفة**: regex غير مثبّت يمسح المجموعة. خطة أخيرة لا أولى.',
  select: 'محمولة — تقليل الحقول المُعادة، وهي ما يمنع تسريب الحقول الحسّاسة.',
  include: 'محمولة — تحميل الـPointer في استعلام واحد بدل جلبه على حدة.',
  limit: 'محمولة — والسقف مفروض في كل استعلام يُعيد قائمة، بلا استثناء.',
  ascending: 'محمولة — الترتيب على حقل واحد متطابق في المحوّلين.',
  descending: 'محمولة — وعليها يقوم ترتيب الوارد والسجلّ بالأحدث.',
};

/**
 * صيغ مرفوضة قصداً، ولكلٍّ بديلها في هذا المستودع.
 * وجودها في `cloud/` خطأٌ لا سهو.
 */
const REJECTED = {
  withinKilometers: 'يفرض فهرس 2dsphere (أو PostGIS) — استخدم صندوق الإحاطة في lib/geo.js.',
  withinPolygon: 'يفرض فهرساً مكانياً كنظيرتها — والقرب هنا لا يحتاجه.',
  near: 'يفرض فهرساً مكانياً، ويُرتّب بالمسافة داخل القاعدة بدل هافرساين.',
  withinRadians: 'صيغة أخرى للقرب المكاني، وتفرض الفهرس نفسه.',
  withinMiles: 'صيغة أخرى للقرب المكاني، وتفرض الفهرس نفسه.',
  fullText: 'يفرض فهرساً نصّياً لا يعبّر عنه مخطط Parse — يُضاف يدوياً إن لزم.',
  aggregate: 'دعم محوّل PostgreSQL له جزئي ويختلف عن MongoDB.',
  distinct: 'كالتجميع — دعم محوّل PostgreSQL له جزئي، والنتيجة قد تختلف.',
  matchesKeyInQuery: 'استعلام داخل استعلام — أداؤه يختلف كثيراً بين المحوّلين.',
  doesNotMatchKeyInQuery: 'نفي استعلامٍ داخل استعلام — أثقل من سابقتها وأشدّ اختلافاً.',
};

/** كل ملفات السحابة عدا الحزمة المولَّدة — هي نسخةٌ من الباقي. */
function cloudSources(dir = CLOUD) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return cloudSources(full);
    if (!entry.name.endsWith('.js') || entry.name === 'main.bundle.js') return [];
    return [full];
  });
}

/** أسماء التوابع المستدعاة على كائن — تقريبٌ نصّي يكفي لسلك التعثّر. */
function methodsIn(source) {
  return new Set((source.match(/\.([a-zA-Z][a-zA-Z0-9]*)\s*\(/g) || [])
    .map((hit) => hit.slice(1).replace(/\s*\($/, '')));
}

/**
 * قوائم المحافظات مكتوبة بأيدينا في موضعين — التحقّق في السحابة والاختيار في
 * الواجهة — والبيانات مصدرها الوزارة. حرفٌ يختلف يعني محافظةً يرفضها الخادم أو
 * لا يجدها المستخدم، **وتعني خطةَ الإشعار البديلة تُطابق صفراً** لأنها تُقارن
 * محافظة المستخدم بمحافظة المسجد نصّاً.
 */
test('قوائم المحافظات تطابق البيانات', async (t) => {
  const listIn = (file, declaration) => {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const block = source.match(new RegExp(`${declaration} = \\[(.*?)\\];`, 's'));
    assert.ok(block, `${file}: لم يُعثر على ${declaration}`);
    return new Set([...block[1].matchAll(/'([^']+)'/g)].map((hit) => hit[1]));
  };

  const cloud = listIn('cloud/functions/users.js', 'const GOVERNORATES');
  const client = listIn('app/src/api.js', 'export const GOVERNORATES');

  await t.test('الموضعان متطابقان', () => {
    assert.deepEqual([...cloud].sort(), [...client].sort(),
      'محافظة يقبلها أحدهما ويرفضها الآخر');
  });

  await t.test('وتطابقان بيانات الوزارة حرفاً بحرف', () => {
    const data = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'data', 'mosques.json'), 'utf8'));
    const actual = new Set(data.map((row) => row.governorate));

    assert.deepEqual([...actual].sort(), [...cloud].sort(),
      'اختلافُ حرفٍ يجعل المستخدم يختار محافظةً لا تُطابق أي مسجد');
  });
});

test('محمولية الاستعلامات', async (t) => {
  const files = cloudSources();

  await t.test('الملفات تُقرأ فعلاً', () => {
    assert.ok(files.length >= 8, `وُجد ${files.length} ملفاً فقط — المسح لا يصل إلى الكود`);
  });

  await t.test('لا صيغة مرفوضة في كود السحابة', () => {
    for (const file of files) {
      const used = methodsIn(fs.readFileSync(file, 'utf8'));
      for (const [name, why] of Object.entries(REJECTED)) {
        assert.equal(used.has(name), false,
          `${path.relative(CLOUD, file)} يستعمل ${name}: ${why}`);
      }
    }
  });

  await t.test('كل صيغة استعلام مستعملة مُراجَعة', () => {
    // نُقصر الفحص على ما يُعرف أنه من واجهة الاستعلام حتى لا نلاحق كل تابع
    const QUERY_SURFACE = new Set([...Object.keys(REVIEWED), ...Object.keys(REJECTED),
      // صيغ استعلام أخرى تعرفها Parse — وجودها يستوجب مراجعة لا رفضاً تلقائياً
      'notContainedIn', 'containedBy', 'exists', 'endsWith', 'matches', 'matchesQuery',
      'doesNotMatchQuery', 'skip', 'addAscending', 'addDescending', 'polygonContains',
      'withinGeoBox', 'or', 'and', 'nor', 'each', 'aggregate', 'distinct']);

    const unreviewed = new Set();
    for (const file of files) {
      for (const name of methodsIn(fs.readFileSync(file, 'utf8'))) {
        if (QUERY_SURFACE.has(name) && !REVIEWED[name] && !REJECTED[name]) unreviewed.add(name);
      }
    }

    assert.deepEqual([...unreviewed], [],
      'صيغ استعلام بلا مراجعة محمولية — ابحث عن سلوكها في المحوّلين ثم أضفها إلى REVIEWED');
  });

  await t.test('القائمتان لا تتقاطعان', () => {
    for (const name of Object.keys(REJECTED)) {
      assert.equal(REVIEWED[name], undefined, `${name} مقبولة ومرفوضة معاً`);
    }
  });

  await t.test('كل صيغة مُراجَعة لها سببها مكتوباً', () => {
    for (const [name, note] of Object.entries({ ...REVIEWED, ...REJECTED })) {
      assert.ok(note && note.length > 15, `${name} بلا ملاحظة تشرح قرارها`);
    }
  });
});
