/**
 * مسجدٌ يتنازعه اثنان.
 *
 * قِيس على خادمٍ حقيقي: الثاني يُردّ بـ«يوجد طلب ملكية معلّق لهذا المسجد» —
 * **وثلاثةُ أعطابٍ في هذا السطر الواحد**:
 *
 * ١) لا يُفرَّق بين طلبي أنا وطلبِ غيري، فمن أعاد الإرسال ظنّ أنّ غيرَه سبقه
 *    إلى مسجده.
 * ٢) ولا بابَ بعده: إمامُ المسجد الحقيقيّ يُردّ ولا يُقال له ماذا يفعل — وقاعدة
 *    المستودع أنّ خبراً بلا فعلٍ تالٍ نصفُ خبر.
 * ٣) **والمشرف لا يعلم.** وأصعبُ سؤالٍ في هذه المنصّة: كيف يُثبت الإمام أنه
 *    إمام؟ وأن يتقدّم اثنان على مسجدٍ واحد قرينةٌ من الطراز الأول على أنّ
 *    الملكية منازَعة — فيعتمد المشرفُ الأوّلَ **لأنه الأوّل لا لأنه الأحقّ**.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startStack, applySchema, unavailableReason } = require('./harness');

const skip = unavailableReason();
const options = skip ? { skip } : {};

test('مسجدٌ يتنازعه اثنان', options, async (t) => {
  const stack = await startStack();
  const { Parse } = stack;
  t.after(() => stack.stop());

  await applySchema(Parse);

  let unique = 0;
  const tokens = new Map();
  async function signUp(role, fullName) {
    const user = new Parse.User();
    user.set('username', `${role}_${Date.now()}_${++unique}`);
    user.set('password', 'Integration12345!');
    user.set('role', role);
    user.set('fullName', fullName);
    await user.signUp();
    tokens.set(user.id, user.getSessionToken());
    return user;
  }
  const as = (user, fn, params = {}) =>
    Parse.Cloud.run(fn, params, { sessionToken: tokens.get(user.id) });

  const admin = await signUp('donor', 'المشرف');
  admin.set('role', 'admin');
  await admin.save(null, { useMasterKey: true });

  const first = await signUp('imam', 'الشيخ سعيد');
  const second = await signUp('imam', 'الشيخ حمد');
  const third = await signUp('imam', 'الشيخ خالد');

  const mosque = new (Parse.Object.extend('Mosques'))();
  mosque.set({
    externalId: `contest_${Date.now()}`, name: 'البلاغ', type: 'جامع',
    governorate: 'مسقط', wilayat: 'بوشر', lat: 23.6, lng: 58.5, hasLocation: true,
  });
  await mosque.save(null, { useMasterKey: true });

  const claim = (user, note) => as(user, 'claimMosque', {
    mosqueId: mosque.id, capacity: 'imam', evidenceNote: note,
    lat: 23.6, lng: 58.5,
  });

  const refusal = async (promise) => {
    try {
      await promise;
      return null;
    } catch (error) {
      return error.message;
    }
  };

  await claim(first, 'أنا إمام هذا الجامع منذ سنوات');

  /*
   * **حالةٌ يجب أن تبقى خضراء على `HEAD`.**
   *
   * بقيّةُ الحالات تسقط عليه جميعاً — بعضُها لأن الحقل نفسه لم يكن موجوداً،
   * فتقرأ `undefined` — فلولا هذه لما دلّت الحمرةُ الشاملة على شيء: بيئةٌ
   * معطوبة تُنتجها كما يُنتجها العطبُ المقصود.
   */
  await t.test('الطلبُ الأوّل يُقبل ويبلغ طابور المشرف', async () => {
    const queue = await as(admin, 'listPendingClaims', {});
    assert.equal(queue.length, 1, `الطابور ${queue.length} — والمنتظر واحد`);
    assert.match(queue[0].mosqueName, /البلاغ/, 'الطلب في الطابور بلا اسم مسجده');
  });

  await t.test('ومن أعاد طلبَه يُقال له إنه طلبُه هو', async () => {
    const said = await refusal(claim(first, 'أعدتُ الإرسال'));
    assert.ok(said, 'قُبل طلبٌ ثانٍ من صاحب الطلب نفسه');
    assert.match(said, /طلبُك/,
      `قيل لصاحب الطلب إنّ غيرَه سبقه: «${said}»`);
  });

  await t.test('ومن رُدّ لطلب غيره يُقال له ماذا يفعل', async () => {
    const said = await refusal(claim(second, 'بل أنا إمامه'));
    assert.ok(said, 'قُبل طلبٌ على مسجدٍ عليه طلبٌ معلّق');
    assert.match(said, /غيرُك/, `لم يُفرَّق بين طلبه وطلب غيره: «${said}»`);
    // **وبابٌ بعده**: ردٌّ بلا فعلٍ تالٍ يترك إمامَ المسجد الحقيقيّ بلا حيلة
    assert.match(said, /الإدارة/, `ردٌّ بلا بابٍ بعده: «${said}»`);
  });

  await t.test('وتُقيَّد المنازعة على الطلب المعلّق فيراها المشرف', async () => {
    await refusal(claim(third, 'أنا وكيله'));

    const queue = await as(admin, 'listPendingClaims', {});
    assert.equal(queue.length, 1, `الطابور ${queue.length} — والمنتظر واحد`);
    assert.equal(queue[0].contestedCount, 2,
      `نازعه اثنان وقِيد ${queue[0].contestedCount} — والمشرف يعتمد الأوّل لأنه الأوّل`);
  });

  /* ————— حدودٌ يجب أن تبقى خضراء ————— */

  await t.test('وإعادةُ صاحبِه لا تُقيَّد منازعةً عليه', async () => {
    await refusal(claim(first, 'أعدتُ ثانيةً'));

    const queue = await as(admin, 'listPendingClaims', {});
    assert.equal(queue[0].contestedCount, 2,
      'عُدَّ صاحبُ الطلب منازعاً لنفسه');
  });

  await t.test('ومسجدٌ لا طلب عليه يُسجَّل بلا منازعة', async () => {
    const other = new (Parse.Object.extend('Mosques'))();
    other.set({
      externalId: `clean_${Date.now()}`, name: 'الفتح', type: 'مسجد',
      governorate: 'مسقط', wilayat: 'السيب', lat: 23.7, lng: 58.2, hasLocation: true,
    });
    await other.save(null, { useMasterKey: true });

    await as(second, 'claimMosque', {
      mosqueId: other.id, capacity: 'imam', evidenceNote: 'أنا إمامه',
      lat: 23.7, lng: 58.2,
    });

    const queue = await as(admin, 'listPendingClaims', {});
    const clean = queue.find((row) => /الفتح/.test(row.mosqueName));
    assert.ok(clean, `لم يدخل الطابور: ${JSON.stringify(queue.map((r) => r.mosqueName))}`);
    assert.equal(clean.contestedCount, 0,
      'قُيّدت منازعةٌ على طلبٍ لم ينازعه أحد');
  });
});
