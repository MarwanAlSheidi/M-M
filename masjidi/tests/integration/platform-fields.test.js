/**
 * اختبار تكامل: حقولٌ تملكها المنصّة، والسمعة أوّلها.
 *
 * `beforeSave` كان يحرس `role` و`isVerifiedContractor` وحدهما. وقِيس على خادمٍ
 * حقيقي بمحاولة **كل** كتابةٍ ممكنة من العميل:
 *
 * ```
 * الفئات كلُّها: رُدّ (Permission denied)
 * role: رُدّ   ·   isVerifiedContractor: رُدّ
 * completedJobs: قُبل → 999   ·   avgRating: قُبل → 5   ·   abandonedJobs: قُبل → 0
 * isActive: قُبل → false   ·   contractorReviewedAt: قُبل   ·   lastLat: قُبل
 * ```
 *
 * والثلاثة الأولى بعينها هي ما تُعرضه `getRequestInterests` للإمام وهو يختار
 * المنفّذ. **بُنيت لتكون بيّنته، فإذا هي إقرارٌ من صاحب الشأن على نفسه.**
 * وأخصُّها `abandonedJobs`: تحذيرٌ يُعرض للإمام، ويمحوه من قام به بسطرٍ واحد.
 *
 * ولا يراه بديل Parse: `beforeSave` على `_User` وCLP الفئات لا يُشغّلهما إلا
 * خادمٌ حقيقي بجلسةِ مستخدمٍ حقيقية.
 *
 * في ملفٍّ مستقلّ — خادمٌ واحد لكل عملية، ويحرس ذلك `harness.startStack`.
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:integration`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startStack, applySchema, unavailableReason } = require('./harness');

const skip = unavailableReason();
const options = skip ? { skip } : {};

/** ما لا يكتبه صاحب الحساب بيده، ولماذا يهمّ. */
const OWNED = {
  completedJobs: 'عددُ الأعمال المنجزة يُعرض للإمام وهو يختار',
  avgRating: 'التقييم يُعرض للإمام وهو يختار',
  abandonedJobs: 'مرّات التغيّب تحذيرٌ يُعرض للإمام — ويمحوه من قام به',
  isActive: 'إيقاف الحساب أداةُ الإدارة الوحيدة لكفّ مسيء',
  contractorReviewedAt: 'به يُميَّز المسحوب اعتمادُه ممّن لم يُراجَع بعد',
  lastLat: 'آخر موقعٍ معروف — تكتبه updateMyLocation بالمفتاح الرئيسي',
  lastLng: 'نظيره',
};

