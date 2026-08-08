/**
 * اختبار تكامل: صندوق الوارد على خادم حقيقي **بصفر Installation مسجَّل**.
 *
 * وهو بيت القصيد. `Parse.Push` لا يصل إلا لجهازٍ سُجّل ورُبط بحسابه، وتطبيق
 * الويب لا يسجّله — فكل ما يصل هنا، يصل بلا دفع. راجع «جولة حادية عشرة».
 *
 * ويغطّي ما لا يراه البديل: الصلاحيات كما يطبّقها الخادم فعلاً على قراءة
 * `Notifications` مباشرةً.
 *
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:integration`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startStack, applySchema, unavailableReason } = require('./harness');

const skip = unavailableReason();
const options = skip ? { skip } : {};

test('صندوق الوارد على خادم حقيقي', options, async (t) => {
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
  const nearby = await signUp('volunteer', 'خالد');

  const mosque = new (Parse.Object.extend('Mosques'))();
  mosque.set({
    externalId: `inbox_${Date.now()}`, name: 'مسجد الوارد', governorate: 'مسقط',
    isClaimed: true, imamId: imam, lat: 23.6, lng: 58.5,
  });
  await mosque.save(null, { useMasterKey: true });

  const request = await as(imam, 'createServiceRequest',
    { mosqueId: mosque.id, title: 'تصليح الإنارة', description: 'إنارة الصحن معطّلة' });

  await t.test('لا جهاز مسجَّل إطلاقاً — فالدفع لا يصل أحداً', async () => {
    const installations = await new Parse.Query(Parse.Installation)
      .count({ useMasterKey: true });
    assert.equal(installations, 0);
  });

  await t.test('الاهتمام يصل وارد الإمام رغم ذلك', async () => {
    await as(volunteer, 'expressInterest', { requestId: request.objectId, note: 'أستطيع الجمعة' });

    const box = await as(imam, 'getMyNotifications');
    assert.equal(box.unread, 1);
    assert.match(box.items[0].body, /متطوّع مهتمّ/);
  });

  await t.test('وارد كل امرئ له وحده', async () => {
    const box = await as(volunteer, 'getMyNotifications');
    assert.equal(box.items.length, 0, 'وصل إلى وارد غيره');
  });

  await t.test('التكليف يصل المنفّذ ومعه معرّف الطلب', async () => {
    await as(imam, 'assignWorker', { requestId: request.objectId, workerId: volunteer.id });

    const box = await as(volunteer, 'getMyNotifications');
    assert.match(box.items[0].body, /تم تكليفك/);
    assert.equal(box.items[0].requestId, request.objectId,
      'بلا معرّف الطلب لا يعرف المنفّذ أيّ عمل كُلّف به');
  });

  await t.test('لا يُعلَّم وارد الغير مقروءاً بتمرير معرّفاته', async () => {
    const imamBox = await as(imam, 'getMyNotifications');
    const target = imamBox.items[0].id;

    const attempt = await as(volunteer, 'markNotificationsRead', { ids: [target] });
    assert.equal(attempt.marked, 0, 'أخفى عن الإمام إشعاراً لم يره');

    const after = await as(imam, 'getMyNotifications');
    assert.equal(after.unread, imamBox.unread, 'تغيّر عدّاد الإمام بفعل غيره');
  });

  await t.test('صاحبه يُعلّمه، والمقروء يبقى', async () => {
    const before = await as(imam, 'getMyNotifications');
    const marked = await as(imam, 'markNotificationsRead');
    assert.equal(marked.marked, before.unread);

    const after = await as(imam, 'getMyNotifications');
    assert.equal(after.unread, 0);
    assert.equal(after.items.length, before.items.length, 'التعليم ليس حذفاً');
    assert.ok(after.items[0].readAt);
  });

  await t.test('سحب التكليف يصل المنفّذ أيضاً', async () => {
    await as(imam, 'releaseAssignment', { requestId: request.objectId, reason: 'no_show' });

    const box = await as(volunteer, 'getMyNotifications');
    assert.match(box.items[0].body, /سُحب تكليفك/);
  });

  await t.test('البثّ الواسع لا يُخزَّن', async () => {
    await as(nearby, 'updateMyLocation', { lat: 23.601, lng: 58.501 });
    const before = (await as(nearby, 'getMyNotifications')).items.length;

    await as(imam, 'createServiceRequest',
      { mosqueId: mosque.id, title: 'تنظيف السجاد', description: 'قبل صلاة الجمعة' });

    const after = (await as(nearby, 'getMyNotifications')).items.length;
    assert.equal(after, before,
      'سطرٌ لكل متطوّع قريب عند كل طلب يُنهك باقة الطلبات — والفرصة لها قناتها');
  });

  await t.test('الوارد لا يُقرأ بتجاوز دالة السحابة', async () => {
    await assert.rejects(
      () => new Parse.Query('Notifications').find({ sessionToken: tokens.get(volunteer.id) }),
      /Permission denied/);
  });
});
