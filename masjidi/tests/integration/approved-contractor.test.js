/**
 * الشركة المعتمدة تبلغ عينَ الإمام — ولا يبلغها ما ليس له.
 *
 * كان مسارُ الشركات مبنيّاً من طرفيه ومقطوعاً في وسطه: تسجيلٌ بسجلٍّ تجاري،
 * وطابورُ اعتمادٍ عند المشرف، و`assignWorker` يقبل الشركة على طلبٍ تطوّعيّ —
 * **ولا دالّة في المستودع كلِّه تُعطي الإمامَ معرّفَ شركة.** والشركة لا تُبدي
 * اهتماماً قصداً، فقائمةُ المهتمّين لا تحمله، وهي مصدرُ زرّ التكليف الوحيد.
 *
 * وهذا يقيس البابَ الجديد من جهتيه: أنه يفتح لمن له، وأنه **لا يُفشي**.
 * الهاتف يصل بعد التكليف وحده (`getRequestContacts`)، والسجلّ التجاري محجوبٌ
 * في `protectedFields` وأساسُ الاعتماد عند المشرف لا عند الإمام.
 *
 * في ملفٍّ مستقلّ — خادمٌ واحد لكل عملية، ويحرس ذلك `harness.startStack`.
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:integration`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startStack, applySchema, unavailableReason } = require('./harness');

const skip = unavailableReason();
const options = skip ? { skip } : {};

test('الشركات المعتمدة تبلغ الإمام', options, async (t) => {
  const stack = await startStack();
  const { Parse } = stack;
  t.after(() => stack.stop());

  await applySchema(Parse);

  const stamp = Date.now();
  const PASSWORD = 'Integration12345!';

  const make = async (role, extra) => {
    const user = new Parse.User();
    user.set({ username: `${role}_${stamp}_${Math.random().toString(36).slice(2, 7)}`,
      password: PASSWORD, role, ...extra });
    await user.signUp();
    return user;
  };

  const imam = await make('imam', { fullName: 'الشيخ سعيد' });

  const approved = await make('contractor', {
    fullName: 'مالك الشركة', companyName: 'شركة البناء الحديث',
    crNumber: '1234567', phone: '99887766', governorate: 'مسقط',
  });
  approved.set({ isVerifiedContractor: true, completedJobs: 4, avgRating: 4.5 });
  await approved.save(null, { useMasterKey: true });

  // لم تُراجَع بعد — تُقرأ في الطابور عند المشرف، ولا تُعرض للإمام
  await make('contractor', {
    fullName: 'شركة لم تُراجع', companyName: 'شركة الانتظار', crNumber: '7654321',
  });

  const suspended = await make('contractor', {
    fullName: 'شركة موقوفة', companyName: 'شركة الإيقاف', crNumber: '1112223',
  });
  suspended.set({ isVerifiedContractor: true, isActive: false });
  await suspended.save(null, { useMasterKey: true });

  const list = () => Parse.Cloud.run('listApprovedContractors', {},
    { sessionToken: imam.getSessionToken() });

  /*
   * **حالةٌ تبقى خضراء على `HEAD`** (القاعدة ٤٦): بقيّةُ الحالات تسقط جميعاً
   * قبل الإصلاح — والسقوطُ الشامل لا يُميَّز عن عطبٍ في المِرقاة. وهذه تمرّ
   * بطريقٍ قائمٍ من قبل، فخضرتُها تقول إنّ المستخدمين والأدوار والاعتماد
   * كلَّها سليمة، وإنّ الحمرة بعدها خبرٌ عن الشيفرة.
   */
  await t.test('والطابور القائم يعمل — فالمِرقاة سليمة', async () => {
    const admin = await make('donor', {});
    admin.set('role', 'admin');
    await admin.save(null, { useMasterKey: true });

    const queue = await Parse.Cloud.run('listPendingContractors', {},
      { sessionToken: admin.getSessionToken() });
    const names = queue.map((row) => row.companyName);
    assert.ok(names.includes('شركة الانتظار'),
      `طابورُ الاعتماد نفسه لا يعمل: ${names.join('، ')}`);
  });

  await t.test('الإمام يرى المعتمدة وحدها', async () => {
    const rows = await list();
    const names = rows.map((row) => row.companyName);

    assert.ok(names.includes('شركة البناء الحديث'),
      `المعتمدة لا تبلغ الإمام — وبلا معرّفها لا تُكلَّف بحال: ${names.join('، ')}`);
    assert.equal(names.includes('شركة الانتظار'), false,
      'شركةٌ لم يعتمدها المشرف تُعرض للاختيار — والاعتماد هو كلُّ ما يميّزها');
    assert.equal(names.includes('شركة الإيقاف'), false,
      'موقوفةٌ تُعرض — والخادم يردّها عند أوّل فعل، فالإمام يختار من لا يعمل');
  });

  await t.test('وما يقوم عليه اختيارُه معه', async () => {
    const [row] = await list();
    assert.equal(row.completedJobs, 4, 'يُختار المنفّذ بلا بيّنةِ ما أنجز');
    assert.equal(row.avgRating, 4.5);
    assert.equal(row.abandonedJobs, 0);
    assert.equal(row.governorate, 'مسقط', 'شركةٌ بلا موضعٍ يُقاس عليه البُعد');
  });

  /*
   * **ولا يُفشى ما ليس لهذه الشاشة.** القاعدة ٣٠: ما يُقرأ عن إنسانٍ يمرّ
   * بدالّةٍ تعرف من يسأل ولماذا. والهاتف طريقُه `getRequestContacts` بعد
   * التكليف وفي مدّته وحدها؛ والسجلّ التجاري محجوبٌ في `protectedFields`
   * ويُقرأ في طابور الاعتماد عند المشرف — وقد يُقرأ هنا سهواً لأن الدالّة
   * تعمل بالمفتاح الرئيس، فتمرّ الحقول كلُّها ما لم تُنتقَ.
   */
  await t.test('ولا هاتفَ ولا سجلٌّ تجاريّ يعبر إلى هنا', async () => {
    const [row] = await list();
    const keys = Object.keys(row);
    assert.equal(keys.includes('phone'), false, `الهاتف يُفشى قبل التكليف: ${keys}`);
    assert.equal(keys.includes('crNumber'), false, `السجل التجاري يُفشى: ${keys}`);
    assert.equal(JSON.stringify(row).includes('99887766'), false,
      'الهاتف يعبر تحت اسمٍ آخر');
  });

  await t.test('ولا يفتحه غيرُ الإمام', async () => {
    for (const role of ['volunteer', 'donor', 'contractor']) {
      const other = await make(role, {});
      await assert.rejects(
        () => Parse.Cloud.run('listApprovedContractors', {},
          { sessionToken: other.getSessionToken() }),
        (error) => /صلاحي|مصرّح|مسموح|فقط/.test(error.message),
        `${role} يقرأ قائمة الشركات — وفيها أسماءٌ وسمعةُ ناسٍ لا شأن له بها`,
      );
    }
  });

  /*
   * **والقائمة تُقاس بأثرها لا بوجودها.** معرّفٌ يصل الشاشةَ ولا يقبله
   * `assignWorker` بابٌ يُفتح على جدار — والطريق سالكٌ على الخادم قبل هذه
   * الدورة وبعدها، فهذه الحالة **خضراء على `HEAD`** لو بلغها.
   */
  await t.test('والمعرّف الذي يصل يُكلَّف به فعلاً', async () => {
    const mosque = new (Parse.Object.extend('Mosques'))();
    mosque.set({
      externalId: `ac_${stamp}`, name: 'جامع البلاغ', governorate: 'مسقط',
      wilayat: 'بوشر', isClaimed: true, imamId: imam, lat: 23.6, lng: 58.5,
    });
    await mosque.save(null, { useMasterKey: true });

    const made = await Parse.Cloud.run('createServiceRequest', {
      mosqueId: mosque.id,
      title: 'صيانة مكيّفات المصلّى',
      description: 'ثلاثة مكيّفات لا تعمل، والعمل يحتاج فنّيّ تبريد بمعدّاته.',
      category: 'hvac',
    }, { sessionToken: imam.getSessionToken() });
    assert.equal(made.estimatedCost, 0, 'المرحلة الأولى تطوّعيّة — والتكلفة صفر');

    const [row] = await list();
    await Parse.Cloud.run('assignWorker', { requestId: made.objectId, workerId: row.id },
      { sessionToken: imam.getSessionToken() });

    const after = await new Parse.Query('ServiceRequests')
      .get(made.objectId, { useMasterKey: true });
    assert.equal(after.get('status'), 'assigned');
    assert.equal(after.get('assignedContractorId').id, approved.id,
      'كُلِّفت غيرُ من اختير');
  });
});
