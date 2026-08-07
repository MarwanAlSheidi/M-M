const E = require('../lib/errors');
const { requireUser, requireRole, fetchPointer } = require('../lib/auth');
const { pushToUsers } = require('../lib/push');
const payments = require('../lib/payments');
const { STATUS } = require('./requests');

/**
 * ⚠️ ثلاثة أخطاء جوهرية في النسخة الأصلية من fundRequest تم إصلاحها هنا:
 *
 * 1) كانت تُحدّث الرصيد فور استدعاء الدالة — أي أن أي مستخدم يستطيع
 *    "التبرع" بمليون ريال دون أن يدفع فلساً. الآن: المال يُقيَّد فقط بعد
 *    تأكيد البوابة عبر confirmDonation.
 * 2) كانت تعتبر الطلب مموّلاً بالكامل مهما كان المبلغ. الآن: تمويل جزئي
 *    تراكمي عبر fundedAmount، والحالة تتغيّر عند بلوغ التكلفة التقديرية.
 * 3) mosque كان Pointer غير مُحمّل، فـ get('walletBalance') يعيد undefined
 *    والنتيجة NaN في الرصيد. الآن نجلب الكائن قبل التعديل، ونستخدم
 *    increment() الذرّية بدل قراءة-ثم-كتابة (تفادي حالات التسابق).
 */

const MIN_DONATION_OMR = 1;
const MAX_DONATION_OMR = 1000;

// مهلة حجز نيّة التبرّع. بعدها تُعتبر الجلسة مهجورة ويُفرَج عن مبلغها
// ليتبرّع به غيره — وإلا عطّل متبرّعٌ لم يُكمل الدفع تمويلَ الطلب إلى الأبد.
const PENDING_TTL_MINUTES = 30;

/**
 * مجموع نيّات التبرّع المعلّقة الحيّة لهذا الطلب.
 *
 * `fundedAmount` لا يعدّ إلا المبالغ المُقيَّدة، فلو اعتمدنا عليه وحده لرأى كل
 * متبرّع المتبقي كاملاً متاحاً: خمسة متبرّعين يبدأون معاً بـ500 ريال لطلب
 * تكلفته 500، ويدفعون جميعاً، فتُقبض 2500 ريال بلا مسار استرداد.
 */
async function reservedAmount(serviceRequest) {
  const cutoff = new Date(Date.now() - PENDING_TTL_MINUTES * 60 * 1000);
  const pending = await new Parse.Query('Transactions')
    .equalTo('requestId', serviceRequest)
    .equalTo('type', 'donation')
    .equalTo('status', 'pending')
    .greaterThan('createdAt', cutoff)
    .limit(1000)
    .find({ useMasterKey: true });

  return pending.reduce((sum, t) => sum + (Number(t.get('amount')) || 0), 0);
}

