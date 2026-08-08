/**
 * اختبار تكامل: مسار الشركة كاملاً على خادم حقيقي.
 *
 * الخادم بُني له من البداية — `assignWorker` يفرّع على الدور، و`startWork`
 * و`markWorkDone` تقبلان الشركة، و`recordWorkerRating` تقرأ حقلها — ولم يكن
 * مُختبَراً قطّ، بينما كانت الواجهة تستعلم على حقل المتطوّع وحده فلا ترى شركةٌ
 * تكليفها أبداً.
 *
 * في ملفٍّ مستقلّ عن `limits.test.js` لا زيادةً في التنظيم: `directAccess` يربط
 * نسخة Parse المفردة بأوّل خادم يُنشأ في العملية، فخادمان في ملفٍ واحد يجعلان
 * الثاني يخاطب قاعدة الأوّل بعد إغلاقها. لكل ملفٍ عمليته.
 *
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:integration`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startStack, applySchema, unavailableReason } = require('./harness');

const skip = unavailableReason();
const options = skip ? { skip } : {};

test('مسار الشركة على خادم حقيقي', options, async (t) => {
  const stack = await startStack();
  const { Parse } = stack;
  t.after(() => stack.stop());

  await applySchema(Parse);

  const tokens = new Map();
  let unique = 0;
  async function signUp(role, extra = {}) {
    const user = new Parse.User();
    user.set('username', `${role}_${Date.now()}_${++unique}`);
    user.set('password', 'Integration12345!');
    user.set('role', role);
    for (const [key, value] of Object.entries(extra)) user.set(key, value);
    await user.signUp();
    tokens.set(user.id, user.getSessionToken());
    return user;
  }
  const as = (user, fn, params = {}) =>
    Parse.Cloud.run(fn, params, { sessionToken: tokens.get(user.id) });

  const imam = await signUp('imam', { fullName: 'الشيخ سعيد' });
  const admin = await signUp('donor');
  admin.set('role', 'admin');
  await admin.save(null, { useMasterKey: true });
  const contractor = await signUp('contractor', { fullName: 'مؤسسة النور', crNumber: '1234567' });

  const mosque = new (Parse.Object.extend('Mosques'))();
  mosque.set({
    externalId: `contractor_${Date.now()}`, name: 'مسجد الشركة', governorate: 'مسقط',
    isClaimed: true, imamId: imam, lat: 23.6, lng: 58.5,
  });
  await mosque.save(null, { useMasterKey: true });

  const request = await as(imam, 'createServiceRequest',
    { mosqueId: mosque.id, title: 'صيانة المكيّفات', description: 'أربع وحدات تحتاج صيانة' });

  await t.test('الشركة غير المعتمدة لا تُكلَّف', async () => {
    await assert.rejects(
      () => as(imam, 'assignWorker', { requestId: request.objectId, workerId: contractor.id }),
      /غير معتمدة/);
  });

  await t.test('المشرف يعتمدها ثم تُكلَّف', async () => {
    await as(admin, 'reviewContractor', { contractorId: contractor.id, approve: true });

    const result = await as(imam, 'assignWorker',
      { requestId: request.objectId, workerId: contractor.id });
    assert.equal(result.status, 'assigned');

    const stored = await new Parse.Query('ServiceRequests')
      .get(request.objectId, { useMasterKey: true });
    assert.ok(stored.get('assignedContractorId'), 'الشركة تُسجَّل في حقلها لا حقل المتطوّع');
    assert.equal(stored.get('assignedVolunteerId'), undefined);
  });

  await t.test('الشركة ترى تكليفها باستعلام الواجهة نفسه', async () => {
    // نفس ما تبنيه `app/src/api.js#assignedToMe` للدور contractor
    const mine = await new Parse.Query('ServiceRequests')
      .equalTo('assignedContractorId', contractor)
      .find({ sessionToken: tokens.get(contractor.id) });

    assert.equal(mine.length, 1, 'الشركة لا ترى ما كُلّفت به');
    assert.equal(mine[0].id, request.objectId);
  });

  await t.test('الشركة تبدأ وتُبلّغ، والإمام يعتمد', async () => {
    await as(contractor, 'startWork', { requestId: request.objectId });
    await as(contractor, 'markWorkDone', { requestId: request.objectId, notes: 'أُنجزت الصيانة' });
    const done = await as(imam, 'completeService', { requestId: request.objectId, rating: 5 });
    assert.equal(done.status, 'completed');
  });

  await t.test('سجل الشركة يتحدّث كسجل المتطوّع', async () => {
    const fresh = await new Parse.Query(Parse.User).get(contractor.id, { useMasterKey: true });
    assert.equal(fresh.get('completedJobs'), 1);
    assert.equal(fresh.get('avgRating'), 5);
  });

  await t.test('الشركة لا تسجّل اهتماماً — الإمام يختارها', async () => {
    const another = await as(imam, 'createServiceRequest',
      { mosqueId: mosque.id, title: 'دهان', description: 'دهان الجدار الخارجي' });

    await assert.rejects(
      () => as(contractor, 'expressInterest', { requestId: another.objectId }),
      /للمتطوّعين فقط/);
  });
});
