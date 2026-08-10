/**
 * اختبار تكامل: إيقافُ حسابٍ مكلَّفٍ بعمل — من يُخبَر، وعلى من يُقيَّد؟
 *
 * المنصّة تُخرج المنفّذ من الميدان بطريقين: سحبُ اعتماد الشركة، وإيقافُ
 * الحساب. والأوّل كان يُبلَّغ به أئمّةُ المساجد، والثاني يقع في صمتٍ تامّ.
 *
 * وقِيس على خادمٍ حقيقي قبل الإصلاح:
 *
 *     وارد الإمام:  1 ← 1        (لا خبر)
 *     سجلّ المسجد:  3 ← 3        (لا قيد)
 *     الموقوف مردود: «حسابك موقوف حالياً»
 *     وُسم بالغياب:  abandonedJobs = 1
 *
 * **فالمنصّة تمنعه من الحضور، ولا تُخبر الإمام، ثم تُقيّد عليه غيابه.** والوسم
 * يبقى بعد إعادة إتاحته ويقرؤه كل إمامٍ بعدها.
 *
 * ولماذا التكامل لا الوحدة: الحارس `afterSave` على `_User` — أي على **تغيّر
 * البيانات** لا على مستدعٍ بعينه، إذ الإيقاف يقع من `scripts/promote_admin.js`
 * بالمفتاح الرئيس. والمُشغّلات لا يشغّلها بديل Parse كما يشغّلها خادم.
 *
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:integration`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startStack, applySchema, unavailableReason } = require('./harness');

const skip = unavailableReason();
const options = skip ? { skip } : {};

test('من أوقفته المنصّة لا يُحاسَب على غيابه', options, async (t) => {
  const stack = await startStack();
  const { Parse } = stack;
  t.after(() => stack.stop());

  await applySchema(Parse);

  const tokens = new Map();
  let unique = 0;
  async function signUp(role, fullName) {
    const user = new Parse.User();
    user.set('username', `${role}_${Date.now()}_${++unique}`);
    user.set('password', 'Integration12345!');
    user.set('role', role);
    user.set('fullName', fullName);
    await user.signUp();
    tokens.set(user.id, user.getSessionToken());
    return user;
  }
  const as = (user, fn, params = {}) =>
    Parse.Cloud.run(fn, params, { sessionToken: tokens.get(user.id) });

  /** الإيقاف كما يفعله `scripts/promote_admin.js` بالحرف — بالمفتاح الرئيس. */
  async function suspend(user) {
    const stored = await new Parse.Query(Parse.User).get(user.id, { useMasterKey: true });
    stored.set('isActive', false);
    await stored.save(null, { useMasterKey: true });
  }

  const field = async (user, name) => {
    const fresh = await new Parse.Query(Parse.User).get(user.id, { useMasterKey: true });
    return fresh.get(name);
  };

  const imam = await signUp('imam', 'الشيخ سعيد');

  const mosque = new (Parse.Object.extend('Mosques'))();
  mosque.set({
    externalId: `suspend_${Date.now()}`, name: 'جامع الإيقاف',
    governorate: 'مسقط', wilayat: 'بوشر', isClaimed: true, imamId: imam,
    lat: 23.6, lng: 58.5,
  });
  await mosque.save(null, { useMasterKey: true });

  const newAssignedRequest = async (title, worker) => {
    const created = await as(imam, 'createServiceRequest', {
      mosqueId: mosque.id, title, category: 'electrical',
      description: 'إنارة صحن المسجد معطّلة منذ أسبوع.',
    });
    await as(imam, 'assignWorker', { requestId: created.objectId, workerId: worker.id });
    return created.objectId;
  };

  await t.test('الإمام يُخبَر أن المكلَّف بمسجده أُوقف', async () => {
    const salim = await signUp('volunteer', 'سالم بن راشد');
    const requestId = await newAssignedRequest('تصليح إنارة الصحن', salim);

    const before = (await as(imam, 'getMyNotifications', {})).items.length;
    await suspend(salim);
    const after = (await as(imam, 'getMyNotifications', {})).items;

    assert.ok(after.length > before, 'أُوقف المكلَّف بمسجده ولم يُخبَر');
    assert.match(after[0].body, /أُوقف حساب سالم بن راشد/);
    assert.match(after[0].body, /جامع الإيقاف/, 'للإمام مساجد، والخبر بلا مسجدٍ ناقص');
    // لا يُترك في حيرة: يُقال له ما يملك، ويُطمأن أن السحب لا يظلم الموقوف
    assert.match(after[0].body, /لن يُقيَّد عليه غياب/);
    assert.equal(after[0].requestId, requestId);
  });

  await t.test('ويُقيَّد في سجلّ المسجد — والشفافية غاية المنصّة', async () => {
    const trail = await as(imam, 'getMosqueAuditTrail', { mosqueId: mosque.id });
    const entry = trail.find((row) => row.action === 'worker_suspended');
    assert.ok(entry, `لا قيدَ لإيقافٍ وقع: ${JSON.stringify(trail.map((r) => r.action))}`);
    assert.match(entry.note, /سالم بن راشد/, 'قيدٌ لا يقول من أُوقف');
  });

  await t.test('ولا يُقيَّد غيابٌ على من مُنع من الحضور', async () => {
    const salim = await signUp('volunteer', 'مانع بن سالم');
    const requestId = await newAssignedRequest('صيانة مكيّفات', salim);
    await suspend(salim);

    // المنع واقعٌ فعلاً: لا يستطيع البدء ولو أراد
    await assert.rejects(
      () => as(salim, 'startWork', { requestId }),
      /موقوف/, 'الموقوف يعمل — فالإيقاف زينة',
    );

    await as(imam, 'releaseAssignment', { requestId, reason: 'no_show' });
    assert.equal(await field(salim, 'abandonedJobs'), 0,
      'وُسم بالغياب من منعته المنصّة من الحضور — ووسمٌ يبقى بعد إعادة إتاحته');
  });

  await t.test('والغيابُ الحقيقي يُقيَّد كما كان — الحارس لا يُعطّل الحكم', async () => {
    // لولا هذه لكان «الإصلاح» تعطيلاً لـ`no_show` كلِّه، ولا يُكشف
    const ghayeb = await signUp('volunteer', 'غائب بن حاضر');
    const requestId = await newAssignedRequest('ترميم المئذنة', ghayeb);

    await as(imam, 'releaseAssignment', { requestId, reason: 'no_show' });
    assert.equal(await field(ghayeb, 'abandonedJobs'), 1, 'غيابٌ حقيقيّ لم يُقيَّد');
  });

  await t.test('والشركة تمرّ بالباب نفسه — منطقٌ واحد لا نسختان', async () => {
    const company = await signUp('contractor', 'مؤسسة النور');
    company.set('companyName', 'مؤسسة النور للصيانة');
    company.set('isVerifiedContractor', true);
    await company.save(null, { useMasterKey: true });
    await newAssignedRequest('تمديدات المياه', company);

    const before = (await as(imam, 'getMyNotifications', {})).items.length;
    await suspend(company);
    const after = (await as(imam, 'getMyNotifications', {})).items;

    assert.ok(after.length > before, 'أُوقفت شركةٌ مكلَّفة ولم يُخبَر الإمام');
    // الشركة تُعرف باسمها التجاري لا باسم من سجّلها
    assert.match(after[0].body, /مؤسسة النور للصيانة/);
  });

  await t.test('ولا يُبلَّغ أحدٌ عن إيقافٍ لا عملَ قائماً معه', async () => {
    // البلاغ عن كل إيقافٍ يُغرق وارد الأئمة بما لا يعنيهم
    const idle = await signUp('volunteer', 'قاعد بن ساكن');

    const before = (await as(imam, 'getMyNotifications', {})).items.length;
    await suspend(idle);
    const after = (await as(imam, 'getMyNotifications', {})).items.length;

    assert.equal(after, before, 'بلاغٌ عن إيقافٍ لا يمسّ الإمام في شيء');
  });

  await t.test('وإعادة الإتاحة لا تُبلِّغ شيئاً — الحارس على المنع لا على كل تغيّر', async () => {
    const back = await signUp('volunteer', 'عائد بن راجع');
    await newAssignedRequest('تنظيف الخزّان', back);
    await suspend(back);

    const before = (await as(imam, 'getMyNotifications', {})).items.length;
    const stored = await new Parse.Query(Parse.User).get(back.id, { useMasterKey: true });
    stored.set('isActive', true);
    await stored.save(null, { useMasterKey: true });
    const after = (await as(imam, 'getMyNotifications', {})).items.length;

    assert.equal(after, before, 'كلُّ حفظٍ على الحساب يُنشئ بلاغاً');
  });
});