test('حقول المنصّة لا يكتبها صاحب الحساب', options, async (t) => {
  const stack = await startStack();
  const { Parse } = stack;
  t.after(() => stack.stop());

  await applySchema(Parse);

  let unique = 0;
  async function signUp(role = 'volunteer', extra = {}) {
    const user = new Parse.User();
    user.set({
      username: `own_${role}_${Date.now()}_${++unique}`,
      password: 'Integration12345!',
      role,
      ...extra,
    });
    await user.signUp();
    return user;
  }
  const reread = (user) => new Parse.Query(Parse.User).get(user.id, { useMasterKey: true });

  await t.test('لا يُكتب حقلٌ منها بعد التسجيل', async () => {
    const user = await signUp();
    const token = user.getSessionToken();

    for (const [field, why] of Object.entries(OWNED)) {
      const mine = await new Parse.Query(Parse.User).get(user.id, { sessionToken: token });
      mine.set(field, field === 'isActive' ? false : 99);

      await assert.rejects(
        mine.save(null, { sessionToken: token }),
        /تكتبه المنصّة/,
        `${field}: قُبل من صاحب الحساب — ${why}`,
      );
    }
  });

  await t.test('ولا تُزرع عند التسجيل نفسه — الباب الأوّل', async () => {
    // لا يكفي ردُّ التعديل: من سجّل بسمعةٍ جاهزة لا يحتاج إلى تعديلها بعدُ
    const user = await signUp('volunteer', {
      completedJobs: 999, avgRating: 5, abandonedJobs: 0, isActive: false,
      lastLat: 1, lastLng: 1, contractorReviewedAt: new Date(),
    });
    const stored = await reread(user);

    assert.equal(stored.get('completedJobs'), 0, 'سُجّل بتسعمئةٍ وتسعةٍ وتسعين عملاً منجزاً');
    assert.equal(stored.get('abandonedJobs'), 0);
    assert.equal(stored.get('avgRating'), undefined, 'تقييمٌ قبل أوّل عمل');
    assert.equal(stored.get('isActive'), true, 'سجّل حساباً موقوفاً — والإيقاف بيد الإدارة');
    assert.equal(stored.get('lastLat'), undefined);
    assert.equal(stored.get('contractorReviewedAt'), undefined);
  });

  await t.test('والمنصّة تكتبها كما كانت — الحارس لا يعطّل ما يحرسه', async () => {
    const imam = await signUp('imam');
    const volunteer = await signUp('volunteer');
    const tokens = { imam: imam.getSessionToken(), volunteer: volunteer.getSessionToken() };

    const mosque = new (Parse.Object.extend('Mosques'))();
    mosque.set({
      externalId: `own_${Date.now()}`, name: 'مسجد السمعة', governorate: 'مسقط',
      wilayat: 'بوشر', isClaimed: true, imamId: imam, lat: 23.6, lng: 58.5, hasLocation: true,
    });
    await mosque.save(null, { useMasterKey: true });

    const as = (token, fn, params) => Parse.Cloud.run(fn, params, { sessionToken: token });
    const created = await as(tokens.imam, 'createServiceRequest',
      { mosqueId: mosque.id, title: 'تنظيف السجاد', description: 'وصفٌ كافٍ لهذا الطلب' });

    await as(tokens.volunteer, 'expressInterest', { requestId: created.objectId });
    await as(tokens.imam, 'assignWorker', { requestId: created.objectId, workerId: volunteer.id });
    await as(tokens.volunteer, 'startWork', { requestId: created.objectId });
    await as(tokens.volunteer, 'markWorkDone', { requestId: created.objectId, notes: 'نُظّف' });
    await as(tokens.imam, 'completeService', { requestId: created.objectId, rating: 4 });

    const stored = await reread(volunteer);
    assert.equal(stored.get('completedJobs'), 1, 'الحارس منع المنصّة من كتابة سمعةٍ صادقة');
    assert.equal(stored.get('avgRating'), 4);
  });

  await t.test('وتغيّبٌ يُقيَّد لا يُمحى', async () => {
    const imam = await signUp('imam');
    const volunteer = await signUp('volunteer');
    const tokens = { imam: imam.getSessionToken(), volunteer: volunteer.getSessionToken() };
    const as = (token, fn, params) => Parse.Cloud.run(fn, params, { sessionToken: token });

    const mosque = new (Parse.Object.extend('Mosques'))();
    mosque.set({
      externalId: `own2_${Date.now()}`, name: 'مسجد الغياب', governorate: 'مسقط',
      wilayat: 'بوشر', isClaimed: true, imamId: imam, lat: 23.6, lng: 58.5, hasLocation: true,
    });
    await mosque.save(null, { useMasterKey: true });

    const created = await as(tokens.imam, 'createServiceRequest',
      { mosqueId: mosque.id, title: 'دهان', description: 'وصفٌ كافٍ لهذا الطلب' });
    await as(tokens.volunteer, 'expressInterest', { requestId: created.objectId });
    await as(tokens.imam, 'assignWorker', { requestId: created.objectId, workerId: volunteer.id });
    await as(tokens.imam, 'releaseAssignment', { requestId: created.objectId, reason: 'no_show' });

    assert.equal((await reread(volunteer)).get('abandonedJobs'), 1);

    // ثم يحاول محوَه — وهو ما كان يُقبل
    const mine = await new Parse.Query(Parse.User).get(volunteer.id, { sessionToken: tokens.volunteer });
    mine.set('abandonedJobs', 0);
    await assert.rejects(mine.save(null, { sessionToken: tokens.volunteer }), /تكتبه المنصّة/);

    assert.equal((await reread(volunteer)).get('abandonedJobs'), 1,
      'مُحي التغيّب — والإمام التالي يختار بلا أن يعلم');
  });

  await t.test('وما يملكه صاحب الحساب يبقى له', async () => {
    // الحارس ضيّقٌ قصداً: تعديل الاسم والهاتف والمهارات حقُّ صاحبه
    const user = await signUp();
    await Parse.Cloud.run('updateMyProfile',
      { fullName: 'سالم بن راشد', phone: '90001122', skills: ['electrical'] },
      { sessionToken: user.getSessionToken() });

    const stored = await reread(user);
    assert.equal(stored.get('fullName'), 'سالم بن راشد');
    assert.deepEqual(stored.get('skills'), ['electrical']);
  });

  await t.test('والفئات كلُّها مقفلةٌ للكتابة من العميل', async () => {
    // مسحٌ لا عيّنة: باب واحدٌ مفتوح يُبطل ما سواه
    const user = await signUp();
    const token = user.getSessionToken();

    for (const className of ['Mosques', 'MosqueClaims', 'ServiceRequests',
      'Transactions', 'TaskInterests', 'AuditLog', 'Notifications']) {
      const row = new (Parse.Object.extend(className))();
      row.set('title', 'محاولة');
      await assert.rejects(row.save(null, { sessionToken: token }),
        (error) => error.code === Parse.Error.OPERATION_FORBIDDEN,
        `${className}: يُكتب من العميل مباشرةً`);
    }
  });
});
