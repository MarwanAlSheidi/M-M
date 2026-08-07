/**
 * دورة حياة طلب الصيانة: الإنشاء، الإلغاء، الاعتماد، والصرف.
 *
 * كل حالة هنا تُقابل بنداً كان في «ما لم يُعالَج» بـ`docs/REVIEW.md`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCloud } = require('./helpers/parse-mock');

test('طلبات الصيانة', async (t) => {
  let api;
  let imam;
  let volunteer;
  let mosque;

  t.beforeEach(() => {
    api = loadCloud('modular');
    imam = api.asUser('user_imam', 'imam');
    volunteer = api.asUser('user_volunteer', 'volunteer');
    mosque = api.make('Mosques', { name: 'مسجد الاختبار', walletBalance: 0, isClaimed: true, imamId: imam });
  });

  const requestAt = (status, extra = {}) => api.make('ServiceRequests', {
    mosqueId: mosque,
    title: 'إصلاح المكيّف',
    estimatedCost: 0,
    fundedAmount: 0,
    status,
    ...extra,
  });

  await t.test('التكلفة غير الرقمية تُرفض بدل أن تصير طلباً تطوّعياً', async () => {
    const { error } = await api.call('createServiceRequest',
      { title: 'إصلاح', description: 'وصف كافٍ للطلب', estimatedCost: 'كثير' },
      { user: imam });

    assert.equal(error.code, api.ParseError.VALIDATION_ERROR,
      '`Number(x) || 0` كان يبتلع NaN فيُنشئ طلباً بتكلفة صفر');
  });

  await t.test('غياب التكلفة يعني طلباً تطوّعياً', async () => {
    const { ok } = await api.call('createServiceRequest',
      { title: 'تنظيف', description: 'تنظيف السجاد قبل الجمعة' }, { user: imam });

    assert.equal(ok.estimatedCost, 0);
    assert.equal(ok.status, 'open_for_volunteers');
  });

  await t.test('لا يُلغى الطلب بعد بدء التنفيذ', async () => {
    for (const status of ['in_progress', 'pending_imam_approval']) {
      const serviceRequest = requestAt(status, { assignedVolunteerId: volunteer });
      const { error } = await api.call('cancelServiceRequest',
        { requestId: serviceRequest.id }, { user: imam });

      assert.equal(error.code, api.ParseError.OPERATION_FORBIDDEN, `أُلغي وهو ${status}`);
      assert.equal(serviceRequest.get('status'), status);
    }
  });

  await t.test('الإلغاء قبل التنفيذ يمرّ ويُشعر المكلَّف', async () => {
    const serviceRequest = requestAt('assigned', { assignedVolunteerId: volunteer });
    const { ok } = await api.call('cancelServiceRequest',
      { requestId: serviceRequest.id }, { user: imam });

    assert.equal(ok.status, 'cancelled');
    assert.equal(api.pushes.length, 1, 'المتطوّع قد يكون في طريقه إلى المسجد');
    assert.equal(api.pushes[0].users[0].id, volunteer.id);
  });

  await t.test('الاعتماد يُحدّث تقييم المنفّذ وعدد أعماله', async () => {
    const worker = api.make('_User', { role: 'volunteer', completedJobs: 0 });
    const serviceRequest = requestAt('pending_imam_approval', { assignedVolunteerId: worker });

    await api.call('completeService', { requestId: serviceRequest.id, rating: 4 }, { user: imam });

    assert.equal(worker.get('completedJobs'), 1);
    assert.equal(worker.get('avgRating'), 4);

    const second = requestAt('pending_imam_approval', { assignedVolunteerId: worker });
    await api.call('completeService', { requestId: second.id, rating: 2 }, { user: imam });

    assert.equal(worker.get('completedJobs'), 2);
    assert.equal(worker.get('avgRating'), 3, 'المتوسط التراكمي (4+2)/2');
  });

  await t.test('الصرف لا يتجاوز الرصيد ولو تزامن', async () => {
    const admin = api.asUser('user_admin', 'admin');
    mosque.set('walletBalance', 500);

    const first = requestAt('completed', { estimatedCost: 500 });
    const second = requestAt('completed', { estimatedCost: 500 });

    // صرفان متزامنان على مسجد رصيده يكفي واحداً منهما فقط
    const [a, b] = await Promise.all([
      api.call('payoutContractor', { requestId: first.id, amount: 500 }, { user: admin }),
      api.call('payoutContractor', { requestId: second.id, amount: 500 }, { user: admin }),
    ]);

    const succeeded = [a, b].filter((r) => r.ok).length;
    assert.equal(succeeded, 1, 'نجح الصرفان معاً — الرصيد صار سالباً');
    assert.equal(mosque.get('walletBalance'), 0, 'التعويض لم يُعِد المبلغ المرفوض');
  });

  await t.test('الصرف المكرَّر لنفس الطلب مرفوض', async () => {
    const admin = api.asUser('user_admin', 'admin');
    mosque.set('walletBalance', 1000);
    const serviceRequest = requestAt('completed', { estimatedCost: 500 });

    await api.call('payoutContractor', { requestId: serviceRequest.id, amount: 500 }, { user: admin });
    const again = await api.call('payoutContractor',
      { requestId: serviceRequest.id, amount: 500 }, { user: admin });

    assert.equal(again.error.code, api.ParseError.DUPLICATE_VALUE);
    assert.equal(mosque.get('walletBalance'), 500);
  });
});

test('طلبات ملكية المسجد', async (t) => {
  let api;
  let imam;

  t.beforeEach(() => {
    api = loadCloud('modular');
    imam = api.asUser('user_imam', 'imam');
  });

  await t.test('الإمام يرى حالة طلبه', async () => {
    const mosque = api.make('Mosques', { name: 'جامع السلطان', wilayat: 'العامرات' });
    api.make('MosqueClaims', { imamId: imam, mosqueId: mosque, status: 'pending', evidenceNote: 'إفادة' });

    const { ok } = await api.call('getMyClaims', {}, { user: imam });

    assert.equal(ok.length, 1);
    assert.equal(ok[0].status, 'pending');
    assert.equal(ok[0].mosqueName, 'جامع السلطان',
      'MosqueClaims مقفلة على Master Key فلا سبيل آخر للإمام لمعرفة الحالة');
  });

  await t.test('لا يرى طلبات غيره', async () => {
    const other = api.asUser('user_other_imam', 'imam');
    const mosque = api.make('Mosques', { name: 'مسجد آخر' });
    api.make('MosqueClaims', { imamId: other, mosqueId: mosque, status: 'approved' });

    const { ok } = await api.call('getMyClaims', {}, { user: imam });
    assert.equal(ok.length, 0);
  });
});
