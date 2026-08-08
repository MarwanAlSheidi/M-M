/**
 * اختبار تكامل: الرحلة كاملة على خادم Parse حقيقي.
 *
 * ما يُغطّيه هنا ولا يُغطّيه البديل في الذاكرة: تطبيق المخطط وقيمه الافتراضية،
 * والصلاحيات كما يطبّقها الخادم فعلاً، وACL المستخدم، وأخطاء قاعدة البيانات.
 *
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:integration`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startStack, applySchema, unavailableReason } = require('./harness');

// `{ skip: null }` يعامله المُشغّل تخطّياً، فلا يُمرَّر المفتاح إلا عند وجود سبب
const skip = unavailableReason();
const options = skip ? { skip } : {};

test('الرحلة الكاملة على خادم حقيقي', options, async (t) => {
  const stack = await startStack();
  const { Parse } = stack;
  t.after(() => stack.stop());

  const MASTER = { useMasterKey: true };
  const as = (user, fn, params = {}) =>
    Parse.Cloud.run(fn, params, { sessionToken: user.getSessionToken() });

  let unique = 0;
  async function signUp(role, extra = {}) {
    const user = new Parse.User();
    user.set('username', `${role}_${Date.now()}_${++unique}`);
    user.set('password', 'Integration12345!');
    user.set('role', role);
    for (const [key, value] of Object.entries(extra)) user.set(key, value);
    await user.signUp();
    return user;
  }

  await t.test('المخطط يُطبَّق كاملاً — بفهارسه', async () => {
    const indexed = await applySchema(Parse);
    const schema = await new Parse.Schema('AuditLog').get();
    assert.ok(schema.fields.action, 'AuditLog لم تُنشأ');

    // كانت هذه الدالة تُسقط كتلة `indexes` كلّها، فيشهد الاختبار لبيئةٍ ليست
    // هي التي تُنشر — والاستعلامات المضبوطة على الفهارس تمسح المجموعة
    assert.ok(indexed >= 14, `طُبّق ${indexed} فهرساً فقط — راجع «جولة عاشرة»`);
    assert.ok((await new Parse.Schema('Mosques').get()).indexes.name_tokens,
      'فهرس الكلمات غائب — البحث المفهرس يمسح المجموعة');
  });

  // ⚠️ هذا ما فشل على أول خادم حقيقي: `isVerifiedContractor` له قيمة افتراضية
  // في المخطط، فيطبّقها Parse عند الإنشاء ويُعلّم الحقل مُعدَّلاً، فكان الحارس
  // يرفض كل تسجيل. لا يظهر إلا هنا لأن البديل لا يطبّق القيم الافتراضية.
  await t.test('التسجيل يعمل رغم القيم الافتراضية في المخطط', async () => {
    const imam = await signUp('imam', { fullName: 'الشيخ سعيد' });
    assert.ok(imam.id);
    assert.equal(imam.get('role'), 'imam');
    assert.equal(imam.get('isVerifiedContractor'), false, 'الحساب الجديد يبدأ غير معتمد');
  });

  await t.test('الحمايات التي يطبّقها الخادم', async () => {
    const imam = await signUp('imam');

    const rogue = new Parse.Object('ServiceRequests');
    rogue.set('title', 'طلب مزوّر');
    rogue.set('status', 'completed');
    await assert.rejects(
      () => rogue.save(null, { sessionToken: imam.getSessionToken() }),
      (error) => error.code === Parse.Error.OPERATION_FORBIDDEN,
      'CLP لا يمنع الكتابة المباشرة على ServiceRequests');

    const contractor = await signUp('contractor', { companyName: 'شركة الاختبار' });
    contractor.set('isVerifiedContractor', true);
    await assert.rejects(() => contractor.save(null, { sessionToken: contractor.getSessionToken() }),
      'شركة اعتمدت نفسها');
  });

  await t.test('حساب المستخدم مقفل على صاحبه', async () => {
    const volunteer = await signUp('volunteer', { phone: '9900xxxx' });
    const stranger = await signUp('donor');

    const seen = await new Parse.Query(Parse.User).equalTo('objectId', volunteer.id)
      .find({ sessionToken: stranger.getSessionToken() });

    if (seen.length > 0) {
      assert.equal(seen[0].get('phone'), undefined, 'رقم الهاتف مكشوف لمستخدم آخر');
      assert.equal(seen[0].get('lastKnownLocation'), undefined, 'موقع المتطوّع مكشوف');
    }
  });

  // القرب على حقلين رقميين لا على فهرس مكاني: هذه الحالة تُثبت أن الاستعلام
  // يعمل على خادم حقيقي بلا PostGIS ولا 2dsphere.
  await t.test('القرب يعمل بلا فهرس مكاني', async () => {
    const user = await signUp('volunteer');
    const Mosque = Parse.Object.extend('Mosques');

    const put = async (name, lat, lng) => {
      const mosque = new Mosque();
      mosque.set('externalId', `geo-${name}-${Date.now()}-${++unique}`);
      mosque.set('name', name);
      mosque.set('governorate', 'مسقط');
      mosque.set('lat', lat);
      mosque.set('lng', lng);
      await mosque.save(null, MASTER);
      return mosque;
    };

    await put('قريب جداً', 23.5920, 58.3829);
    await put('متوسط', 23.6150, 58.3829);
    await put('بعيد جداً', 25.0000, 58.3829);

    const near = await as(user, 'getNearbyMosques',
      { lat: 23.5880, lng: 58.3829, radius: 10 });

    const names = near.map((row) => row.name);
    assert.ok(names.includes('قريب جداً'));
    assert.ok(!names.includes('بعيد جداً'), 'أُعيد ما هو خارج النطاق');
    assert.ok(near[0].distanceKm < near[near.length - 1].distanceKm, 'غير مرتّب بالمسافة');

    const saved = await as(user, 'updateMyLocation', { lat: 23.5880, lng: 58.3829 });
    assert.equal(saved.lat, 23.5880);
  });

  await t.test('الرحلة: من طلب الملكية إلى اعتماد العمل', async () => {
    const imam = await signUp('imam', { fullName: 'الشيخ سعيد' });
    const volunteer = await signUp('volunteer', { fullName: 'سالم', skills: ['كهرباء'] });
    const rival = await signUp('volunteer', { fullName: 'خالد' });
    const admin = await signUp('donor');
    admin.set('role', 'admin');
    await admin.save(null, MASTER);

    const Mosque = Parse.Object.extend('Mosques');
    const mosque = new Mosque();
    mosque.set('externalId', `it-${Date.now()}`);
    mosque.set('name', 'مسجد الاختبار');
    mosque.set('nameNormalized', 'مسجد الاختبار');
    mosque.set('governorate', 'مسقط');
    mosque.set('wilayat', 'العامرات');
    await mosque.save(null, MASTER);

    const claim = await as(imam, 'claimMosque', { mosqueId: mosque.id, evidenceNote: 'إفادة' });
    const mine = await as(imam, 'getMyClaims');
    assert.equal(mine[0].status, 'pending');
    assert.equal(mine[0].mosqueName, 'مسجد الاختبار');

    await as(admin, 'reviewMosqueClaim', { claimId: claim.claimId, approve: true });
    assert.equal((await as(imam, 'getMyClaims'))[0].status, 'approved');

    await assert.rejects(
      () => as(imam, 'createServiceRequest',
        { title: 'إصلاح', description: 'وصف كافٍ للطلب', estimatedCost: 'كثير' }),
      (error) => error.code === Parse.Error.VALIDATION_ERROR);

    // ⚠️ هذا ما فشل أيضاً على أول خادم حقيقي: الإشعار للمتطوّعين القريبين رفع
    // خطأً فأسقط الدالة كلها بعد أن كان الطلب قد حُفظ.
    const request = await as(imam, 'createServiceRequest', {
      title: 'تصليح إنارة الصحن',
      description: 'ثلاث لمبات محترقة تحتاج استبدالاً.',
      category: 'electrical',
    });
    assert.equal(request.status, 'open_for_volunteers');

    await as(volunteer, 'expressInterest', { requestId: request.objectId, note: 'بعد الجمعة' });
    await as(rival, 'expressInterest', { requestId: request.objectId });
    await assert.rejects(() => as(volunteer, 'expressInterest', { requestId: request.objectId }),
      (error) => error.code === Parse.Error.DUPLICATE_VALUE);

    const interests = await as(imam, 'getRequestInterests', { requestId: request.objectId });
    assert.equal(interests.length, 2);
    assert.equal(interests[0].phone, undefined, 'هاتف المتطوّع لا يُعاد للإمام');

    const stranger = await signUp('imam');
    await assert.rejects(() => as(stranger, 'getRequestInterests', { requestId: request.objectId }),
      (error) => error.code === Parse.Error.OPERATION_FORBIDDEN);

    await as(imam, 'assignWorker', { requestId: request.objectId, workerId: volunteer.id });
    assert.equal((await as(imam, 'getRequestInterests', { requestId: request.objectId })).length, 0,
      'الاهتمامات لم تُقفل بعد التكليف');

    await assert.rejects(() => as(rival, 'startWork', { requestId: request.objectId }),
      (error) => error.code === Parse.Error.OPERATION_FORBIDDEN);

    await as(volunteer, 'startWork', { requestId: request.objectId });
    await assert.rejects(() => as(imam, 'cancelServiceRequest', { requestId: request.objectId }),
      (error) => error.code === Parse.Error.OPERATION_FORBIDDEN);

    await as(volunteer, 'markWorkDone', { requestId: request.objectId, notes: 'استُبدلت اللمبات.' });
    await assert.rejects(
      () => as(volunteer, 'completeService', { requestId: request.objectId, rating: 5 }),
      (error) => error.code === Parse.Error.OPERATION_FORBIDDEN);

    await as(imam, 'completeService', { requestId: request.objectId, rating: 5, volunteerHours: 2 });

    await volunteer.fetch(MASTER);
    assert.equal(volunteer.get('completedJobs'), 1);
    assert.equal(volunteer.get('avgRating'), 5);

    const trail = await as(admin, 'getMosqueAuditTrail', { mosqueId: mosque.id });
    const actions = trail.map((entry) => entry.action);
    for (const expected of ['claim_reviewed', 'request_created', 'interest_expressed',
      'worker_assigned', 'work_started', 'work_done', 'request_completed']) {
      assert.ok(actions.includes(expected), `سجل التدقيق ينقصه ${expected}`);
    }
    assert.ok(trail.every((entry) => entry.actorId === undefined), 'هوية الفاعل مُعادة');
  });
});
