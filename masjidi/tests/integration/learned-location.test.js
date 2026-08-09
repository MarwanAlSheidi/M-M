/**
 * اختبار تكامل: المسجد يتعلّم موقعه من طلب ملكيته.
 *
 * ستة عشر مسجداً في بيانات الوزارة بلا موقع صالح، وأهلها خارج البحث بالقرب
 * وفرصُهم في ذيل القائمة. وحين يسجّله إمامه من عنده نكون قد عرفنا أين هو —
 * فتُتبنّى إحداثياته بعد اعتماد المشرف. والبيانات تُصلَح بالاستعمال.
 *
 * في ملفٍّ مستقلّ — خادمٌ واحد لكل عملية، ويحرس ذلك `harness.startStack`.
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:integration`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startStack, applySchema, unavailableReason } = require('./harness');

const skip = unavailableReason();
const options = skip ? { skip } : {};

test('المسجد يتعلّم موقعه من طلب ملكيته', options, async (t) => {
  const stack = await startStack();
  const { Parse } = stack;
  t.after(() => stack.stop());

  await applySchema(Parse);

  const tokens = new Map();
  let unique = 0;
  async function signUp(role) {
    const user = new Parse.User();
    user.set({ username: `learn_${role}_${Date.now()}_${++unique}`, password: 'Integration12345!', role });
    await user.signUp();
    tokens.set(user.id, user.getSessionToken());
    return user;
  }
  const as = (user, fn, params = {}) =>
    Parse.Cloud.run(fn, params, { sessionToken: tokens.get(user.id) });

  const admin = await signUp('donor');
  admin.set('role', 'admin');
  await admin.save(null, { useMasterKey: true });

  const Mosque = Parse.Object.extend('Mosques');
  const make = async (suffix, extra) => {
    const mosque = new Mosque();
    mosque.set({
      externalId: `learn_${Date.now()}_${suffix}`, name: `مسجد ${suffix}`,
      governorate: 'مسقط', wilayat: 'بوشر', ...extra,
    });
    await mosque.save(null, { useMasterKey: true });
    return mosque;
  };
  const reread = (mosque) =>
    new Parse.Query('Mosques').get(mosque.id, { useMasterKey: true });

  await t.test('الاعتماد يمنح المسجد موقعه، ويُقيَّد في سجلّه', async () => {
    const blind = await make('التائه', { hasLocation: false });
    const imam = await signUp('imam');

    const claim = await as(imam, 'claimMosque',
      { mosqueId: blind.id, lat: 23.61, lng: 58.51 });
    const result = await as(admin, 'reviewMosqueClaim',
      { claimId: claim.claimId, approve: true });

    assert.equal(result.locationLearned, true);
    const fresh = await reread(blind);
    assert.equal(fresh.get('lat'), 23.61);
    assert.equal(fresh.get('hasLocation'), true);
    assert.equal(fresh.get('locationSource'), 'claim',
      'بلا مصدر لا يُعرف أنه تقديرٌ لا بيانات وزارة');
    assert.ok(fresh.get('location'), 'GeoPoint لم يُضبط — والفهرس المكاني يقوم عليه');

    const trail = await as(admin, 'getMosqueAuditTrail', { mosqueId: blind.id });
    assert.ok(trail.some((entry) => entry.action === 'location_learned'),
      'تغيّرَ موقعُ مسجد بلا أثرٍ في سجلّه');
  });

  await t.test('وبعدها يظهر في البحث بالقرب كسائر المساجد', async () => {
    const blind = await make('العائد', { hasLocation: false });
    const imam = await signUp('imam');
    const claim = await as(imam, 'claimMosque',
      { mosqueId: blind.id, lat: 23.62, lng: 58.52 });
    await as(admin, 'reviewMosqueClaim', { claimId: claim.claimId, approve: true });

    const near = await as(imam, 'getNearbyMosques',
      { lat: 23.62, lng: 58.52, radius: 1 });
    assert.ok(near.some((row) => row.objectId === blind.id),
      'المسجد تعلّم موقعه ولا يزال خارج القرب');
  });

  await t.test('ولا تُمسّ إحداثياتٌ موجودة أبداً', async () => {
    const located = await make('المرجع', { lat: 23.6, lng: 58.5, hasLocation: true });
    const imam = await signUp('imam');

    const claim = await as(imam, 'claimMosque',
      { mosqueId: located.id, lat: 23.6009, lng: 58.5 });
    const result = await as(admin, 'reviewMosqueClaim',
      { claimId: claim.claimId, approve: true });

    assert.equal(result.locationLearned, false);
    const fresh = await reread(located);
    assert.equal(fresh.get('lat'), 23.6,
      'بيانات الوزارة مرجع، وموقع الجهاز تقدير — لا ينسخ التقديرُ فوق المرجع');
    assert.equal(fresh.get('locationSource'), undefined);
  });

  /**
   * الموقع المُقدَّم لمسجدٍ مجهول لا يُقاس إلى المسجد — فلا موقع له — لكنه
   * يُقاس إلى **مساجد ولايته المعلومة**. وهي القرينة الوحيدة المتاحة، وأشدّ
   * حالةٍ تحتاجها: ما يُقبل هنا يصير موقع المسجد الدائم على الخريطة.
   *
   * والرقم مقيس: على 17,784 مسجداً موثوقاً، أقصى بُعدٍ عن أقرب جارٍ في الولاية
   * نفسها 73.4 كم — فثمانون فوق أقصى الواقع ولا تُقصي قائماً.
   */
  /** مسجدٌ معلوم الموقع في الولاية — القرينة التي يُقاس إليها الموقع المُقدَّم. */
  const anchorWilayat = async (wilayat, lat, lng) => make(`مرساة ${wilayat}`, {
    wilayat, lat, lng, hasLocation: true,
  });

  await t.test('وموقعٌ بعيدٌ عن كل مساجد الولاية يُردّ لحظة التقديم', async () => {
    await anchorWilayat('بوشر', 23.6, 58.5);
    const blind = await make('البعيد', { hasLocation: false });
    const imam = await signUp('imam');

    // المسجد في بوشر بمسقط، والموقع المُرسل في ظفار — 850 كم
    await assert.rejects(
      as(imam, 'claimMosque', { mosqueId: blind.id, lat: 17.0, lng: 54.1 }),
      /بعيدٌ عن كل مساجد ولاية/,
      'قُبل موقعٌ يستحيل أن يكون مسجدَ تلك الولاية، وسيصير موقعه الدائم',
    );
  });

  await t.test('والمشرف يرى بُعد الموقع عن مساجد الولاية', async () => {
    await anchorWilayat('بوشر', 23.6, 58.5);
    const blind = await make('المقيس', { hasLocation: false });
    const imam = await signUp('imam');
    await as(imam, 'claimMosque', { mosqueId: blind.id, lat: 23.605, lng: 58.505 });

    const [pending] = (await as(admin, 'listPendingClaims'))
      .filter((row) => row.mosqueName === 'مسجد المقيس');
    assert.ok(pending.wilayatNearestKm != null,
      'المشرف يقرّر بلا قرينة في الحالة التي اعتمادُه فيها يمنح موقعاً دائماً');
    assert.ok(pending.wilayatNearestKm < 5);
    assert.equal(pending.willSetLocation, true);
  });

  await t.test('وموقعٌ صار بعيداً بعد التقديم لا يُتبنّى عند الاعتماد', async () => {
    // الفحص يُعاد لحظة الاعتماد: الطلب قد يكون أُنشئ قبل وجود الفحص أصلاً
    await anchorWilayat('بوشر', 23.6, 58.5);
    const blind = await make('المتأخّر', { hasLocation: false });
    const imam = await signUp('imam');
    const claim = await as(imam, 'claimMosque',
      { mosqueId: blind.id, lat: 23.606, lng: 58.506 });

    // يُزوَّر الطلب بموقعٍ بعيد كما لو أُنشئ قبل الفحص
    const stored = await new Parse.Query('MosqueClaims')
      .get(claim.claimId, { useMasterKey: true });
    stored.set('claimLat', 17.0);
    stored.set('claimLng', 54.1);
    await stored.save(null, { useMasterKey: true });

    const result = await as(admin, 'reviewMosqueClaim',
      { claimId: claim.claimId, approve: true });

    assert.equal(result.status, 'approved', 'الإمام يُعتمد — الموقع وحده هو المريب');
    assert.equal(result.locationLearned, false);
    assert.equal(result.locationRejected, true);
    assert.match(result.message, /لم يُعتمد الموقع/);

    const fresh = await reread(blind);
    assert.equal(fresh.get('hasLocation'), false);
    assert.equal(fresh.get('lat'), undefined,
      'تُبنّي موقعٌ يستحيل، وسيقود إليه كل متطوّع');
    assert.ok(fresh.get('imamId'), 'رُفض الموقع فسقط اعتماد الإمام معه');
  });

  await t.test('وولايةٌ لا نعرف موقع مسجدٍ فيها لا تُقصي إمامها', async () => {
    // غيابُ البيّنة ليس بيّنةَ نفي. و`DEPLOY.md` يوصي بالاستيراد على مراحل،
    // فولايةٌ لم تُستورد بعد حالةٌ متوقّعة — وخلطُها بالموقع المريب يُقصي كل
    // إمامٍ فيها بلا أن يفهم أحدٌ لماذا.
    const blind = await make('المعزول', { wilayat: 'ولاية لم تُستورد', hasLocation: false });
    const imam = await signUp('imam');

    const claim = await as(imam, 'claimMosque',
      { mosqueId: blind.id, lat: 23.61, lng: 58.51 });
    assert.ok(claim.claimId, 'رُدّ طلبٌ لا سبيل إلى الحكم عليه أصلاً');

    const [pending] = (await as(admin, 'listPendingClaims'))
      .filter((row) => row.mosqueName === 'مسجد المعزول');
    assert.equal(pending.wilayatNearestKm, null, 'رقمٌ يوهم المشرف بقياسٍ لم يقع');
    assert.equal(pending.willSetLocation, true, 'الاعتماد سيمنح موقعاً والمشرف لا يعلم');

    const result = await as(admin, 'reviewMosqueClaim',
      { claimId: claim.claimId, approve: true });
    assert.equal(result.locationLearned, true);
    assert.equal((await reread(blind)).get('lat'), 23.61);
  });

  await t.test('والرفض لا يمنح موقعاً', async () => {
    const blind = await make('المرفوض', { hasLocation: false });
    const imam = await signUp('imam');

    const claim = await as(imam, 'claimMosque',
      { mosqueId: blind.id, lat: 23.63, lng: 58.53 });
    await as(admin, 'reviewMosqueClaim', { claimId: claim.claimId, approve: false });

    const fresh = await reread(blind);
    assert.equal(fresh.get('lat'), undefined,
      'طلبٌ رفضه المشرف يُغيّر بيانات المسجد');
    assert.equal(fresh.get('hasLocation'), false);
  });
});
