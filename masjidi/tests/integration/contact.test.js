/**
 * اختبار تكامل: كلٌّ من طرفَي التكليف يعرف الآخر — ولا يعرفه سواهما.
 *
 * قِيس في متصفّح حقيقي على شاشة الإمام بعد التكليف، فلم يكن عليها اسمٌ ولا رقم:
 *
 *     كُلِّف المنفّذ منذ 12 يوماً ولمّا يبدأ بعد… **إن كنت على تواصلٍ معه**
 *     فانتظاره أولى، وإلا فاسحب التكليف | سحب التكليف — لم يحضر
 *
 * والزرّ يُقيِّد غياباً في `abandonedJobs` يقرؤه كل إمامٍ بعده. **حكمٌ على
 * إنسانٍ لا يُرى**، ثم يُكتب له تقييمٌ في `avgRating` كذلك.
 *
 * ولماذا التكامل لا الوحدة: `phone` محميّ في `protectedFields` على `_User`،
 * **وذلك حرسٌ لا يعرفه بديل Parse أصلاً** — فسؤال «أيتسرّب الرقم باستعلامٍ من
 * العميل؟» لا جواب له إلا على خادمٍ حقيقي يطبّق المخطط.
 *
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:integration`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startStack, applySchema, unavailableReason } = require('./harness');

const skip = unavailableReason();
const options = skip ? { skip } : {};

test('طرفا التكليف يتعارفان، ولا يعرفهما ثالث', options, async (t) => {
  const stack = await startStack();
  const { Parse } = stack;
  t.after(() => stack.stop());

  await applySchema(Parse);

  const tokens = new Map();
  let unique = 0;
  async function signUp(role, fullName, phone) {
    const user = new Parse.User();
    user.set('username', `${role}_${Date.now()}_${++unique}`);
    user.set('password', 'Integration12345!');
    user.set('role', role);
    user.set('fullName', fullName);
    user.set('phone', phone);
    await user.signUp();
    tokens.set(user.id, user.getSessionToken());
    return user;
  }
  const as = (user, fn, params = {}) =>
    Parse.Cloud.run(fn, params, { sessionToken: tokens.get(user.id) });

  /**
   * الطرف الآخر لطلبٍ واحد — والدالّة تأخذ قائمةً وتُعيد خريطة.
   *
   * وما لا يكون المستدعي طرفاً فيه **يغيب من الخريطة ولا يُسقط الدفعة**:
   * القائمة تُطلب لصفوفٍ بيد صاحبها، فسقوطُها كلِّها لأجل صفٍّ واحد يُعمي
   * البقيّة. فالتحقّق هنا على الغياب لا على الرمي.
   */
  const contactOf = async (user, id) => {
    const map = await Parse.Cloud.run('getRequestContacts', { requestIds: [id] },
      { sessionToken: tokens.get(user.id) });
    return map[id];
  };


  const imam = await signUp('imam', 'الشيخ سعيد', '99110011');
  const salim = await signUp('volunteer', 'سالم بن راشد', '99220022');
  const stranger = await signUp('volunteer', 'فضوليّ', '99330033');

  const mosque = new (Parse.Object.extend('Mosques'))();
  mosque.set({
    externalId: `contact_${Date.now()}`, name: 'جامع التواصل',
    governorate: 'مسقط', wilayat: 'بوشر', isClaimed: true, imamId: imam,
    lat: 23.6, lng: 58.5,
  });
  await mosque.save(null, { useMasterKey: true });

  const created = await as(imam, 'createServiceRequest', {
    mosqueId: mosque.id,
    title: 'تصليح إنارة الصحن',
    description: 'إنارة صحن المسجد معطّلة منذ أسبوع.',
    category: 'electrical',
  });
  const requestId = created.objectId;

  await t.test('قبل التكليف لا طرف آخر أصلاً', async () => {
    assert.equal(await contactOf(imam, requestId), undefined);
  });

  await as(salim, 'expressInterest', { requestId, note: 'أستطيع غداً' });
  await as(imam, 'assignWorker', { requestId, workerId: salim.id });

  await t.test('الإمام يرى المنفّذ الذي يحكم عليه — اسماً ورقماً', async () => {
    const contact = await contactOf(imam, requestId);
    assert.equal(contact.name, 'سالم بن راشد');
    assert.equal(contact.phone, '99220022', 'الاسم بلا رقم لا يُنشئ تواصلاً');
    assert.equal(contact.role, 'volunteer');
  });

  await t.test('والمنفّذ يرى من يسأل عنه إذا وصل المسجد', async () => {
    const contact = await contactOf(salim, requestId);
    assert.equal(contact.name, 'الشيخ سعيد');
    assert.equal(contact.phone, '99110011');
    assert.equal(contact.role, 'imam');
  });

  await t.test('ولا يقرأ رقمَ أحدهما من ليس طرفاً', async () => {
    assert.equal(await contactOf(stranger, requestId), undefined,
      'قرأ رقمَ طرفٍ في تكليفٍ لا شأن له به');
  });

  await t.test('ولا يُقرأ شيءٌ عن أحدٍ باستعلامٍ مباشر — الحرس أوسع ممّا ظننت', async () => {
    // لو كان الحساب مقروءاً هكذا لكانت الدالّة زينةً: يُعدّد الفضوليُّ
    // المستخدمين ويقرأ أرقامهم بلا تكليفٍ ولا صلة.
    //
    // وقِيس: `protectedFields` تحجب `phone` وحده، لكنّ الـACL على كل حساب
    // `{صاحبه: قراءة وكتابة}` — فالاستعلام لا يُخفي حقلاً بل **لا يُرجع
    // الكائن أصلاً**. حتى الاسم لا يُقرأ، فالدالّة ليست تسهيلاً بل الطريق
    // الوحيد، وسحبُها يُعيد الشاشة إلى حكمٍ على مجهول.
    const seen = await new Parse.Query(Parse.User)
      .equalTo('objectId', salim.id)
      .first({ sessionToken: tokens.get(stranger.id) });
    assert.equal(seen, undefined, 'حسابُ المتطوّع يُقرأ من أي مستخدم مصادَق');

    const all = await new Parse.Query(Parse.User).limit(10)
      .find({ sessionToken: tokens.get(stranger.id) });
    assert.equal(all.length, 1, 'الاستعلام يُعدّد المستخدمين');
    assert.equal(all[0].id, stranger.id, 'ومن يراه ليس نفسه');
  });

  await t.test('والدفعة تُعطي ما له وتُسقط ما ليس له — ولا تسقط كلُّها', async () => {
    // القائمة تُطلب لصفوفٍ بيد صاحبها، فسقوطُها كلِّها لأجل صفٍّ واحد يُعمي
    // البقيّة. وهذا هو الفرق بين الدفعة والنداء الواحد، فيُقاس صراحةً.
    const other = new (Parse.Object.extend('Mosques'))();
    other.set({
      externalId: `contact2_${Date.now()}`, name: 'جامع الغير',
      governorate: 'مسقط', wilayat: 'بوشر', isClaimed: true, imamId: stranger,
      lat: 23.6, lng: 58.5,
    });
    await other.save(null, { useMasterKey: true });

    const mine = await Parse.Cloud.run('getRequestContacts',
      { requestIds: [requestId, 'AAAAAAAAAA'] },
      { sessionToken: tokens.get(imam.id) });

    assert.equal(Object.keys(mine).length, 1, 'معرّفٌ غريب أسقط الدفعة كلَّها');
    assert.equal(mine[requestId].name, 'سالم بن راشد');
  });

  await t.test('وينقطع التواصل بانقضاء التكليف', async () => {
    await as(salim, 'startWork', { requestId });
    // في التنفيذ يبقى — فالحاجة قائمة ما دام العمل قائماً
    assert.equal((await contactOf(imam, requestId)).name, 'سالم بن راشد');

    await as(salim, 'markWorkDone', { requestId, notes: 'تمّ' });
    // وفي المعاينة يبقى: الاعتماد يكتب تقييماً، والتقييم حكمٌ على مَن
    assert.equal((await contactOf(imam, requestId)).name, 'سالم بن راشد');

    await as(imam, 'completeService', { requestId, rating: 5 });
    assert.equal(await contactOf(imam, requestId), undefined);
    assert.equal(await contactOf(salim, requestId), undefined);
  });
});
