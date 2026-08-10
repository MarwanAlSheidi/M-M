/**
 * اختبار تكامل: حسابٌ يزول وعليه عملٌ قائم.
 *
 * **العطب المقيس:** بحثٌ عن حسابٍ **بعد** أن ثبت أثرُ العملية، فيقلب نتيجةَ ما
 * تمّ. قِيس على خادمٍ حقيقي بحذف حساب المكلَّف وهو مكلَّف، ثم سحبُ الإمام
 * تكليفَه:
 *
 *     [قبل السحب]  الحالة=assigned            · متطوّع=5TT2jSXGRi · noShowBy=[]
 *     releaseAssignment: **سقط** (101) Object not found.
 *     [بعد السحب]  الحالة=open_for_volunteers · متطوّع=لا شيء · noShowBy=["5TT2jSXGRi"]
 *
 * **عمليةٌ تمّت وأُبلغ عنها بالسقوط.** والإمام يرى رسالةً إنجليزية، فيضغط
 * ثانيةً فيُقال له «لا يُسحب التكليف إلا قبل بدء التنفيذ» — لأن الحالة تغيّرت
 * فعلاً — فيظنّ طلبه عالقاً **فيُلغيه**. وهو ما وقع في القياس نفسه.
 *
 * والموضع الثاني من الصنف نفسه: `completeService` يحفظ الطلب منجَزاً ثم
 * `recordWorkerRating` تجلب المنفّذ لتكتب سمعته — فيُعتمد العمل ويُقال للإمام
 * إن اعتماده سقط.
 *
 * ولا يُقاس هذا على البديل في الذاكرة: المؤشّر المعلَّق سلوكُ خادمٍ لا سلوكُ
 * كائنٍ في الذاكرة، و`101` تأتي من المحوّل لا من منطقنا.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startStack, applySchema, seedMosques, unavailableReason } = require('./harness');

const skip = unavailableReason();
const options = skip ? { skip } : {};

test('حسابٌ يزول وعليه عمل', options, async (t) => {
  const stack = await startStack();
  const { Parse } = stack;
  t.after(() => stack.stop());

  await applySchema(Parse);
  await seedMosques(Parse, 40);
  const mosque = await new Parse.Query('Mosques')
    .equalTo('hasLocation', true).first({ useMasterKey: true });

  const stamp = Date.now();
  const signUp = async (name, role) => {
    const user = new Parse.User();
    user.set({ username: name, password: 'Integration12345!', role, fullName: name, phone: '99112233' });
    await user.signUp();
    return user;
  };

  const imam = await signUp(`da_imam_${stamp}`, 'imam');
  mosque.set({ imamId: imam, isClaimed: true });
  await mosque.save(null, { useMasterKey: true });
  const imamToken = imam.getSessionToken();

  /** طلبٌ جديد مُسنَدٌ إلى متطوّعٍ جديد — ويعيد الاثنين. */
  const assigned = async (tag) => {
    const worker = await signUp(`da_w_${tag}_${stamp}`, 'volunteer');
    const created = await Parse.Cloud.run('createServiceRequest', {
      mosqueId: mosque.id,
      title: `إصلاح مكيّف المسجد ${tag}`,
      description: 'المكيّف لا يعمل منذ أسبوع والحرّ شديد',
      type: 'volunteer',
      estimatedCost: 0,
    }, { sessionToken: imamToken });
    const requestId = created.id || created.objectId;

    await Parse.Cloud.run('expressInterest', { requestId, note: 'أستطيع القيام به' },
      { sessionToken: worker.getSessionToken() });
    await Parse.Cloud.run('assignWorker', { requestId, workerId: worker.id },
      { sessionToken: imamToken });
    return { requestId, worker };
  };

  const statusOf = async (requestId) => (await new Parse.Query('ServiceRequests')
    .get(requestId, { useMasterKey: true })).get('status');

  /*
   * **الحالة التي يجب أن تبقى خضراء.**
   *
   * المكلَّف قائمٌ، فالسحب يعمل كما كان: الطلب يعود مفتوحاً، والغياب يُقيَّد
   * على صاحبه. وحارسٌ يُنجّي المحذوف ويُسقط الحيّ لا ينفع.
   */
  await t.test('بمكلَّفٍ قائم: السحب يعمل ويُقيَّد الغياب', async () => {
    const { requestId, worker } = await assigned('live');

    const out = await Parse.Cloud.run('releaseAssignment', { requestId, reason: 'no_show' },
      { sessionToken: imamToken });

    assert.equal(out.status, 'open_for_volunteers');
    assert.equal(out.noShowRecorded, true, 'تغيّبٌ لم يُقيَّد على حسابٍ قائم');

    const stored = await new Parse.Query(Parse.User).get(worker.id, { useMasterKey: true });
    assert.equal(stored.get('abandonedJobs'), 1, 'العدّاد لم يبلغ صاحبه');
  });

  await t.test('وبمكلَّفٍ زال حسابه: السحب يتمّ ويُبلَّغ بأنه تمّ', async () => {
    const { requestId, worker } = await assigned('gone');
    await worker.destroy({ sessionToken: worker.getSessionToken() });

    // **الآلية لا الحال**: لا يكفي ألّا يرمي — يجب أن يقول ما صار إليه الطلب
    const out = await Parse.Cloud.run('releaseAssignment', { requestId, reason: 'no_show' },
      { sessionToken: imamToken });

    assert.equal(out.status, 'open_for_volunteers',
      `أُبلغ بغير ما وقع: ${JSON.stringify(out)}`);
    assert.equal(await statusOf(requestId), 'open_for_volunteers',
      'قيل إنه تحرّر ولم يتحرّر في القاعدة');
  });

  await t.test('ولا يُترك الإمام يُلغي طلبه ظنّاً أنه عالق', async () => {
    const { requestId, worker } = await assigned('stuck');
    await worker.destroy({ sessionToken: worker.getSessionToken() });

    await Parse.Cloud.run('releaseAssignment', { requestId, reason: 'no_show' },
      { sessionToken: imamToken });

    /*
     * وهذا هو الضرر الذي وقع فعلاً في القياس: النداء الأوّل يتمّ ويُبلَّغ
     * بالسقوط، فيضغط الإمام ثانيةً فيُقال له كلامٌ آخر، فيُلغي الطلب. فيُختبر
     * أن الطلب قابلٌ للتكليف من جديد — أي أن الرحلة لم تنقطع.
     */
    const other = await signUp(`da_new_${stamp}`, 'volunteer');
    await Parse.Cloud.run('expressInterest', { requestId, note: 'أستطيع القيام به' },
      { sessionToken: other.getSessionToken() });
    await Parse.Cloud.run('assignWorker', { requestId, workerId: other.id },
      { sessionToken: imamToken });

    assert.equal(await statusOf(requestId), 'assigned',
      'الطلب لم يقبل مكلَّفاً جديداً — فالإمام بين إلغائه وتركه');
  });

  await t.test('واعتمادُ عملٍ أنجزه من زال حسابه يتمّ ويُبلَّغ بأنه تمّ', async () => {
    const { requestId, worker } = await assigned('done');
    const workerToken = worker.getSessionToken();

    await Parse.Cloud.run('startWork', { requestId }, { sessionToken: workerToken });
    await Parse.Cloud.run('markWorkDone', { requestId, note: 'أُنجز العمل والحمد لله' },
      { sessionToken: workerToken });
    await worker.destroy({ sessionToken: workerToken });

    const out = await Parse.Cloud.run('completeService', { requestId, rating: 5 },
      { sessionToken: imamToken });

    assert.ok(out, 'لم يُبلَّغ الإمام بشيء');
    assert.equal(await statusOf(requestId), 'completed',
      'قيل إن العمل اعتُمد ولم يُعتمد — أو العكس');
  });

  await t.test('واعتمادُ عملِ مكلَّفٍ قائم يكتب سمعته كما كان', async () => {
    const { requestId, worker } = await assigned('rate');
    const workerToken = worker.getSessionToken();

    await Parse.Cloud.run('startWork', { requestId }, { sessionToken: workerToken });
    await Parse.Cloud.run('markWorkDone', { requestId, note: 'أُنجز العمل والحمد لله' },
      { sessionToken: workerToken });
    await Parse.Cloud.run('completeService', { requestId, rating: 4 },
      { sessionToken: imamToken });

    const stored = await new Parse.Query(Parse.User).get(worker.id, { useMasterKey: true });
    assert.equal(stored.get('completedJobs'), 1, 'السمعة لم تُكتب لمن يستحقّها');
    assert.equal(stored.get('avgRating'), 4);
  });
});
