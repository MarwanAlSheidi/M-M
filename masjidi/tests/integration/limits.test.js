/**
 * اختبار تكامل: حدود المنصّة وسحب التكليف على خادم حقيقي.
 *
 * ما لا يراه البديل هنا: `count()` كما ينفّذها المحوّل، و`unset` على حقول
 * الـPointer، وقيم المخطط الافتراضية في `abandonedJobs`.
 *
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:integration`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startStack, applySchema, unavailableReason } = require('./harness');

const skip = unavailableReason();
const options = skip ? { skip } : {};

test('الحدود وسحب التكليف على خادم حقيقي', options, async (t) => {
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

  /**
   * قراءة حقول المستخدم بلا لمس كائن الجلسة.
   * `user.fetch({ useMasterKey: true })` يمسح رمز الجلسة من الكائن، فتفشل كل
   * استدعاءات ما بعده بـ«يجب تسجيل الدخول» — وهو فشلٌ يُقرأ خطأً على أنه القيد.
   */
  const field = async (user, name) => {
    const fresh = await new Parse.Query(Parse.User).get(user.id, { useMasterKey: true });
    return fresh.get(name);
  };

  /** يرفض النجاح، ويرفض أيضاً الفشل لسبب غير المقصود. */
  async function rejects(fn, expected) {
    let caught = null;
    try { await fn(); } catch (error) { caught = error; }
    assert.ok(caught, 'نجحت العملية وكان يجب أن تُرفض');
    assert.equal(/تسجيل الدخول|Invalid session/i.test(caught.message), false,
      `فشلت لانقطاع الجلسة لا للقيد المقصود: ${caught.message}`);
    if (expected) assert.match(caught.message, expected);
    return caught.message;
  }

  const imam = await signUp('imam', 'الشيخ سعيد');
  const volunteer = await signUp('volunteer', 'سالم');
  const other = await signUp('volunteer', 'خالد');

  // مسجدان: لكل مسجد سقف عشرة طلبات مفتوحة، والسيناريو يحتاج أحد عشر
  const mosques = [];
  for (let i = 0; i < 2; i += 1) {
    const mosque = new (Parse.Object.extend('Mosques'))();
    mosque.set({
      externalId: `limits_${Date.now()}_${i}`, name: `مسجد التجربة ${i + 1}`,
      governorate: 'مسقط', isClaimed: true, imamId: imam, lat: 23.6, lng: 58.5,
    });
    await mosque.save(null, { useMasterKey: true });
    mosques.push(mosque);
  }

  let made = 0;
  const newRequest = () => as(imam, 'createServiceRequest', {
    mosqueId: mosques[Math.floor(made++ / 6)].id,
    title: `عمل رقم ${made}`,
    description: 'وصف كافٍ لهذا الطلب',
  });

  const requests = [];
  for (let i = 0; i < 11; i += 1) requests.push(await newRequest());

  await t.test('الاهتمامات المفتوحة محدودة بعشرة', async () => {
    for (let i = 0; i < 10; i += 1) {
      await as(volunteer, 'expressInterest', { requestId: requests[i].objectId });
    }
    await rejects(
      () => as(volunteer, 'expressInterest', { requestId: requests[10].objectId }),
      /اهتماماً مفتوحاً/);
  });

  await t.test('التكليفات المتزامنة محدودة بثلاثة', async () => {
    for (let i = 0; i < 3; i += 1) {
      await as(imam, 'assignWorker', { requestId: requests[i].objectId, workerId: volunteer.id });
    }
    await rejects(
      () => as(imam, 'assignWorker', { requestId: requests[3].objectId, workerId: volunteer.id }),
      /لم تُنجَز/);
  });

  await t.test('السحب يُعيد الطلب ويُقيّد الغياب', async () => {
    const result = await as(imam, 'releaseAssignment',
      { requestId: requests[0].objectId, reason: 'no_show' });

    assert.equal(result.status, 'open_for_volunteers');
    assert.equal(result.noShowRecorded, true);
    assert.equal(await field(volunteer, 'abandonedJobs'), 1);

    const stored = await new Parse.Query('ServiceRequests')
      .get(requests[0].objectId, { useMasterKey: true });
    assert.equal(stored.get('assignedVolunteerId'), undefined,
      'بقاء التكليف في القاعدة يمنع تعيين غيره');
  });

  await t.test('المكان تفرّغ فيُقبل تكليف رابع', async () => {
    const result = await as(imam, 'assignWorker',
      { requestId: requests[3].objectId, workerId: volunteer.id });
    assert.equal(result.status, 'assigned');
  });

  await t.test('المسحوب منه لا يُعيد التسجيل، وغيره يسجّل', async () => {
    await rejects(
      () => as(volunteer, 'expressInterest', { requestId: requests[0].objectId }),
      /سُحب منك/);

    const ok = await as(other, 'expressInterest', { requestId: requests[0].objectId });
    assert.ok(ok.interestId, 'أُقصي من لم يُسحب منه شيء');
  });

  await t.test('الإمام يرى مرّات التغيّب قبل أن يختار', async () => {
    await as(volunteer, 'withdrawInterest', { requestId: requests[4].objectId });
    await as(volunteer, 'expressInterest', { requestId: requests[4].objectId });

    const list = await as(imam, 'getRequestInterests', { requestId: requests[4].objectId });
    const salim = list.find((row) => row.volunteerId === volunteer.id);
    assert.equal(salim.abandonedJobs, 1, 'الإمام يختار بلا أن يعلم بتغيّبه');
    assert.equal(salim.phone, undefined, 'الهاتف لا يُكشف قبل التكليف');
  });

  await t.test('المنفّذ ينسحب بنفسه بلا أن يُقيَّد عليه', async () => {
    const before = await field(volunteer, 'abandonedJobs');
    const result = await as(volunteer, 'releaseAssignment', { requestId: requests[1].objectId });

    assert.equal(result.status, 'open_for_volunteers');
    assert.equal(result.noShowRecorded, false);
    assert.equal(await field(volunteer, 'abandonedJobs'), before,
      'عوقب المنسحب المُعلن، فلا يبقى للمنفّذ إلا الصمت');
  });

  await t.test('لا سحب بعد بدء التنفيذ، ولا من غير المكلَّف', async () => {
    await as(volunteer, 'startWork', { requestId: requests[2].objectId });
    await rejects(
      () => as(imam, 'releaseAssignment', { requestId: requests[2].objectId, reason: 'no_show' }),
      /قبل بدء التنفيذ/);
    await rejects(
      () => as(other, 'releaseAssignment', { requestId: requests[3].objectId }),
      /غير مُسند إليك/);
  });
});
