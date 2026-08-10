/**
 * اختبار تكامل: مقدّم طلب الملكية يُخبَر بما صار إليه طلبُه.
 *
 * قِيس على خادمٍ حقيقي:
 *
 *     ما قيل لمقدّم الطلب: «تم استلام طلبك… **سيُراجع خلال أيام عمل**»
 *     وارده بعد الاعتماد:  []
 *     وارده بعد الرفض:     []
 *
 * **وعدٌ يُقطع ثم لا يُوفى.** والمراجعة بيد إنسانٍ فتطول أياماً، وهي أوّلُ
 * معاملةٍ للإمام مع المنصّة — وبلا مسجدٍ معتمَد لا يستطيع شيئاً البتّة، لا
 * ينشر طلباً ولا يرى مسجداً. فكان عليه أن يتذكّر وحده أن يعود وينظر.
 *
 * وفي `reviewMosqueClaim` بلاغٌ للإمام **السابق** حين يُنقل مسجده، وفوقه:
 * «من يُنزع منه مسجده أولى الناس بأن يعلم». **والمبدأ نفسه لم يُطبَّق على
 * صاحب الطلب** — وهو أوّل من ينتظر.
 *
 * ولماذا التكامل لا الوحدة: الوارد صفٌّ في `Notifications` يُكتب ويُقرأ عبر
 * سلسلةٍ كاملة، والدور `admin` لا يُنال إلا بالمفتاح الرئيس بعد التسجيل —
 * وكلاهما لا يقيسه بديل Parse.
 *
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:integration`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startStack, applySchema, unavailableReason } = require('./harness');

const skip = unavailableReason();
const options = skip ? { skip } : {};

test('من ينتظر قراراً يُبلَّغ به', options, async (t) => {
  const stack = await startStack();
  const { Parse } = stack;
  t.after(() => stack.stop());

  await applySchema(Parse);

  const tokens = new Map();
  let unique = 0;
  async function signUp(role, fullName) {
    const user = new Parse.User();
    user.set('username', `${role}_${Date.now()}_${++unique}`);
    user.set('password', 'Integration12345!');
    user.set('role', role);
    user.set('fullName', fullName);
    user.set('governorate', 'مسقط');
    await user.signUp();
    tokens.set(user.id, user.getSessionToken());
    return user;
  }
  const as = (user, fn, params = {}) =>
    Parse.Cloud.run(fn, params, { sessionToken: tokens.get(user.id) });

  const inbox = async (user) =>
    (await as(user, 'getMyNotifications', {})).items.map((row) => row.body);

  // الدور `admin` لا يُختار عند التسجيل قصداً — يُرقّى بالمفتاح الرئيس
  const admin = await signUp('donor', 'المشرف');
  const stored = await new Parse.Query(Parse.User).get(admin.id, { useMasterKey: true });
  stored.set('role', 'admin');
  await stored.save(null, { useMasterKey: true });

  let mosques = 0;
  const makeMosque = async (name, located = true) => {
    const mosque = new (Parse.Object.extend('Mosques'))();
    mosque.set({
      externalId: `claimed_${Date.now()}_${++mosques}`, name,
      governorate: 'مسقط', wilayat: 'بوشر', hasLocation: located,
      ...(located ? { lat: 23.6, lng: 58.5 } : {}),
    });
    await mosque.save(null, { useMasterKey: true });
    return mosque;
  };

  await t.test('المعتمَد يُخبَر، ويُقال له ما صار يملك', async () => {
    const saeed = await signUp('imam', 'الشيخ سعيد');
    const mosque = await makeMosque('جامع القبول');
    const { claimId } = await as(saeed, 'claimMosque', {
      mosqueId: mosque.id, capacity: 'imam', lat: 23.6, lng: 58.5,
    });

    const before = await inbox(saeed);
    await as(admin, 'reviewMosqueClaim', { claimId, approve: true });
    const after = await inbox(saeed);

    assert.ok(after.length > before.length,
      'قيل له «سيُراجع خلال أيام عمل» ثم لم يُقَل شيء');
    assert.match(after[0], /اعتُمدت إمامتك/);
    assert.match(after[0], /جامع القبول/, 'بلاغٌ لا يقول عن أي مسجد');
    // البلاغ يفتح الباب التالي: الإمام لا يعرف من تلقاء نفسه أين يُنشر الطلب
    assert.match(after[0], /مساجدي/);
  });

  await t.test('والمرفوض يُخبَر، ويُقال له ما يملك بعدها', async () => {
    const badr = await signUp('imam', 'الشيخ بدر');
    const mosque = await makeMosque('جامع الرفض');
    const { claimId } = await as(badr, 'claimMosque', {
      mosqueId: mosque.id, capacity: 'imam', lat: 23.6, lng: 58.5,
    });

    await as(admin, 'reviewMosqueClaim', { claimId, approve: false });
    const seen = await inbox(badr);

    assert.ok(seen.length > 0, 'رُفض طلبه في صمت — فينتظر ما لا يأتي');
    assert.match(seen[0], /لم يُعتمد طلبك/);
    // الرفض بلا مخرجٍ يُقفل الباب: يُقال له أن الطريق ما زال مفتوحاً
    assert.match(seen[0], /طلبٍ جديد/);
  });

  await t.test('ومن اعتُمد ورُدّ موقعه يُقال له ذلك — لا للمشرف وحده', async () => {
    // المسجد مجهول الموقع، والطلب من نقطةٍ بعيدةٍ جداً فيُردّ موقعُها.
    // وبلا هذا البلاغ تبقى معرفةُ ذلك عند المشرف، وتنبيهُ الإمام خطوةً بشرية.
    const nasir = await signUp('imam', 'الشيخ ناصر');
    const mosque = await makeMosque('جامع بلا موقع', false);
    const { claimId } = await as(nasir, 'claimMosque', {
      mosqueId: mosque.id, capacity: 'imam', lat: 23.6, lng: 58.5,
    });

    // الحالة التي يصفها الكود: طلبٌ يحمل موقعاً مريباً يُكشف عند الاعتماد لا
    // عند التقديم — «وقد يكون الطلب أُنشئ قبل وجود هذا الفحص أصلاً». فتُكتب
    // الإحداثيات بالمفتاح الرئيس كما لو حُفظت حينها.
    const pending = await new Parse.Query('MosqueClaims')
      .get(claimId, { useMasterKey: true });
    pending.set('claimLat', 17.0); // ظفار — والمسجد في بوشر
    pending.set('claimLng', 54.1);
    await pending.save(null, { useMasterKey: true });

    const result = await as(admin, 'reviewMosqueClaim', { claimId, approve: true });
    assert.equal(result.locationRejected, true, 'الموقع البعيد قُبل — فالمقدّمة سقطت');

    const seen = await inbox(nasir);
    assert.match(seen[0], /اعتُمدت إمامتك/);
    assert.match(seen[0], /ما زال مجهول الموقع/, 'اعتُمد ولا يعلم أن مسجده خارج الخريطة');
    assert.match(seen[0], /ثبّته/, 'يُقال له العطب ولا يُقال له الدواء');
  });

  await t.test('والنقل يُبلَّغ به الطرفان — الآخذ والمأخوذ منه', async () => {
    const owner = await signUp('imam', 'الشيخ الأوّل');
    const heir = await signUp('imam', 'الشيخ الخَلَف');
    const mosque = await makeMosque('جامع الانتقال');

    const first = await as(owner, 'claimMosque', {
      mosqueId: mosque.id, capacity: 'imam', lat: 23.6, lng: 58.5,
    });
    await as(admin, 'reviewMosqueClaim', { claimId: first.claimId, approve: true });

    const second = await as(heir, 'claimMosque', {
      mosqueId: mosque.id, capacity: 'imam', lat: 23.6, lng: 58.5,
    });
    const ownerBefore = (await inbox(owner)).length;
    await as(admin, 'reviewMosqueClaim', { claimId: second.claimId, approve: true });

    const ownerAfter = await inbox(owner);
    assert.ok(ownerAfter.length > ownerBefore, 'نُزع مسجده ولم يُخبَر');
    assert.match(ownerAfter[0], /نُقلت إمامة/);

    assert.match((await inbox(heir))[0], /اعتُمدت إمامتك/,
      'الخَلَف ينتظر قراراً كما ينتظره غيره');
  });

  await t.test('ولا يصل قرارُ أحدٍ إلى غيره', async () => {
    const bystander = await signUp('imam', 'الشيخ الغريب');
    const seen = await inbox(bystander);
    assert.deepEqual(seen, [], `وصلته قرارات ليست له: ${JSON.stringify(seen)}`);
  });
});
