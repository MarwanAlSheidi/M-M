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

  // رُصد على خادم حقيقي: الاستعلام الجغرافي فشل (لا فهرس)، فأسقط إنشاء الطلب
  // بعد أن كان الطلب قد حُفظ فعلاً — فيرى الإمام خطأً ويُعيد المحاولة فيُكرّر.
  await t.test('فشل جلب المتطوّعين القريبين لا يُسقط إنشاء الطلب', async () => {
    const original = Parse.Query.prototype.find;
    Parse.Query.prototype.find = async function patched() {
      if (this.className === '_User') throw new Error('لا يوجد فهرس 2dsphere');
      return original.call(this);
    };

    try {
      const { ok, error } = await api.call('createServiceRequest',
        { title: 'تنظيف', description: 'تنظيف السجاد قبل الجمعة' }, { user: imam });

      assert.equal(error, undefined, error && error.message);
      assert.equal(ok.status, 'open_for_volunteers');
    } finally {
      Parse.Query.prototype.find = original;
    }
  });

  await t.test('فشل إرسال الإشعار نفسه لا يُسقط العملية', async () => {
    const original = Parse.Push.send;
    Parse.Push.send = async () => { throw new Error('تعذّر الإرسال'); };

    try {
      const serviceRequest = requestAt('assigned', { assignedVolunteerId: volunteer });
      const { ok } = await api.call('cancelServiceRequest',
        { requestId: serviceRequest.id }, { user: imam });

      assert.equal(ok.status, 'cancelled');
    } finally {
      Parse.Push.send = original;
    }
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

test('طلبات الإشراف على المسجد', async (t) => {
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

test('اهتمام المتطوّعين', async (t) => {
  let api;
  let imam;
  let volunteer;
  let mosque;
  let openRequest;

  t.beforeEach(() => {
    api = loadCloud('modular');
    imam = api.asUser('user_imam', 'imam');
    volunteer = api.make('_User', { role: 'volunteer', fullName: 'سالم', skills: ['كهرباء'], completedJobs: 3, avgRating: 4.5 });
    mosque = api.make('Mosques', { name: 'مسجد الاختبار', isClaimed: true, imamId: imam });
    openRequest = api.make('ServiceRequests',
      { mosqueId: mosque, title: 'تصليح إنارة', estimatedCost: 0, status: 'open_for_volunteers' });
  });

  await t.test('المتطوّع يُسجّل اهتمامه بلا أن يُسند الطلب لنفسه', async () => {
    const { ok } = await api.call('expressInterest',
      { requestId: openRequest.id, note: 'أستطيع الجمعة' }, { user: volunteer });

    assert.ok(ok.interestId);
    assert.equal(openRequest.get('status'), 'open_for_volunteers',
      'الاهتمام لا يُغيّر الحالة — الإمام هو من يعيّن');
    assert.equal(openRequest.get('assignedVolunteerId'), undefined);
    assert.equal(api.pushes.at(-1).users[0].id, imam.id, 'يجب إشعار الإمام');
  });

  await t.test('لا يُسجَّل اهتمامان لنفس المتطوّع', async () => {
    await api.call('expressInterest', { requestId: openRequest.id }, { user: volunteer });
    const again = await api.call('expressInterest', { requestId: openRequest.id }, { user: volunteer });

    assert.equal(again.error.code, api.ParseError.DUPLICATE_VALUE);
  });

  await t.test('الطلب المموّل لا يستقبل اهتماماً', async () => {
    const funded = api.make('ServiceRequests',
      { mosqueId: mosque, title: 'ترميم', estimatedCost: 500, status: 'pending_funding' });

    const { error } = await api.call('expressInterest', { requestId: funded.id }, { user: volunteer });
    assert.equal(error.code, api.ParseError.VALIDATION_ERROR);
  });

  await t.test('الإمام يرى المهتمّين بمهاراتهم وتقييمهم لا بهواتفهم', async () => {
    await api.call('expressInterest',
      { requestId: openRequest.id, note: 'أستطيع الجمعة' }, { user: volunteer });

    const { ok } = await api.call('getRequestInterests', { requestId: openRequest.id }, { user: imam });

    assert.equal(ok.length, 1);
    assert.equal(ok[0].fullName, 'سالم');
    assert.deepEqual(ok[0].skills, ['كهرباء']);
    assert.equal(ok[0].avgRating, 4.5);
    assert.equal(ok[0].note, 'أستطيع الجمعة');
    assert.equal(ok[0].phone, undefined, 'الهاتف لا يُكشف قبل التكليف');
  });

  await t.test('إمام مسجد آخر لا يرى المهتمّين', async () => {
    await api.call('expressInterest', { requestId: openRequest.id }, { user: volunteer });
    const stranger = api.asUser('other_imam', 'imam');

    const { error } = await api.call('getRequestInterests',
      { requestId: openRequest.id }, { user: stranger });

    assert.ok(error, 'كُشفت قائمة مهتمّين لمسجد غير مسجّل باسمه');
  });

  await t.test('السحب يُخرج المتطوّع من القائمة', async () => {
    await api.call('expressInterest', { requestId: openRequest.id }, { user: volunteer });
    await api.call('withdrawInterest', { requestId: openRequest.id }, { user: volunteer });

    const { ok } = await api.call('getRequestInterests', { requestId: openRequest.id }, { user: imam });
    assert.equal(ok.length, 0);
  });

  await t.test('التكليف يُقفل الاهتمامات المعلّقة', async () => {
    const other = api.make('_User', { role: 'volunteer', fullName: 'خالد' });

    await api.call('expressInterest', { requestId: openRequest.id }, { user: volunteer });
    await api.call('expressInterest', { requestId: openRequest.id }, { user: other });

    await api.call('assignWorker',
      { requestId: openRequest.id, workerId: volunteer.id }, { user: imam });

    const remaining = api.store.TaskInterests.filter((i) => i.get('status') === 'active');
    assert.equal(remaining.length, 0, 'من لم يُختَر يبقى معروضاً كأنه بالانتظار');
  });
});

test('صور الإنجاز', async (t) => {
  let api;
  let imam;
  let worker;
  let mosque;

  t.beforeEach(() => {
    api = loadCloud('modular');
    // الدالة تشتقّ المضيف المسموح من عنوان الخادم
    Parse.serverURL = 'https://parseapi.back4app.com/';
    imam = api.asUser('user_imam', 'imam');
    worker = api.make('_User', { role: 'volunteer', fullName: 'سالم' });
    mosque = api.make('Mosques', { name: 'مسجد الاختبار', isClaimed: true, imamId: imam });
  });

  const inProgress = () => api.make('ServiceRequests', {
    mosqueId: mosque, title: 'دهان', status: 'in_progress', assignedVolunteerId: worker,
  });

  const ok = 'https://parsefiles.back4app.com/appid/work-1.png';

  await t.test('روابط تخزين التطبيق تُقبل وتُحفظ', async () => {
    const request = inProgress();
    await api.call('markWorkDone',
      { requestId: request.id, notes: 'تمّ', photoUrls: [ok] }, { user: worker });

    assert.deepEqual(request.get('completionPhotos'), [ok]);
    assert.equal(request.get('status'), 'pending_imam_approval');
  });

  // بلا هذا الحدّ يُحشر في سجلّ المسجد رابط خارجي: يتتبّع الإمام حين يفتح
  // الطلب، أو يتغيّر محتواه بعد الاعتماد فيصير الدليل غير ما اعتُمد.
  await t.test('الروابط الخارجية وغير الآمنة والفاسدة تُرفض', async () => {
    for (const [label, url] of [
      ['نطاق خارجي', 'https://evil.example.com/track.png'],
      ['بروتوكول غير آمن', 'http://example.org/a.png'],
      ['ليس رابطاً', 'مجرد نص'],
    ]) {
      const request = inProgress();
      const { error } = await api.call('markWorkDone',
        { requestId: request.id, photoUrls: [url] }, { user: worker });

      assert.equal(error.code, api.ParseError.VALIDATION_ERROR, label);
      assert.equal(request.get('status'), 'in_progress', `${label}: تغيّرت الحالة رغم الرفض`);
    }
  });

  await t.test('الإبلاغ بلا صور يمرّ — الإمام يعاين على الطبيعة', async () => {
    const request = inProgress();
    const { ok: result } = await api.call('markWorkDone',
      { requestId: request.id, notes: 'تمّ' }, { user: worker });

    assert.equal(result.status, 'pending_imam_approval');
    assert.deepEqual(request.get('completionPhotos'), []);
  });

  await t.test('أكثر من ستّ صور تُرفض', async () => {
    const request = inProgress();
    const { error } = await api.call('markWorkDone',
      { requestId: request.id, photoUrls: Array(7).fill(ok) }, { user: worker });

    assert.equal(error.code, api.ParseError.VALIDATION_ERROR);
  });
});

test('مساجد الإمام', async (t) => {
  let api;
  let imam;

  t.beforeEach(() => {
    api = loadCloud('modular');
    imam = api.asUser('user_imam', 'imam');
  });

  // الواجهة كانت تشتقّها من MosqueClaims، فمسجد أُسند بغير مسار الطلب لا يراه
  // إمامه رغم أن `mosqueForImam` تقبله
  await t.test('تُشتقّ من imamId لا من طلبات الملكية', async () => {
    api.make('Mosques', { name: 'جامع الوادي', wilayat: 'نزوى', isClaimed: true, imamId: imam,
      openRequestsCount: 2 });

    const { ok } = await api.call('getMyMosques', {}, { user: imam });

    assert.equal(ok.length, 1);
    assert.equal(ok[0].name, 'جامع الوادي');
    assert.equal(ok[0].openRequestsCount, 2);
  });

  await t.test('غير المعتمد لا يظهر', async () => {
    api.make('Mosques', { name: 'مسجد معلّق', isClaimed: false, imamId: imam });
    const { ok } = await api.call('getMyMosques', {}, { user: imam });
    assert.equal(ok.length, 0);
  });

  await t.test('لا يرى مساجد غيره', async () => {
    api.make('Mosques', { name: 'مسجد آخر', isClaimed: true, imamId: api.asUser('other', 'imam') });
    const { ok } = await api.call('getMyMosques', {}, { user: imam });
    assert.equal(ok.length, 0);
  });
});

/**
 * منع سوء الاستخدام: الحدود، وسحب التكليف.
 *
 * كان التكليف طريقاً بلا رجعة ولا حدّ لعدده — البند المفتوح الأخير في
 * `CLAUDE.md`: «لا يوجد منطق لمنع سوء الاستخدام المتكرر».
 */
test('حدود المنصّة وسحب التكليف', async (t) => {
  let api;
  let imam;
  let volunteer;
  let mosque;

  t.beforeEach(() => {
    api = loadCloud('modular');
    imam = api.asUser('user_imam', 'imam');
    volunteer = api.make('_User', { role: 'volunteer', fullName: 'سالم' });
    mosque = api.make('Mosques', { name: 'مسجد الاختبار', isClaimed: true, imamId: imam });
  });

  const openRequest = (extra = {}) => api.make('ServiceRequests',
    { mosqueId: mosque, title: 'تصليح إنارة', estimatedCost: 0, status: 'open_for_volunteers', ...extra });

  const assignedTo = (worker, extra = {}) => api.make('ServiceRequests',
    { mosqueId: mosque, title: 'عمل مكلَّف', estimatedCost: 0, status: 'assigned',
      assignedVolunteerId: worker, ...extra });

  await t.test('الاهتمامات المفتوحة محدودة', async () => {
    for (let i = 0; i < 10; i += 1) {
      const { error } = await api.call('expressInterest',
        { requestId: openRequest().id }, { user: volunteer });
      assert.equal(error, undefined, `رُفض الاهتمام رقم ${i + 1} قبل بلوغ الحدّ`);
    }

    const { error } = await api.call('expressInterest',
      { requestId: openRequest().id }, { user: volunteer });

    assert.equal(error.code, api.ParseError.OPERATION_FORBIDDEN,
      'متطوّع واحد كان يتصدّر قوائم كل الأئمة بلا حدّ');
  });

  await t.test('السحب يُفرّغ مكاناً لاهتمام جديد', async () => {
    const first = openRequest();
    for (let i = 0; i < 9; i += 1) {
      await api.call('expressInterest', { requestId: openRequest().id }, { user: volunteer });
    }
    await api.call('expressInterest', { requestId: first.id }, { user: volunteer });
    await api.call('withdrawInterest', { requestId: first.id }, { user: volunteer });

    const { error } = await api.call('expressInterest',
      { requestId: openRequest().id }, { user: volunteer });
    assert.equal(error, undefined, 'المسحوب ما زال محسوباً على الحدّ');
  });

  await t.test('لا يُكلَّف من عنده ثلاثة أعمال لم تُنجَز', async () => {
    assignedTo(volunteer);
    assignedTo(volunteer);
    assignedTo(volunteer, { status: 'in_progress' });

    const { error } = await api.call('assignWorker',
      { requestId: openRequest().id, workerId: volunteer.id }, { user: imam });

    assert.equal(error.code, api.ParseError.OPERATION_FORBIDDEN,
      'ثلاثة مساجد تظنّ أن لها منفّذاً والمنفّذ واحد');
  });

  await t.test('العمل المنجَز لا يُحسب على الحدّ', async () => {
    assignedTo(volunteer, { status: 'completed' });
    assignedTo(volunteer, { status: 'completed' });
    assignedTo(volunteer, { status: 'cancelled' });

    const { error } = await api.call('assignWorker',
      { requestId: openRequest().id, workerId: volunteer.id }, { user: imam });

    assert.equal(error, undefined, 'المنجَز أُحصي كأنه معلّق فأُقصي منفّذ نشط');
  });

  await t.test('الإمام يسحب التكليف فيعود الطلب إلى المتاح', async () => {
    const serviceRequest = assignedTo(volunteer);

    const { ok } = await api.call('releaseAssignment',
      { requestId: serviceRequest.id, reason: 'no_show' }, { user: imam });

    assert.equal(ok.status, 'open_for_volunteers');
    assert.equal(serviceRequest.get('assignedVolunteerId'), undefined,
      'بقاء التكليف يمنع تعيين غيره');
    assert.equal(api.pushes.at(-1).users[0].id, volunteer.id, 'المنفّذ يجب أن يعلم');
  });

  await t.test('الطلب المموّل يعود إلى `funded` لا إلى التطوّع', async () => {
    const contractor = api.make('_User',
      { role: 'contractor', isVerifiedContractor: true, fullName: 'شركة' });
    const serviceRequest = api.make('ServiceRequests',
      { mosqueId: mosque, title: 'ترميم', estimatedCost: 500, fundedAmount: 500,
        status: 'assigned', assignedContractorId: contractor });

    const { ok } = await api.call('releaseAssignment',
      { requestId: serviceRequest.id }, { user: imam });

    assert.equal(ok.status, 'funded',
      'طلبٌ مموّل عاد إلى التطوّع العيني فيُنفَّذ بلا مقابل رغم أن ماله محصَّل');
  });

  await t.test('الغياب يُقيَّد على المنفّذ والانسحاب لا يُقيَّد', async () => {
    await api.call('releaseAssignment',
      { requestId: assignedTo(volunteer).id, reason: 'no_show' }, { user: imam });
    assert.equal(volunteer.get('abandonedJobs'), 1);

    await api.call('releaseAssignment',
      { requestId: assignedTo(volunteer).id }, { user: volunteer });
    assert.equal(volunteer.get('abandonedJobs'), 1,
      'الانسحاب المُعلن عوقب كالتغيّب، فلا يبقى للمنفّذ إلا الصمت');
  });

  await t.test('المنفّذ ينسحب بنفسه فيُشعَر الإمام', async () => {
    const serviceRequest = assignedTo(volunteer);

    const { ok } = await api.call('releaseAssignment',
      { requestId: serviceRequest.id }, { user: volunteer });

    assert.equal(ok.status, 'open_for_volunteers');
    assert.equal(api.pushes.at(-1).users[0].id, imam.id);
  });

  await t.test('لا ينسحب من ليس مكلَّفاً', async () => {
    const other = api.make('_User', { role: 'volunteer', fullName: 'خالد' });

    const { error } = await api.call('releaseAssignment',
      { requestId: assignedTo(volunteer).id }, { user: other });

    assert.equal(error.code, api.ParseError.OPERATION_FORBIDDEN);
  });

  await t.test('لا يُسحب التكليف بعد بدء التنفيذ', async () => {
    for (const status of ['in_progress', 'pending_imam_approval', 'completed']) {
      const { error } = await api.call('releaseAssignment',
        { requestId: assignedTo(volunteer, { status }).id, reason: 'no_show' }, { user: imam });

      assert.equal(error.code, api.ParseError.VALIDATION_ERROR,
        `سُحب التكليف من حالة ${status} فضاع جهد المنفّذ وحقّه في المعاينة`);
    }
  });

  await t.test('المسحوب منه لا يُعيد التسجيل في الطلب نفسه', async () => {
    const serviceRequest = openRequest();
    await api.call('expressInterest', { requestId: serviceRequest.id }, { user: volunteer });
    await api.call('assignWorker',
      { requestId: serviceRequest.id, workerId: volunteer.id }, { user: imam });
    await api.call('releaseAssignment',
      { requestId: serviceRequest.id, reason: 'no_show' }, { user: imam });

    const { error } = await api.call('expressInterest',
      { requestId: serviceRequest.id }, { user: volunteer });

    assert.equal(error.code, api.ParseError.OPERATION_FORBIDDEN,
      'تدور الحلقة: تكليف ثم غياب ثم تسجيل من جديد');
  });

  await t.test('غير المسحوب منهم يسجّلون في الطلب العائد', async () => {
    const serviceRequest = openRequest();
    const other = api.make('_User', { role: 'volunteer', fullName: 'خالد' });
    await api.call('expressInterest', { requestId: serviceRequest.id }, { user: other });
    await api.call('assignWorker',
      { requestId: serviceRequest.id, workerId: volunteer.id }, { user: imam });
    await api.call('releaseAssignment',
      { requestId: serviceRequest.id, reason: 'no_show' }, { user: imam });

    const { error } = await api.call('expressInterest',
      { requestId: serviceRequest.id }, { user: other });
    assert.equal(error, undefined, 'أُقصي من لم يُسحب منه شيء');
  });

  await t.test('الإمام يرى مرّات التغيّب قبل أن يختار', async () => {
    volunteer.set('abandonedJobs', 2);
    const serviceRequest = openRequest();
    await api.call('expressInterest', { requestId: serviceRequest.id }, { user: volunteer });

    const { ok } = await api.call('getRequestInterests',
      { requestId: serviceRequest.id }, { user: imam });

    assert.equal(ok[0].abandonedJobs, 2, 'الإمام يختار بلا أن يعلم بتغيّبه السابق');
  });

  await t.test('إمام مسجد آخر لا يسحب تكليفاً ليس له', async () => {
    const stranger = api.asUser('other_imam', 'imam');

    const { error } = await api.call('releaseAssignment',
      { requestId: assignedTo(volunteer).id, reason: 'no_show' }, { user: stranger });

    assert.ok(error, 'سُحب تكليف من مسجد غير مسجّل باسمه');
  });
});
