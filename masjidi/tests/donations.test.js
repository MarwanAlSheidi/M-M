/**
 * المسار المالي: تأكيد التبرّع وحجز نيّات التبرّع.
 *
 * كل حالة هنا تُقابل ثغرة أُصلحت — راجع `docs/REVIEW.md` قبل تعديل أي توقُّع.
 * الاختبارات تُشغَّل على النسختين المجزّأة والمدمجة، فأي انحراف بينهما يظهر هنا.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCloud, ENTRIES } = require('./helpers/parse-mock');

const OMR = (baisa) => baisa * 1000;

for (const entry of Object.keys(ENTRIES)) {
  test(`التبرعات — النسخة ${entry}`, async (t) => {
    let api;
    let donor;
    let attacker;
    let mosque;

    t.beforeEach(() => {
      api = loadCloud(entry);
      donor = api.asUser('user_donor');
      attacker = api.asUser('user_attacker');
      mosque = api.make('Mosques', { name: 'مسجد الاختبار', walletBalance: 0 });
    });

    /** طلب صيانة مموّل بتكلفة 500 ريال، بلا تمويل بعد. */
    const openRequest = () => api.make('ServiceRequests', {
      mosqueId: mosque,
      title: 'إصلاح المكيّف',
      estimatedCost: 500,
      fundedAmount: 0,
      status: 'pending_funding',
    });

    const pendingDonation = (serviceRequest, amount = 500, ageMinutes = 0) =>
      api.make('Transactions', {
        donorId: donor,
        mosqueId: mosque,
        requestId: serviceRequest,
        amount,
        type: 'donation',
        status: 'pending',
        paymentSessionId: 'sess_test',
      }, new Date(Date.now() - ageMinutes * 60 * 1000));

    await t.test('لا يؤكّد المعاملةَ إلا صاحبها', async () => {
      const transaction = pendingDonation(openRequest());
      api.gateway.status = 'unpaid';

      const { error } = await api.call('confirmDonation',
        { transactionId: transaction.id }, { user: attacker });

      assert.equal(error.code, api.ParseError.OPERATION_FORBIDDEN);
      assert.equal(transaction.get('status'), 'pending',
        'محاولة الغريب يجب ألا تمسّ حالة المعاملة');
    });

    await t.test('الجلسة المفتوحة تبقى pending فلا يضيع الدفع اللاحق', async () => {
      const serviceRequest = openRequest();
      const transaction = pendingDonation(serviceRequest);

      // يعود المتبرّع قبل أن يُتمّ الدفع
      api.gateway.status = 'unpaid';
      const early = await api.call('confirmDonation',
        { transactionId: transaction.id }, { user: donor });

      assert.equal(early.ok.status, 'pending');
      assert.equal(transaction.get('status'), 'pending',
        'تعليمها failed هنا يُسقطها من شرط pending فيضيع المبلغ');

      // ثم يدفع فعلاً ويعود
      api.gateway.status = 'paid';
      api.gateway.amountBaisa = OMR(500);
      const settled = await api.call('confirmDonation',
        { transactionId: transaction.id }, { user: donor });

      assert.equal(settled.ok.status, 'captured');
      assert.equal(mosque.get('walletBalance'), 500);
      assert.equal(serviceRequest.get('status'), 'funded');
    });

    await t.test('الجلسة الملغاة وحدها تُعلَّم failed', async () => {
      const transaction = pendingDonation(openRequest(), 100);
      api.gateway.status = 'cancelled';

      const { ok } = await api.call('confirmDonation',
        { transactionId: transaction.id }, { user: donor });

      assert.equal(ok.status, 'failed');
      assert.equal(transaction.get('status'), 'failed');
    });

    await t.test('استدعاء webhook بـ Master Key يمرّ بلا مستخدم', async () => {
      const transaction = pendingDonation(openRequest());
      api.gateway.status = 'paid';
      api.gateway.amountBaisa = OMR(500);

      const { ok } = await api.call('confirmDonation',
        { transactionId: transaction.id }, { master: true });

      assert.equal(ok.status, 'captured');
    });

    await t.test('التأكيد المكرَّر لا يضاعف الرصيد', async () => {
      const transaction = pendingDonation(openRequest());
      api.gateway.status = 'paid';
      api.gateway.amountBaisa = OMR(500);

      await api.call('confirmDonation', { transactionId: transaction.id }, { user: donor });
      const again = await api.call('confirmDonation',
        { transactionId: transaction.id }, { user: donor });

      assert.equal(again.ok.status, 'captured');
      assert.equal(mosque.get('walletBalance'), 500, 'قُيّد المبلغ مرتين');
    });

    await t.test('مبلغ البوابة المخالف يُرفض ويُعلَّم mismatch', async () => {
      const transaction = pendingDonation(openRequest());
      api.gateway.status = 'paid';
      api.gateway.amountBaisa = OMR(5); // دُفع 5 بدل 500

      const { error } = await api.call('confirmDonation',
        { transactionId: transaction.id }, { user: donor });

      assert.equal(error.code, api.ParseError.VALIDATION_ERROR);
      assert.equal(transaction.get('status'), 'mismatch');
      assert.equal(mosque.get('walletBalance'), 0);
    });

    await t.test('نيّة التبرّع المعلّقة تحجز المبلغ فيُمنع التمويل الزائد', async () => {
      const serviceRequest = openRequest();

      const first = await api.call('initiateDonation',
        { requestId: serviceRequest.id, amount: 500 }, { user: donor });
      assert.ok(first.ok, 'المتبرّع الأول يجب أن يُقبل');

      const second = await api.call('initiateDonation',
        { requestId: serviceRequest.id, amount: 500 }, { user: attacker });

      assert.equal(second.error.code, api.ParseError.VALIDATION_ERROR,
        'بلا حجز يدفع الاثنان فتُقبض 1000 ريال لطلب تكلفته 500');
    });

    await t.test('الحجز المهجور يسقط بعد المهلة', async () => {
      const serviceRequest = openRequest();
      pendingDonation(serviceRequest, 500, 31); // معلّقة منذ 31 دقيقة

      const { ok } = await api.call('initiateDonation',
        { requestId: serviceRequest.id, amount: 500 }, { user: donor });

      assert.ok(ok, 'متبرّع لم يُكمل الدفع يجب ألا يُعطّل الطلب إلى الأبد');
    });

    await t.test('الحجز الجزئي يترك الباقي متاحاً', async () => {
      const serviceRequest = openRequest();
      pendingDonation(serviceRequest, 200);

      const fits = await api.call('initiateDonation',
        { requestId: serviceRequest.id, amount: 300 }, { user: attacker });
      assert.ok(fits.ok, 'المتبقي 300 ريال فيجب أن يُقبل');

      const overflows = await api.call('initiateDonation',
        { requestId: serviceRequest.id, amount: 1 }, { user: attacker });
      assert.ok(overflows.error, 'لم يبقَ شيء بعد الحجزين');
    });
  });
}
