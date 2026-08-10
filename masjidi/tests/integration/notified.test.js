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

  await t.test('ولا يصل خبرُ أحدٍ إلى غيره', async () => {
    // الوارد صفٌّ لكل مستهدَف، فخطأٌ في `userId` يُسرّب حركة مسجدٍ إلى غريب
    const seen = await inbox(khalid);
    assert.equal(seen.some((body) => /اعتمد الإمام عملك/.test(body)), false,
      'وصل خالداً خبرُ اعتماد عملٍ ليس له');
    assert.equal(seen.some((body) => /بدأ العمل/.test(body)), false);
  });
});
