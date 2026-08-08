/**
 * صندوق الوارد.
 *
 * `Parse.Push` لا يصل إلا لمن سُجّل له Installation ورُبط بحسابه، وتطبيق الويب
 * لا يسجّله. فكان كل إشعار في المنصّة يذهب إلى لا أحد بينما تعيد الدالة
 * `{ sent: n }` فتُبلّغ بنجاحٍ لم يقع. هذه الحالات تحرس القناة التي تصل فعلاً.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCloud } = require('./helpers/parse-mock');

test('صندوق الوارد', async (t) => {
  let api;
  let imam;
  let volunteer;
  let mosque;

  t.beforeEach(() => {
    api = loadCloud('modular');
    imam = api.make('_User', { role: 'imam', fullName: 'الإمام' });
    volunteer = api.make('_User', { role: 'volunteer', fullName: 'سالم' });
    mosque = api.make('Mosques', { name: 'مسجد الاختبار', isClaimed: true, imamId: imam });
  });

  const openRequest = () => api.make('ServiceRequests',
    { mosqueId: mosque, title: 'تصليح إنارة', estimatedCost: 0, status: 'open_for_volunteers' });

  const inbox = () => api.store.Notifications || [];

  await t.test('الاهتمام يترك أثراً في وارد الإمام لا في الهواء', async () => {
    await api.call('expressInterest', { requestId: openRequest().id }, { user: volunteer });

    assert.equal(inbox().length, 1, 'الإشعار ذهب إلى الدفع وحده — ولا Installation مسجَّل');
    assert.equal(inbox()[0].get('userId').id, imam.id);
    assert.match(inbox()[0].get('body'), /متطوّع مهتمّ/);
  });

  await t.test('التكليف يصل المنفّذ ولو لم يصل الدفع', async () => {
    const serviceRequest = openRequest();
    await api.call('assignWorker',
      { requestId: serviceRequest.id, workerId: volunteer.id }, { user: imam });

    const mine = inbox().filter((n) => n.get('userId').id === volunteer.id);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].get('requestId'), serviceRequest.id,
      'بلا معرّف الطلب لا يعرف المنفّذ أيّ عمل كُلّف به');
  });

  await t.test('صاحب الوارد وحده يقرأه', async () => {
    await api.call('expressInterest', { requestId: openRequest().id }, { user: volunteer });

    const { ok } = await api.call('getMyNotifications', {}, { user: imam });
    assert.equal(ok.items.length, 1);
    assert.equal(ok.unread, 1);

    const other = await api.call('getMyNotifications', {}, { user: volunteer });
    assert.equal(other.ok.items.length, 0, 'وصل إلى وارد غيره');
  });

  await t.test('التعليم مقروءاً يُصفّر العدّاد ولا يحذف', async () => {
    await api.call('expressInterest', { requestId: openRequest().id }, { user: volunteer });

    const marked = await api.call('markNotificationsRead', {}, { user: imam });
    assert.equal(marked.ok.marked, 1);

    const { ok } = await api.call('getMyNotifications', {}, { user: imam });
    assert.equal(ok.unread, 0);
    assert.equal(ok.items.length, 1, 'المقروء يبقى — التعليم ليس حذفاً');
    assert.ok(ok.items[0].readAt);
  });

  await t.test('لا يُعلَّم وارد الغير مقروءاً بتمرير معرّفاته', async () => {
    await api.call('expressInterest', { requestId: openRequest().id }, { user: volunteer });
    const target = inbox()[0];

    const { ok } = await api.call('markNotificationsRead',
      { ids: [target.id] }, { user: volunteer });

    assert.equal(ok.marked, 0, 'أخفى عن الإمام إشعاراً لم يره');
    assert.equal(target.get('readAt'), undefined);
  });

  await t.test('فشل الحفظ لا يُسقط العملية التي يُبلّغ عنها', async () => {
    const serviceRequest = openRequest();
    const original = Parse.Object.saveAll;
    Parse.Object.saveAll = async () => { throw new Error('القاعدة ممتلئة'); };

    const { ok, error } = await api.call('assignWorker',
      { requestId: serviceRequest.id, workerId: volunteer.id }, { user: imam });

    Parse.Object.saveAll = original;
    assert.equal(error, undefined, 'سقط التكليف لأن إشعاراً لم يُحفَظ');
    assert.equal(ok.status, 'assigned');
  });

  await t.test('البثّ الواسع لا يُخزَّن — الفرصة القريبة لها قناتها', async () => {
    for (let i = 0; i < 3; i += 1) {
      api.make('_User', { role: 'volunteer', isActive: true, governorate: 'مسقط' });
    }
    mosque.set('governorate', 'مسقط');
    const before = inbox().length;

    await api.call('createServiceRequest',
      { mosqueId: mosque.id, title: 'تنظيف', description: 'تنظيف السجاد قبل الجمعة' },
      { user: imam });

    assert.equal(inbox().length, before,
      'سطرٌ لكل متطوّع قريب عند كل طلب يُنهك باقة الطلبات بلا فائدة');
    assert.ok(api.pushes.length > 0, 'الدفع نفسه يبقى — البثّ لا يُلغى');
  });
});

test('تقليم صندوق الوارد', async (t) => {
  await t.test('القديم يُحذف والحديث يبقى', async () => {
    const api = loadCloud('modular');
    const user = api.make('_User', { role: 'volunteer' });
    const daysAgo = (n) => new Date(Date.now() - n * 24 * 3600 * 1000);

    api.make('Notifications', { userId: user, body: 'قديم' }, daysAgo(120));
    api.make('Notifications', { userId: user, body: 'حديث' }, daysAgo(10));

    const { messages } = await api.runJob('pruneNotifications', {});

    assert.equal(api.store.Notifications.length, 1);
    assert.equal(api.store.Notifications[0].get('body'), 'حديث');
    assert.match(messages.at(-1), /1 إشعاراً أقدم من 90/);
  });

  await t.test('مدّة الاحتفاظ لها حدّ أدنى', async () => {
    const api = loadCloud('modular');
    const user = api.make('_User', { role: 'volunteer' });
    api.make('Notifications', { userId: user, body: 'أمس' },
      new Date(Date.now() - 2 * 24 * 3600 * 1000));

    // صفرٌ يمسح الصندوق كلّه — الحدّ الأدنى يمنع ذلك بالخطأ
    await api.runJob('pruneNotifications', { retentionDays: 0 });
    assert.equal(api.store.Notifications.length, 1);
  });
});
