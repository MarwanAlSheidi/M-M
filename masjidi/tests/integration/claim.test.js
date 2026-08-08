/**
 * اختبار تكامل: تأكيد الموقع عند تسجيل المسجد، وصفة مقدّم الطلب.
 *
 * السؤال المفتوح منذ أوّل يوم: كيف يُثبت الإمام أنه إمام هذا المسجد؟ لا جواب
 * تامّ دون تكامل مع الوزارة، لكن **من يدّعي مسجداً يُتوقّع أن يكون فيه** —
 * فيُطلب موقعه وتُحسب مسافته وتُعرض للمشرف. والوكيل يسجّل كالإمام بصفته لا
 * منتحلاً صفته.
 *
 * في ملفٍّ مستقلّ — انظر `contractor.test.js` لسبب ذلك.
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:integration`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startStack, applySchema, unavailableReason } = require('./harness');

const skip = unavailableReason();
const options = skip ? { skip } : {};

test('تأكيد الموقع عند تسجيل المسجد', options, async (t) => {
  const stack = await startStack();
  const { Parse } = stack;
  t.after(() => stack.stop());

  await applySchema(Parse);

  const tokens = new Map();
  let unique = 0;
  async function signUp(role) {
    const user = new Parse.User();
    user.set({ username: `claim_${role}_${Date.now()}_${++unique}`, password: 'Integration12345!', role });
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
      externalId: `claim_${Date.now()}_${suffix}`, name: `مسجد ${suffix}`,
      governorate: 'مسقط', wilayat: 'بوشر', ...extra,
    });
    await mosque.save(null, { useMasterKey: true });
    return mosque;
  };

  // المسجد عند 23.6/58.5 — ومئة متر شمالاً ≈ 0.0009 درجة
  const located = await make('الموقع', { lat: 23.6, lng: 58.5, hasLocation: true });
  const blind = await make('بلا موقع', { hasLocation: false });

  await t.test('طلبٌ بلا موقع يُرفض حين للمسجد إحداثيات', async () => {
    const imam = await signUp('imam');
    await assert.rejects(
      () => as(imam, 'claimMosque', { mosqueId: located.id }),
      /أكّد موقعك عند المسجد/);

    const claims = await new Parse.Query('MosqueClaims').count({ useMasterKey: true });
    assert.equal(claims, 0, 'حُفظ طلبٌ رغم رفضه');
  });

  await t.test('طلبٌ من عند المسجد يُقبل ويُوسَم', async () => {
    const imam = await signUp('imam');
    const result = await as(imam, 'claimMosque',
      { mosqueId: located.id, lat: 23.6009, lng: 58.5, capacity: 'imam' });

    assert.equal(result.atMosque, true, 'مئة متر ليست «عند المسجد»');
    assert.match(result.message, /من عند المسجد/);
  });

  await t.test('والمشرف يرى المسافة والصفة', async () => {
    const pending = await as(admin, 'listPendingClaims');
    const claim = pending.find((row) => row.mosqueName === 'مسجد الموقع');

    assert.equal(claim.atMosque, true);
    assert.ok(claim.claimDistanceKm < 0.2, `المسافة ${claim.claimDistanceKm} كم`);
    assert.equal(claim.capacity, 'imam');
  });

  await t.test('البعيد يُقبل ولا يُرفض آلياً — ويُوسَم بمسافته', async () => {
    const far = await make('البعيد', { lat: 23.6, lng: 58.5, hasLocation: true });
    const imam = await signUp('imam');

    // صلالة: نحو ٨٠٠ كم من مسقط
    const result = await as(imam, 'claimMosque',
      { mosqueId: far.id, lat: 17.019, lng: 54.089 });

    assert.equal(result.atMosque, false);
    assert.equal(/من عند المسجد/.test(result.message), false);

    const claim = (await as(admin, 'listPendingClaims'))
      .find((row) => row.mosqueName === 'مسجد البعيد');
    assert.ok(claim.claimDistanceKm > 500,
      'الرفض الآلي يُقصي محقّاً بلا مراجعة — لكن المسافة تصل المشرف');
    assert.equal(claim.atMosque, false);
  });

  await t.test('ومسجدٌ بلا إحداثيات لا يُحرم أهله من التسجيل', async () => {
    const imam = await signUp('imam');
    const result = await as(imam, 'claimMosque', { mosqueId: blind.id });

    assert.ok(result.claimId, 'ستة عشر مسجداً بلا موقع — لا تُقاس إليها مسافة');
    assert.equal(result.atMosque, false);
  });

  await t.test('الوكيل يسجّل بصفته لا منتحلاً صفة الإمام', async () => {
    const mosque = await make('الوكيل', { lat: 23.6, lng: 58.5, hasLocation: true });
    const agent = await signUp('imam');

    await as(agent, 'claimMosque',
      { mosqueId: mosque.id, lat: 23.6, lng: 58.5, capacity: 'agent' });

    const claim = (await as(admin, 'listPendingClaims'))
      .find((row) => row.mosqueName === 'مسجد الوكيل');
    assert.equal(claim.capacity, 'agent',
      'إجبار الوكيل أن يسمّي نفسه إماماً كذبٌ يُدخل على المشرف');

    const mine = await as(agent, 'getMyClaims');
    assert.equal(mine[0].capacity, 'agent');
  });

  await t.test('صفةٌ مجهولة تُرفض', async () => {
    const mosque = await make('المجهول', { lat: 23.6, lng: 58.5, hasLocation: true });
    const imam = await signUp('imam');

    await assert.rejects(
      () => as(imam, 'claimMosque',
        { mosqueId: mosque.id, lat: 23.6, lng: 58.5, capacity: 'الوالي' }),
      /إمام المسجد أو وكيله/);
  });
});
