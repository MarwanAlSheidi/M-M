/**
 * حين يخرج المنفّذ من الميدان وله عملٌ قائم — من يُخبَر؟
 *
 * المنصّة تُخرج المنفّذ بطريقين: **سحبُ اعتماد الشركة** (`reviewContractor`)،
 * و**إيقافُ الحساب** (`isActive = false` بيد الإدارة). والأوّل كان يُبلَّغ به
 * أئمّةُ المساجد التي عنده فيها عمل، والثاني كان يقع في صمتٍ تامّ.
 *
 * وقِيس على خادمٍ حقيقي: أُوقف متطوّعٌ مكلَّفٌ بعملٍ في مسجد، فكانت النتيجة:
 *
 *     وارد الإمام:  1 ← 1        (لا خبر)
 *     سجلّ المسجد:  3 ← 3        (لا قيد)
 *     الموقوف مردود: «حسابك موقوف حالياً»
 *     وُسم بالغياب:  abandonedJobs = 1
 *
 * **فالمنصّة تمنعه من الحضور، ولا تُخبر الإمام، ثم تُقيّد عليه غيابه.** والوسم
 * يبقى بعد إعادة إتاحته، يقرؤه كل إمامٍ بعدها.
 *
 * فالحارس هنا لا عند المستدعي: الإيقاف يقع من `scripts/promote_admin.js`
 * بالمفتاح الرئيس، وقد يقع غداً من دالّةٍ أخرى. ومن ربط البلاغ بالمستدعي ربطه
 * بواحدٍ من أبوابٍ عدّة.
 *
 * **ولا يُسحب التكليف تلقائياً** — كما في سحب الاعتماد سواءً: عملٌ قد يكون
 * نصفَ منجَز، وإسقاطه بلا معاينة يُضيّع جهداً بُذل في المسجد. تُعطى البيّنة
 * ويبقى القرار للإمام.
 */

const audit = require('./audit');
const { pushToUsers } = require('./push');

/** أعمالٌ قائمة: ما لم يُعتمد بعد. خروجُ المنفّذ يمسّ أصحابها لا المنفّذَ وحده. */
const LIVE_STATUSES = ['assigned', 'in_progress', 'pending_imam_approval'];

/** الاسم كما يعرفه الإمام: الشركة بسجلّها التجاري، والمتطوّع باسمه. */
const describeWorker = (worker) => worker.get('companyName')
  || worker.get('fullName') || 'المنفّذ المكلَّف';

/**
 * الأعمال القائمة المسنَدة إلى منفّذٍ — متطوّعاً كان أو شركة.
 *
 * استعلامان لا `Parse.Query.or`: الحقلان منفصلان على الخادم، والـ`or` صيغةٌ
 * تختلف بين المحوّلين ويردّها `tests/portability.test.js`.
 */
async function liveAssignmentsOf(worker) {
  const find = (field) => new Parse.Query('ServiceRequests')
    .equalTo(field, worker)
    .containedIn('status', LIVE_STATUSES)
    .include('mosqueId')
    .limit(100)
    .find({ useMasterKey: true });

  const [asVolunteer, asContractor] = await Promise.all([
    find('assignedVolunteerId'), find('assignedContractorId'),
  ]);
  return [...asVolunteer, ...asContractor];
}

/**
 * إبلاغ أئمّة المساجد التي عند المنفّذ فيها عملٌ قائم.
 *
 * @param {object} options.action فعلُ السجلّ (`audit.ACTIONS`)
 * @param {function} options.alert يبني نصّ البلاغ من (الاسم، الطلب، المسجد)
 * @returns {number} كم عملاً قائماً تأثّر
 */
async function warnImamsOfWorkerLoss(worker, { action, actor, alert }) {
  const live = await liveAssignmentsOf(worker);
  const name = describeWorker(worker);

  for (const serviceRequest of live) {
    const mosque = serviceRequest.get('mosqueId');
    if (!mosque) continue;

    // القيد على المسجد ليُقرأ في سجلّه — لا على المنفّذ حيث لا قارئ له
    await audit.record({
      action,
      target: serviceRequest,
      mosque,
      actor,
      note: `${name} — "${serviceRequest.get('title')}"`,
    });

    const imam = mosque.get('imamId');
    if (imam) {
      await pushToUsers(imam, {
        alert: alert(name, serviceRequest, mosque),
        requestId: serviceRequest.id,
      });
    }
  }

  return live.length;
}

module.exports = { LIVE_STATUSES, liveAssignmentsOf, warnImamsOfWorkerLoss, describeWorker };
