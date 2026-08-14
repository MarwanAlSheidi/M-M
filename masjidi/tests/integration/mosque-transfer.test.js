/**
 * اختبار تكامل: مسجدٌ ينتقل من إمامٍ إلى إمام.
 *
 * `claimMosque` تردّ كلّ طلبٍ على مسجدٍ مسجَّل، ولا دالةَ تُغيّر إمامه بعد ذلك.
 * **فالمسجد مربوطٌ بأوّل من سجّله إلى الأبد.** والأئمّة يُنقلون ويتقاعدون
 * ويموتون، ومنهم من يُوقَف حسابه لإساءة — وحينها:
 *
 * - المسجد مجمَّد: لا طلب صيانةٍ جديد، ولا اعتماد لعملٍ أُنجز
 * - ومنفّذٌ أتمّ عملَه يبقى بلا اعتمادٍ ولا تقييمٍ ولا عدٍّ في سجلّه
 * - وإمامُه الجديد لا يستطيع تسجيله: «مسجّل باسم غيرك بالفعل»
 *
 * فعقوبةُ إمامٍ مسيء تقع على جماعة المسجد، ولا مخرج إلا تعديلُ السجلّ يدوياً
 * من لوحة Back4app بلا أثرٍ ولا مراجعة.
 *
 * وآلة النقل موجودة أصلاً: `reviewMosqueClaim` تكتب `imamId` عند الاعتماد.
 * الناقص أن يُقبل الطلب أصلاً، وأن يعرف المشرف أنه نقلٌ لا تسجيلٌ أوّل.
 *
 * في ملفٍّ مستقلّ — خادمٌ واحد لكل عملية، ويحرس ذلك `harness.startStack`.
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:integration`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startStack, applySchema, unavailableReason } = require('./harness');

const skip = unavailableReason();
const options = skip ? { skip } : {};

test('انتقال المسجد بين الأئمّة', options, async (t) => {
  const stack = await startStack();
  const { Parse } = stack;
  t.after(() => stack.stop());

  await applySchema(Parse);

  const tokens = new Map();
  let unique = 0;
  async function signUp(role, extra = {}) {
    const user = new Parse.User();
    user.set({ username: `mv_${role}_${Date.now()}_${++unique}`, password: 'Integration12345!', role });
    for (const [key, value] of Object.entries(extra)) user.set(key, value);
    await user.signUp();
    tokens.set(user.id, user.getSessionToken());
    return user;
  }
  const as = (user, fn, params = {}) =>
    Parse.Cloud.run(fn, params, { sessionToken: tokens.get(user.id) });

  const admin = await signUp('donor');
  admin.set('role', 'admin');
  await admin.save(null, { useMasterKey: true });

  const departed = await signUp('imam', { fullName: 'الشيخ سعيد', phone: '90000001' });
  const successor = await signUp('imam', { fullName: 'الشيخ حمد', phone: '90000002' });
  const volunteer = await signUp('volunteer', { fullName: 'سالم' });

  const AT = { lat: 23.6, lng: 58.5 };
  const Mosque = Parse.Object.extend('Mosques');
  const mosque = new Mosque();
  mosque.set({
    externalId: `mv_${Date.now()}`, name: 'جامع المنتقل', governorate: 'مسقط',
    wilayat: 'بوشر', isClaimed: true, imamId: departed,
    lat: AT.lat, lng: AT.lng, hasLocation: true,
  });
  await mosque.save(null, { useMasterKey: true });

  /** عملٌ أتمّه متطوّعٌ وينتظر معاينة الإمام — هذا ما يتجمّد بغيابه. */
  const stranded = await as(departed, 'createServiceRequest',
    { mosqueId: mosque.id, title: 'ترميم المئذنة', description: 'تشقّقٌ في جدار المئذنة' });
  await as(volunteer, 'expressInterest', { requestId: stranded.objectId });
  await as(departed, 'assignWorker', { requestId: stranded.objectId, workerId: volunteer.id });
  await as(volunteer, 'startWork', { requestId: stranded.objectId });
  await as(volunteer, 'markWorkDone', { requestId: stranded.objectId, notes: 'رُمّمت' });

  // الإمام يُوقَف حسابه — والمسجد يتجمّد معه
  departed.set('isActive', false);
  await departed.save(null, { useMasterKey: true });

  /** وارد الموقوف: `getMyNotifications` تردّه، فيُقرأ من القاعدة مباشرةً. */
  const inboxOf = (user) => new Parse.Query('Notifications')
    .equalTo('userId', user).descending('createdAt').find({ useMasterKey: true });
  const reread = () => new Parse.Query('Mosques').get(mosque.id, { useMasterKey: true });

  let claimId;

  await t.test('الإمام الموقوف لا يعتمد عملاً أُنجز في مسجده', async () => {
    // البيّنة على أن الجمود واقعٌ لا مفترض
    await assert.rejects(
      as(departed, 'completeService', { requestId: stranded.objectId, rating: 5 }),
      /موقوف/);
  });

  await t.test('وخَلَفُه يطلب المسجد، فيُقبل طلبه بوصفه نقلاً لا يُردّ عند الباب', async () => {
    const result = await as(successor, 'claimMosque',
      { mosqueId: mosque.id, capacity: 'imam', evidenceNote: 'عُيّنت إماماً بعده', ...AT });

    assert.ok(result.claimId, 'رُدّ خَلَفُ الإمام عند الباب — والمسجد يبقى مجمّداً أبداً');
    assert.equal(result.isTransfer, true,
      'قيل له «سُجّل طلبك» ولم يُقل إنه طلب نقل — والخبر الناقص يُنتظر عليه');
    claimId = result.claimId;

    // ويقرؤه في «طلباتي» كذلك: مراجعةُ النقل أثقل، ومن ظنّه تسجيلاً عادياً
    // انتظر «أيام عمل» لا تأتي
    const mine = await as(successor, 'getMyClaims');
    assert.equal(mine.find((row) => row.id === claimId).isTransfer, true);
  });

  await t.test('وإمامُه لا يطلب مسجده — الطلب على النفس لغو', async () => {
    const own = await signUp('imam', { fullName: 'الشيخ مالك' });
    const other = new Mosque();
    other.set({
      externalId: `mv_own_${Date.now()}`, name: 'مسجد المالك', governorate: 'مسقط',
      wilayat: 'بوشر', isClaimed: true, imamId: own, lat: 23.61, lng: 58.51, hasLocation: true,
    });
    await other.save(null, { useMasterKey: true });

    await assert.rejects(
      as(own, 'claimMosque', { mosqueId: other.id, lat: 23.61, lng: 58.51 }),
      /مسجَّلٌ على هذا المسجد/);
  });

  await t.test('والمشرف يرى أنه نقلٌ ومع من هو الآن — وإلا اعتمده كتسجيلٍ أوّل', async () => {
    const rows = await as(admin, 'listPendingClaims');
    const row = rows.find((entry) => entry.id === claimId);

    assert.ok(row, 'الطلب لا يصل المشرف');
    assert.equal(row.isTransfer, true,
      'يُعرض النقل كتسجيلٍ أوّل، فيُنزع مسجدٌ من إمامه بضغطةٍ لا يعلم أثرها');
    assert.equal(row.currentImamName, 'الشيخ سعيد',
      'لا يُقال للمشرف ممّن يُنزع — ولا سبيل له إلى التحقّق');
    assert.equal(row.currentImamPhone, '90000001', 'ولا سبيل للاتصال بمن يُنزع منه');
  });

  await t.test('والاعتماد ينقل الإشراف ويُخبر السابق', async () => {
    const before = (await inboxOf(departed)).length;
    await as(admin, 'reviewMosqueClaim', { claimId, approve: true });

    const fresh = await reread();
    assert.equal(fresh.get('imamId').id, successor.id, 'اعتُمد النقل ولم يُنقل شيء');
    assert.equal(fresh.get('isClaimed'), true, 'المسجد صار بلا إمام بدل أن ينتقل');

    const after = await inboxOf(departed);
    assert.ok(after.length > before, 'نُزع مسجدٌ من إمامه ولم يُخبَر به');
    assert.match(after[0].get('body'), /جامع المنتقل/, 'الإشعار لا يقول أيُّ مسجدٍ يعني');
  });

  await t.test('ويُقيَّد في سجلّ المسجد بلا تسمية أحد', async () => {
    const trail = await as(successor, 'getMosqueAuditTrail', { mosqueId: mosque.id });
    const entry = trail.find((row) => row.action === 'mosque_transferred');
    assert.ok(entry, 'تغيّر إمامُ المسجد بلا أثرٍ في سجلّه');
    // السجلّ يُقرأ من كل مستخدم، و`getMosqueAuditTrail` تُعيد الدور لا الهوية
    assert.equal(entry.note, null, 'أسماء الأئمّة في سجلٍّ يقرؤه كل الناس');
  });

  await t.test('والخَلَف يعتمد العمل الذي بقي معلّقاً — وهذا مقصود النقل', async () => {
    const done = await as(successor, 'completeService',
      { requestId: stranded.objectId, rating: 5, volunteerHours: 3 });
    assert.equal(done.status, 'completed');

    await volunteer.fetch({ useMasterKey: true });
    assert.equal(volunteer.get('completedJobs'), 1,
      'المتطوّع أتمّ عملَه ولم يُعدّ له — عقوبةُ الإمام وقعت عليه');
  });

  await t.test('والسابق لم يعد يملك شيئاً منه', async () => {
    departed.set('isActive', true);
    await departed.save(null, { useMasterKey: true });

    assert.equal((await as(departed, 'getMyMosques')).length, 0);
    await assert.rejects(
      as(departed, 'createServiceRequest',
        { mosqueId: mosque.id, title: 'طلبٌ بعد النقل', description: 'وصفٌ كافٍ لهذا الطلب' }),
      /لستَ مسجَّلاً/);
  });

  await t.test('والرفض لا ينقل شيئاً', async () => {
    const third = await signUp('imam', { fullName: 'الشيخ راشد' });
    const asked = await as(third, 'claimMosque', { mosqueId: mosque.id, ...AT });
    await as(admin, 'reviewMosqueClaim', { claimId: asked.claimId, approve: false });

    assert.equal((await reread()).get('imamId').id, successor.id);
  });

  await t.test('وطلبات النقل محدودةٌ لكلّ طالب — وإلا اجتاح المساجد', async () => {
    // فتحُ المسجّل للطلبات يجعل الثمانية عشر ألفاً كلَّها قابلةً للمنازعة،
    // والمشرف وحده هو الحاجز. فلا يُترك بابُ الإغراق مفتوحاً.
    const greedy = await signUp('imam', { fullName: 'الشيخ الطامع' });
    const targets = [];
    for (let i = 0; i < 4; i += 1) {
      const spare = new Mosque();
      spare.set({
        externalId: `mv_spare_${Date.now()}_${i}`, name: `مسجد ${i}`, governorate: 'مسقط',
        wilayat: 'بوشر', lat: 23.6, lng: 58.5, hasLocation: true,
      });
      await spare.save(null, { useMasterKey: true });
      targets.push(spare);
    }

    for (let i = 0; i < 3; i += 1) {
      await as(greedy, 'claimMosque', { mosqueId: targets[i].id, ...AT });
    }
    await assert.rejects(
      as(greedy, 'claimMosque', { mosqueId: targets[3].id, ...AT }),
      /طلبات معلّقة/);
  });
});
