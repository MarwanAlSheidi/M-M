/**
 * اختبار تكامل: كلُّ انتقالٍ في دورة الطلب يبلغ صاحبَه.
 *
 * مُسحت دورةُ الطلب انتقالاً انتقالاً: من يتأثّر بكلٍّ منها، وهل يُخبَر؟
 * فكانت سبعةٌ تُخبِر وثلاثةٌ صامتة، وأخطرُ الثلاثة قِيس على خادمٍ حقيقي:
 *
 *     المتطوّع بعد التكليف:  1 — «تم تكليفك بـ…»
 *     المتطوّع بعد الاعتماد: 1 — **الرسالة نفسها، لا شيء جديد**
 *     وسمعته صارت:          completedJobs=1  avgRating=5
 *
 * **قُيِّم ولم يُخبَر.** والمسار كلُّه في المرحلة الأولى قائمٌ على التطوّع
 * العيني، فاللحظة التي يُكافأ فيها المتطوّع هي اللحظة الوحيدة التي سكتت عنها
 * المنصّة. وكانت «بارك الله فيكم» في ردّ الدالّة — أي للإمام الذي ضغط الزرّ.
 *
 * والصامتان الآخران: بدءُ العمل لا يبلغ الإمام، والاعتذارُ عن الاهتمام لا
 * يبلغه — وقد أُخبر بالاهتمام نفسه، **فيُدعى إلى قائمةٍ صارت فارغة**.
 *
 * ولماذا التكامل لا الوحدة: الوارد صفٌّ في `Notifications` يكتبه `lib/push.js`
 * ويقرؤه `getMyNotifications` بعدّ غير المقروء — سلسلةٌ لا يقيسها إلا خادمٌ
 * حقيقي بمخطّطه.
 *
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:integration`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startStack, applySchema, unavailableReason } = require('./harness');

const skip = unavailableReason();
const options = skip ? { skip } : {};

test('لا انتقالَ صامتاً على صاحبه', options, async (t) => {
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
    await user.signUp();
    tokens.set(user.id, user.getSessionToken());
    return user;
  }
  const as = (user, fn, params = {}) =>
    Parse.Cloud.run(fn, params, { sessionToken: tokens.get(user.id) });

  /** نصوص الوارد كما يقرؤها صاحبه. */
  const inbox = async (user) => {
    const result = await as(user, 'getMyNotifications', {});
    return result.items.map((row) => row.body);
  };

  const imam = await signUp('imam', 'الشيخ سعيد');
  const salim = await signUp('volunteer', 'سالم بن راشد');
  const khalid = await signUp('volunteer', 'خالد بن سيف');

  const mosque = new (Parse.Object.extend('Mosques'))();
  mosque.set({
    externalId: `notified_${Date.now()}`, name: 'جامع البلاغ',
    governorate: 'مسقط', wilayat: 'بوشر', isClaimed: true, imamId: imam,
    lat: 23.6, lng: 58.5,
  });
  await mosque.save(null, { useMasterKey: true });

  const newRequest = async (title) => {
    const created = await as(imam, 'createServiceRequest', {
      mosqueId: mosque.id, title, category: 'electrical',
      description: 'إنارة صحن المسجد معطّلة منذ أسبوع.',
    });
    return created.objectId;
  };

  await t.test('المتطوّع يُخبَر أن عمله اعتُمد — وسمعتُه تُكتب في اللحظة نفسها', async () => {
    const requestId = await newRequest('تصليح إنارة الصحن');
    await as(salim, 'expressInterest', { requestId, note: 'أستطيع غداً' });
    await as(imam, 'assignWorker', { requestId, workerId: salim.id });
    await as(salim, 'startWork', { requestId });
    await as(salim, 'markWorkDone', { requestId, notes: 'تمّ' });

    const before = await inbox(salim);
    await as(imam, 'completeService', { requestId, rating: 5, volunteerHours: 3 });
    const after = await inbox(salim);

    assert.ok(after.length > before.length,
      `وارد المتطوّع لم يتغيّر بالاعتماد: ${JSON.stringify(after)}`);
    assert.match(after[0], /اعتمد الإمام عملك/);
    // الساعات تُسجَّل ولا تُقال — وهي ما يبقى للمتطوّع من عمله
    assert.match(after[0], /3 ساعة/, 'سُجّلت ساعاته ولم يُخبَر بها');

    // والسمعة تغيّرت فعلاً في اللحظة نفسها — فالصمت كان على تغيّرٍ واقع
    const fresh = await new Parse.Query(Parse.User).get(salim.id, { useMasterKey: true });
    assert.equal(fresh.get('completedJobs'), 1);
    assert.equal(fresh.get('avgRating'), 5);
  });

  await t.test('والشركة كذلك — تُكلَّف وتُنفّذ كالمتطوّع', async () => {
    const company = await signUp('contractor', 'مؤسسة النور');
    company.set('isVerifiedContractor', true);
    await company.save(null, { useMasterKey: true });

    const requestId = await newRequest('صيانة مكيّفات');
    await as(imam, 'assignWorker', { requestId, workerId: company.id });
    await as(company, 'startWork', { requestId });
    await as(company, 'markWorkDone', { requestId, notes: 'تمّ' });
    await as(imam, 'completeService', { requestId, rating: 4 });

    const seen = await inbox(company);
    assert.ok(seen.some((body) => /اعتمد الإمام عملك/.test(body)),
      `وارد الشركة بلا خبر الاعتماد: ${JSON.stringify(seen)}`);
    // ولا تُقال ساعات تطوّع لمن لم تُسجَّل له
    assert.ok(!seen.some((body) => /ساعة تطوّع/.test(body)));
  });

  await t.test('والإمام يُخبَر أن العمل بدأ في مسجده', async () => {
    const requestId = await newRequest('ترميم المئذنة');
    await as(salim, 'expressInterest', { requestId });
    await as(imam, 'assignWorker', { requestId, workerId: salim.id });

    const before = await inbox(imam);
    await as(salim, 'startWork', { requestId });
    const after = await inbox(imam);

    assert.ok(after.length > before.length, 'بدأ العمل في مسجده ولم يُخبَر');
    assert.match(after[0], /بدأ العمل/);
    assert.match(after[0], /جامع البلاغ/, 'للإمام مساجد، والخبر بلا مسجدٍ ناقص');
  });

  await t.test('ويُخبَر بالاعتذار كما أُخبر بالاهتمام', async () => {
    const requestId = await newRequest('تنظيف الخزّان');
    await as(khalid, 'expressInterest', { requestId });

    const before = await inbox(imam);
    assert.ok(before.some((body) => /متطوّع مهتمّ/.test(body)), 'لم يُخبَر بالاهتمام أصلاً');

    await as(khalid, 'withdrawInterest', { requestId });
    const after = await inbox(imam);

    // دُعي إلى قائمةٍ صارت فارغة: الإخبار بالبدء دون النهاية أسوأ من الصمت فيهما
    assert.ok(after.length > before.length,
      `انصرف المتطوّع بعد أن أُخبر الإمام باهتمامه: ${JSON.stringify(after)}`);
    assert.match(after[0], /اعتذر متطوّع/);
  });

  /*
   * **ومن قال «هذا مسجدي» يُبلَّغ بما يقع فيه.**
   *
   * `favoriteMosqueId` هو التعبير الوحيد عن الانتماء في المنصّة: يضغط
   * المستخدم «هذا مسجدي» فيُقال له «صار مسجدك»، ويُحفظ، ويُعرض في «حسابي».
   * وقِيس في متصفّح حقيقي أنه **لا يترتّب عليه شيء**: متبرّعٌ اختار مسجداً،
   * ثم نشر إمامُه احتياجاً فيه، فكان واردُه صفراً.
   *
   * لأن الإشعار القريب يُصفّي بالدور (`volunteer`) وبموقع الجهاز الآن — فيُخطئ
   * من أعلن انتماءه وهو في بيته، ويُخطئ المتبرّع دائماً.
   */
  await t.test('ومن أعلن أن هذا مسجده يُبلَّغ باحتياجه — ولو لم يكن متطوّعاً', async () => {
    const donor = await signUp('donor', 'أبو محمد');
    await as(donor, 'setFavoriteMosque', { mosqueId: mosque.id });

    // ومن أعلن انتماءه لمسجدٍ آخر لا يُزعَج — **حالةٌ يجب أن تبقى خضراء**
    const other = new (Parse.Object.extend('Mosques'))();
    other.set({
      externalId: `other_${Date.now()}`, name: 'مسجد الفتح',
      governorate: 'مسقط', wilayat: 'السيب', lat: 23.7, lng: 58.2,
    });
    await other.save(null, { useMasterKey: true });
    const stranger = await signUp('donor', 'أبو سالم');
    await as(stranger, 'setFavoriteMosque', { mosqueId: other.id });

    const before = (await inbox(donor)).length;
    await newRequest('صيانة مكيّفات المصلّى');

    const after = await inbox(donor);
    assert.ok(after.length > before,
      'أعلن أن هذا مسجده فلم يُخبَر باحتياجه — ووعدُ الانتماء لا يُوفى');
    // **الرسالة لا الحال**: نموٌّ في الوارد قد يجيء من خبرٍ آخر
    assert.match(after[0], /احتياجٌ جديد/, `أُخبر بغير ما وقع: «${after[0]}»`);
    assert.match(after[0], /جامع البلاغ/, 'خبرٌ بلا اسم المسجد الذي انتمى إليه');

    assert.deepEqual(await inbox(stranger), [],
      'وصل خبرُ مسجدٍ إلى من أعلن انتماءه لغيره');

    // والإمام لا يُخبَر بما نشره هو
    assert.equal((await inbox(imam)).some((body) => /احتياجٌ جديد في جامع البلاغ/.test(body)),
      false, 'أُخبر الإمام بخبر نشره بنفسه');
  });

  /*
   * والقناة تحمل الفرج كما حملت الخبر.
   *
   * قِيس على خادمٍ حقيقي: منتمٍ أُبلغ بالاحتياج، ثم مرّت دورة الطلب كاملةً —
   * تطوّعٌ فتكليفٌ فبدءٌ فإنجازٌ فاعتماد — ووارده بعدها **رسالةٌ واحدة كما
   * كان**: «احتياجٌ جديد». الإمام يصله ثلاث، والمنفّذ اثنتان، والمنتمي واحدة
   * أبداً. قناةٌ تُنذر ولا تُطمئن.
   */
  await t.test('ومن أُبلغ بالاحتياج يُبلَّغ بانقضائه', async () => {
    const ahli = await signUp('donor', 'أبو زيد');
    await as(ahli, 'setFavoriteMosque', { mosqueId: mosque.id });

    // ومنتمٍ لمسجدٍ آخر لا يُزعَج بفرح غيره — **حالةٌ يجب أن تبقى خضراء**
    const far = new (Parse.Object.extend('Mosques'))();
    far.set({
      externalId: `far_${Date.now()}`, name: 'مسجد الوفاء',
      governorate: 'ظفار', wilayat: 'صلالة', lat: 17.0, lng: 54.1,
    });
    await far.save(null, { useMasterKey: true });
    const outsider = await signUp('donor', 'أبو نصر');
    await as(outsider, 'setFavoriteMosque', { mosqueId: far.id });

    const requestId = await newRequest('تجديد فرش المصلّى');
    const announced = await inbox(ahli);
    assert.match(announced[0], /احتياجٌ جديد/, 'لم يُبلَّغ بالاحتياج أصلاً');

    await as(salim, 'expressInterest', { requestId });
    await as(imam, 'assignWorker', { requestId, workerId: salim.id });
    await as(salim, 'startWork', { requestId });
    await as(salim, 'markWorkDone', { requestId, notes: 'تمّ' });
    await as(imam, 'completeService', { requestId, rating: 5, volunteerHours: 2 });

    const after = await inbox(ahli);
    assert.ok(after.length > announced.length,
      `أُنجز العمل في مسجده ولم يُخبَر — الوارد كما هو: ${JSON.stringify(after)}`);
    // **الرسالة لا الحال**: نموٌّ في الوارد قد يجيء من خبرٍ آخر
    assert.match(after[0], /أُنجز/, `أُخبر بغير ما وقع: «${after[0]}»`);
    assert.match(after[0], /تجديد فرش المصلّى/, 'فرجٌ بلا ذكر ما انقضى');
    assert.match(after[0], /جامع البلاغ/, 'خبرٌ بلا اسم المسجد الذي انتمى إليه');

    assert.deepEqual(await inbox(outsider), [],
      'وصل خبرُ مسجدٍ إلى من أعلن انتماءه لغيره');

    // والإمام اعتمد بنفسه، والمنفّذ وصلته رسالةٌ باسمه — فلا يُثنّى عليهما
    assert.equal((await inbox(imam)).some((body) => /^أُنجز في جامع البلاغ/.test(body)),
      false, 'أُخبر الإمام بخبرٍ صنعه بنفسه');
    assert.equal((await inbox(salim)).some((body) => /^أُنجز في جامع البلاغ/.test(body)),
      false, 'أُخبر المنفّذ مرّتين بإنجازٍ واحد');
  });

  await t.test('والإلغاء نهايةٌ تُبلَّغ كالإنجاز', async () => {
    const ahli = await signUp('donor', 'أبو حمد');
    await as(ahli, 'setFavoriteMosque', { mosqueId: mosque.id });

    const requestId = await newRequest('إصلاح باب المصلّى');
    const announced = await inbox(ahli);
    assert.equal(announced.length, 1, 'لم يُبلَّغ بالاحتياج أصلاً');

    await as(imam, 'cancelServiceRequest', { requestId });

    const after = await inbox(ahli);
    assert.ok(after.length > announced.length,
      `أُلغي الطلب وبقي في وارده احتياجٌ لم يعد قائماً: ${JSON.stringify(after)}`);
    assert.match(after[0], /لم يعد/, `أُخبر بغير ما وقع: «${after[0]}»`);
    assert.match(after[0], /إصلاح باب المصلّى/, 'إلغاءٌ بلا ذكر ما أُلغي');
  });

  await t.test('ولا يصل خبرُ أحدٍ إلى غيره', async () => {
    // الوارد صفٌّ لكل مستهدَف، فخطأٌ في `userId` يُسرّب حركة مسجدٍ إلى غريب
    const seen = await inbox(khalid);
    assert.equal(seen.some((body) => /اعتمد الإمام عملك/.test(body)), false,
      'وصل خالداً خبرُ اعتماد عملٍ ليس له');
    assert.equal(seen.some((body) => /بدأ العمل/.test(body)), false);
  });
});
