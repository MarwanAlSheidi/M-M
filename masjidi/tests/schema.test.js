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

  await t.test('walletBalance غير مقروء من العميل', () => {
    assert.ok(classOf('Mosques').classLevelPermissions.protectedFields['*']
      .includes('walletBalance'));
  });
});

test('نقاط الدخول', async (t) => {
  const EXPECTED_FUNCTIONS = [
    'getNearbyMosques', 'searchMosques', 'claimMosque', 'reviewMosqueClaim',
    'createServiceRequest', 'assignWorker', 'startWork', 'markWorkDone',
    'completeService', 'cancelServiceRequest', 'initiateDonation',
    'confirmDonation', 'payoutContractor', 'getMosqueLedger', 'health',
  ];

  const EXPECTED_TRIGGERS = [
    'beforeSave:_User', 'afterSave:_User', 'beforeSave:Mosques',
    'beforeSave:ServiceRequests', 'beforeSave:Transactions',
    'afterSave:ServiceRequests',
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

  await t.test('النسخة المدمجة بلا require ولا module.exports', () => {
    const bundle = fs.readFileSync(path.join(CLOUD, 'main.bundle.js'), 'utf8');
    assert.equal(/\brequire\(/.test(bundle), false);
    assert.equal(/\bmodule\.exports\b/.test(bundle), false);
  });

  await t.test('health يعكس تهيئة بوابة الدفع', async () => {
    const api = loadCloud('modular');
    const { ok } = await api.call('health');
    assert.equal(ok.ok, true);
    assert.equal(typeof ok.paymentsConfigured, 'boolean');
  });
});