/** الخطوة 1: إنشاء نيّة تبرّع + جلسة دفع. لا يتحرك أي رصيد هنا. */
Parse.Cloud.define('initiateDonation', async (request) => {
  const donor = requireRole(request, 'donor', 'imam', 'volunteer', 'contractor', 'admin');
  const { requestId, amount, successUrl, cancelUrl } = request.params;

  const value = Number(amount);
  if (!Number.isFinite(value) || value < MIN_DONATION_OMR || value > MAX_DONATION_OMR) {
    E.invalid(`المبلغ يجب أن يكون بين ${MIN_DONATION_OMR} و ${MAX_DONATION_OMR} ريال.`);
  }

  const serviceRequest = await new Parse.Query('ServiceRequests')
    .get(requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  if (serviceRequest.get('status') !== STATUS.PENDING_FUNDING) {
    E.invalid('هذا الطلب لا يقبل التمويل حالياً.');
  }

  const funded = serviceRequest.get('fundedAmount') || 0;
  const reserved = await reservedAmount(serviceRequest);
  const remaining = serviceRequest.get('estimatedCost') - funded - reserved;

  if (remaining <= 0) {
    E.invalid(`الطلب محجوز بالكامل حالياً — أعد المحاولة بعد ${PENDING_TTL_MINUTES} دقيقة.`);
  }
  if (value > remaining) E.invalid(`المتاح للتبرّع الآن ${remaining} ريال فقط.`);

  const mosque = await fetchPointer(serviceRequest.get('mosqueId'), 'Mosques');

  const Transaction = Parse.Object.extend('Transactions');
  const transaction = new Transaction();
  transaction.set('donorId', donor);
  transaction.set('mosqueId', mosque);
  transaction.set('requestId', serviceRequest);
  transaction.set('amount', value);
  transaction.set('type', 'donation');
  transaction.set('status', 'pending');
  await transaction.save(null, { useMasterKey: true });

  const session = await payments.createCheckoutSession({
    amountOmr: value,
    clientReferenceId: transaction.id, // مفتاح المطابقة والمنع المزدوج
    description: `تبرع: ${serviceRequest.get('title')} — ${mosque.get('name')}`,
    successUrl: successUrl || process.env.PAYMENT_SUCCESS_URL,
    cancelUrl: cancelUrl || process.env.PAYMENT_CANCEL_URL,
  });

  transaction.set('paymentSessionId', session.sessionId);
  await transaction.save(null, { useMasterKey: true });

  return { transactionId: transaction.id, redirectUrl: session.redirectUrl };
});

/**
 * الخطوة 2: التأكيد. تُستدعى من webhook البوابة أو عند عودة المستخدم.
 * تعتمد حصراً على استعلام البوابة، لا على ما يرسله العميل.
 * idempotent: استدعاؤها مرتين لا يضاعف الرصيد.
 */
Parse.Cloud.define('confirmDonation', async (request) => {
  const caller = request.master ? null : requireUser(request);
  const { transactionId } = request.params;

  const transaction = await new Parse.Query('Transactions')
    .get(transactionId, { useMasterKey: true })
    .catch(() => E.notFound('المعاملة غير موجودة.'));

  // صاحب المعاملة وحده — أو استدعاء بـ Master Key من webhook البوابة.
  // بدون هذا الشرط يستطيع أي مستخدم مصادَق أن يستدعيها على معاملة غيره.
  if (caller) {
    const owner = transaction.get('donorId');
    if (!owner || owner.id !== caller.id) E.forbidden('هذه المعاملة ليست لك.');
  }

  if (transaction.get('status') === 'captured') {
    return { status: 'captured', message: 'سبق تأكيد هذه المعاملة.' };
  }
  if (transaction.get('status') !== 'pending') E.invalid('حالة المعاملة لا تسمح بالتأكيد.');

  const verification = await payments.verifySession(transaction.get('paymentSessionId'));
  if (!verification.paid) {
    // الجلسة ما تزال مفتوحة: تبقى المعاملة `pending` ليصحّ التأكيد بعد الدفع.
    // تعليمها `failed` هنا يُسقطها نهائياً من مسار التأكيد ويضيّع مبلغ المتبرع.
    if (!verification.terminal) {
      return { status: 'pending', message: 'لم يكتمل الدفع بعد — أعد المحاولة بعد إتمامه.' };
    }
    transaction.set('status', 'failed');
    await transaction.save(null, { useMasterKey: true });
    return { status: 'failed', message: 'أُلغيت عملية الدفع أو انتهت صلاحية الجلسة.' };
  }

  // تطابق المبلغ — حماية من التلاعب في صفحة الدفع
  if (Math.abs(verification.amountOmr - transaction.get('amount')) > 0.001) {
    transaction.set('status', 'mismatch');
    await transaction.save(null, { useMasterKey: true });
    E.invalid('المبلغ المدفوع لا يطابق المبلغ المسجّل — راجع الإدارة.');
  }

  transaction.set('status', 'captured');
  transaction.set('paymentGatewayRef', verification.reference);
  transaction.set('capturedAt', new Date());
  await transaction.save(null, { useMasterKey: true });

  const amount = transaction.get('amount');
  const mosque = await fetchPointer(transaction.get('mosqueId'), 'Mosques');
  const serviceRequest = await fetchPointer(transaction.get('requestId'), 'ServiceRequests');

  // increment ذرّي على مستوى قاعدة البيانات — آمن مع التبرعات المتزامنة
  mosque.increment('walletBalance', amount);
  await mosque.save(null, { useMasterKey: true });

  serviceRequest.increment('fundedAmount', amount);
  await serviceRequest.save(null, { useMasterKey: true });
  await serviceRequest.fetch({ useMasterKey: true });

  if (serviceRequest.get('fundedAmount') >= serviceRequest.get('estimatedCost')) {
    serviceRequest.set('status', STATUS.FUNDED);
    serviceRequest.set('isFundedByDonors', true);
    serviceRequest.set('fundedAt', new Date());
    await serviceRequest.save(null, { useMasterKey: true });

    const imam = mosque.get('imamId');
    if (imam) {
      await pushToUsers(imam, {
        alert: `اكتمل تمويل "${serviceRequest.get('title')}" — يمكنك تعيين المنفّذ الآن.`,
        requestId: serviceRequest.id,
      });
    }
  }

  return { status: 'captured', fundedAmount: serviceRequest.get('fundedAmount') };
});

/**
 * صرف المستحقات للشركة بعد اعتماد الإمام. مشرف فقط.
 * التحويل الفعلي يتم خارج النظام (حوالة بنكية) — هنا نسجّل القيد فقط.
 */
Parse.Cloud.define('payoutContractor', async (request) => {
  const admin = requireRole(request, 'admin');
  const { requestId, amount, bankRef } = request.params;

  const serviceRequest = await new Parse.Query('ServiceRequests')
    .include('mosqueId').include('assignedContractorId')
    .get(requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  if (serviceRequest.get('status') !== STATUS.COMPLETED) E.invalid('لم يُعتمد العمل بعد.');
  if (serviceRequest.get('isPaidOut')) E.duplicate('تم الصرف لهذا الطلب مسبقاً.');

  const mosque = serviceRequest.get('mosqueId');
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) E.invalid('المبلغ غير صحيح.');

  // الخصم أولاً بعملية ذرّية ثم التحقق. فحصُ الرصيد قبل الخصم لا يمنع صرفين
  // متزامنين من اجتيازه معاً، و`increment` ذرّي لكن القراءة التي تسبقه ليست كذلك.
  mosque.increment('walletBalance', -value);
  await mosque.save(null, { useMasterKey: true });
  await mosque.fetch({ useMasterKey: true });

  if ((mosque.get('walletBalance') || 0) < 0) {
    mosque.increment('walletBalance', value); // تعويض: إعادة ما خُصم
    await mosque.save(null, { useMasterKey: true });
    E.invalid('رصيد المسجد لا يكفي.');
  }

  // يُعلَّم الطلب مصروفاً فور تأمين المبلغ، قبل قيد المعاملة، تضييقاً لنافذة
  // الصرف المزدوج. الإغلاق التام يحتاج قيداً على مستوى قاعدة البيانات.
  serviceRequest.set('isPaidOut', true);
  await serviceRequest.save(null, { useMasterKey: true });

  const Transaction = Parse.Object.extend('Transactions');
  const payout = new Transaction();
  payout.set('mosqueId', mosque);
  payout.set('requestId', serviceRequest);
  payout.set('payeeId', serviceRequest.get('assignedContractorId'));
  payout.set('amount', value);
  payout.set('type', 'payout');
  payout.set('status', 'captured');
  payout.set('paymentGatewayRef', String(bankRef || ''));
  payout.set('approvedBy', admin);
  await payout.save(null, { useMasterKey: true });

  return { message: 'تم تسجيل الصرف.', transactionId: payout.id };
});

/** سجل شفاف لكل مسجد — متاح للجميع، بلا بيانات شخصية للمتبرعين. */
Parse.Cloud.define('getMosqueLedger', async (request) => {
  requireUser(request);
  const { mosqueId, limit = 50 } = request.params;
  if (!mosqueId) E.invalid('معرّف المسجد مطلوب.');

  const mosque = new Parse.Object('Mosques');
  mosque.id = mosqueId;

  const transactions = await new Parse.Query('Transactions')
    .equalTo('mosqueId', mosque)
    .equalTo('status', 'captured')
    .descending('createdAt')
    .limit(Math.min(Number(limit) || 50, 100))
    .find({ useMasterKey: true });

  return transactions.map((t) => ({
    id: t.id,
    amount: t.get('amount'),
    type: t.get('type'),
    createdAt: t.get('createdAt'),
    requestId: t.get('requestId') ? t.get('requestId').id : null,
  }));
});
