/**
 * اختبار تكامل: شركةٌ يُسحب اعتمادها وهي مكلَّفةٌ بعمل.
 *
 * الاعتماد شرطٌ يُفحص عند التكليف وحده (`assignWorker`)، ثم لا يُسأل عنه بعد.
 * فإن سحبه المشرف — لسجلٍّ تجاريٍّ انتهى أو شكوى — بقيت الشركة تعمل في المسجد
 * كما كانت: تبدأ وتُبلغ ويُعتمد عملها، **وإمامُ المسجد لا يُخبَر بشيء.**
 * والمشرف يظنّ أنه فعل شيئاً وهو لم يفعل — كما كان إيقافُ الحساب زينةً قبله.
 *
 * وهذا لا يراه بديل Parse: `reviewContractor` تكتب على `_User` بالمفتاح
 * الرئيس، وأثرُ السحب يظهر في استعلامٍ عن طلباتٍ مفتوحة وفي صندوق وارد.
 *
 * في ملفٍّ مستقلّ — خادمٌ واحد لكل عملية، ويحرس ذلك `harness.startStack`.
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:integration`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startStack, applySchema, unavailableReason } = require('./harness');

const skip = unavailableReason();
const options = skip ? { skip } : {};

test('سحب اعتماد شركةٍ مكلَّفة', options, async (t) => {
  const stack = await startStack();
  const { Parse } = stack;
  t.after(() => stack.stop());

  await applySchema(Parse);

  const tokens = new Map();
  let unique = 0;
  async function signUp(role, extra = {}) {
    const user = new Parse.User();
    user.set({ username: `rev_${role}_${Date.now()}_${++unique}`, password: 'Integration12345!', role });
    for (const [key, value] of Object.entries(extra)) user.set(key, value);
    await user.signUp();
    tokens.set(user.id, user.getSessionToken());
    return user;
  }
  const as = (user, fn, params = {}) =>
    Parse.Cloud.run(fn, params, { sessionToken: tokens.get(user.id) });

  const admin = await signUp('donor');
  admin.set('role', 'admin');
  await admin.save(null, { useMasterKey: true });

  const imam = await signUp('imam', { fullName: 'الشيخ سعيد' });
  const contractor = await signUp('contractor',
    { fullName: 'مؤسسة النور', companyName: 'النور للمقاولات', crNumber: '1234567' });

  const mosque = new (Parse.Object.extend('Mosques'))();
  mosque.set({
    externalId: `rev_${Date.now()}`, name: 'مسجد الشركة المسحوبة', governorate: 'مسقط',
    wilayat: 'بوشر', isClaimed: true, imamId: imam, lat: 23.6, lng: 58.5, hasLocation: true,
  });
  await mosque.save(null, { useMasterKey: true });

  /** طلبٌ مكلَّفةٌ به الشركة — الحالة التي يقع فيها السحب. */
  const assignedRequest = async (title) => {
    const created = await as(imam, 'createServiceRequest',
      { mosqueId: mosque.id, title, description: 'وصفٌ كافٍ لهذا الطلب' });
    await as(imam, 'assignWorker', { requestId: created.objectId, workerId: contractor.id });
    return created.objectId;
  };

  const revoke = (approve = false) =>
    as(admin, 'reviewContractor', { contractorId: contractor.id, approve });

  await revoke(true);
  const waiting = await assignedRequest('تكييف المصلّى');
  const started = await assignedRequest('عزل السطح');
  await as(contractor, 'startWork', { requestId: started });

  const inbox = async (user) => (await as(user, 'getMyNotifications', { limit: 50 })).items;

  await t.test('السحب يُخبر إمام المسجد الذي عندها عمل', async () => {
    const before = (await inbox(imam)).length;
    const result = await revoke(false);

    assert.equal(result.affectedRequests, 2,
      'سُحب الاعتماد ولم يُحصَ ما هو قائمٌ من عمل — فالمشرف لا يعرف ماذا فعل');

    const fresh = (await inbox(imam)).slice(0, (await inbox(imam)).length - before);
    const text = fresh.map((row) => row.body).join('\n');
    assert.match(text, /اعتماد/,
      'سُحب اعتماد شركةٍ تعمل في مسجده ولم يُخبَر — وهو من يتحمّل النتيجة');
    assert.match(text, /تكييف المصلّى/, 'الإشعار لا يقول أيُّ عملٍ يعنيه');
    assert.match(text, /عزل السطح/, 'ما بدأ فعلاً أولى بالذكر، وقد سقط');
  });

  await t.test('ويُقيَّد في سجلّ المسجد — لا في سجلٍّ لا يقرؤه أحد', async () => {
    // قيد `contractor_reviewed` يُكتب بلا `mosqueId`، و`getMosqueAuditTrail`
    // هي القارئ الوحيد وتستعلم بالمسجد — فلا يبلغ ذلك القيدُ عيناً أبداً
    const trail = await as(imam, 'getMosqueAuditTrail', { mosqueId: mosque.id });
    const entries = trail.filter((row) => row.action === 'contractor_suspended');
    assert.equal(entries.length, 2, 'سجلّ المسجد لا يذكر أن منفّذه فقد اعتماده');
    assert.match(entries.map((row) => row.note).join('\n'), /النور/,
      'القيد لا يسمّي الشركة — فلا يُراجَع');
  });

  await t.test('والشركة المسحوب اعتمادها لا تبدأ عملاً جديداً', async () => {
    await assert.rejects(
      as(contractor, 'startWork', { requestId: waiting }),
      /اعتماد/,
      'شركةٌ لا تُكلَّف اليوم تبدأ عملاً كُلِّفت به أمس — والشرط يُفحص مرّةً ثم يُنسى',
    );
  });

  await t.test('لكنها تُبلّغ بما بدأته — قطعُ الطريق على البيّنة أسوأ', async () => {
    // العمل جارٍ في المسجد فعلاً. منعُها من الإبلاغ يترك الطلب معلّقاً بلا
    // صورةٍ ولا ملاحظة، ويُضيّع على الإمام معاينة ما أُنجز.
    const result = await as(contractor, 'markWorkDone',
      { requestId: started, notes: 'أُنجز العزل قبل السحب' });
    assert.equal(result.status, 'pending_imam_approval');
  });

  await t.test('والإمام يستردّ الطلب الذي لم يبدأ — والطريق مفتوح', async () => {
    const result = await as(imam, 'releaseAssignment', { requestId: waiting });
    assert.equal(result.status, 'open_for_volunteers');
  });

  await t.test('والشركة تُخبَر بأن اعتمادها سُحب لا بأنها «قيد المراجعة»', async () => {
    const profile = await as(contractor, 'getMyProfile');
    assert.equal(profile.contractorStatus, 'revoked',
      'يُقال لمن سُحب اعتماده «حسابكم بانتظار اعتماد الإدارة» — وهو خبرٌ غير صحيح');
  });

  await t.test('ومن لم يُراجَع بعد حالُه غير من رُوجع فسُحب', async () => {
    const fresh = await signUp('contractor', { companyName: 'الفجر', crNumber: '7654321' });
    assert.equal((await as(fresh, 'getMyProfile')).contractorStatus, 'pending');

    const rows = await as(admin, 'listPendingContractors');
    const find = (user) => rows.find((row) => row.id === user.id);
    assert.equal(find(fresh).previouslyReviewed, false);
    assert.equal(find(contractor).previouslyReviewed, true,
      'المسحوب اعتمادها تعود إلى طابور المنتظرين كأنها لم تُراجَع قطّ');
  });

  await t.test('وإعادة الاعتماد تُعيدها إلى العمل', async () => {
    await revoke(true);
    const again = await assignedRequest('دهان الجدار');
    const result = await as(contractor, 'startWork', { requestId: again });
    assert.equal(result.status, 'in_progress');
    assert.equal((await as(contractor, 'getMyProfile')).contractorStatus, 'verified');
  });

  await t.test('وسحبُ اعتمادِ من لا عمل له لا يُشعر أحداً', async () => {
    const idle = await signUp('contractor', { companyName: 'الهدى', crNumber: '1112223' });
    await as(admin, 'reviewContractor', { contractorId: idle.id, approve: true });

    const before = (await inbox(imam)).length;
    const result = await as(admin, 'reviewContractor', { contractorId: idle.id, approve: false });

    assert.equal(result.affectedRequests, 0);
    assert.equal((await inbox(imam)).length, before,
      'أُشعر إمامٌ بسحبٍ لا يمسّ مسجده — والإشعار الذي لا يعني قارئه يُبطل ما يعنيه');
  });
});
