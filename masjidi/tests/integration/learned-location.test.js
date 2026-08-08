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
