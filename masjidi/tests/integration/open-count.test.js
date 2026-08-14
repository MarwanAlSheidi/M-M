/**
 * شارةُ «N طلب مفتوح» تعدّ ما لم يُفرَغ منه.
 *
 * **العطب المقيس:** كانت `pending_imam_approval` خارج المعدود. وقِيست دورة
 * الطلب على خادمٍ حقيقي من عين القائم على المسجد:
 *
 *     كُلّف المنفّذ        الشارة=1   ·  غيرُ المغلقة فعلاً=1
 *     بدأ العمل            الشارة=1   ·  غيرُ المغلقة فعلاً=1
 *     **أُبلغ بالإنجاز**    **الشارة=0** ·  غيرُ المغلقة فعلاً=1
 *     اعتمده               الشارة=0   ·  غيرُ المغلقة فعلاً=0
 *
 * فاللحظةُ التي يصير فيها الطلبُ **بانتظاره هو** هي التي تختفي فيها شارتُه.
 * يفتح «مساجدي» فيرى مسجداً بلا شيء معلّق، وفي الطابور عملٌ أُنجز ينتظر
 * معاينته — وينتظر معه متطوّعٌ سمعتُه وساعاتُه موقوفةٌ على ضغطته.
 *
 * ولماذا التكامل لا الوحدة: العدّاد يكتبه `afterSave` باستعلامٍ على القاعدة،
 * ويقرؤه `getMyMosques` من كائنٍ آخر — سلسلةٌ لا يقيسها إلا خادمٌ حقيقي.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startStack, applySchema, unavailableReason } = require('./harness');

const skip = unavailableReason();
const options = skip ? { skip } : {};

test('شارةُ الطلبات المفتوحة تعدّ ما لم يُفرَغ منه', options, async (t) => {
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

  const imam = await signUp('imam', 'الشيخ سعيد');
  const salim = await signUp('volunteer', 'سالم بن راشد');

  const mosque = new (Parse.Object.extend('Mosques'))();
  mosque.set({
    externalId: `count_${Date.now()}`, name: 'البلاغ', type: 'جامع',
    governorate: 'مسقط', wilayat: 'بوشر', isClaimed: true, imamId: imam,
    lat: 23.6, lng: 58.5, hasLocation: true,
  });
  await mosque.save(null, { useMasterKey: true });

  /** الشارة كما يقرؤها صاحبُ المسجد على بطاقته. */
  const badge = async () => {
    const mine = await as(imam, 'getMyMosques', {});
    const card = mine.find((each) => each.id === mosque.id);
    assert.ok(card, 'المسجد غائبٌ عن «مساجدي» — القياس لم يقع');
    return card.openRequestsCount;
  };

  const requestId = (await as(imam, 'createServiceRequest', {
    mosqueId: mosque.id, title: 'إصلاح إنارة الصحن', category: 'electrical',
    description: 'إنارة صحن المسجد معطّلة منذ أسبوع ولا يُرى الطريق ليلاً.',
  })).objectId;

  /* ————— حدودٌ يجب أن تبقى خضراء ————— */

  await t.test('الطلب المنشور يُعدّ', async () => {
    assert.equal(await badge(), 1, 'نُشر احتياجٌ ولم تعدّه الشارة');
  });

  await t.test('والمكلَّف يبقى معدوداً', async () => {
    await as(salim, 'expressInterest', { requestId });
    await as(imam, 'assignWorker', { requestId, workerId: salim.id });
    assert.equal(await badge(), 1, 'كُلّف المنفّذ فسقط الطلب من الشارة');
    await as(salim, 'startWork', { requestId });
    assert.equal(await badge(), 1, 'بدأ العمل فسقط الطلب من الشارة');
  });

  /* ————— العطب نفسه ————— */

  await t.test('وما ينتظر معاينةَ صاحبِ المسجد يُعدّ — وهو أولى', async () => {
    await as(salim, 'markWorkDone', { requestId, notes: 'أُصلحت الإنارة' });
    assert.equal(await badge(), 1,
      'صار الطلبُ بانتظار صاحب المسجد فاختفى من شارته — وهي اللحظة التي يلزمه فيها');
  });

  await t.test('ثمّ يُغلق بالاعتماد فتخلو الشارة', async () => {
    await as(imam, 'completeService', { requestId, rating: 5, volunteerHours: 2 });
    assert.equal(await badge(), 0, 'اعتُمد العمل وبقي معدوداً مفتوحاً');
  });

  await t.test('والملغى لا يُعدّ كذلك', async () => {
    const second = (await as(imam, 'createServiceRequest', {
      mosqueId: mosque.id, title: 'دهان السور', category: 'paint',
      description: 'سور المسجد بحاجةٍ إلى دهانٍ بعد الشتاء، والطلاء متقشّر.',
    })).objectId;
    assert.equal(await badge(), 1, 'الطلب الثاني لم يُعدّ');

    await as(imam, 'cancelServiceRequest', { requestId: second });
    assert.equal(await badge(), 0, 'أُلغي الطلب وبقي معدوداً مفتوحاً');
  });

  /*
   * **ولا تُخترع فرصةٌ للمتطوّع** — العدّاد تصفيةٌ أوّلية في «الفرص»، ثم
   * تُستعلَم الطلبات بـ`open_for_volunteers` وحدها. فمسجدٌ كلُّ ما فيه طلبٌ
   * ينتظر الاعتماد يدخل المرشّحين ويخرج بلا فرصة — مرشَّحٌ زائد لا فرصةٌ كاذبة.
   */
  await t.test('ولا يرى المتطوّع فرصةً في عملٍ ينتظر الاعتماد', async () => {
    const third = (await as(imam, 'createServiceRequest', {
      mosqueId: mosque.id, title: 'تنظيف الخزّان', category: 'cleaning',
      description: 'خزّان المسجد بحاجةٍ إلى تنظيفٍ قبل الصيف، ولم يُنظَّف منذ سنة.',
    })).objectId;
    await as(salim, 'expressInterest', { requestId: third });
    await as(imam, 'assignWorker', { requestId: third, workerId: salim.id });
    await as(salim, 'startWork', { requestId: third });
    await as(salim, 'markWorkDone', { requestId: third, notes: 'تمّ' });

    assert.equal(await badge(), 1, 'المنتظِرُ للاعتماد غير معدود');

    const nearby = await as(salim, 'getNearbyOpportunities', {
      lat: 23.6, lng: 58.5, radiusKm: 5,
    });
    assert.deepEqual(nearby.map((row) => row.title), [],
      `عُرضت فرصةٌ على عملٍ لا يقبل متطوّعاً: ${JSON.stringify(nearby.map((r) => r.title))}`);
  });
  /*
   * وما ينتظر الاعتماد يتراكم بلا سقفٍ على المنفّذ — **قصداً**.
   *
   * حدُّ التكليفات ثلاثة، و`pending_imam_approval` خارجه: من أتمّ عمله لا
   * يُحبس على بطء غيره. وهذا صحيح، **ومنه يجيء العطب**: تتجاوز مهامُّه الحيّة
   * عشرين، فيردّ `getRequestContacts` النداءَ كلَّه — لا الزائدَ منه — فيرى
   * مهامَّه بلا اسمٍ ولا هاتفٍ لواحدةٍ منها. يحرس القسمةَ
   * `tests/contacts-batch.test.js`، وهذا يُثبت أنّ التراكم واقعٌ لا مفترض.
   */
  await t.test('والمنتظِرُ للاعتماد لا يُحبس المنفّذ عن عملٍ جديد', async () => {
    // **الحالةُ تصنع شرطَها بنفسها**: الاعتمادُ على ترتيب ما قبلها يجعل
    // الحمرةَ خبراً عن الترتيب لا عن الشيفرة — ووقع ذلك في أوّل صياغة.
    const waiting = (await as(imam, 'createServiceRequest', {
      mosqueId: mosque.id, title: 'صيانة الأبواب', category: 'other',
      description: 'أبوابُ المسجد بحاجةٍ إلى صيانةٍ ومفصّلاتُها مهترئة.',
    })).objectId;
    await as(salim, 'expressInterest', { requestId: waiting });
    await as(imam, 'assignWorker', { requestId: waiting, workerId: salim.id });
    await as(salim, 'startWork', { requestId: waiting });
    await as(salim, 'markWorkDone', { requestId: waiting, notes: 'تمّ' });

    const before = await new Parse.Query('ServiceRequests')
      .equalTo('assignedVolunteerId', salim)
      .equalTo('status', 'pending_imam_approval')
      .count({ useMasterKey: true });
    assert.ok(before >= 1, `لا عملَ ينتظر الاعتماد — القياس لم يقع (${before})`);

    // ثلاثةٌ جديدة تُسنَد إليه رغم ما ينتظر الاعتماد
    for (let at = 0; at < 3; at += 1) {
      const id = (await as(imam, 'createServiceRequest', {
        mosqueId: mosque.id, title: `عملٌ إضافيّ ${at + 1}`, category: 'other',
        description: 'وصفٌ كافٍ لهذا الاحتياج حتى يفهمه من يقرؤه في المسجد.',
      })).objectId;
      await as(salim, 'expressInterest', { requestId: id });
      await as(imam, 'assignWorker', { requestId: id, workerId: salim.id });
    }

    const live = await new Parse.Query('ServiceRequests')
      .equalTo('assignedVolunteerId', salim)
      .containedIn('status', ['assigned', 'in_progress', 'pending_imam_approval'])
      .count({ useMasterKey: true });
    assert.ok(live > 3,
      `المهامُّ الحيّة ${live} — والحدُّ ثلاثةٌ للمُسنَد وحده، فالتراكم غير واقع`);
  });
});
