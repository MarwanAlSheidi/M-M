/**
 * سجل التدقيق والمهمة الدورية لمراجعة المعاملات المعلّقة.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCloud } = require('./helpers/parse-mock');

const OMR = (baisa) => baisa * 1000;

test('سجل التدقيق', async (t) => {
  let api;
  let imam;
  let mosque;

  t.beforeEach(() => {
    api = loadCloud('modular');
    imam = api.asUser('user_imam', 'imam');
    mosque = api.make('Mosques', { name: 'مسجد الاختبار', walletBalance: 0, isClaimed: true, imamId: imam });
  });

  const trail = () => api.store.AuditLog || [];

  await t.test('إنشاء الطلب يُقيَّد', async () => {
    await api.call('createServiceRequest',
      { title: 'تنظيف', description: 'تنظيف السجاد قبل الجمعة' }, { user: imam });

    assert.equal(trail().length, 1);
    assert.equal(trail()[0].get('action'), 'request_created');
    assert.equal(trail()[0].get('actorRole'), 'imam');
    assert.equal(trail()[0].get('toStatus'), 'open_for_volunteers');
  });

  await t.test('الإلغاء يُقيَّد بحالته السابقة', async () => {
    const serviceRequest = api.make('ServiceRequests',
      { mosqueId: mosque, title: 'إصلاح', status: 'assigned', fundedAmount: 0 });

    await api.call('cancelServiceRequest', { requestId: serviceRequest.id }, { user: imam });

    const entry = trail().find((e) => e.get('action') === 'request_cancelled');
    assert.ok(entry, 'لم يُقيَّد الإلغاء');
    assert.equal(entry.get('fromStatus'), 'assigned');
    assert.equal(entry.get('toStatus'), 'cancelled');
  });

  await t.test('السجل المعروض يُظهر الدور لا هوية الفاعل', async () => {
    await api.call('createServiceRequest',
      { title: 'تنظيف', description: 'تنظيف السجاد قبل الجمعة' }, { user: imam });

    const { ok } = await api.call('getMosqueAuditTrail',
      { mosqueId: mosque.id }, { user: api.asUser('any_donor') });

    assert.equal(ok.length, 1);
    assert.equal(ok[0].actorRole, 'imam');
    assert.equal(ok[0].actorId, undefined, 'هوية الفاعل يجب ألا تُعاد');
  });

  await t.test('فشل القيد لا يُسقط العملية التي يوثّقها', async () => {
    // اعتماد عمل منجَز يجب ألا يفشل لأن سطر تدقيق لم يُكتب
    const original = Parse.Object.extend;
    Parse.Object.extend = (className) => {
      if (className === 'AuditLog') {
        return class { set() { return this; } async save() { throw new Error('تعذّرت الكتابة'); } };
      }
      return original(className);
    };

    try {
      const serviceRequest = api.make('ServiceRequests',
        { mosqueId: mosque, title: 'إصلاح', status: 'pending_imam_approval' });
      const { ok } = await api.call('completeService',
        { requestId: serviceRequest.id, rating: 5 }, { user: imam });

      assert.equal(ok.status, 'completed');
      assert.equal(serviceRequest.get('status'), 'completed');
    } finally {
      Parse.Object.extend = original;
    }
  });
});

test('مراجعة المعاملات المعلّقة', async (t) => {
  let api;
  let mosque;
  let serviceRequest;

  t.beforeEach(() => {
    api = loadCloud('modular');
    mosque = api.make('Mosques', { name: 'مسجد الاختبار', walletBalance: 0 });
    serviceRequest = api.make('ServiceRequests',
      { mosqueId: mosque, title: 'إصلاح', estimatedCost: 500, fundedAmount: 0, status: 'pending_funding' });
  });

  const stalePending = (ageMinutes) => api.make('Transactions', {
    donorId: api.asUser('user_donor'),
    mosqueId: mosque,
    requestId: serviceRequest,
    amount: 500,
    type: 'donation',
    status: 'pending',
    paymentSessionId: 'sess_stale',
  }, new Date(Date.now() - ageMinutes * 60 * 1000));

  await t.test('الدفع الذي لم يعد صاحبه لتأكيده يُقيَّد', async () => {
    const transaction = stalePending(45);
    api.gateway.status = 'paid';
    api.gateway.amountBaisa = OMR(500);

    const { result } = await api.runJob('reviewPendingDonations');

    assert.match(result, /قُيّدت 1/);
    assert.equal(transaction.get('status'), 'captured');
    assert.equal(mosque.get('walletBalance'), 500, 'أُغلق المسار الذي يُبقي المال معلّقاً');
    assert.equal(serviceRequest.get('status'), 'funded');
  });

  await t.test('الجلسة الملغاة تُعلَّم failed', async () => {
    const transaction = stalePending(45);
    api.gateway.status = 'cancelled';

    await api.runJob('reviewPendingDonations');
    assert.equal(transaction.get('status'), 'failed');
  });

  await t.test('الجلسة المفتوحة تُترك حتى المهلة القصوى', async () => {
    const recent = stalePending(45);
    api.gateway.status = 'unpaid';

    await api.runJob('reviewPendingDonations');
    assert.equal(recent.get('status'), 'pending', 'لم تتجاوز 24 ساعة بعد');

    const ancient = stalePending(25 * 60);
    await api.runJob('reviewPendingDonations');
    assert.equal(ancient.get('status'), 'expired');
  });

  await t.test('المبلغ المخالف لا يُقيَّد', async () => {
    const transaction = stalePending(45);
    api.gateway.status = 'paid';
    api.gateway.amountBaisa = OMR(5); // دُفع 5 بدل 500

    await api.runJob('reviewPendingDonations');

    assert.equal(transaction.get('status'), 'mismatch');
    assert.equal(mosque.get('walletBalance'), 0);
  });

  await t.test('المعاملات الحديثة لا تُمسّ', async () => {
    const fresh = stalePending(5); // ما تزال ضمن مهلة الحجز
    api.gateway.status = 'paid';
    api.gateway.amountBaisa = OMR(500);

    const { result } = await api.runJob('reviewPendingDonations');

    assert.match(result, /فُحصت 0/);
    assert.equal(fresh.get('status'), 'pending');
  });

  // المرحلة الأولى تُطلق بلا بوابة دفع، والمهمة مجدوَلة على أي حال
  await t.test('بلا مفاتيح بوابة تتخطّى المهمة بلا خطأ', async () => {
    const unconfigured = loadCloud('modular', { payments: false });
    const { result, messages } = await unconfigured.runJob('reviewPendingDonations');

    assert.equal(result, 'skipped');
    assert.match(messages[0], /غير مهيأة/);
  });
});

test('نقطة نهاية البوابة', async (t) => {
  let api;
  let mosque;
  let transaction;

  t.beforeEach(() => {
    process.env.PAYMENT_WEBHOOK_SECRET = 'whsec_correct_value';
    api = loadCloud('modular');
    mosque = api.make('Mosques', { name: 'مسجد الاختبار', walletBalance: 0 });
    const serviceRequest = api.make('ServiceRequests',
      { mosqueId: mosque, title: 'إصلاح', estimatedCost: 500, fundedAmount: 0, status: 'pending_funding' });
    transaction = api.make('Transactions', {
      donorId: api.asUser('user_donor'),
      mosqueId: mosque,
      requestId: serviceRequest,
      amount: 500,
      type: 'donation',
      status: 'pending',
      paymentSessionId: 'sess_hook',
    });
  });

  t.afterEach(() => { delete process.env.PAYMENT_WEBHOOK_SECRET; });

  await t.test('السرّ الخاطئ يُرفض', async () => {
    api.gateway.status = 'paid';
    api.gateway.amountBaisa = OMR(500);

    const { error } = await api.call('paymentWebhook',
      { secret: 'whsec_wrong_value___', clientReferenceId: transaction.id });

    assert.equal(error.code, api.ParseError.OPERATION_FORBIDDEN);
    assert.equal(mosque.get('walletBalance'), 0);
  });

  await t.test('السرّ الناقص يُرفض ولو كان بادئةً صحيحة', async () => {
    const { error } = await api.call('paymentWebhook',
      { secret: 'whsec_correct', clientReferenceId: transaction.id });

    assert.equal(error.code, api.ParseError.OPERATION_FORBIDDEN);
  });

  await t.test('السرّ الصحيح يُقيّد الدفع', async () => {
    api.gateway.status = 'paid';
    api.gateway.amountBaisa = OMR(500);

    const { ok } = await api.call('paymentWebhook',
      { secret: 'whsec_correct_value', clientReferenceId: transaction.id });

    assert.equal(ok.status, 'captured');
    assert.equal(mosque.get('walletBalance'), 500);
  });

  await t.test('جسم الطلب لا يُصدَّق — البوابة وحدها تُقرّر', async () => {
    // البوابة تقول "غير مدفوع"، والجسم يدّعي الدفع
    api.gateway.status = 'unpaid';

    const { ok } = await api.call('paymentWebhook', {
      secret: 'whsec_correct_value',
      clientReferenceId: transaction.id,
      payment_status: 'paid',
      total_amount: 500000,
    });

    assert.equal(ok.status, 'pending');
    assert.equal(mosque.get('walletBalance'), 0, 'قُيّد مبلغ بناءً على ادّعاء المُرسِل');
  });

  await t.test('الاستدعاء المكرَّر لا يضاعف الرصيد', async () => {
    api.gateway.status = 'paid';
    api.gateway.amountBaisa = OMR(500);
    const params = { secret: 'whsec_correct_value', clientReferenceId: transaction.id };

    await api.call('paymentWebhook', params);
    const again = await api.call('paymentWebhook', params);

    assert.equal(again.ok.status, 'captured');
    assert.equal(mosque.get('walletBalance'), 500);
  });

  await t.test('بلا سرّ مضبوط تُرفض النقطة كلياً', async () => {
    delete process.env.PAYMENT_WEBHOOK_SECRET;
    const unconfigured = loadCloud('modular');

    const { error } = await unconfigured.call('paymentWebhook',
      { secret: 'anything', clientReferenceId: transaction.id });

    assert.equal(error.code, api.ParseError.OPERATION_FORBIDDEN);
  });
});

test('تقليم سجل التدقيق', async (t) => {
  let api;

  t.beforeEach(() => { api = loadCloud('modular'); });

  const entryAgedDays = (days) => api.make('AuditLog', { action: 'request_created' },
    new Date(Date.now() - days * 24 * 3600 * 1000));

  await t.test('يحذف ما تجاوز مدة الحفظ ويُبقي ما دونها', async () => {
    entryAgedDays(200);
    entryAgedDays(200);
    const kept = entryAgedDays(10);

    const { result } = await api.runJob('pruneAuditLog');

    assert.match(result, /حُذف 2/);
    assert.deepEqual(api.store.AuditLog, [kept]);
  });

  await t.test('مدة الحفظ لا تنزل عن 30 يوماً مهما طُلب', async () => {
    const recent = entryAgedDays(20);

    await api.runJob('pruneAuditLog', { retentionDays: 1 });

    assert.deepEqual(api.store.AuditLog, [recent],
      'مدة أقصر من 30 يوماً تمسح سجلاً ما زال لازماً للمساءلة');
  });

  await t.test('سجل فارغ لا يُخطئ', async () => {
    const { result } = await api.runJob('pruneAuditLog');
    assert.match(result, /حُذف 0/);
  });
});
