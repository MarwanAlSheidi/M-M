/**
 * سجل التدقيق.
 *
 * وعد المنصّة للمتبرّع هو الشفافية، و`getMosqueLedger` يُظهر المال وحده: من
 * تبرّع بكم ومتى صُرف. لا يُظهر من غيّر حالة الطلب ولا متى، فلا سبيل للإجابة
 * عن "من ألغى هذا الطلب؟" أو "متى اعتُمد العمل ومن اعتمده؟".
 *
 * قيدان في التصميم:
 *
 * 1) **القيد لا يُسقط العملية أبداً.** فشل الكتابة هنا يُسجَّل في السجلّ ويُبتلع
 *    — لا يجوز أن يفشل اعتماد عملٍ منجَز لأن سطر تدقيق لم يُكتب.
 * 2) **يُستدعى صراحةً من الدوال لا من `afterSave`.** المُشغّل يرى تغيّر الحالة
 *    لكنه لا يرى الفاعل: الحفظ يجري بـ Master Key فيصل `request.user` فارغاً.
 *
 * تنبيه على التكلفة: كل قيد كتابةٌ إضافية. باقة Back4app المجانية 25 ألف طلب
 * شهرياً، فالقيد مقصور على تحوّلات الحالة وحركات المال لا على كل حفظ.
 */

const ACTIONS = {
  REQUEST_CREATED: 'request_created',
  INTEREST_EXPRESSED: 'interest_expressed',
  INTEREST_WITHDRAWN: 'interest_withdrawn',
  WORKER_ASSIGNED: 'worker_assigned',
  WORK_STARTED: 'work_started',
  WORK_DONE: 'work_done',
  REQUEST_COMPLETED: 'request_completed',
  REQUEST_CANCELLED: 'request_cancelled',
  DONATION_CAPTURED: 'donation_captured',
  DONATION_EXPIRED: 'donation_expired',
  PAYOUT_RECORDED: 'payout_recorded',
  CLAIM_REVIEWED: 'claim_reviewed',
  CONTRACTOR_REVIEWED: 'contractor_reviewed',
  DONATION_REFUNDED: 'donation_refunded',
};

/**
 * قيد سطر تدقيق واحد.
 *
 * @param {object}  entry
 * @param {string}  entry.action      من `ACTIONS`
 * @param {object=} entry.target      الكائن المتأثّر (طلب، معاملة، …)
 * @param {object=} entry.mosque      المسجد — مفتاح عرض السجل
 * @param {object=} entry.actor       المستخدم الفاعل، أو لا شيء للنظام
 * @param {string=} entry.fromStatus
 * @param {string=} entry.toStatus
 * @param {number=} entry.amount
 */
async function record({ action, target, mosque, actor, fromStatus, toStatus, amount }) {
  try {
    const Entry = Parse.Object.extend('AuditLog');
    const entry = new Entry();

    entry.set('action', action);
    if (target) {
      entry.set('targetClass', target.className);
      entry.set('targetId', target.id);
    }
    if (mosque) entry.set('mosqueId', mosque);
    if (actor) {
      entry.set('actorId', actor);
      entry.set('actorRole', actor.get('role') || null);
    }
    if (fromStatus) entry.set('fromStatus', fromStatus);
    if (toStatus) entry.set('toStatus', toStatus);
    if (typeof amount === 'number') entry.set('amount', amount);

    await entry.save(null, { useMasterKey: true });
  } catch (error) {
    // مقصود: التدقيق لا يُسقط العملية التي يوثّقها
    console.error('[audit] تعذّر قيد السطر:', action, error && error.message);
  }
}

module.exports = { record, ACTIONS };
