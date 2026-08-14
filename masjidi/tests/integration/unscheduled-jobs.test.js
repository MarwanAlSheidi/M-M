/**
 * المهامّ الدورية — أُشغّلها كما تُشغّلها Back4app، وأسأل عمّن لم يُشغّلها قطّ.
 *
 * `pruneAuditLog` و`pruneNotifications` هما **الحاجز الوحيد** أمام نموّ
 * القاعدة بلا حدّ في باقةٍ مجانية سعتُها ٢٥٠ ميغابايت، وقد كانتا مُجرَّبتين
 * على بديل Parse في الذاكرة وحده (`tests/notifications.test.js` عبر
 * `api.runJob`) — وهو يستدعي الدالّة استدعاءً مباشراً، فلا يقول شيئاً عن:
 *
 *   - هل `Parse.Cloud.job` منفَذٌ يُنادى أصلاً على خادمٍ حقيقي؟
 *   - هل `lessThan('createdAt', …)` يحذف ما تجاوز المدّة على محوّلٍ حقيقي؟
 *   - وهل يعرف `preflight` من **لم يُجدوِلها قطّ**؟
 *
 * والثالثة كشفت عطباً. كان الفحص يقرأ `_JobStatus`، فإن خلا قال «لم تُشغَّل
 * بعد — طبيعيٌّ قبل أوّل موعد» **ومرّ أخضر**، وحدُّ الأربعةَ عشرَ يوماً لا
 * يُطبَّق إلا على من شُغّل مرّةً ثم انقطع. فكان يكشف الانقطاع ولا يكشف ألّا
 * تكون الجدولة بدأت — وهي الحالة التي سمّاها تعليقُه نفسه أشيعَ إخفاق. قِيس:
 *
 *     خادمٌ عمرُه ٦٠ يوماً، لا صفَّ واحد في `_JobStatus`:
 *     ✓ المهام الدورية شُغّلت فعلاً — لم تُشغَّل بعد، طبيعيٌّ قبل أوّل موعد
 *
 * **وتشييخُ القاعدة هو أداة القياس هنا.** `createdAt` لا يُقدَّم إلى الوراء
 * عبر REST ولو بالمفتاح الرئيس — قِيس، فرُدّ بـ201 و`createdAt` هو الآن.
 * ويُقدَّم عبر `DatabaseController` في العملية نفسها، وهو ما يفعله هذا الملف:
 * بلا ذلك لا يُختبر حدُّ مدّةٍ واحد في هذه المنصّة إلا بانتظار تسعين يوماً.
 *
 * في ملفٍّ مستقلّ — خادمٌ واحد لكل عملية، ويحرس ذلك `harness.startStack`.
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:integration`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { startStack, applySchema, seedMosques, unavailableReason } = require('./harness');
const integration = require('./harness');

const skip = unavailableReason();
const options = skip ? { skip } : {};

const ROOT = path.join(__dirname, '..', '..');

test('المهامّ الدورية على خادمٍ حقيقي', options, async (t) => {
  const stack = await startStack();
  const { Parse } = stack;
  t.after(() => stack.stop());

  await applySchema(Parse);
  await seedMosques(Parse, 20);

  const admin = new Parse.User();
  admin.set({ username: `jobs_admin_${Date.now()}`, password: 'Integration12345!', role: 'donor' });
  await admin.signUp();
  admin.set('role', 'admin');
  await admin.save(null, { useMasterKey: true });

  // المحوّل نفسه الذي يستعمله الخادم — لا اتصالٌ ثانٍ بالقاعدة
  const Config = require(path.join(ROOT, 'node_modules', 'parse-server', 'lib', 'Config'));
  const config = Config.get(integration.APP_ID);
  const daysAgo = (days) => ({
    __type: 'Date', iso: new Date(Date.now() - days * 86400000).toISOString(),
  });

  /** يُنادي المهمّة كما تُناديها Back4app بالضبط: منفَذٌ فوق HTTP بالمفتاح الرئيس. */
  const runJob = (name, params) => fetch(`${stack.serverURL}/jobs/${name}`, {
    method: 'POST',
    headers: {
      'X-Parse-Application-Id': integration.APP_ID,
      'X-Parse-Master-Key': integration.MASTER_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params || {}),
  });

  const preflight = () => Parse.Cloud.run('preflight', {}, { useMasterKey: true });
  const jobsCheck = (report) => report.checks.find((row) => row.name.includes('المهام الدورية'));

  /* ————— أوّلاً: الخادم في يومه الأول ————— */

  await t.test('خادمٌ في يومه الأول لم تُشغَّل فيه مهمّة — وليس ذلك عطباً', async () => {
    // **الحدُّ الذي يجب أن يبقى أخضر**: لو احمرّ كلُّ خادمٍ بلا `_JobStatus`
    // لقُرئ الفحص ضجيجاً في اليوم الذي يُقرأ فيه أوّل مرّة، فيُهمَل كلُّه.
    const row = jobsCheck(await preflight());
    assert.ok(row, 'الجدولة لا تُفحص أصلاً');
    assert.equal(row.ok, true, `يومُه الأول يُقرأ عطباً: ${row.detail}`);
    assert.match(row.detail, /في يومه 0/, `لا يقول كم عمرُه: ${row.detail}`);
  });

  /* ————— ثانياً: الخادم بعد شهرين، ولا جدولة ————— */

  await t.test('وخادمٌ عمرُه شهران لم تُجدوَل فيه قطّ — أحمر', async () => {
    await config.database.update('Mosques', { hasLocation: { $in: [true, false] } },
      { createdAt: daysAgo(60) }, { many: true });

    const report = await preflight();
    const row = jobsCheck(report);

    assert.equal(row.ok, false,
      `مضى شهران بلا تشغيلٍ واحد ومرّ الفحص أخضر: ${row.detail}`);

    // **والسببُ يُقاس لا الحُكم وحده**: حمرةٌ لأن `_JobStatus` تعذّرت قراءته
    // تمرّ على `ok === false` والفحصُ لا يعمل.
    assert.match(row.detail, /لم تُشغَّل قطّ/, `احمرّ لسببٍ آخر: ${row.detail}`);
    assert.match(row.detail, /60 يوماً/, `لا يقول كم مضى: ${row.detail}`);
    assert.match(row.why, /Background Jobs/, 'يقول العطب ولا يقول أين دواؤه');
    assert.ok(report.failed.includes(row.name), 'احمرّ الفحص ولم يُذكر في `failed`');
  });

  /* ————— ثالثاً: المهمّة تُنادى فعلاً، وتحذف ما تجاوز المدّة ————— */

  await t.test('والمهمّة منفَذٌ يُنادى — وتحذف القديم وحده', async () => {
    const user = new Parse.User();
    user.set({ username: `jobs_v_${Date.now()}`, password: 'Integration12345!', role: 'volunteer' });
    await user.signUp();

    const Notification = Parse.Object.extend('Notifications');
    const rows = [0, 1, 2, 3, 4].map((at) => {
      const row = new Notification();
      row.set('userId', user);
      row.set('body', at < 3 ? `قديم ${at}` : `حديث ${at}`);
      return row;
    });
    await Parse.Object.saveAll(rows, { useMasterKey: true });

    for (const row of rows.slice(0, 3)) {
      await config.database.update('Notifications', { objectId: row.id },
        { createdAt: daysAgo(120) });
    }

    const count = () => new Parse.Query('Notifications')
      .exists('objectId').count({ useMasterKey: true });
    assert.equal(await count(), 5, 'لم تُكتب الخمسة أصلاً');

    const response = await runJob('pruneNotifications', { retentionDays: 90 });
    assert.equal(response.status, 200,
      `منفَذ المهامّ لا يُنادى على خادمٍ حقيقي: ${response.status}`);

    // المهمّة تمضي بعد الردّ — الردّ إقرارٌ بالبدء لا بالانتهاء
    const settled = async () => {
      for (let tries = 0; tries < 40; tries += 1) {
        const [status] = await new Parse.Query('_JobStatus')
          .equalTo('jobName', 'pruneNotifications')
          .descending('createdAt').limit(1)
          .find({ useMasterKey: true });
        if (status && status.get('status') !== 'running') return status;
        await new Promise((resolve) => { setTimeout(resolve, 250); });
      }
      return null;
    };

    const status = await settled();
    assert.ok(status, 'لم يُكتب صفٌّ في `_JobStatus` — فلا أثر للجدولة يُقرأ');
    assert.equal(status.get('status'), 'succeeded', `سقطت المهمّة: ${status.get('message')}`);
    assert.match(status.get('message'), /حُذف 3 إشعاراً/,
      `لم تحذف ما تجاوز التسعين: ${status.get('message')}`);

    // **والحدُّ الأخضر داخل الفحص نفسه**: مهمّةٌ تحذف كلَّ شيء تُبلّغ بنجاحٍ
    // لا يُميَّز عن الصواب — فالباقي يُعدّ كما يُعدّ الذاهب.
    assert.equal(await count(), 2, 'حُذف الحديث مع القديم');
    const left = await new Parse.Query('Notifications')
      .exists('objectId').ascending('objectId').find({ useMasterKey: true });
    for (const row of left) {
      assert.match(row.get('body'), /^حديث/, `بقي ما كان يجب حذفه: ${row.get('body')}`);
    }
  });

  /* ————— رابعاً: وبعد أن شُغّلت، يخضرّ الفحص ————— */

  await t.test('وبعد أوّل تشغيلٍ يخضرّ الفحص وإن شاخت القاعدة', async () => {
    const row = jobsCheck(await preflight());
    assert.equal(row.ok, true, `شُغّلت المهمّة اليوم ولا يزال أحمر: ${row.detail}`);
    assert.match(row.detail, /آخر تشغيل منذ 0 يوماً/, `لا يقول متى شُغّلت: ${row.detail}`);
  });
});
