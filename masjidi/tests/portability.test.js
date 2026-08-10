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
  exists: 'محمولة — وعلى `exists("objectId")` يقوم العدُّ الكامل: قيدٌ يصدق '
    + 'على كل سجلّ، وبه تُتجنّب count بلا قيد التي تُعيد صفراً صامتاً.',
  startsWith: 'محمولة — regex مثبّت من البداية، فيستفيد من الفهرس في الاثنين.',
  contains: 'محمولة، **ومكلفة**: regex غير مثبّت يمسح المجموعة. خطة أخيرة لا أولى.',
  select: 'محمولة — تقليل الحقول المُعادة، وهي ما يمنع تسريب الحقول الحسّاسة.',
  include: 'محمولة — تحميل الـPointer في استعلام واحد بدل جلبه على حدة.',
  limit: 'محمولة — والسقف مفروض في كل استعلام يُعيد قائمة، بلا استثناء.',
  ascending: 'محمولة — الترتيب على حقل واحد متطابق في المحوّلين.',
  descending: 'محمولة — وعليها يقوم ترتيب الوارد والسجلّ بالأحدث.',
  find: 'محمولة — وعليها يقوم كلُّ عرضٍ في المنصّة.',
  first: 'محمولة — سجلٌّ واحد، وتُغني عن limit(1) وقراءة الأوّل.',
  count: 'محمولة **بقيد**. وبلا قيدٍ واحدٍ على الأقل قِيست على PostgreSQL '
    + 'فأعادت صفراً بينما find تُعيد ثلاثين — بلا خطأ. استعمل exists("objectId").',
  addAscending: 'محمولة — ترتيبٌ مركّب، ويُترجَم إلى فرزٍ بمفتاحين في المحوّلين. '
    + '**ولازمةٌ مع التصفّح**: `ascending("createdAt")` وحدها لا تُرتّب المتساويين، '
    + 'وقِيس أن التصفّح فوقها يفقد صفوفاً — 6 من 56 في `export_records.js`. '
    + 'فالمفتاح الثاني يكون فريداً (`objectId`).',
  skip: 'محمولة، **ومكلفة على الطرف البعيد**: MongoDB يمرّ على ما يتخطّاه، فتزداد '
    + 'الكلفة مع الإزاحة. مقبولةٌ في تصديرٍ يُشغَّل شهرياً، **ولا تُستعمل في مسارٍ '
    + 'يراه مستخدم** — وهي غير مستعملة في `cloud/` أصلاً. ولا تصحّ بلا ترتيبٍ فريد.',
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

/**
 * القوائم المغلقة المكتوبة مرّتين — مرّةً للخادم ومرّةً للقارئ العربي.
 *
 * وقع هذا مرّتين في هذا المستودع: مهارةٌ يقبلها الخادم ولا اسم عربيَّ لها في
 * الواجهة فظهرت للمستخدم بمفتاحها الإنجليزي `electrical`؛ وفعلٌ في سجلّ
 * التدقيق بلا ترجمة فظهر `location_learned` في شاشةٍ عربية. وكلاهما لا يُسقط
 * شيئاً — يُعرض فحسب، بلغةٍ ليست لغة قارئه.
 */
test('القوائم المغلقة مترجَمة كاملةً', async (t) => {
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

  /** مفاتيح كائنٍ معلَن حرفياً — تقريبٌ نصّي يكفي لسلك التعثّر. */
  const keysIn = (source, declaration) => {
    const block = source.match(new RegExp(`${declaration} = \\{(.*?)\\n\\};`, 's'));
    assert.ok(block, `لم يُعثر على ${declaration}`);
    return new Set([...block[1].matchAll(/^\s*([a-zA-Z_]+):/gm)].map((hit) => hit[1]));
  };

  await t.test('كل فعلٍ في سجلّ التدقيق له اسمٌ عربي', () => {
    const actions = new Set([...read('cloud/lib/audit.js')
      .matchAll(/^\s*[A-Z_]+: '([a-z_]+)',/gm)].map((hit) => hit[1]));
    const labels = keysIn(read('app/src/api.js'), 'export const AUDIT_LABEL');

    assert.ok(actions.size >= 15, `قُرئ ${actions.size} فعلاً فقط — المسح لا يصل`);
    assert.deepEqual([...actions].filter((action) => !labels.has(action)), [],
      'فعلٌ يُقيَّد في السجلّ ويُعرض للقارئ بمفتاحه الإنجليزي');
    assert.deepEqual([...labels].filter((label) => !actions.has(label)), [],
      'ترجمةٌ لفعلٍ لم يعد يُقيَّد — تُوهم بأنه ما زال يُسجَّل');
  });

  await t.test('وكل مهارةٍ يقبلها الخادم لها اسمٌ عربي', () => {
    const source = read('cloud/functions/users.js');
    const block = source.match(/const SKILLS = \[(.*?)\];/s);
    assert.ok(block, 'لم يُعثر على SKILLS');
    const skills = new Set([...block[1].matchAll(/'([^']+)'/g)].map((hit) => hit[1]));
    const categories = keysIn(read('app/src/api.js'), 'export const CATEGORIES');

    assert.deepEqual([...skills].sort(), [...categories].sort(),
      'مهارةٌ يقبلها الخادم بلا اسمٍ عربي، أو اسمٌ عربي لمهارةٍ يرفضها');
  });
});

/**
 * والسكربتات تُمسح كما يُمسح كود السحابة.
 *
 * كان المسح على `cloud/` وحده، **و`scripts/` تستعلم من القاعدة الحيّة نفسها**:
 * `seed_mosques` و`export_records` و`promote_admin` كلُّها تكتب وتقرأ من
 * الإنتاج بالمفتاح الرئيس. وقِيس: صيغةُ تصفّحٍ أُضيفت في `export_records.js`
 * لم يمرّ عليها هذا الحارس أصلاً — **لأن نطاقه أضيق من الخطر الذي وُضع له**.
 */
function scriptSources() {
  const dir = path.join(__dirname, '..', 'scripts');
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return fs.readdirSync(full).filter((f) => f.endsWith('.js'))
          .map((f) => path.join(full, f));
      }
      return entry.name.endsWith('.js') ? [full] : [];
    });
}

