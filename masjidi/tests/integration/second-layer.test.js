/**
 * اختبار تكامل: الطبقة الثانية خلف الصلاحيات.
 *
 * **العطب المقيس:** كلُّ ما يمنع الكتابة من متصفّح في هذه المنصّة كان
 * `classLevelPermissions` — سطرٌ يُقلب من لوحة Back4app بضغطة، أو لا يصل
 * القاعدة أصلاً إن تعثّر `npm run schema` (وهو عطبُ دورةٍ سابقة). وفوقه
 * `beforeSave` لثلاثة أصنافٍ من سبعة، **ولا `beforeDelete` لواحد**.
 *
 * وقِيس على خادمٍ حقيقي بفتح الأقفال، بحساب متطوّعٍ لا صلة له بشيء:
 *
 *     AuditLog        إنشاء: نجح · تعديل: نجح · حذف: نجح
 *     ServiceRequests إنشاء: رُدّ (119) · تعديل: رُدّ (119) · حذف: **نجح**
 *     MosqueClaims · Notifications · TaskInterests        حذف: **نجح**
 *
 * فكُتب من متصفّحه قيدُ تدقيقٍ يقول `payout_released` بصفة `admin`.
 *
 * **ولا يُختبر هذا على البديل في الذاكرة:** الصلاحيات هناك ليست قائمة أصلاً،
 * فلا يوجد ما يُفتح ولا ما يقف خلفه. القياس يلزمه خادمٌ يُطبَّق عليه مخطط.
 *
 * وفيه حالةٌ يجب أن تبقى خضراء: **المسارات السليمة تعمل**. حارسٌ يمنع العميل
 * ويمنع معه المهام الدورية يكسر المنصّة بدل أن يحميها — والتقليم يحذف
 * `AuditLog` و`Notifications` بالمفتاح الرئيس في كل أسبوع.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startStack, applySchema, seedMosques, unavailableReason } = require('./harness');

const skip = unavailableReason();
const options = skip ? { skip } : {};

/** قفلٌ مفتوح على مصراعيه — كما يقع من اللوحة أو من مخططٍ لم يُطبَّق. */
const OPEN = {
  find: { '*': true }, get: { '*': true }, count: { '*': true },
  create: { '*': true }, update: { '*': true }, delete: { '*': true }, addField: { '*': true },
};

