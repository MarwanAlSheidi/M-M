/**
 * السجلّ يقول عن أيّ احتياجٍ يتكلّم.
 *
 * مسجدٌ له احتياجٌ واحد لا يكشف العطب — الأسطر كلُّها عنه. والحال المعتاد أن
 * يكون فيه أكثر من احتياج، فتتشابك الأسطر. قِيس على خادمٍ حقيقي بثلاثة
 * احتياجات: تسعةُ أسطرٍ، **لا يقول واحدٌ منها موضوعَه** — «طلب صيانة جديد»
 * ثلاث مرّات متطابقة، و«كُلّف منفّذ بالعمل» مرّتين. فمن قرأه لم يعرف أنُقل
 * الفرش أم أُصلحت المكيّفات، ولا أيّ الثلاثة أُلغي.
 *
 * وهذه هي الشاشة التي وُصفت في الكود بأنها «أداةُ الشفافية لا سطرٌ يُثبت أن
 * شيئاً وقع» — والقاعدة كانت مطبَّقة على تصويب الموقع وحده.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startStack, applySchema, unavailableReason } = require('./harness');

const skip = unavailableReason();
const options = skip ? { skip } : {};

test('سجلٌّ لا يقول عن أيّ احتياجٍ يتكلّم', options, async (t) => {
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

  const imam = await signUp('imam', 'الشيخ سعيد');
  const salim = await signUp('volunteer', 'سالم بن راشد');
  const musalli = await signUp('donor', 'المصلّي');

  const mosque = new (Parse.Object.extend('Mosques'))();
  mosque.set({
    externalId: `subject_${Date.now()}`, name: 'جامع السلام',
    governorate: 'مسقط', wilayat: 'بوشر', isClaimed: true, imamId: imam,
    lat: 23.6, lng: 58.5, locationSource: 'ministry',
  });
  await mosque.save(null, { useMasterKey: true });

  const newRequest = async (title) => {
    const created = await as(imam, 'createServiceRequest', {
      mosqueId: mosque.id, title, category: 'electrical',
      description: 'وصفٌ كافٍ لهذا الاحتياج حتى يفهمه من يقرؤه في المسجد.',
    });
    return created.objectId;
  };

  const coolers = await newRequest('إصلاح مكيّفات المصلّى');
  // الفرش لا يُمسّ بعد إنشائه: سطرٌ واحد يكفي لقياس أن العنوان يُنسب إلى صاحبه
  await newRequest('تجديد فرش المسجد');
  const toilets = await newRequest('صيانة دورات المياه');

  await as(salim, 'expressInterest', { requestId: coolers });
  await as(imam, 'assignWorker', { requestId: coolers, workerId: salim.id });
  await as(salim, 'startWork', { requestId: coolers });
  await as(imam, 'cancelServiceRequest', { requestId: toilets });

  await t.test('كلُّ سطرٍ عن احتياجٍ يحمل اسمه', async () => {
    const trail = await as(musalli, 'getMosqueAuditTrail', { mosqueId: mosque.id });

    /*
     * **والاهتمام منها**: قيدُه على كائن `TaskInterests` لا على الطلب، فتصفيةٌ
     * بـ`ServiceRequests` وحدها تُخضِّر الحارسَ على سطرين ما زالا صامتين —
     * وقد وقع ذلك فعلاً في أول صياغةٍ لهذا الحارس.
     */
    const SUBJECT_ACTIONS = new Set(['request_created', 'interest_expressed',
      'interest_withdrawn', 'worker_assigned', 'assignment_released',
      'work_started', 'work_done', 'request_completed', 'request_cancelled']);
    const aboutRequests = trail.filter((entry) => SUBJECT_ACTIONS.has(entry.action));
    assert.ok(aboutRequests.length >= 6,
      `القياس نفسه لم يقع: أسطر الاحتياجات ${aboutRequests.length}`);

    const nameless = aboutRequests.filter((entry) => !entry.subject);
    assert.deepEqual(nameless, [],
      `أسطرٌ لا تقول عن أيّ احتياجٍ تتكلّم: ${JSON.stringify(
        nameless.map((entry) => entry.action))}`);

    // **والاسم الصحيح لا أيُّ اسم**: خلطُ العناوين أسوأ من غيابها
    const line = (action, subject) => trail.some(
      (entry) => entry.action === action && entry.subject === subject);
    assert.ok(line('work_started', 'إصلاح مكيّفات المصلّى'),
      'بدء العمل نُسب إلى غير احتياجه');
    assert.ok(line('request_cancelled', 'صيانة دورات المياه'),
      'الإلغاء نُسب إلى غير احتياجه');
    assert.ok(line('request_created', 'تجديد فرش المسجد'),
      'إنشاء الفرش غاب عن السجلّ أو نُسب إلى غيره');
    assert.ok(line('interest_expressed', 'إصلاح مكيّفات المصلّى'),
      'اهتمامٌ لا يقول بأيّ احتياجٍ اهتمّ صاحبُه');

    // وثلاثة عناوين متمايزة — لا عنوانٌ واحد نُسخ على الكلّ
    const subjects = new Set(aboutRequests.map((entry) => entry.subject));
    assert.equal(subjects.size, 3, `العناوين المتمايزة: ${JSON.stringify([...subjects])}`);
  });

  /* ————— حدودٌ يجب أن تبقى خضراء ————— */

  await t.test('وما ليس عن احتياجٍ لا يُنسب إليه عنوان', async () => {
    await as(imam, 'confirmMosqueLocation', {
      mosqueId: mosque.id, lat: 23.61, lng: 58.51,
    });

    const trail = await as(musalli, 'getMosqueAuditTrail', { mosqueId: mosque.id });
    // التصفية بالفعل لا بالفئة: الاهتمام مقيَّدٌ على `TaskInterests` وهو عن احتياج
    const others = trail.filter((entry) => entry.action === 'location_corrected');
    assert.ok(others.length > 0, 'لم يقع في السجلّ سطرٌ غير احتياجيّ فالحدّ غير مقيس');
    assert.deepEqual(others.filter((entry) => entry.subject).map((e) => e.subject), [],
      'نُسب عنوان احتياجٍ إلى سطرٍ ليس عنه');
  });

  await t.test('والسطر يبقى وإن ذهب الاحتياج، بلا عنوانٍ مُختلق', async () => {
    const doomed = await newRequest('احتياجٌ سيُحذف');
    const before = await as(musalli, 'getMosqueAuditTrail', { mosqueId: mosque.id });
    assert.ok(before.some((entry) => entry.subject === 'احتياجٌ سيُحذف'),
      'لم يُقيَّد الاحتياج أصلاً فالحدّ غير مقيس');

    const row = await new Parse.Query('ServiceRequests')
      .get(doomed, { useMasterKey: true });
    await row.destroy({ useMasterKey: true });

    const after = await as(musalli, 'getMosqueAuditTrail', { mosqueId: mosque.id });
    assert.equal(after.length, before.length, 'ذهاب الاحتياج أسقط سطراً من السجلّ');
    const orphan = after.find((entry) => entry.targetId === doomed);
    assert.equal(orphan.subject, null, `اختُلق عنوانٌ لاحتياجٍ ذهب: ${orphan.subject}`);
  });

  await t.test('ولا تُكشف هوية الفاعل مع العنوان', async () => {
    const trail = await as(musalli, 'getMosqueAuditTrail', { mosqueId: mosque.id });
    assert.ok(trail.every((entry) => entry.actorId === undefined),
      'هوية الفاعل مُعادة مع السجلّ');
    assert.ok(trail.every((entry) => !/سالم بن راشد|الشيخ سعيد/.test(
      JSON.stringify(entry))), 'اسم الفاعل تسرّب إلى السجلّ');
  });
});