test('محمولية الاستعلامات', async (t) => {
  const files = [...cloudSources(), ...scriptSources()];

  await t.test('الملفات تُقرأ فعلاً', () => {
    assert.ok(files.length >= 8, `وُجد ${files.length} ملفاً فقط — المسح لا يصل إلى الكود`);
    assert.ok(files.some((file) => file.includes(`${path.sep}scripts${path.sep}`)),
      'المسح لا يبلغ `scripts/` — وهي تستعلم من الإنتاج كما يستعلم كود السحابة');
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
      'withinGeoBox', 'or', 'and', 'nor', 'each', 'aggregate', 'distinct',
      // التوابع الطرفية: ليست قيوداً، لكنها تُنفَّذ على المحوّل — و`count`
      // بلا قيدٍ تُعيد صفراً على أحدهما. غيابُها عن القائمة أخفاها عن المسح.
      'find', 'first', 'count']);

    const unreviewed = new Set();
    for (const file of files) {
      for (const name of methodsIn(fs.readFileSync(file, 'utf8'))) {
        if (QUERY_SURFACE.has(name) && !REVIEWED[name] && !REJECTED[name]) unreviewed.add(name);
      }
    }

    assert.deepEqual([...unreviewed], [],
      'صيغ استعلام بلا مراجعة محمولية — ابحث عن سلوكها في المحوّلين ثم أضفها إلى REVIEWED');
  });

  /**
   * `include` بمسارٍ منقوط ليست `include` عاديّة.
   *
   * الأولى تُحمّل مؤشّراً في الاستعلام نفسه، والثانية تلاحق مؤشّراً داخل
   * مؤشّر — تفكّها Parse إلى استعلامٍ تالٍ على الفئة الهدف. واسم التابع واحد،
   * فالمسح بالاسم لا يفرّق بينهما ويمرّ المنقوط صامتاً. **وسلكُ تعثّرٍ يمرّ
   * تحته ما لم يُراجَع ليس سلكاً.**
   */
  await t.test('ومسارات include المنقوطة مُراجَعة كلٌّ على حدة', () => {
    const NESTED = {
      'mosqueId.imamId': 'محمولة — Parse تفكّها إلى استعلامٍ تالٍ على _User '
        + 'بمعرّفاتٍ مجموعة، فوق المحوّل لا داخله. ولا يقرأ منها إلا المشرف.',
    };

    const found = new Set();
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      for (const hit of source.matchAll(/\.include\(['"`]([^'"`]*\.[^'"`]*)['"`]/g)) {
        found.add(hit[1]);
      }
    }

    assert.deepEqual([...found].filter((path_) => !NESTED[path_]), [],
      'مسار include منقوط بلا مراجعة — راجع سلوكه ثم أضِفه بملاحظته');
  });

  /**
   * `count()` بلا قيدٍ واحد تُعيد **صفراً** على `parse-server` فوق PostgreSQL،
   * بينما `find()` على الاستعلام نفسه تُعيد السجلّات كلَّها. قِيس ذلك في هذا
   * المستودع لا نُقل عن أحد.
   *
   * **وأسوأ ما فيها أنها لا تسقط:** فحصٌ يقول «لا مسجد في القاعدة» وفيها
   * ثمانية عشر ألفاً يُرسل المُشغّل يستورد ما هو مستورد، وحدٌّ يقرأ صفراً
   * يسمح بما كان يمنعه. والقيد `exists('objectId')` يصدق على كل سجلّ.
   */
  await t.test('ولا عدَّ بلا قيد — يُعيد صفراً صامتاً', () => {
    const bare = [];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      for (const hit of source.matchAll(/new Parse\.Query\([^)]*\)\s*\.count\(/g)) {
        bare.push(`${path.relative(CLOUD, file)}: ${hit[0].replace(/\s+/g, ' ')}`);
      }
    }

    assert.deepEqual(bare, [],
      'عدٌّ بلا قيد — يُعيد صفراً على PostgreSQL بلا خطأ. قيّده بـ exists("objectId")');
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
