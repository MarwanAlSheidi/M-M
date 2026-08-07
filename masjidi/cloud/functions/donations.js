const E = require('../lib/errors');
const { requireUser, requireRole, fetchPointer } = require('../lib/auth');
const { pushToUsers } = require('../lib/push');
const payments = require('../lib/payments');
const { STATUS } = require('./requests');
const audit = require('../lib/audit');
const crypto = require('crypto');

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

  return captureDonation(transaction, verification);
});

/**
 * قيد تبرّع مؤكَّد الدفع. مشتركة بين `confirmDonation` والمهمة الدورية، فلا
 * يوجد مساران يُقيّدان المال بمنطقين مختلفين.
 */
async function captureDonation(transaction, verification) {
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

  await audit.record({
    action: audit.ACTIONS.DONATION_CAPTURED,
    target: transaction,
    mosque,
    actor: transaction.get('donorId'),
    amount,
  });

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
}

/**
 * مقارنة السرّ بزمن ثابت — المقارنة بـ`===` تُسرّب طول البادئة المطابقة.
 */
function secretMatches(provided, expected) {
  if (!expected || typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * نقطة نهاية البوابة.
 *
 * تُستدعى من ثواني لا من مستخدم، فلا جلسة معها — التوثيق بسرّ مشترك يُضبط في
 * `PAYMENT_WEBHOOK_SECRET` ويُسجَّل في لوحة البوابة.
 *
 * **جسم الطلب لا يُصدَّق إطلاقاً.** كل ما يُؤخذ منه هو معرّف المعاملة، ثم تُسأل
 * البوابة عن حالتها الحقيقية. من يعرف السرّ يستطيع أن يطلب إعادة الفحص، لا أن
 * يُقرّر أن الدفع تمّ.
 *
 * أفضلُ من المهمة الدورية لأن القيد يتمّ لحظة الدفع لا بعد ساعة، والمهمة تبقى
 * شبكة أمان لما يضيع من الطلبات.
 */
Parse.Cloud.define('paymentWebhook', async (request) => {
  const expected = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!expected) E.forbidden('نقطة نهاية البوابة غير مهيأة.');
  if (!secretMatches(request.params.secret, expected)) E.forbidden('توثيق غير صالح.');

  // ثواني تُعيد معرّف المعاملة في client_reference_id كما أُرسل عند إنشاء الجلسة
  const transactionId = request.params.clientReferenceId || request.params.client_reference_id;
  if (!transactionId) E.invalid('معرّف المعاملة مطلوب.');

  const transaction = await new Parse.Query('Transactions')
    .get(String(transactionId), { useMasterKey: true })
    .catch(() => E.notFound('المعاملة غير موجودة.'));

  if (transaction.get('status') === 'captured') {
    return { status: 'captured', message: 'سبق قيد هذه المعاملة.' };
  }
  if (transaction.get('status') !== 'pending') {
    return { status: transaction.get('status'), message: 'حالة المعاملة لا تسمح بالقيد.' };
  }

  const verification = await payments.verifySession(transaction.get('paymentSessionId'));

  if (!verification.paid) {
    if (!verification.terminal) return { status: 'pending' };
    transaction.set('status', 'failed');
    await transaction.save(null, { useMasterKey: true });
    return { status: 'failed' };
  }

  if (Math.abs(verification.amountOmr - transaction.get('amount')) > 0.001) {
    transaction.set('status', 'mismatch');
    await transaction.save(null, { useMasterKey: true });
    E.invalid('المبلغ المدفوع لا يطابق المبلغ المسجّل.');
  }

  return captureDonation(transaction, verification);
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

  await audit.record({
    action: audit.ACTIONS.PAYOUT_RECORDED,
    target: payout,
    mosque,
    actor: admin,
    amount: value,
  });

  return { message: 'تم تسجيل الصرف.', transactionId: payout.id };
});

/**
 * استرداد تبرّع مُقيَّد — مشرف فقط.
 *
 * كان المسار مفقوداً كلياً: طلبٌ يُلغى بعد التمويل، أو تمويلٌ زائد أفلت من
 * الحجز، كلاهما بلا مخرج إلا تعديل قاعدة البيانات يدوياً. التحويل الفعلي يتم
 * خارج النظام كما في الصرف — هنا يُسجَّل القيد ويُعاد الطلب إلى حالة التمويل.
 */
Parse.Cloud.define('refundDonation', async (request) => {
  const admin = requireRole(request, 'admin');
  const { transactionId, reason } = request.params;
  if (!transactionId) E.invalid('معرّف المعاملة مطلوب.');

  const original = await new Parse.Query('Transactions')
    .get(String(transactionId), { useMasterKey: true })
    .catch(() => E.notFound('المعاملة غير موجودة.'));

  if (original.get('type') !== 'donation') E.invalid('الاسترداد للتبرعات وحدها.');
  if (original.get('status') === 'refunded') E.duplicate('سبق استرداد هذه المعاملة.');
  if (original.get('status') !== 'captured') E.invalid('لا يُسترد إلا مبلغ مُقيَّد.');

  const amount = original.get('amount');
  const mosque = await fetchPointer(original.get('mosqueId'), 'Mosques');
  const serviceRequest = await fetchPointer(original.get('requestId'), 'ServiceRequests');

  if (serviceRequest.get('isPaidOut')) {
    E.forbidden('صُرفت مستحقات هذا الطلب — الاسترداد بعده تسوية محاسبية يدوية.');
  }

  // الخصم أولاً ثم التحقق، كما في الصرف: الرصيد قد يكون أُنفق على طلب آخر
  mosque.increment('walletBalance', -amount);
  await mosque.save(null, { useMasterKey: true });
  await mosque.fetch({ useMasterKey: true });

  if ((mosque.get('walletBalance') || 0) < 0) {
    mosque.increment('walletBalance', amount); // تعويض
    await mosque.save(null, { useMasterKey: true });
    E.invalid('رصيد المسجد لا يكفي للاسترداد — رُوجع في طلبات أخرى.');
  }

  original.set('status', 'refunded');
  await original.save(null, { useMasterKey: true });

  serviceRequest.increment('fundedAmount', -amount);
  await serviceRequest.save(null, { useMasterKey: true });
  await serviceRequest.fetch({ useMasterKey: true });

  // الطلب لم يعد مموّلاً بالكامل، فيعود لاستقبال التمويل
  if (serviceRequest.get('status') === STATUS.FUNDED
      && serviceRequest.get('fundedAmount') < serviceRequest.get('estimatedCost')) {
    serviceRequest.set('status', STATUS.PENDING_FUNDING);
    serviceRequest.set('isFundedByDonors', false);
    await serviceRequest.save(null, { useMasterKey: true });
  }

  const Transaction = Parse.Object.extend('Transactions');
  const entry = new Transaction();
  entry.set('mosqueId', mosque);
  entry.set('requestId', serviceRequest);
  entry.set('payeeId', original.get('donorId'));
  entry.set('amount', amount);
  entry.set('type', 'refund');
  entry.set('status', 'captured');
  entry.set('paymentGatewayRef', String(reason || ''));
  entry.set('approvedBy', admin);
  await entry.save(null, { useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.DONATION_REFUNDED,
    target: entry,
    mosque,
    actor: admin,
    amount,
  });

  return { message: 'سُجّل الاسترداد.', transactionId: entry.id, fundedAmount: serviceRequest.get('fundedAmount') };
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

/**
 * مراجعة المعاملات المعلّقة.
 *
 * `confirmDonation` تُستدعى عند عودة المستخدم من صفحة الدفع، فإن أغلق التطبيق
 * بعد الدفع مباشرة بقيت معاملته `pending` ومالُه غير مقيَّد. تُجدوَل هذه المهمة
 * من لوحة Back4app (Server Settings → Background Jobs) كل ساعة.
 *
 * تسأل البوابة عن كل معاملة معلّقة تجاوزت مهلة الحجز:
 *   دُفعت    → تُقيَّد عبر `captureDonation` نفسها التي تستعملها الدالة
 *   انتهت    → `failed`
 *   مفتوحة   → تُترك، إلا إذا تجاوزت المهلة القصوى فتصير `expired`
 */
const PENDING_MAX_AGE_HOURS = 24;

Parse.Cloud.job('reviewPendingDonations', async (request) => {
  const { message } = request;

  if (!payments.isConfigured()) {
    message('بوابة الدفع غير مهيأة — لا شيء لمراجعته.');
    return 'skipped';
  }

  const cutoff = new Date(Date.now() - PENDING_TTL_MINUTES * 60 * 1000);
  const stale = await new Parse.Query('Transactions')
    .equalTo('type', 'donation')
    .equalTo('status', 'pending')
    .lessThan('createdAt', cutoff)
    .limit(100)
    .find({ useMasterKey: true });

  const counts = { captured: 0, failed: 0, expired: 0, open: 0, errors: 0 };
  const expiryLimit = new Date(Date.now() - PENDING_MAX_AGE_HOURS * 3600 * 1000);

  for (const transaction of stale) {
    try {
      const verification = await payments.verifySession(transaction.get('paymentSessionId'));

      if (verification.paid) {
        // نفس فحص المطابقة الذي في confirmDonation — لا يُقيَّد مبلغ مخالف
        if (Math.abs(verification.amountOmr - transaction.get('amount')) > 0.001) {
          transaction.set('status', 'mismatch');
          await transaction.save(null, { useMasterKey: true });
          counts.errors += 1;
          continue;
        }
        await captureDonation(transaction, verification);
        counts.captured += 1;
      } else if (verification.terminal) {
        transaction.set('status', 'failed');
        await transaction.save(null, { useMasterKey: true });
        counts.failed += 1;
      } else if (transaction.get('createdAt') < expiryLimit) {
        transaction.set('status', 'expired');
        await transaction.save(null, { useMasterKey: true });
        await audit.record({
          action: audit.ACTIONS.DONATION_EXPIRED,
          target: transaction,
          mosque: transaction.get('mosqueId'),
          amount: transaction.get('amount'),
        });
        counts.expired += 1;
      } else {
        counts.open += 1;
      }
    } catch (error) {
      counts.errors += 1;
      console.error('[reviewPendingDonations]', transaction.id, error && error.message);
    }
  }

  const summary = `فُحصت ${stale.length}: قُيّدت ${counts.captured}، فشلت ${counts.failed}، `
    + `انتهت ${counts.expired}، ما تزال مفتوحة ${counts.open}، أخطاء ${counts.errors}`;
  message(summary);
  return summary;
});

/**
 * سجل التدقيق لمسجد — من فعل ماذا ومتى.
 * `getMosqueLedger` يُظهر المال، وهذا يُظهر القرارات. هوية الفاعل لا تُعاد،
 * دوره فقط: الغرض تتبّع المسار لا كشف الأشخاص.
 */
Parse.Cloud.define('getMosqueAuditTrail', async (request) => {
  requireUser(request);
  const { mosqueId, limit = 50 } = request.params;
  if (!mosqueId) E.invalid('معرّف المسجد مطلوب.');

  const mosque = new Parse.Object('Mosques');
  mosque.id = mosqueId;

  const entries = await new Parse.Query('AuditLog')
    .equalTo('mosqueId', mosque)
    .descending('createdAt')
    .limit(Math.min(Number(limit) || 50, 100))
    .find({ useMasterKey: true });

  return entries.map((entry) => ({
    action: entry.get('action'),
    targetClass: entry.get('targetClass'),
    targetId: entry.get('targetId'),
    fromStatus: entry.get('fromStatus'),
    toStatus: entry.get('toStatus'),
    actorRole: entry.get('actorRole'),
    amount: entry.get('amount'),
    createdAt: entry.get('createdAt'),
  }));
});
