/**
 * المخطط ونقاط الدخول.
 *
 * `apply_schema.js` لا يستدعي `setCLP` إلا عند وجود المفتاح، فغيابه عن فئة
 * يعني بصمت أنها تبقى على إعداد الخادم الافتراضي — وهي الطريقة التي بقيت بها
 * `_User` مكشوفة. هذا الملف يحرس ذلك ويحرس تطابق النسختين المجزّأة والمدمجة.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadCloud, CLOUD } = require('./helpers/parse-mock');

const schema = JSON.parse(
  fs.readFileSync(path.join(CLOUD, 'schema.json'), 'utf8'));

const classOf = (name) => schema.classes.find((c) => c.className === name);

test('المخطط', async (t) => {
  await t.test('كل فئة تعرّف صلاحياتها صراحةً', () => {
    for (const definition of schema.classes) {
      assert.ok(definition.classLevelPermissions,
        `${definition.className} بلا classLevelPermissions — ستبقى على إعداد الخادم الافتراضي`);
    }
  });

  await t.test('_User: القراءة مصادَقة والحقول الحسّاسة محميّة', () => {
    const clp = classOf('_User').classLevelPermissions;

    assert.equal(clp.find.requiresAuthentication, true);
    assert.equal(clp.get.requiresAuthentication, true);
    assert.deepEqual(clp.create, { '*': true }, 'التسجيل يمرّ عبر create فيبقى مفتوحاً');

    for (const field of ['phone', 'lastKnownLocation']) {
      assert.ok(clp.protectedFields['*'].includes(field),
        `${field} مكشوف — موقع المتطوّع ورقمه ليسا عامّين`);
    }
  });

  await t.test('الفئات المالية مقفلة للكتابة من العميل', () => {
    for (const name of ['Mosques', 'ServiceRequests', 'Transactions']) {
      const clp = classOf(name).classLevelPermissions;
      for (const action of ['create', 'update', 'delete']) {
        assert.deepEqual(clp[action], {},
          `${name}.${action} مفتوح — الكتابة يجب أن تمرّ بدوال السحابة`);
      }
    }
  });

  await t.test('TaskInterests مقفلة — القائمة تمرّ بدالة تتحقق من الإشراف على المسجد', () => {
    const clp = classOf('TaskInterests').classLevelPermissions;
    for (const action of ['find', 'get', 'create', 'update', 'delete']) {
      assert.deepEqual(clp[action], {}, `TaskInterests.${action} مفتوح`);
    }
  });

  await t.test('AuditLog مقفل تماماً — يُقرأ عبر دالة السحابة وحدها', () => {
    const clp = classOf('AuditLog').classLevelPermissions;
    for (const action of ['find', 'get', 'create', 'update', 'delete']) {
      assert.deepEqual(clp[action], {}, `AuditLog.${action} مفتوح — يكشف هوية الفاعل`);
    }
  });

  await t.test('Notifications مقفلة — وارد كل امرئ له وحده', () => {
    const clp = classOf('Notifications').classLevelPermissions;
    for (const action of ['find', 'get', 'create', 'update', 'delete']) {
      assert.deepEqual(clp[action], {},
        `Notifications.${action} مفتوح — يُقرأ وارد الغير أو يُعلَّم مقروءاً`);
    }
  });

  await t.test('walletBalance غير مقروء من العميل', () => {
    assert.ok(classOf('Mosques').classLevelPermissions.protectedFields['*']
      .includes('walletBalance'));
  });

  /*
   * **وما يُقفل في الملفّ يُفحص على القاعدة.**
   *
   * كلُّ ما فوق يقرأ `cloud/schema.json` — أي **النيّة**. والحقيقة في القاعدة:
   * قِيس أن فتح `ServiceRequests` بضغطةٍ من اللوحة يجعل غريباً يمحو طلباً ليس
   * له، والملفُّ على حاله. فصار `preflight` يقرأ الأقفال من القاعدة الحيّة.
   *
   * وقائمتاه مكتوبتان فيه لا مقروءتان من الملفّ — **وذلك مقصود**: مقابلةُ
   * الملفّ بنفسه تُخضِّر الحالةَ التي نبحث عنها بعينها (ملفٌّ صحيحٌ لم يُطبَّق).
   * وثمنُها أن تنحرف القائمة عن الملفّ، **وصنفٌ يُقفل هناك ولا يُذكر هنا يبقى
   * بلا فحص إلى الأبد ولا يسأل عنه أحد**. فهذا هو الحارس على ذلك الثمن.
   */
  await t.test('وكلُّ مقفلٍ ومحجوبٍ في الملفّ مذكورٌ في preflight', () => {
    const source = fs.readFileSync(path.join(CLOUD, 'functions', 'preflight.js'), 'utf8');

    const listed = (name) => {
      const hit = source.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
      return hit ? hit[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1)) : [];
    };
    const hiddenBlock = source.match(/const HIDDEN_FIELDS = \{([\s\S]*?)\n\};/);

    // **أداةُ القياس تُقاس أولاً**: استخراجٌ نمطيّ يُخفق صامتاً إن تغيّرت
    // الصياغة، فيصير «لا انحراف» معناه «لم أقرأ شيئاً»
    const locked = listed('LOCKED_CLASSES');
    assert.ok(locked.length >= 5, `لم يُقرأ LOCKED_CLASSES من المصدر (${locked.length})`);
    assert.ok(hiddenBlock, 'لم يُقرأ HIDDEN_FIELDS من المصدر');

    for (const definition of schema.classes) {
      const clp = definition.classLevelPermissions || {};
      const shut = ['create', 'update', 'delete']
        .every((door) => clp[door] && Object.keys(clp[door]).length === 0);
      if (!shut) continue;
      assert.ok(locked.includes(definition.className),
        `${definition.className} مقفلٌ في المخطط وغير مذكورٍ في LOCKED_CLASSES — فقفلُه بلا فحص`);
    }

    /*
     * **وخلف كل قفلٍ حارسٌ ثانٍ.**
     *
     * الصلاحيات سطرٌ واحد يُقلب من لوحة Back4app أو لا يصل القاعدة أصلاً، وقِيس
     * أثرُ سقوطه: متطوّعٌ عاديّ كتب قيد تدقيقٍ يقول `payout_released` بصفة
     * `admin`، ومحا طلب خدمةٍ ليس له. فكلُّ صنفٍ مقفلٍ في المخطط له `beforeDelete`
     * — و`beforeSave` إن لم يكن له واحدٌ خاصّ به.
     *
     * والقراءة من المُشغّلات المسجَّلة لا من نصّ المصدر: هي ما يعمل فعلاً.
     */
    const { triggers } = loadCloud('modular');
    for (const definition of schema.classes) {
      const clp = definition.classLevelPermissions || {};
      const shut = ['create', 'update', 'delete']
        .every((door) => clp[door] && Object.keys(clp[door]).length === 0);
      if (!shut) continue;

      assert.ok(triggers[`beforeDelete:${definition.className}`],
        `${definition.className} مقفلٌ بالصلاحيات وحدها — لا beforeDelete خلفها`);
      assert.ok(triggers[`beforeSave:${definition.className}`],
        `${definition.className} مقفلٌ بالصلاحيات وحدها — لا beforeSave خلفها`);
    }

    for (const definition of schema.classes) {
      const hidden = (definition.classLevelPermissions || {}).protectedFields;
      for (const field of (hidden && hidden['*']) || []) {
        assert.match(hiddenBlock[1], new RegExp(`'${field}'`),
          `${definition.className}.${field} محجوبٌ في المخطط وغير مفحوصٍ في HIDDEN_FIELDS`);
      }
    }
  });
});