test('الطبقة الثانية', options, async (t) => {
  const stack = await startStack();
  const { Parse } = stack;
  t.after(() => stack.stop());

  await applySchema(Parse);
  await seedMosques(Parse, 5);
  const mosque = await new Parse.Query('Mosques').first({ useMasterKey: true });

  const imam = new Parse.User();
  imam.set({ username: `sl_imam_${Date.now()}`, password: 'Integration12345!', role: 'imam' });
  await imam.signUp();

  const stranger = new Parse.User();
  stranger.set({ username: `sl_out_${Date.now()}`, password: 'Integration12345!', role: 'volunteer' });
  await stranger.signUp();
  const token = stranger.getSessionToken();

  const seedRow = async (className, fields) => {
    const Row = Parse.Object.extend(className);
    const row = new Row();
    row.set(fields);
    await row.save(null, { useMasterKey: true });
    return row;
  };

  const written = {};
  for (const className of ['MosqueClaims', 'ServiceRequests', 'TaskInterests',
    'AuditLog', 'Notifications']) {
    written[className] = (await new Parse.Schema(className).get({ useMasterKey: true }))
      .classLevelPermissions;
  }

  await t.test('بالأقفال المكتوبة: العميل مردودٌ عند الصلاحيات', async () => {
    const row = await seedRow('AuditLog',
      { mosqueId: mosque, action: 'request_created', actorRole: 'imam' });

    // هنا الردّ من CLP لا من المُشغّل — والمُشغّل لا يُنادى أصلاً. وذكرُ ذلك
    // مقصود: الطبقة الثانية **لا تُختبر** في الحالة السليمة، فلا تُقرأ منها
    await assert.rejects(() => row.destroy({ sessionToken: token }),
      (error) => error.code === Parse.Error.OPERATION_FORBIDDEN,
      'قفلٌ مكتوبٌ ولم يردّ العميل');
  });

  await t.test('وبأقفالٍ مفتوحة: سجلّ التدقيق لا يُزوَّر ولا يُمحى', async () => {
    const open = new Parse.Schema('AuditLog');
    open.setCLP(OPEN);
    await open.update();

    try {
      const Row = Parse.Object.extend('AuditLog');
      const forged = new Row();
      forged.set({ mosqueId: mosque, action: 'payout_released', actorRole: 'admin' });

      await assert.rejects(() => forged.save(null, { sessionToken: token }),
        (error) => {
          // **الرسالة لا الحال**: ردٌّ بـ«حقلٌ مطلوب» ليس حمايةً — من يملأ
          // الحقول يمرّ. والحارس يُعرف بأنه سمّى الصنف وقال من يكتب فيه
          assert.match(error.message, /AuditLog/, `رُدّ بغير رسالة الحارس: ${error.message}`);
          assert.match(error.message, /دوال السحابة/, `رُدّ لسببٍ عارض: ${error.message}`);
          return true;
        },
        'كُتب قيدُ تدقيقٍ مزوَّرٌ من متصفّح — والسجلّ هو وعد المنصّة');

      const real = await seedRow('AuditLog',
        { mosqueId: mosque, action: 'request_created', actorRole: 'imam' });
      await assert.rejects(() => real.destroy({ sessionToken: token }),
        (error) => {
          assert.match(error.message, /لا تُحذف من التطبيق/, `رُدّ لسببٍ آخر: ${error.message}`);
          return true;
        },
        'مُحي قيدُ تدقيقٍ من متصفّح');

      // ولم يذهب فعلاً — الردّ قولٌ والقاعدة هي الشاهد
      const still = await new Parse.Query('AuditLog').get(real.id, { useMasterKey: true })
        .then(() => true, () => false);
      assert.equal(still, true, 'رُدّ الحذف في الردّ ووقع في القاعدة');
    } finally {
      const restore = new Parse.Schema('AuditLog');
      restore.setCLP(written.AuditLog);
      await restore.update();
    }
  });

  await t.test('وطلبُ خدمةٍ لا يُمحى ولو فُتح قفلُه — وbeforeSave لا يُغني', async () => {
    const request = await seedRow('ServiceRequests', {
      mosqueId: mosque, createdBy: imam, title: 'إصلاح مكيّف', description: 'قياس',
      status: 'open_for_volunteers', type: 'volunteer', estimatedCost: 0,
    });

    const open = new Parse.Schema('ServiceRequests');
    open.setCLP(OPEN);
    await open.update();

    try {
      /*
       * `ServiceRequests` له `beforeSave` منذ البداية — وقِيس أنه ردّ الإنشاء
       * والتعديل **ومرّ الحذف**: `beforeSave` لا يُنادى عند الحذف أصلاً.
       * فوجودُ حارسٍ على الكتابة لا يُقرأ حارساً على المحو.
       */
      await assert.rejects(() => request.destroy({ sessionToken: token }),
        (error) => {
          assert.match(error.message, /ServiceRequests لا تُحذف/, `رُدّ لسببٍ آخر: ${error.message}`);
          return true;
        },
        'محا غريبٌ طلبَ خدمةٍ ليس له');
    } finally {
      const restore = new Parse.Schema('ServiceRequests');
      restore.setCLP(written.ServiceRequests);
      await restore.update();
    }
  });

  await t.test('وطلبُ الملكية لا يُبدَّل حالُه من متصفّح', async () => {
    const claim = await seedRow('MosqueClaims',
      { mosqueId: mosque, imamId: imam, status: 'pending' });

    const open = new Parse.Schema('MosqueClaims');
    open.setCLP(OPEN);
    await open.update();

    try {
      claim.set('status', 'approved');
      await assert.rejects(() => claim.save(null, { sessionToken: token }),
        (error) => {
          assert.match(error.message, /MosqueClaims تُكتب عبر دوال السحابة/,
            `رُدّ لسببٍ آخر: ${error.message}`);
          return true;
        },
        'اعتمد غريبٌ طلبَ ملكيةٍ لنفسه بلا مشرف');

      const stored = await new Parse.Query('MosqueClaims').get(claim.id, { useMasterKey: true });
      assert.equal(stored.get('status'), 'pending', 'رُدّ الحفظ في الردّ ووقع في القاعدة');
    } finally {
      const restore = new Parse.Schema('MosqueClaims');
      restore.setCLP(written.MosqueClaims);
      await restore.update();
    }
  });

  /*
   * **والحالة التي يجب أن تبقى خضراء.**
   *
   * حارسٌ يمنع العميل ويمنع معه المهام الدورية يكسر المنصّة بدل أن يحميها:
   * `pruneAuditLog` و`pruneNotifications` يحذفان أسبوعياً بالمفتاح الرئيس،
   * وتوقّفُهما يملأ الباقة بعد أشهر بلا سببٍ ظاهر. فيُقاس مرورُهما فعلاً.
   */
  await t.test('والمفتاح الرئيس يحذف كما كان — الحارس على الجلسة لا على الحذف', async () => {
    /*
     * **وما لا يُقاس هنا يُقال:** حدُّ التقليم أدناه ثلاثون يوماً، والطابع
     * `createdAt` **لا يُؤرَّخ رجعياً** — قِيس: طُلب 2025-07-06 فكُتب اليوم.
     * فلا سبيل إلى تشغيل `pruneAuditLog` على صفوفٍ يبلغها حدُّه في اختبار.
     *
     * فيُقاس **نداءُ الحذف الذي تصدره المهمّة حرفاً بحرف** — `destroyAll`
     * بالمفتاح الرئيس — لا المهمّة كلَّها. وهو موضع الخطر بعينه: حارسٌ يمنع
     * الجلسة وحدها يمرّ، وحارسٌ يمنع الحذف مطلقاً يوقف التقليم فتمتلئ الباقة
     * بعد أشهرٍ بلا سببٍ ظاهر.
     */
    const rows = [];
    for (let i = 0; i < 3; i += 1) {
      rows.push(await seedRow('AuditLog',
        { mosqueId: mosque, action: 'request_created', actorRole: 'imam' }));
    }
    const notice = await seedRow('Notifications',
      { userId: imam, title: 'قياس', body: 'قياس' });

    await Parse.Object.destroyAll([...rows, notice], { useMasterKey: true });

    for (const row of rows) {
      const gone = await new Parse.Query('AuditLog').get(row.id, { useMasterKey: true })
        .then(() => false, () => true);
      assert.equal(gone, true, 'الحارس منع الحذف بالمفتاح الرئيس — فيتوقّف التقليم');
    }
  });

  await t.test('وحسابُ الحذف مذكورٌ في preflight كذلك', async () => {
    const report = await Parse.Cloud.run('preflight', {}, { useMasterKey: true });
    const locks = report.checks.find((row) => row.name.includes('الكتابة من العميل'));
    assert.equal(locks.ok, true, `أُعيدت الأقفال ولم تُقرأ سليمة: ${locks.detail}`);
  });
});
