/**
 * اختبار تكامل: سلسلة إثبات الإنجاز — رفع الصور والتحقّق من روابطها.
 *
 * الإمام يعتمد عملاً لم يره إلا في صورةٍ رفعها المنفّذ، فسلامة هذه السلسلة هي
 * ما يمنع اعتماداً على غير بيّنة. و`validatePhotos` كانت مُختبَرة على روابط
 * مخترَعة وحدها؛ هنا تُختبَر على `Parse.File` حقيقي رفعه مستخدمٌ حقيقي.
 *
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:integration`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startStack, applySchema, unavailableReason } = require('./harness');

const skip = unavailableReason();
const options = skip ? { skip } : {};

/** أصغر PNG صالح: ترويسة + IHDR + IDAT + IEND. لا حاجة إلى ملفٍّ على القرص. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('صور الإنجاز على خادم حقيقي', options, async (t) => {
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
  const volunteer = await signUp('volunteer', 'سالم');

  const mosque = new (Parse.Object.extend('Mosques'))();
  mosque.set({
    externalId: `photos_${Date.now()}`, name: 'مسجد البيّنة', governorate: 'مسقط',
    isClaimed: true, imamId: imam, lat: 23.6, lng: 58.5,
  });
  await mosque.save(null, { useMasterKey: true });

  const request = await as(imam, 'createServiceRequest',
    { mosqueId: mosque.id, title: 'تصليح الإنارة', description: 'إنارة الصحن معطّلة' });
  await as(volunteer, 'expressInterest', { requestId: request.objectId });
  await as(imam, 'assignWorker', { requestId: request.objectId, workerId: volunteer.id });
  await as(volunteer, 'startWork', { requestId: request.objectId });

  let uploaded = null;

  await t.test('المنفّذ يرفع صورة فعلاً', async () => {
    const file = new Parse.File('work.png', [...PNG], 'image/png');
    await file.save({ sessionToken: tokens.get(volunteer.id) });
    uploaded = file.url();

    assert.ok(uploaded, 'الرفع لم يُعِد رابطاً');
    assert.match(uploaded, /\/files\//);
  });

  await t.test('الرابط المرفوع يُقبل ويُخزَّن كما هو', async () => {
    const done = await as(volunteer, 'markWorkDone',
      { requestId: request.objectId, notes: 'أُبدلت الكشّافات', photoUrls: [uploaded] });

    assert.equal(done.status, 'pending_imam_approval');
    assert.deepEqual(done.completionPhotos, [uploaded]);
  });

  await t.test('الإمام يرى الصورة قبل أن يعتمد', async () => {
    const stored = await new Parse.Query('ServiceRequests')
      .get(request.objectId, { sessionToken: tokens.get(imam.id) });

    assert.deepEqual(stored.get('completionPhotos'), [uploaded],
      'الإمام يعتمد عملاً لا يرى دليله');
  });

  await t.test('الصورة تُجلب فعلاً من الرابط المخزَّن', async () => {
    // الرابط في السجل بلا محتوى ليس دليلاً — والتخزين قد يكون رفض الملف صامتاً
    const response = await fetch(uploaded);
    assert.equal(response.status, 200);
    const body = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(body, PNG, 'المُخزَّن غير المرفوع');
  });

  await t.test('الرابط الخارجي والإفراط في العدد يُرفضان', async () => {
    const another = await as(imam, 'createServiceRequest',
      { mosqueId: mosque.id, title: 'دهان', description: 'دهان الجدار الخارجي' });
    await as(volunteer, 'expressInterest', { requestId: another.objectId });
    await as(imam, 'assignWorker', { requestId: another.objectId, workerId: volunteer.id });
    await as(volunteer, 'startWork', { requestId: another.objectId });

    await assert.rejects(
      () => as(volunteer, 'markWorkDone',
        { requestId: another.objectId, photoUrls: ['https://example.com/proof.png'] }),
      /تخزين التطبيق/,
      'رابطٌ خارجي في السجل يتتبّع الإمام، أو يتغيّر محتواه بعد الاعتماد');

    // ولا يُترك الطلب في حالةٍ لم تقع: التحقّق قبل أي تعديل
    const stored = await new Parse.Query('ServiceRequests')
      .get(another.objectId, { useMasterKey: true });
    assert.equal(stored.get('status'), 'in_progress');
    assert.equal(stored.get('workerNotes'), undefined);

    await assert.rejects(
      () => as(volunteer, 'markWorkDone', {
        requestId: another.objectId,
        photoUrls: Array.from({ length: 7 }, () => uploaded),
      }),
      /أقصى عدد للصور/);
  });

  await t.test('الإمام يعتمد بعد أن رأى', async () => {
    const done = await as(imam, 'completeService', { requestId: request.objectId, rating: 5 });
    assert.equal(done.status, 'completed');
  });
});