test('نقاط الدخول', async (t) => {
  const EXPECTED_FUNCTIONS = [
    'getNearbyMosques', 'getNearbyOpportunities', 'updateMyLocation', 'searchMosques', 'claimMosque', 'getMyMosques', 'getMyClaims', 'confirmMosqueLocation', 'listPendingClaims', 'reviewMosqueClaim',
    'createServiceRequest', 'expressInterest', 'withdrawInterest',
    'getRequestInterests', 'getMyInterests', 'assignWorker', 'releaseAssignment',
    'startWork', 'markWorkDone', 'getRequestContacts',
    'completeService', 'cancelServiceRequest', 'initiateDonation',
    'confirmDonation', 'paymentWebhook', 'payoutContractor', 'refundDonation',
    'getMosqueLedger', 'listPendingContractors', 'listApprovedContractors', 'reviewContractor',
    'setFavoriteMosque', 'getMyProfile', 'updateMyProfile',
    'getMyNotifications', 'markNotificationsRead',
    'getMosqueAuditTrail', 'health', 'preflight',
  ];

  const EXPECTED_TRIGGERS = [
    'beforeSave:_User', 'afterSave:_User', 'beforeLogin:_User', 'beforeSave:Mosques',
    // الصور: النوع والحجم — وهو البابُ الثاني الذي يُغلق من كود السحابة
    'beforeSave:@File',
    'beforeSave:ServiceRequests', 'beforeSave:Transactions',
    'afterSave:ServiceRequests',
    // الطبقة الثانية خلف الصلاحيات — أربعةٌ للكتابة وسبعةٌ للحذف
    'beforeSave:MosqueClaims', 'beforeSave:TaskInterests',
    'beforeSave:AuditLog', 'beforeSave:Notifications',
    'beforeDelete:Mosques', 'beforeDelete:MosqueClaims', 'beforeDelete:ServiceRequests',
    'beforeDelete:Transactions', 'beforeDelete:TaskInterests',
    'beforeDelete:AuditLog', 'beforeDelete:Notifications',
  ];

  await t.test('النسختان تسجّلان الدوال والمُشغّلات نفسها', () => {
    for (const entry of ['modular', 'bundle']) {
      const api = loadCloud(entry);
      assert.deepEqual(Object.keys(api.functions).sort(), [...EXPECTED_FUNCTIONS].sort(),
        `دوال النسخة ${entry} لا تطابق المتوقَّع`);
      assert.deepEqual(Object.keys(api.triggers).sort(), [...EXPECTED_TRIGGERS].sort(),
        `مُشغّلات النسخة ${entry} لا تطابق المتوقَّع`);
    }
  });

  await t.test('المهمة الدورية مسجَّلة في النسختين', () => {
    for (const entry of ['modular', 'bundle']) {
      const api = loadCloud(entry);
      assert.deepEqual(Object.keys(api.jobs).sort(),
        ['pruneAuditLog', 'pruneNotifications', 'reviewPendingDonations'], `النسخة ${entry}`);
    }
  });

  await t.test('النسخة المدمجة بلا استيراد نسبي ولا تصدير', () => {
    const bundle = fs.readFileSync(path.join(CLOUD, 'main.bundle.js'), 'utf8');

    // الاستيراد النسبي بلا معنى في ملف واحد، والتصدير كذلك
    assert.equal(/require\(['"]\./.test(bundle), false);
    assert.equal(/\bmodule\.exports\b/.test(bundle), false);

    // أما وحدات Node فتبقى: حذفها كان يترك مرجعاً غير معرّف
    assert.equal(/require\(['"]crypto['"]\)/.test(bundle), true);
  });

  /**
   * المواصفات وثيقةٌ يقرؤها من ينشر ويصون، وفيها جدول المهام الدورية الذي
   * يجدولها المُشغّل. حين انحرفت، بقيت `pruneNotifications` خارجها — فلا
   * تُجدوَل، ويمتلئ صندوق الوارد بلا سبب ظاهر.
   */
  /**
   * كلُّ ما تناديه الواجهة موجودٌ على الخادم.
   *
   * `Parse.Cloud.run('اسمٌ مخطوء')` لا يسقط عند البناء ولا عند الفحص — يسقط
   * **في وجه المستخدم** حين يفتح الشاشة، برسالة `Invalid function`. ووقع هذا
   * في هذا المستودع أثناء كتابة اختبار (`listPendingMosqueClaims` بدل
   * `listPendingClaims`)، ولم يكشفه إلا خادمٌ يعمل. ولو وقع في شاشةٍ نادرة
   * لبلغ الناسَ قبل أن يبلغنا.
   */
  await t.test('كل دالةٍ تناديها الواجهة معرَّفةٌ على الخادم', () => {
    const client = fs.readFileSync(
      path.join(CLOUD, '..', 'app', 'src', 'api.js'), 'utf8');
    const called = new Set([...client.matchAll(/(?:Cloud\.run|\brun)\(\s*'([^']+)'/g)]
      .map((hit) => hit[1]));
    const defined = new Set(Object.keys(loadCloud('modular').functions));

    assert.ok(called.size >= 25, `قُرئ ${called.size} نداءً فقط — المسح لا يصل`);
    assert.deepEqual([...called].filter((name) => !defined.has(name)), [],
      'الواجهة تنادي دالةً لا وجود لها — تسقط في وجه المستخدم لا في الفحص');
  });

  /**
   * وكلُّ ملفّ سحابةٍ داخلٌ في الحزمة.
   *
   * `main.bundle.js` هو ما يُلصق في لوحة Back4app، وقائمةُ ملفاته في المولّد
   * مكتوبةٌ باليد. فملفٌّ جديد يُضاف إلى `main.js` ولا يُضاف إليها **يعمل في
   * كل اختباراتنا ويغيب عن الإنتاج وحده** — وهو أسوأ أنواع الغياب.
   */
  await t.test('وكل ملفّ يُحمّله main.js داخلٌ في الحزمة', () => {
    const entry = fs.readFileSync(path.join(CLOUD, 'main.js'), 'utf8');
    const required = [...entry.matchAll(/require\('\.\/([^']+)'\)/g)]
      .map((hit) => (hit[1].endsWith('.js') ? hit[1] : `${hit[1]}.js`));

    const builder = fs.readFileSync(
      path.join(CLOUD, '..', 'scripts', 'build_single_file.py'), 'utf8');
    const bundled = new Set([...builder.matchAll(/\("([^"]+\.js)",/g)].map((hit) => hit[1]));

    assert.ok(required.length >= 6, `قُرئ ${required.length} استيراداً فقط — المسح لا يصل`);
    assert.deepEqual(required.filter((file) => !bundled.has(file)), [],
      'ملفّ سحابةٍ خارج الحزمة — يعمل في الاختبارات ويغيب عن الإنتاج وحده');
  });

  await t.test('جدولا المواصفات يطابقان ما بُني', async () => {
    const spec = fs.readFileSync(
      path.join(CLOUD, '..', 'docs', 'PROJECT_SPEC.md'), 'utf8');

    const section = (from, to) => {
      const start = spec.indexOf(from);
      const end = to ? spec.indexOf(to, start) : spec.length;
      return spec.slice(start, end === -1 ? spec.length : end);
    };
    const named = (text) => new Set(
      [...text.matchAll(/^\| `([a-zA-Z]+)` \|/gm)].map((hit) => hit[1]));

    const api = loadCloud('modular');
    const documented = named(section('## 6. دوال السحابة', '### المهام الدورية'));
    assert.deepEqual([...documented].sort(), Object.keys(api.functions).sort(),
      'جدول دوال السحابة في المواصفات لا يطابق المُسجَّل فعلاً');

    const jobs = named(section('### المهام الدورية', '## 7'));
    assert.deepEqual([...jobs].sort(), Object.keys(api.jobs).sort(),
      'جدول المهام الدورية لا يطابق المُسجَّل — ما غاب عنه لا يُجدوَل فيتراكم');
  });

  await t.test('health يعكس تهيئة بوابة الدفع', async () => {
    const api = loadCloud('modular');
    const { ok } = await api.call('health');
    assert.equal(ok.ok, true);
    assert.equal(typeof ok.paymentsConfigured, 'boolean');
  });
});
