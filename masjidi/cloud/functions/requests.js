const E = require('../lib/errors');
const { requireUser, requireRole, mosqueForImam, fetchPointer } = require('../lib/auth');
const { pushToUsers, pushToNearbyVolunteers } = require('../lib/push');
const audit = require('../lib/audit');

/**
 * دورة حياة الطلب:
 *   pending_funding → funded → assigned → in_progress → pending_imam_approval → completed
 *   (أو) open_for_volunteers → assigned → ... (مسار التطوّع العيني، بلا مال)
 *   يمكن الإلغاء في أي مرحلة قبل التنفيذ → cancelled
 */
const STATUS = {
  PENDING_FUNDING: 'pending_funding',
  OPEN_FOR_VOLUNTEERS: 'open_for_volunteers',
  FUNDED: 'funded',
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  PENDING_APPROVAL: 'pending_imam_approval',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

const MAX_ESTIMATE_OMR = 5000;

Parse.Cloud.define('createServiceRequest', async (request) => {
  const imam = requireRole(request, 'imam');
  const mosque = await mosqueForImam(imam, request.params.mosqueId);

  const { title, description, category, estimatedCost, urgency } = request.params;
  if (!title || String(title).trim().length < 3) E.invalid('العنوان مطلوب (3 أحرف فأكثر).');
  if (!description || String(description).trim().length < 10) E.invalid('الوصف مطلوب (10 أحرف فأكثر).');

  // `Number(x) || 0` كان يبتلع NaN فيحوّل مدخلاً فاسداً إلى طلب تطوّعي بصمت
  const cost = estimatedCost === undefined || estimatedCost === null ? 0 : Number(estimatedCost);
  if (!Number.isFinite(cost) || cost < 0 || cost > MAX_ESTIMATE_OMR) {
    E.invalid(`التكلفة التقديرية يجب أن تكون رقماً بين 0 و ${MAX_ESTIMATE_OMR} ريال.`);
  }

  // منع إغراق النظام: حد أقصى للطلبات المفتوحة لكل مسجد
  const openCount = await new Parse.Query('ServiceRequests')
    .equalTo('mosqueId', mosque)
    .containedIn('status', [STATUS.PENDING_FUNDING, STATUS.OPEN_FOR_VOLUNTEERS, STATUS.FUNDED, STATUS.ASSIGNED, STATUS.IN_PROGRESS])
    .count({ useMasterKey: true });
  if (openCount >= 10) E.invalid('لديك 10 طلبات مفتوحة — أغلق بعضها قبل إضافة طلب جديد.');

  const ServiceRequest = Parse.Object.extend('ServiceRequests');
  const serviceRequest = new ServiceRequest();
  serviceRequest.set('mosqueId', mosque);
  serviceRequest.set('createdBy', imam);
  serviceRequest.set('title', String(title).trim().slice(0, 120));
  serviceRequest.set('description', String(description).trim().slice(0, 2000));
  serviceRequest.set('category', category || 'other'); // electrical | plumbing | ac | paint | cleaning | carpet | other
  serviceRequest.set('urgency', urgency || 'normal'); // low | normal | high
  serviceRequest.set('estimatedCost', cost);
  serviceRequest.set('fundedAmount', 0);
  serviceRequest.set('status', cost > 0 ? STATUS.PENDING_FUNDING : STATUS.OPEN_FOR_VOLUNTEERS);

  await serviceRequest.save(null, { useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.REQUEST_CREATED,
    target: serviceRequest,
    mosque,
    actor: imam,
    toStatus: serviceRequest.get('status'),
  });

  if (cost === 0) {
    await pushToNearbyVolunteers(mosque, {
      alert: `فرصة تطوّع: ${serviceRequest.get('title')} — مسجد ${mosque.get('name')}`,
      requestId: serviceRequest.id,
    });
  }

  return serviceRequest.toJSON();
});

const MAX_INTEREST_NOTE = 300;

/**
 * المتطوّع يُسجّل اهتمامه بطلب مفتوح.
 *
 * لا يُسند الطلب ولا يُغيّر حالته: الإمام يبقى صاحب القرار عبر `assignWorker`.
 * بدون هذا المسار يرى المتطوّع الفرصة القريبة ولا يملك وسيلة للتعبير عنها
 * أصلاً — وهي أكبر فجوة في مسار التطوّع العيني، وهو المسار القابل للإطلاق.
 */
Parse.Cloud.define('expressInterest', async (request) => {
  const volunteer = requireRole(request, 'volunteer');
  const { requestId, note } = request.params;
  if (!requestId) E.invalid('معرّف الطلب مطلوب.');

  const serviceRequest = await new Parse.Query('ServiceRequests')
    .get(requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  if (serviceRequest.get('status') !== STATUS.OPEN_FOR_VOLUNTEERS) {
    E.invalid('هذا الطلب لا يستقبل المتطوّعين حالياً.');
  }

  const existing = await new Parse.Query('TaskInterests')
    .equalTo('requestId', serviceRequest)
    .equalTo('volunteerId', volunteer)
    .equalTo('status', 'active')
    .first({ useMasterKey: true });
  if (existing) E.duplicate('سبق أن سجّلت اهتمامك بهذا الطلب.');

  const Interest = Parse.Object.extend('TaskInterests');
  const interest = new Interest();
  interest.set('requestId', serviceRequest);
  interest.set('volunteerId', volunteer);
  interest.set('status', 'active');
  interest.set('note', String(note || '').trim().slice(0, MAX_INTEREST_NOTE));
  await interest.save(null, { useMasterKey: true });

  const mosque = await fetchPointer(serviceRequest.get('mosqueId'), 'Mosques');

  await audit.record({
    action: audit.ACTIONS.INTEREST_EXPRESSED,
    target: interest,
    mosque,
    actor: volunteer,
  });

  const imam = mosque.get('imamId');
  if (imam) {
    await pushToUsers(imam, {
      alert: `متطوّع مهتمّ بـ "${serviceRequest.get('title')}" — اختر المنفّذ من قائمة المهتمّين.`,
      requestId: serviceRequest.id,
    });
  }

  return { interestId: interest.id, message: 'سُجّل اهتمامك، والإمام يختار المنفّذ.' };
});

/** سحب الاهتمام قبل الاختيار. */
Parse.Cloud.define('withdrawInterest', async (request) => {
  const volunteer = requireRole(request, 'volunteer');
  const { requestId } = request.params;
  if (!requestId) E.invalid('معرّف الطلب مطلوب.');

  const serviceRequest = new Parse.Object('ServiceRequests');
  serviceRequest.id = requestId;

  const interest = await new Parse.Query('TaskInterests')
    .equalTo('requestId', serviceRequest)
    .equalTo('volunteerId', volunteer)
    .equalTo('status', 'active')
    .first({ useMasterKey: true });
  if (!interest) E.notFound('لا يوجد اهتمام مسجّل لك بهذا الطلب.');

  interest.set('status', 'withdrawn');
  await interest.save(null, { useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.INTEREST_WITHDRAWN,
    target: interest,
    actor: volunteer,
  });

  return { status: 'withdrawn' };
});

/**
 * اهتمامات المتطوّع المستدعي — `TaskInterests` مقفلة فلا يصلها العميل مباشرةً.
 */
Parse.Cloud.define('getMyInterests', async (request) => {
  const volunteer = requireRole(request, 'volunteer');

  const interests = await new Parse.Query('TaskInterests')
    .equalTo('volunteerId', volunteer)
    .descending('createdAt')
    .include('requestId')
    .limit(50)
    .find({ useMasterKey: true });

  return interests.map((interest) => {
    const serviceRequest = interest.get('requestId');
    return {
      id: interest.id,
      status: interest.get('status'),
      note: interest.get('note'),
      createdAt: interest.get('createdAt'),
      requestId: serviceRequest ? serviceRequest.id : null,
      requestTitle: serviceRequest ? serviceRequest.get('title') : null,
      requestStatus: serviceRequest ? serviceRequest.get('status') : null,
    };
  });
});

/**
 * قائمة المهتمّين بطلب — للإمام صاحب المسجد وحده.
 *
 * تُعاد المهارات والتقييم ليختار الإمام عن بيّنة. لا يُعاد رقم الهاتف: التواصل
 * يبدأ بعد التكليف عبر الإشعار، فلا داعي لكشفه لكل من سجّل اهتماماً.
 */
Parse.Cloud.define('getRequestInterests', async (request) => {
  const imam = requireRole(request, 'imam');
  const { requestId } = request.params;
  if (!requestId) E.invalid('معرّف الطلب مطلوب.');

  const serviceRequest = await new Parse.Query('ServiceRequests')
    .get(requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  await mosqueForImam(imam, serviceRequest.get('mosqueId').id);

  const interests = await new Parse.Query('TaskInterests')
    .equalTo('requestId', serviceRequest)
    .equalTo('status', 'active')
    .include('volunteerId')
    .ascending('createdAt')
    .limit(50)
    .find({ useMasterKey: true });

  return interests.map((interest) => {
    const volunteer = interest.get('volunteerId');
    return {
      interestId: interest.id,
      volunteerId: volunteer ? volunteer.id : null,
      fullName: volunteer ? volunteer.get('fullName') : null,
      skills: (volunteer && volunteer.get('skills')) || [],
      completedJobs: (volunteer && volunteer.get('completedJobs')) || 0,
      avgRating: volunteer ? volunteer.get('avgRating') : null,
      note: interest.get('note'),
      createdAt: interest.get('createdAt'),
    };
  });
});

/** تعيين منفّذ: متطوع أو شركة. الإمام هو من يعيّن. */
Parse.Cloud.define('assignWorker', async (request) => {
  const imam = requireRole(request, 'imam');
  const { requestId, workerId } = request.params;
  if (!requestId || !workerId) E.invalid('معرّف الطلب ومعرّف المنفّذ مطلوبان.');

  const serviceRequest = await new Parse.Query('ServiceRequests')
    .get(requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  // التحقق من الملكية يدوياً — query.get يتجاهل قيود equalTo
  const mosque = await mosqueForImam(imam, serviceRequest.get('mosqueId').id);

  const allowed = [STATUS.FUNDED, STATUS.OPEN_FOR_VOLUNTEERS];
  if (!allowed.includes(serviceRequest.get('status'))) {
    E.invalid('لا يمكن التعيين في هذه المرحلة — تأكد من تمويل الطلب أولاً.');
  }

  const worker = await new Parse.Query(Parse.User).get(workerId, { useMasterKey: true })
    .catch(() => E.notFound('المستخدم غير موجود.'));

  const role = worker.get('role');
  if (role === 'volunteer') {
    if (serviceRequest.get('estimatedCost') > 0) E.invalid('الطلبات المموّلة تُسند إلى شركة معتمدة.');
    serviceRequest.set('assignedVolunteerId', worker);
  } else if (role === 'contractor') {
    if (!worker.get('isVerifiedContractor')) E.forbidden('هذه الشركة غير معتمدة بعد.');
    serviceRequest.set('assignedContractorId', worker);
  } else {
    E.invalid('المستخدم ليس متطوعاً ولا شركة خدمات.');
  }

  const previousStatus = serviceRequest.get('status');
  serviceRequest.set('status', STATUS.ASSIGNED);
  serviceRequest.set('assignedAt', new Date());
  await serviceRequest.save(null, { useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.WORKER_ASSIGNED,
    target: serviceRequest,
    mosque,
    actor: imam,
    fromStatus: previousStatus,
    toStatus: STATUS.ASSIGNED,
  });

  await closeInterests(serviceRequest);

  await pushToUsers(worker, {
    alert: `تم تكليفك بـ "${serviceRequest.get('title')}" في مسجد ${mosque.get('name')}.`,
    requestId: serviceRequest.id,
  });

  return serviceRequest.toJSON();
});

/**
 * إقفال الاهتمامات المعلّقة بعد اختيار المنفّذ.
 * تركُها `active` يُبقي القائمة تعرض من لم يُختَر كأنه ما زال بالانتظار.
 */
async function closeInterests(serviceRequest) {
  const open = await new Parse.Query('TaskInterests')
    .equalTo('requestId', serviceRequest)
    .equalTo('status', 'active')
    .limit(100)
    .find({ useMasterKey: true });

  for (const interest of open) interest.set('status', 'closed');
  if (open.length > 0) await Parse.Object.saveAll(open, { useMasterKey: true });
}

/** المنفّذ يبدأ العمل. */
Parse.Cloud.define('startWork', async (request) => {
  const user = requireRole(request, 'volunteer', 'contractor');
  const serviceRequest = await loadAssignedRequest(request.params.requestId, user);

  if (serviceRequest.get('status') !== STATUS.ASSIGNED) E.invalid('الطلب ليس في حالة تكليف.');
  serviceRequest.set('status', STATUS.IN_PROGRESS);
  serviceRequest.set('startedAt', new Date());
  await serviceRequest.save(null, { useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.WORK_STARTED,
    target: serviceRequest,
    mosque: serviceRequest.get('mosqueId'),
    actor: user,
    fromStatus: STATUS.ASSIGNED,
    toStatus: STATUS.IN_PROGRESS,
  });

  return serviceRequest.toJSON();
});

/** المنفّذ يبلّغ بانتهاء العمل — لا يُقفل الطلب، بل ينتظر معاينة الإمام. */
Parse.Cloud.define('markWorkDone', async (request) => {
  const user = requireRole(request, 'volunteer', 'contractor');
  const { requestId, notes, photoUrls } = request.params;
  const serviceRequest = await loadAssignedRequest(requestId, user);

  if (serviceRequest.get('status') !== STATUS.IN_PROGRESS) E.invalid('الطلب ليس قيد التنفيذ.');

  serviceRequest.set('status', STATUS.PENDING_APPROVAL);
  serviceRequest.set('workerNotes', String(notes || '').slice(0, 1000));
  serviceRequest.set('completionPhotos', Array.isArray(photoUrls) ? photoUrls.slice(0, 6) : []);
  serviceRequest.set('workDoneAt', new Date());
  await serviceRequest.save(null, { useMasterKey: true });

  const mosque = await fetchPointer(serviceRequest.get('mosqueId'), 'Mosques');

  await audit.record({
    action: audit.ACTIONS.WORK_DONE,
    target: serviceRequest,
    mosque,
    actor: user,
    fromStatus: STATUS.IN_PROGRESS,
    toStatus: STATUS.PENDING_APPROVAL,
  });

  const imam = mosque.get('imamId');
  if (imam) {
    await pushToUsers(imam, {
      alert: `تم إنجاز "${serviceRequest.get('title')}" — بانتظار معاينتك واعتمادك.`,
      requestId: serviceRequest.id,
    });
  }

  return serviceRequest.toJSON();
});

/** الإمام يعاين ويعتمد. هنا فقط يُقفل الطلب وتُسجّل ساعات التطوّع. */
Parse.Cloud.define('completeService', async (request) => {
  const imam = requireRole(request, 'imam');
  const { requestId, rating, volunteerHours } = request.params;

  const serviceRequest = await new Parse.Query('ServiceRequests')
    .get(requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  await mosqueForImam(imam, serviceRequest.get('mosqueId').id);

  if (serviceRequest.get('status') !== STATUS.PENDING_APPROVAL) {
    E.invalid('الطلب ليس بانتظار الاعتماد.');
  }

  const score = Math.min(Math.max(Number(rating) || 5, 1), 5);
  serviceRequest.set('status', STATUS.COMPLETED);
  serviceRequest.set('imamRating', score);
  serviceRequest.set('imamApprovalDate', new Date());
  serviceRequest.set('volunteerHours', Math.min(Number(volunteerHours) || 0, 24));
  await serviceRequest.save(null, { useMasterKey: true });

  await recordWorkerRating(serviceRequest, score);

  await audit.record({
    action: audit.ACTIONS.REQUEST_COMPLETED,
    target: serviceRequest,
    mosque: serviceRequest.get('mosqueId'),
    actor: imam,
    fromStatus: STATUS.PENDING_APPROVAL,
    toStatus: STATUS.COMPLETED,
  });

  // TODO: صرف المستحقات للشركة يتم عبر دالة payout منفصلة بعد الاعتماد (functions/donations.js)
  // TODO: تسجيل ساعات التطوّع في منصة "أيادي" — يحتاج اتفاقية وAPI key رسمي.

  return { message: 'تم اعتماد العمل، بارك الله فيكم.', status: STATUS.COMPLETED };
});

/** إلغاء الطلب — الإمام فقط، وقبل بدء التنفيذ، وبشرط عدم وجود تمويل مُحصّل. */
Parse.Cloud.define('cancelServiceRequest', async (request) => {
  const imam = requireRole(request, 'imam');
  const serviceRequest = await new Parse.Query('ServiceRequests')
    .get(request.params.requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  const mosque = await mosqueForImam(imam, serviceRequest.get('mosqueId').id);
  const status = serviceRequest.get('status');

  if ([STATUS.COMPLETED, STATUS.CANCELLED].includes(status)) {
    E.invalid('الطلب مغلق بالفعل.');
  }
  // العمل بدأ فعلاً: إلغاؤه يُضيّع جهد المنفّذ ويُسقط حقّه في المعاينة
  if ([STATUS.IN_PROGRESS, STATUS.PENDING_APPROVAL].includes(status)) {
    E.forbidden('بدأ التنفيذ — عاين العمل واعتمده، أو تواصل مع المنفّذ.');
  }
  if ((serviceRequest.get('fundedAmount') || 0) > 0) {
    E.forbidden('لا يمكن إلغاء طلب استلم تبرعات — تواصل مع الإدارة لإعادة توجيه المبلغ.');
  }

  serviceRequest.set('status', STATUS.CANCELLED);
  serviceRequest.set('cancelledAt', new Date());
  await serviceRequest.save(null, { useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.REQUEST_CANCELLED,
    target: serviceRequest,
    mosque,
    actor: imam,
    fromStatus: status,
    toStatus: STATUS.CANCELLED,
  });

  // المنفّذ المكلَّف قد يكون في طريقه إلى المسجد — يجب أن يعلم
  const worker = serviceRequest.get('assignedVolunteerId')
    || serviceRequest.get('assignedContractorId');
  if (worker) {
    await pushToUsers(worker, {
      alert: `أُلغي طلب "${serviceRequest.get('title')}" في مسجد ${mosque.get('name')}.`,
      requestId: serviceRequest.id,
    });
  }

  return { status: STATUS.CANCELLED };
});

/**
 * تحديث سجل المنفّذ عند اعتماد العمل.
 *
 * `completedJobs` و`avgRating` كانا معرّفين في المخطط ولا يُكتبان أبداً، فتقييم
 * المنفّذين معطّل فعلياً. المتوسط يُحسب تراكمياً من العدد السابق فلا نحتفظ بكل
 * التقييمات. قراءة‑ثم‑كتابة هنا مقبولة: اعتمادان متزامنان للمنفّذ نفسه نادران
 * وأثرهما تقييم منحرف قليلاً لا مال ضائع — بخلاف `walletBalance`.
 */
async function recordWorkerRating(serviceRequest, score) {
  const pointer = serviceRequest.get('assignedContractorId')
    || serviceRequest.get('assignedVolunteerId');
  if (!pointer) return;

  const worker = await fetchPointer(pointer, '_User');
  const done = worker.get('completedJobs') || 0;
  const average = worker.get('avgRating');

  worker.set('avgRating', average == null ? score : ((average * done) + score) / (done + 1));
  worker.increment('completedJobs', 1);
  await worker.save(null, { useMasterKey: true });
}

async function loadAssignedRequest(requestId, user) {
  if (!requestId) E.invalid('معرّف الطلب مطلوب.');
  const serviceRequest = await new Parse.Query('ServiceRequests')
    .get(requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  const volunteer = serviceRequest.get('assignedVolunteerId');
  const contractor = serviceRequest.get('assignedContractorId');
  const assignedId = (volunteer && volunteer.id) || (contractor && contractor.id);
  if (assignedId !== user.id) E.forbidden('هذا الطلب غير مُسند إليك.');
  return serviceRequest;
}

module.exports = { STATUS };
