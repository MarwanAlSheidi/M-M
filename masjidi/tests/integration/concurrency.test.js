/**
 * اختبار تكامل: ضغطتان في لحظةٍ واحدة.
 *
 * الدوال تفحص الحالة ثم تكتب، وبين الفحص والكتابة يمرّ الآخر. والضغطة المتتالية
 * محروسةٌ بالفحص نفسه (قِيس: «الطلب ليس بانتظار الاعتماد») — **والمتوازية لا.**
 * وهي ما يقع فعلاً حين يُضغط زرٌّ لا يُعطَّل بينهما على شبكةٍ بطيئة.
 *
 * قِيس على خادمٍ حقيقي قبل الإصلاح:
 *
 * ```
 * تكليفان متوازيان : نجحا معاً → المكلَّف الثاني، و**كلاهما أُخبر بأنه كُلِّف**
 * اعتمادان متوازيان: نجحا معاً → completedJobs = 2 لعملٍ واحد
 * ```
 *
 * **وحارسُ التزامن في `beforeSave` جُرّب فلم يمنع شيئاً**: `request.original`
 * لا يعكس ما كتبه المتوازي معه. فالعلاج حيث وقع الأثر لا حيث يُشتهى:
 * العدد يُشتقّ من الطلبات فلا ينحرف، والبشرى لا تُرسَل إلا لمن صار له التكليف.
 *
 * في ملفٍّ مستقلّ — خادمٌ واحد لكل عملية، ويحرس ذلك `harness.startStack`.
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:integration`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startStack, applySchema, unavailableReason } = require('./harness');

const skip = unavailableReason();
const options = skip ? { skip } : {};

test('ضغطتان في لحظةٍ واحدة', options, async (t) => {
  const stack = await startStack();
  const { Parse } = stack;
  t.after(() => stack.stop());

  await applySchema(Parse);

  const tokens = new Map();
  let unique = 0;
  async function signUp(role) {
    const user = new Parse.User();
    user.set({ username: `cc_${role}_${Date.now()}_${++unique}`, password: 'Integration12345!', role });
    await user.signUp();
    tokens.set(user.id, user.getSessionToken());
    return user;
  }
  const as = (user, fn, params = {}) =>
    Parse.Cloud.run(fn, params, { sessionToken: tokens.get(user.id) });

  const imam = await signUp('imam');
  const salim = await signUp('volunteer');
  const khalid = await signUp('volunteer');

  const mosque = new (Parse.Object.extend('Mosques'))();
  mosque.set({
    externalId: `cc_${Date.now()}`, name: 'مسجد اللحظة', governorate: 'مسقط',
    wilayat: 'بوشر', isClaimed: true, imamId: imam, lat: 23.6, lng: 58.5, hasLocation: true,
  });
  await mosque.save(null, { useMasterKey: true });

  const newRequest = async (title) => (await as(imam, 'createServiceRequest',
    { mosqueId: mosque.id, title, description: 'وصفٌ كافٍ لهذا الطلب' })).objectId;

  const inboxOf = (user) => new Parse.Query('Notifications')
    .equalTo('userId', user).find({ useMasterKey: true });

  await t.test('تكليفان متوازيان: لا يُبشَّر إلا من صار له التكليف', async () => {
    const requestId = await newRequest('تكليفان');
    await as(salim, 'expressInterest', { requestId });
    await as(khalid, 'expressInterest', { requestId });

    const results = await Promise.allSettled([
      as(imam, 'assignWorker', { requestId, workerId: salim.id }),
      as(imam, 'assignWorker', { requestId, workerId: khalid.id }),
    ]);
    assert.equal(results.filter((row) => row.status === 'rejected').length, 1,
      'نجح التكليفان معاً — واثنان يظنّان أن العمل لهما');

    const stored = await new Parse.Query('ServiceRequests').get(requestId, { useMasterKey: true });
    const holder = stored.get('assignedVolunteerId');
    const loser = holder.id === salim.id ? khalid : salim;

    const told = (await inboxOf(loser)).filter((row) => /تم تكليفك/.test(row.get('body') || ''));
    assert.equal(told.length, 0,
      'أُخبر من لم يُكلَّف بأنه كُلِّف — فيسافر إلى المسجد وليس له فيه عمل');

    const winner = holder.id === salim.id ? salim : khalid;
    assert.equal((await inboxOf(winner)).filter((row) => /تم تكليفك/.test(row.get('body') || '')).length,
      1, 'ولا يصل المكلَّف خبرُ تكليفه');
  });

  await t.test('واعتمادان متوازيان لا يرفعان السمعة مرّتين', async () => {
    const requestId = await newRequest('اعتمادان');
    await as(salim, 'expressInterest', { requestId });
    await as(imam, 'assignWorker', { requestId, workerId: salim.id });
    await as(salim, 'startWork', { requestId });
    await as(salim, 'markWorkDone', { requestId, notes: 'أُنجز' });

    await Promise.allSettled([
      as(imam, 'completeService', { requestId, rating: 5 }),
      as(imam, 'completeService', { requestId, rating: 5 }),
    ]);

    await salim.fetch({ useMasterKey: true });
    assert.equal(salim.get('completedJobs'), 1,
      'عملٌ واحد عُدّ مرّتين — وهي السمعة التي يقرؤها الإمام ليختار');
  });

  await t.test('والسمعة تُشتقّ من الطلبات، فتُصلح ما انحرف قبلها', async () => {
    // عدّادٌ منفوخٌ من تشغيلةٍ سابقة — أوّل اعتمادٍ بعده يُعيده إلى صوابه
    salim.set('completedJobs', 99);
    salim.set('avgRating', 5);
    await salim.save(null, { useMasterKey: true });

    const requestId = await newRequest('تصويب');
    await as(salim, 'expressInterest', { requestId });
    await as(imam, 'assignWorker', { requestId, workerId: salim.id });
    await as(salim, 'startWork', { requestId });
    await as(salim, 'markWorkDone', { requestId, notes: 'أُنجز' });
    await as(imam, 'completeService', { requestId, rating: 3 });

    await salim.fetch({ useMasterKey: true });
    assert.equal(salim.get('completedJobs'), 2, 'العدد لم يُشتقّ — بقي منفوخاً');
    // منجزان: 5 و3
    assert.equal(salim.get('avgRating'), 4, 'المتوسط لم يُحسب من التقييمات نفسها');
  });

  await t.test('والعدّ يصدق بعد إلغاءٍ وسحبٍ لا يُحسبان إنجازاً', async () => {
    const cancelled = await newRequest('ملغى');
    await as(imam, 'cancelServiceRequest', { requestId: cancelled });

    const released = await newRequest('مسحوب');
    await as(salim, 'expressInterest', { requestId: released });
    await as(imam, 'assignWorker', { requestId: released, workerId: salim.id });
    await as(imam, 'releaseAssignment', { requestId: released, reason: 'no_show' });

    const requestId = await newRequest('ثالث');
    await as(salim, 'expressInterest', { requestId });
    await as(imam, 'assignWorker', { requestId, workerId: salim.id });
    await as(salim, 'startWork', { requestId });
    await as(salim, 'markWorkDone', { requestId, notes: 'أُنجز' });
    await as(imam, 'completeService', { requestId, rating: 4 });

    await salim.fetch({ useMasterKey: true });
    assert.equal(salim.get('completedJobs'), 3, 'حُسب الملغى أو المسحوب إنجازاً');
  });
});
