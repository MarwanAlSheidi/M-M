/**
 * شؤون الحسابات والاسترداد والبحث — البنود الأخيرة من «ما لم يُعالَج».
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCloud } = require('./helpers/parse-mock');

test('اعتماد الشركات', async (t) => {
  let api;
  let admin;

  t.beforeEach(() => {
    api = loadCloud('modular');
    admin = api.asUser('user_admin', 'admin');
  });

  const contractor = (extra = {}) => api.make('_User',
    { role: 'contractor', isVerifiedContractor: false, companyName: 'شركة النور', ...extra });

  await t.test('المشرف يرى المنتظرين بسجلّهم التجاري', async () => {
    contractor({ crNumber: '1234567', fullName: 'مؤسسة النور' });

    const { ok } = await api.call('listPendingContractors', {}, { user: admin });

    assert.equal(ok.length, 1);
    assert.equal(ok[0].companyName, 'شركة النور');
    assert.equal(ok[0].crNumber, '1234567', 'السجل التجاري أساس القرار');
  });

  await t.test('لا اعتماد بلا سجل تجاري', async () => {
    const pending = contractor();
    const { error } = await api.call('reviewContractor',
      { contractorId: pending.id, approve: true }, { user: admin });

    assert.equal(error.code, api.ParseError.VALIDATION_ERROR);
    assert.equal(pending.get('isVerifiedContractor'), false);
  });

  await t.test('الاعتماد يُغيّر الحقل ويُقيَّد ويُشعِر', async () => {
    const pending = contractor({ crNumber: '1234567' });

    const { ok } = await api.call('reviewContractor',
      { contractorId: pending.id, approve: true }, { user: admin });

    assert.equal(ok.isVerifiedContractor, true);
    assert.equal(pending.get('isVerifiedContractor'), true);
    assert.ok(api.store.AuditLog.some((e) => e.get('action') === 'contractor_reviewed'));
    assert.equal(api.pushes.at(-1).users[0].id, pending.id);
  });

  await t.test('المتطوّع ليس شركة', async () => {
    const volunteer = api.make('_User', { role: 'volunteer' });
    const { error } = await api.call('reviewContractor',
      { contractorId: volunteer.id, approve: true }, { user: admin });

    assert.equal(error.code, api.ParseError.VALIDATION_ERROR);
  });

  await t.test('غير المشرف لا يعتمد', async () => {
    const pending = contractor({ crNumber: '7' });
    const { error } = await api.call('reviewContractor',
      { contractorId: pending.id, approve: true }, { user: api.asUser('u', 'imam') });

    assert.equal(error.code, api.ParseError.OPERATION_FORBIDDEN);
  });
});

test('الملف الشخصي والمسجد المفضّل', async (t) => {
  let api;
  let user;

  t.beforeEach(() => {
    api = loadCloud('modular');
    user = api.make('_User', { role: 'volunteer', fullName: 'سالم', skills: ['كهرباء'] });
  });

  await t.test('ضبط المسجد المفضّل يتحقق من وجوده', async () => {
    const { error } = await api.call('setFavoriteMosque',
      { mosqueId: 'لا-وجود-له' }, { user });
    assert.equal(error.code, api.ParseError.OBJECT_NOT_FOUND);
  });

  await t.test('الضبط ثم القراءة', async () => {
    const mosque = api.make('Mosques', { name: 'جامع السلطان' });

    const set = await api.call('setFavoriteMosque', { mosqueId: mosque.id }, { user });
    assert.equal(set.ok.mosqueName, 'جامع السلطان');

    const profile = await api.call('getMyProfile', {}, { user });
    assert.equal(profile.ok.favoriteMosqueName, 'جامع السلطان');
    assert.deepEqual(profile.ok.skills, ['كهرباء']);
    assert.equal(profile.ok.role, 'volunteer');
  });

  await t.test('الإرسال بلا معرّف يمسح التفضيل', async () => {
    const mosque = api.make('Mosques', { name: 'جامع السلطان' });
    await api.call('setFavoriteMosque', { mosqueId: mosque.id }, { user });

    const cleared = await api.call('setFavoriteMosque', {}, { user });
    assert.equal(cleared.ok.favoriteMosqueId, null);
    assert.equal((await api.call('getMyProfile', {}, { user })).ok.favoriteMosqueId, null);
  });
});

test('استرداد التبرّع', async (t) => {
  let api;
  let admin;
  let mosque;
  let serviceRequest;
  let donation;

  t.beforeEach(() => {
    api = loadCloud('modular');
    admin = api.asUser('user_admin', 'admin');
    mosque = api.make('Mosques', { name: 'مسجد الاختبار', walletBalance: 500 });
    serviceRequest = api.make('ServiceRequests', {
      mosqueId: mosque, title: 'ترميم', estimatedCost: 500, fundedAmount: 500,
      status: 'funded', isFundedByDonors: true,
    });
    donation = api.make('Transactions', {
      donorId: api.asUser('user_donor'), mosqueId: mosque, requestId: serviceRequest,
      amount: 500, type: 'donation', status: 'captured',
    });
  });

  await t.test('الاسترداد يعيد الرصيد ويُرجع الطلب للتمويل', async () => {
    const { ok } = await api.call('refundDonation',
      { transactionId: donation.id, reason: 'أُلغي الطلب' }, { user: admin });

    assert.equal(ok.fundedAmount, 0);
    assert.equal(mosque.get('walletBalance'), 0);
    assert.equal(donation.get('status'), 'refunded');
    assert.equal(serviceRequest.get('status'), 'pending_funding');
    assert.equal(serviceRequest.get('isFundedByDonors'), false);

    const entry = api.store.Transactions.find((tx) => tx.get('type') === 'refund');
    assert.ok(entry, 'لم يُقيَّد سطر استرداد');
    assert.equal(entry.get('amount'), 500);
  });

  await t.test('لا استرداد مرتين', async () => {
    await api.call('refundDonation', { transactionId: donation.id }, { user: admin });
    const again = await api.call('refundDonation', { transactionId: donation.id }, { user: admin });

    assert.equal(again.error.code, api.ParseError.DUPLICATE_VALUE);
    assert.equal(mosque.get('walletBalance'), 0, 'خُصم المبلغ مرتين');
  });

  await t.test('لا استرداد بعد صرف المستحقات', async () => {
    serviceRequest.set('isPaidOut', true);
    const { error } = await api.call('refundDonation',
      { transactionId: donation.id }, { user: admin });

    assert.equal(error.code, api.ParseError.OPERATION_FORBIDDEN);
    assert.equal(mosque.get('walletBalance'), 500);
  });

  await t.test('لا استرداد لمبلغ أُنفق على طلب آخر', async () => {
    mosque.set('walletBalance', 100); // صُرف معظمه
    const { error } = await api.call('refundDonation',
      { transactionId: donation.id }, { user: admin });

    assert.equal(error.code, api.ParseError.VALIDATION_ERROR);
    assert.equal(mosque.get('walletBalance'), 100, 'التعويض لم يُعِد الرصيد');
  });

  await t.test('غير المشرف لا يسترد', async () => {
    const { error } = await api.call('refundDonation',
      { transactionId: donation.id }, { user: api.asUser('u', 'imam') });
    assert.equal(error.code, api.ParseError.OPERATION_FORBIDDEN);
  });
});

test('بحث المساجد', async (t) => {
  let api;
  let user;

  t.beforeEach(() => {
    api = loadCloud('modular');
    user = api.asUser('user_any', 'donor');
    api.make('Mosques', { name: 'مسجد النور', nameNormalized: 'مسجد النور', governorate: 'مسقط' });
    api.make('Mosques', { name: 'جامع النور', nameNormalized: 'جامع النور', governorate: 'ظفار' });
  });

  await t.test('البادئة المثبّتة تُستعمل أولاً', async () => {
    const { ok } = await api.call('searchMosques', { term: 'مسجد' }, { user });
    assert.equal(ok.length, 1);
    assert.equal(ok[0].name, 'مسجد النور');
  });

  await t.test('كلمة من وسط الاسم تسقط إلى المسح', async () => {
    const { ok } = await api.call('searchMosques', { term: 'النور' }, { user });
    assert.equal(ok.length, 2, 'لا نتيجة بالبادئة، فيلزم `contains` كخطة بديلة');
  });

  // البيانات مخزَّنة مطبَّعة؛ لو لم يُطبَّع المصطلح لضاع الحقل كله
  await t.test('التاء المربوطة والألف المهموزة تُطبَّعان قبل البحث', async () => {
    api.make('Mosques', { name: 'مسجد الرحمة', nameNormalized: 'مسجد الرحمه' });

    const exact = await api.call('searchMosques', { term: 'مسجد الرحمة' }, { user });
    assert.equal(exact.ok.length, 1, 'كُتبت بالتاء المربوطة والمخزَّن بالهاء');

    api.make('Mosques', { name: 'مسجد الإيمان', nameNormalized: 'مسجد الايمان' });
    const hamza = await api.call('searchMosques', { term: 'مسجد الإيمان' }, { user });
    assert.equal(hamza.ok.length, 1, 'الهمزة على الألف');
  });

  await t.test('قيد المحافظة يُطبَّق في الحالتين', async () => {
    const prefix = await api.call('searchMosques', { term: 'مسجد', governorate: 'ظفار' }, { user });
    assert.equal(prefix.ok.length, 0);

    const substring = await api.call('searchMosques', { term: 'النور', governorate: 'ظفار' }, { user });
    assert.equal(substring.ok.length, 1);
    assert.equal(substring.ok[0].name, 'جامع النور');
  });
});

test('القرب الجغرافي', async (t) => {
  let api;
  let user;

  // مسقط تقريباً، والمسافات محسوبة من هذه النقطة
  const HERE = { lat: 23.5880, lng: 58.3829 };

  const mosqueAt = (name, lat, lng, openRequests = 0) => api.make('Mosques', {
    name, nameNormalized: name, governorate: 'مسقط', wilayat: 'مسقط',
    lat, lng, openRequestsCount: openRequests,
  });

  t.beforeEach(() => {
    api = loadCloud('modular');
    user = api.make('_User', { role: 'volunteer' });
  });

  await t.test('المساجد تُعاد مرتّبةً بالأقرب ومعها المسافة', async () => {
    mosqueAt('البعيد', 23.6800, 58.3829);   // ~10 كم شمالاً
    mosqueAt('القريب', 23.5920, 58.3829);   // ~450 متراً
    mosqueAt('المتوسط', 23.6150, 58.3829);  // ~3 كم

    const { ok } = await api.call('getNearbyMosques',
      { ...HERE, radius: 20 }, { user });

    assert.deepEqual(ok.map((m) => m.name), ['القريب', 'المتوسط', 'البعيد']);
    assert.ok(ok[0].distanceKm < 0.6, `المسافة ${ok[0].distanceKm}`);
    assert.ok(ok[2].distanceKm > 9 && ok[2].distanceKm < 11, `المسافة ${ok[2].distanceKm}`);
  });

  await t.test('ما خرج عن النطاق لا يُعاد', async () => {
    mosqueAt('داخل', 23.5920, 58.3829);
    mosqueAt('خارج', 24.5880, 58.3829); // ~111 كم

    const { ok } = await api.call('getNearbyMosques', { ...HERE, radius: 5 }, { user });
    assert.deepEqual(ok.map((m) => m.name), ['داخل']);
  });

  await t.test('زاوية الصندوق تُستبعد بالمسافة الدقيقة', async () => {
    // نقطة داخل صندوق نصف قطره 5 كم لكنها خارج الدائرة (قطرياً ~6.6 كم)
    mosqueAt('الزاوية', 23.6300, 58.4290);

    const { ok } = await api.call('getNearbyMosques', { ...HERE, radius: 5 }, { user });
    assert.equal(ok.length, 0, 'الصندوق أوسع من الدائرة، والتصفية الدقيقة بعده');
  });

  await t.test('الإحداثيات غير الصحيحة تُرفض', async () => {
    for (const bad of [{ lat: 'شمالاً', lng: 58 }, { lat: 200, lng: 58 }, {}]) {
      const { error } = await api.call('getNearbyMosques', bad, { user });
      assert.equal(error.code, api.ParseError.VALIDATION_ERROR, JSON.stringify(bad));
    }
  });

  await t.test('الفرص القريبة مرتّبة بالمسافة لا بالتاريخ', async () => {
    const far = mosqueAt('مسجد بعيد', 23.6800, 58.3829, 1);
    const near = mosqueAt('مسجد قريب', 23.5920, 58.3829, 1);

    api.make('ServiceRequests', { mosqueId: far, title: 'طلب بعيد', status: 'open_for_volunteers' });
    api.make('ServiceRequests', { mosqueId: near, title: 'طلب قريب', status: 'open_for_volunteers' });

    const { ok } = await api.call('getNearbyOpportunities',
      { ...HERE, radius: 20 }, { user });

    assert.deepEqual(ok.map((r) => r.title), ['طلب قريب', 'طلب بعيد']);
    assert.equal(ok[0].mosqueName, 'مسجد قريب');
    assert.ok(ok[0].distanceKm < ok[1].distanceKm);
  });

  await t.test('مسجد بلا طلبات مفتوحة لا يُستعلم عنه', async () => {
    const quiet = mosqueAt('مسجد هادئ', 23.5920, 58.3829, 0);
    api.make('ServiceRequests', { mosqueId: quiet, title: 'منجَز', status: 'completed' });

    const { ok } = await api.call('getNearbyOpportunities', { ...HERE, radius: 20 }, { user });
    assert.equal(ok.length, 0);
  });

  await t.test('تحديث الموقع يكتب الحقلين الرقميين', async () => {
    const { ok } = await api.call('updateMyLocation', HERE, { user });

    assert.equal(ok.lat, HERE.lat);
    assert.equal(user.get('lastLat'), HERE.lat);
    assert.equal(user.get('lastLng'), HERE.lng);
    assert.ok(user.get('lastKnownLocation'), 'GeoPoint يبقى للاستعمالات المستقبلية');
  });

  await t.test('إشعار الفرصة يصل للمتطوّع القريب دون البعيد', async () => {
    const imam = api.asUser('user_imam', 'imam');
    const mosque = api.make('Mosques', {
      name: 'مسجد الحيّ', isClaimed: true, imamId: imam,
      lat: HERE.lat, lng: HERE.lng, governorate: 'مسقط',
    });

    api.make('_User', { role: 'volunteer', isActive: true, fullName: 'قريب',
      lastLat: 23.5920, lastLng: 58.3829 });
    api.make('_User', { role: 'volunteer', isActive: true, fullName: 'بعيد',
      lastLat: 24.5880, lastLng: 58.3829 });

    await api.call('createServiceRequest',
      { title: 'تنظيف', description: 'تنظيف السجاد قبل الجمعة', mosqueId: mosque.id },
      { user: imam });

    const notified = api.pushes.at(-1).users.map((u) => u.get('fullName'));
    assert.deepEqual(notified, ['قريب'], 'أُشعر البعيد أيضاً');
  });
});
