const E = require('../lib/errors');
// سطرٌ واحد قصداً — انظر `scripts/build_single_file.py`
const { requireUser, requireRole, mosqueForImam, fetchPointer } = require('../lib/auth');
const { pushToUsers, pushToNearbyVolunteers, pushToMosqueFollowers } = require('../lib/push');
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

/**
 * حدود تمنع إغراق المنصّة.
 *
 * الاهتمام لا يحجز الطلب، فمتطوّع واحد قد يسجّل اهتمامه بكل طلب مفتوح فيتصدّر
 * قوائم الأئمة جميعاً وهو لا ينوي تنفيذ إلا واحد. والتكليف يحجز فعلاً: ثلاثة
 * مساجد تظنّ أن لها منفّذاً والمنفّذ واحد لا يسع إلا مسجداً.
 *
 * الأرقام تقديرية لا محسوبة — تُراجَع بعد أول موسم تشغيل حقيقي.
 */
const MAX_ACTIVE_INTERESTS = 10;
const MAX_ACTIVE_ASSIGNMENTS = 3;

/** حقل التكليف بحسب الدور — المتطوّع والشركة لا يشتركان في حقل واحد. */
const assignmentField = (role) =>
  (role === 'contractor' ? 'assignedContractorId' : 'assignedVolunteerId');

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

  /*
   * ومن أعلن أن هذا مسجده يُبلَّغ — أيّاً كان دوره وأين كان الآن.
   *
   * القريبة تُصفّي بالدور وبموقع الجهاز، فتُخطئ من قال «هذا مسجدي» وهو في
   * بيته، وتُخطئ المتبرّع دائماً. وهذا هو الوعد الوحيد الذي يقطعه ذلك الزرّ.
   *
   * ويُستثنى الإمام: هو من نشره.
   */
  await pushToMosqueFollowers(mosque, {
    alert: `احتياجٌ جديد في ${mosque.get('name')}: ${serviceRequest.get('title')}`,
    requestId: serviceRequest.id,
  }, { exclude: [imam.id] });

  return serviceRequest.toJSON();
});

const MAX_INTEREST_NOTE = 300;
const MAX_PHOTOS = 6;

/**
 * روابط الصور المقبولة.
 *
 * `photoUrls` يصل من العميل، ولو قُبل كما هو لأمكن حشو سجلّ المسجد بروابط
 * خارجية: تتبّعاً للإمام حين يفتح الطلب، أو محتوىً يتغيّر بعد الاعتماد فيصير
 * الدليل غير ما اعتُمد. المقبول: ملفات مرفوعة إلى تخزين المشروع وحده.
 *
 * على Back4app الملفات تُخدَم من مضيف مستقلّ عن الـAPI، فالقائمة تُضبط بـ
 * `FILE_HOST_ALLOWLIST` وتشمل افتراضياً مضيف الخادم ومضيف ملفات Back4app.
 */
function allowedFileHosts() {
  const configured = (process.env.FILE_HOST_ALLOWLIST || '')
    .split(',').map((host) => host.trim()).filter(Boolean);

  const hosts = new Set([...configured, 'parsefiles.back4app.com']);
  try {
    hosts.add(new URL(Parse.serverURL).hostname);
  } catch (_) {
    // serverURL غير مضبوط في بعض بيئات الاختبار
  }
  return hosts;
}

function validatePhotos(photoUrls) {
  if (!Array.isArray(photoUrls) || photoUrls.length === 0) return [];
  if (photoUrls.length > MAX_PHOTOS) E.invalid(`أقصى عدد للصور ${MAX_PHOTOS}.`);

  const hosts = allowedFileHosts();

  return photoUrls.map((raw) => {
    let url;
    try {
      url = new URL(String(raw));
    } catch (_) {
      return E.invalid('رابط صورة غير صالح.');
    }
    // http عادي يُسقط الصور خلف HTTPS ويكشفها للشبكة
    if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      E.invalid('روابط الصور يجب أن تكون عبر HTTPS.');
    }
    if (!hosts.has(url.hostname)) {
      E.invalid('تُقبل الصور المرفوعة إلى تخزين التطبيق وحدها.');
    }
    return url.toString();
  });
}

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

  // سُحب منه هذا الطلب من قبل: بلا هذا الشرط يعيد التسجيل فوراً فتدور الحلقة
  // تكليفٌ ثم غياب ثم تكليف، والإمام يرى اسمه في القائمة كأن شيئاً لم يكن.
  const released = await new Parse.Query('TaskInterests')
    .equalTo('requestId', serviceRequest)
    .equalTo('volunteerId', volunteer)
    .equalTo('status', 'released')
    .first({ useMasterKey: true });
  if (released) E.forbidden('سُحب منك هذا الطلب سابقاً، فلا يمكن التسجيل فيه من جديد.');

  const active = await new Parse.Query('TaskInterests')
    .equalTo('volunteerId', volunteer)
    .equalTo('status', 'active')
    .count({ useMasterKey: true });
  if (active >= MAX_ACTIVE_INTERESTS) {
    E.forbidden(`لديك ${active} اهتماماً مفتوحاً — اسحب بعضها قبل تسجيل اهتمام جديد.`);
  }

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

  // بلا المسجد لا يبلغ القيدُ عيناً: `getMosqueAuditTrail` تستعلم بالمسجد وهي
  // القارئ الوحيد. وكان نظيرُه `interest_expressed` يُقيَّد بمسجده — فالسجلّ
  // يُظهر كلّ من سجّل اهتمامه ويُخفي من انصرف، **فيُقرأ عدداً ليس عدده.**
  const stored = await new Parse.Query('ServiceRequests')
    .get(requestId, { useMasterKey: true }).catch(() => null);

  await audit.record({
    action: audit.ACTIONS.INTEREST_WITHDRAWN,
    target: interest,
    mosque: stored ? stored.get('mosqueId') : null,
    actor: volunteer,
  });

  /*
   * والإمام يُخبَر بالانصراف كما أُخبر بالاهتمام.
   *
   * `expressInterest` تقول له «متطوّع مهتمّ — اختر المنفّذ من قائمة
   * المهتمّين»، وهذه كانت صامتة. **فيُدعى إلى قائمةٍ صارت فارغة** ولا يعلم
   * لماذا، أو ينتظر من انصرف. والإخبار بالبدء دون النهاية أسوأ من الصمت
   * فيهما جميعاً.
   */
  const mosque = stored ? await fetchPointer(stored.get('mosqueId'), 'Mosques') : null;
  const imam = mosque && mosque.get('imamId');
  if (imam) {
    await pushToUsers(imam, {
      alert: `اعتذر متطوّع عن "${stored.get('title')}" — راجع قائمة المهتمّين.`,
      requestId: stored.id,
    });
  }

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
      // يُعرض ليختار الإمام عن بيّنة — لا يمنع الاختيار تلقائياً: الغياب مرّةً
      // له أسبابه، والمنع الآلي يُقصي متطوّعاً بلا مراجعة
      abandonedJobs: (volunteer && volunteer.get('abandonedJobs')) || 0,
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
  if (role !== 'volunteer' && role !== 'contractor') {
    E.invalid('المستخدم ليس متطوعاً ولا شركة خدمات.');
  }

  // التكليف يحجز المنفّذ فعلياً — لا يُكلَّف بما لا يسع. يُحسب قبل أي `set`
  // فلا يبقى الكائن في الذاكرة محمّلاً بتكليفٍ رُفض.
  const openAssignments = await new Parse.Query('ServiceRequests')
    .equalTo(assignmentField(role), worker)
    .containedIn('status', [STATUS.ASSIGNED, STATUS.IN_PROGRESS])
    .count({ useMasterKey: true });
  if (openAssignments >= MAX_ACTIVE_ASSIGNMENTS) {
    E.forbidden(`لدى هذا المنفّذ ${openAssignments} أعمال لم تُنجَز بعد — اختر غيره.`);
  }

  if (role === 'volunteer') {
    if (serviceRequest.get('estimatedCost') > 0) E.invalid('الطلبات المموّلة تُسند إلى شركة معتمدة.');
    serviceRequest.set('assignedVolunteerId', worker);
  } else {
    if (!worker.get('isVerifiedContractor')) E.forbidden('هذه الشركة غير معتمدة بعد.');
    serviceRequest.set('assignedContractorId', worker);
  }

  const previousStatus = serviceRequest.get('status');
  serviceRequest.set('status', STATUS.ASSIGNED);
  serviceRequest.set('assignedAt', new Date());
  await serviceRequest.save(null, { useMasterKey: true });

  /**
   * **لا أثرَ لتكليفٍ لم يقم** — والقراءة بعد الحفظ تقول أيُّهما قام.
   *
   * قِيس بنداءين متوازيين لمنفّذين مختلفين: نجحا معاً، وكُتب الثاني في القاعدة،
   * **وأُخبر كلاهما بأنه كُلِّف** — فيسافر أحدهما إلى المسجد وليس له فيه عمل.
   *
   * ثم قِيس ثانيةً بعد إصلاح البشرى وحدها، **فإذا سجلّ المسجد يقول «كُلّف
   * منفّذ بالعمل» مرّتين** لتكليفٍ واحد قام. والسجلّ هو أداةُ الشفافية التي
   * تقوم عليها المنصّة: يقرؤه المصلّي والمتبرّع، ولا يُميّز قارئُه تكليفاً
   * قام من تكليفٍ نُسخ فوقه بعد لحظة.
   *
   * **فالتحقّق يسبق كلَّ أثر لا البشرى وحدها:** القيد، وإقفال الاهتمامات،
   * والإشعار. ومن لم يقم تكليفُه لا يترك في المسجد أثراً.
   */
  const settled = await new Parse.Query('ServiceRequests')
    .get(serviceRequest.id, { useMasterKey: true }).catch(() => null);
  const holder = settled
    && (settled.get('assignedContractorId') || settled.get('assignedVolunteerId'));
  if (!holder || holder.id !== worker.id) {
    E.invalid('كُلِّف غيرك بهذا الطلب في هذه اللحظة — حدّث القائمة وأعد المحاولة.');
  }

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

/**
 * سحب التكليف وإعادة الطلب إلى المتاح.
 *
 * كان التكليف طريقاً بلا رجعة: منفّذٌ لا يحضر يترك الطلب معلّقاً في `assigned`
 * بلا أجل، وليس أمام الإمام إلا إلغاء الطلب كلّه — فيسقط سجلّه والحاجة قائمة،
 * ثم يُنشئ طلباً جديداً يبدأ من الصفر. والمنفّذ لا يُقيَّد عليه شيء فيكرّرها.
 *
 * تُفتح للطرفين قصداً: الإمام حين لا يحضر المنفّذ، والمنفّذ حين يتبيّن له أنه
 * لا يستطيع. جعل الانسحاب المُعلن متاحاً وبلا عقوبة هو خير ما يُقلّل التغيّب —
 * إغلاقه لا يجعل المتخلّف يحضر، بل يجعله يصمت.
 */
/** الحالات التي يلتقي فيها الطرفان فعلاً — قبلها لا منفّذ، وبعدها انقضى الأمر. */
const LIVE_ASSIGNMENT = [STATUS.ASSIGNED, STATUS.IN_PROGRESS, STATUS.PENDING_APPROVAL];

/**
 * كلٌّ من طرفَي التكليف يعرف الآخر — اسماً ورقماً.
 *
 * قِيس في متصفّح حقيقي على شاشة الإمام بعد التكليف:
 *
 *     بانتظار المنفّذ | كُلِّف المنفّذ منذ 12 يوماً ولمّا يبدأ بعد. وقد طال
 *     الأمر: **إن كنت على تواصلٍ معه** فانتظاره أولى، وإلا فاسحب التكليف…
 *     | سحب التكليف — لم يحضر
 *
 * ولا اسم على الشاشة ولا رقم. **الصفحة تفترض تواصلاً لم تُعطِه**، وتحتها زرٌّ
 * يُقيِّد على المنفّذ غياباً في `abandonedJobs` يقرؤه كل إمامٍ بعده. فالإمام
 * يحكم على إنسانٍ لا يراه، ثم يُقيَّم عملُه في `avgRating` كذلك.
 *
 * ونظيرها عند المنفّذ: بطاقتُه تحمل اسم المسجد وطريقه، ولا تحمل من يسأل عنه
 * إذا وصل. وهما يتواعدان على عملٍ بأيديهما في مسجد.
 *
 * والهاتف محميّ في المخطط (`protectedFields` على `_User`) فلا يُقرأ باستعلامٍ
 * من العميل — وهذا صواب. فيُعطى هنا **للطرف الآخر وحده، وفي مدّة التكليف
 * وحدها**: لا قبله فلا منفّذ، ولا بعده فقد انقضى ما يُتواصل بشأنه.
 *
 * **وبالجمع لا بالواحد.** كانت تُستدعى لكل بطاقةٍ على حدة، فقِيس في متصفّح
 * حقيقي على متطوّعٍ له ثلاثة تكليفات:
 *
 *     مجموع النداءات لفتح «مهامّي»: 8 — منها getRequestContact ثلاثاً
 *
 * وحدُّ التكليفات ثلاثة، فثلاثة نداءٍ ضائعة في كل زيارة. وباقةُ Back4app
 * المجانية 25 ألف طلبٍ شهرياً: خمسون منفّذاً يفتحون شاشتهم خمس مرّاتٍ يومياً
 * يُنفقون **الباقةَ كلَّها** على هذا وحده. ونظيرُه قِيس من قبل في شارة الوارد
 * وعولج بالطريقة نفسها: **ما يُطلب لقائمةٍ يُطلب مرّةً للقائمة.**
 */
const MAX_CONTACTS = 20;

Parse.Cloud.define('getRequestContacts', async (request) => {
  const user = requireUser(request);
  const ids = request.params.requestIds;
  if (!Array.isArray(ids) || ids.length === 0) E.invalid('معرّفات الطلبات مطلوبة.');
  if (ids.length > MAX_CONTACTS) E.invalid(`لا تتجاوز ${MAX_CONTACTS} طلباً في المرّة.`);

  const requests = await new Parse.Query('ServiceRequests')
    .containedIn('objectId', ids)
    .containedIn('status', LIVE_ASSIGNMENT)
    .include('mosqueId')
    .limit(MAX_CONTACTS)
    .find({ useMasterKey: true });

  /*
   * الحسابات تُجلب دفعةً واحدة: المسجد الواحد له إمامٌ واحد، والمنفّذ قد
   * يكون هو نفسه في أكثر من طلب — فاستعلامٌ لكلٍّ يُعيد الشيء مرّاتٍ.
   */
  const parties = new Map();
  for (const serviceRequest of requests) {
    const worker = serviceRequest.get('assignedVolunteerId')
      || serviceRequest.get('assignedContractorId');
    const mosque = serviceRequest.get('mosqueId');
    const imam = mosque && mosque.get('imamId');
    if (!worker || !imam) continue;
    parties.set(serviceRequest.id, { worker, imam });
  }

  const wanted = new Set();
  for (const { worker, imam } of parties.values()) {
    wanted.add(worker.id);
    wanted.add(imam.id);
  }
  if (wanted.size === 0) return {};

  const people = new Map();
  for (const row of await new Parse.Query(Parse.User)
    .containedIn('objectId', [...wanted]).limit(MAX_CONTACTS * 2)
    .find({ useMasterKey: true })) {
    people.set(row.id, row);
  }

  const out = {};
  for (const [requestId, { worker, imam }] of parties) {
    // الصفة تُقرأ من الكائن المخزَّن لا من الطلب، والهوية تُقارَن بالمعرّف —
    // فمن ليس طرفاً في هذا التكليف لا يقرأ رقم أحد. وما ليس طرفاً فيه
    // **يُسقَط بصمت** لا يُسقِط الدفعة: القائمةُ تُطلب لصفوفٍ بيد صاحبها.
    const isImam = imam.id === user.id;
    const isWorker = worker.id === user.id;
    if (!isImam && !isWorker) continue;

    const other = people.get(isImam ? worker.id : imam.id);
    if (!other) continue;

    out[requestId] = {
      role: other.get('role'),
      // الشركة تُعرف باسمها التجاري لا باسم من سجّلها
      name: other.get('companyName') || other.get('fullName') || null,
      phone: other.get('phone') || null,
    };
  }

  return out;
});

Parse.Cloud.define('releaseAssignment', async (request) => {
  const user = requireRole(request, 'imam', 'volunteer', 'contractor');
  const { requestId, reason } = request.params;
  if (!requestId) E.invalid('معرّف الطلب مطلوب.');

  const serviceRequest = await new Parse.Query('ServiceRequests')
    .get(requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  // بعد `startWork` يصير للمنفّذ جهدٌ مبذول وحقٌّ في المعاينة — كقيد الإلغاء
  if (serviceRequest.get('status') !== STATUS.ASSIGNED) {
    E.invalid('لا يُسحب التكليف إلا قبل بدء التنفيذ.');
  }

  const pointer = serviceRequest.get('assignedVolunteerId')
    || serviceRequest.get('assignedContractorId');
  if (!pointer) E.invalid('لا يوجد منفّذ مكلَّف بهذا الطلب.');

  const byImam = user.get('role') === 'imam';
  const mosque = byImam
    ? await mosqueForImam(user, serviceRequest.get('mosqueId').id)
    : await fetchPointer(serviceRequest.get('mosqueId'), 'Mosques');
  if (!byImam && pointer.id !== user.id) E.forbidden('هذا الطلب غير مُسند إليك.');

  /*
   * الغياب وحده يُقيَّد على المنفّذ؛ الانسحاب المُعلن لا يُعاقَب عليه.
   *
   * **والموقوف لا يُقيَّد عليه غياب:** حسابُه مُنع من الدخول ومن `startWork`
   * بيد الإدارة، فتغيّبُه فعلُ المنصّة لا فعلُه. وقِيس قبل هذا الشرط أن إيقاف
   * متطوّعٍ مكلَّف ينتهي بـ`abandonedJobs = 1` عليه — وسمٌ يبقى بعد إعادة
   * إتاحته ويقرؤه كل إمامٍ بعدها.
   *
   * والقيدُ هنا لا في الواجهة: الإمام لا يعرف حال حساب المنفّذ، ولا ينبغي.
   */
  // استعلامٌ صريح لا `fetchPointer`: تلك تُعيد المؤشّر كما هو إن ظنّته مُحمّلاً،
  // و`isActive` قد لا يكون فيه — فيُقرأ الغياب من حقلٍ لم يُجلب.
  const assignee = await new Parse.Query(Parse.User)
    .get(pointer.id, { useMasterKey: true }).catch(() => null);
  const suspended = Boolean(assignee) && assignee.get('isActive') === false;
  const noShow = byImam && reason === 'no_show' && !suspended;

  // الرجوع إلى ما كان: طلبٌ بتكلفة مرّ بالتمويل، وطلب التطوّع العيني لا مال فيه
  const backTo = (serviceRequest.get('estimatedCost') || 0) > 0
    ? STATUS.FUNDED
    : STATUS.OPEN_FOR_VOLUNTEERS;

  serviceRequest.set('status', backTo);
  serviceRequest.unset('assignedVolunteerId');
  serviceRequest.unset('assignedContractorId');
  serviceRequest.unset('assignedAt');
  // علامةٌ دائمة على الطلب نفسه، تُضاف بـ`addUnique` — عمليةٌ ذرّية لا تُكرّر
  // ما وقع. وهي ما يُشتقّ منه العدّاد، فلا يزيده سحبان متوازيان مرّتين.
  if (noShow) serviceRequest.addUnique('noShowBy', pointer.id);
  await serviceRequest.save(null, { useMasterKey: true });

  /*
   * **والمكلَّف هو المقروء أعلاه — لا يُجلب مرّتين، ولا يُشترط وجودُه.**
   *
   * كان هنا `fetchPointer(pointer, '_User')`، وهي ترمي `101 Object not found`
   * على حسابٍ زال. وموضعُها **بعد `serviceRequest.save`**، فكان الأثر قد وقع
   * والنداء يُبلَّغ ساقطاً. وقِيس على خادمٍ حقيقي بحذف حساب المكلَّف وهو مكلَّف:
   *
   *     [قبل السحب]  الحالة=assigned            · متطوّع=5TT2jSXGRi
   *     releaseAssignment: **سقط** (101) Object not found.
   *     [بعد السحب]  الحالة=open_for_volunteers · متطوّع=لا شيء
   *
   * **عمليةٌ تمّت وأُبلغ عنها بالسقوط.** والإمام يرى رسالةً إنجليزية، فيضغط
   * ثانيةً فيُقال له «لا يُسحب التكليف إلا قبل بدء التنفيذ» (لأن الحالة
   * تغيّرت) — فيظنّ طلبه عالقاً **فيُلغيه**. وهو ما فعلتُه في القياس نفسه.
   *
   * والقاعدة مكتوبة في هذا المستودع: الآثار الجانبية لا تُسقط العملية. وهذا
   * أشدُّ منه: أثرٌ جانبيّ **يقلب نتيجةَ عمليةٍ ثبتت**.
   */
  const worker = assignee;
  if (noShow && worker) await recordAbsences(worker);

  // اهتمام هذا المنفّذ بالذات يُوسم `released` فلا يعود يسجّله على الطلب نفسه.
  // اهتمامات الآخرين تبقى `closed` كما أقفلها التكليف: الطلب عاد مفتوحاً
  // فليسجّلوا من جديد إن شاؤوا، ولا يُحيا اهتمامٌ قد يكون صاحبه انصرف عنه.
  const interest = await new Parse.Query('TaskInterests')
    .equalTo('requestId', serviceRequest)
    .equalTo('volunteerId', pointer)
    .first({ useMasterKey: true });
  if (interest) {
    interest.set('status', 'released');
    await interest.save(null, { useMasterKey: true });
  }

  await audit.record({
    action: audit.ACTIONS.ASSIGNMENT_RELEASED,
    target: serviceRequest,
    mosque,
    actor: user,
    fromStatus: STATUS.ASSIGNED,
    toStatus: backTo,
  });

  // يُبلَّغ الطرف الآخر وحده: من طلب السحب يعلمه
  if (byImam) {
    await pushToUsers(worker, {
      alert: `سُحب تكليفك بـ "${serviceRequest.get('title')}" في مسجد ${mosque.get('name')}.`,
      requestId: serviceRequest.id,
    });
  } else if (mosque.get('imamId')) {
    await pushToUsers(mosque.get('imamId'), {
      alert: `اعتذر المنفّذ عن "${serviceRequest.get('title')}" — الطلب متاح من جديد.`,
      requestId: serviceRequest.id,
    });
  }

  return { status: backTo, noShowRecorded: noShow };
});

/**
 * المنفّذ يبدأ العمل.
 *
 * الاعتماد يُفحص هنا ثانيةً لا في `assignWorker` وحدها: الشرط الذي يُفحص مرّةً
 * عند الدخول ثم يُنسى ليس شرطاً. شركةٌ سُحب اعتمادها بعد تكليفها لا تبدأ عملاً
 * جديداً في مسجد — والطلب يبقى `assigned` فيملك الإمام سحبه.
 *
 * ولا يُمنع `markWorkDone` بالمثل: عملٌ بدأ في المسجد فعلاً، ومنعُ الإبلاغ عنه
 * يترك الطلب معلّقاً بلا صورةٍ ولا ملاحظة ويُضيّع على الإمام معاينة ما أُنجز.
 * **يُمنع الابتداء لا يُقطع الطريق على البيّنة.**
 */
Parse.Cloud.define('startWork', async (request) => {
  const user = requireRole(request, 'volunteer', 'contractor');
  const serviceRequest = await loadAssignedRequest(request.params.requestId, user);

  if (user.get('role') === 'contractor' && !user.get('isVerifiedContractor')) {
    E.forbidden('سُحب اعتماد شركتكم، فلا يُبدأ عملٌ جديد. راسلوا الإدارة.');
  }
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

  // ويعلم الإمام أن العمل بدأ في مسجده — وهو من كان يُعرض عليه «لم يحضر»
  const mosque = await fetchPointer(serviceRequest.get('mosqueId'), 'Mosques');
  const imam = mosque.get('imamId');
  if (imam) {
    await pushToUsers(imam, {
      alert: `بدأ العمل في "${serviceRequest.get('title')}" بمسجد ${mosque.get('name')}.`,
      requestId: serviceRequest.id,
    });
  }

  return serviceRequest.toJSON();
});

/** المنفّذ يبلّغ بانتهاء العمل — لا يُقفل الطلب، بل ينتظر معاينة الإمام. */
Parse.Cloud.define('markWorkDone', async (request) => {
  const user = requireRole(request, 'volunteer', 'contractor');
  const { requestId, notes, photoUrls } = request.params;
  const serviceRequest = await loadAssignedRequest(requestId, user);

  if (serviceRequest.get('status') !== STATUS.IN_PROGRESS) E.invalid('الطلب ليس قيد التنفيذ.');

  // التحقّق قبل أي تعديل: الترتيب المعكوس يترك الكائن بحالة `pending_approval`
  // في الذاكرة رغم رفض الصور — لا يُحفظ لأن `save` لا تُنفَّذ، لكن أي قراءة
  // لاحقة من الكائن نفسه تصدّق حالةً لم تقع.
  const photos = validatePhotos(photoUrls);

  serviceRequest.set('status', STATUS.PENDING_APPROVAL);
  serviceRequest.set('workerNotes', String(notes || '').slice(0, 1000));
  serviceRequest.set('completionPhotos', photos);
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

  await recordWorkerRating(serviceRequest);

  await audit.record({
    action: audit.ACTIONS.REQUEST_COMPLETED,
    target: serviceRequest,
    mosque: serviceRequest.get('mosqueId'),
    actor: imam,
    fromStatus: STATUS.PENDING_APPROVAL,
    toStatus: STATUS.COMPLETED,
  });

  /*
   * ويُخبَر صاحبُ العمل أنّ عملَه اعتُمد.
   *
   * قِيس على خادمٍ حقيقي: وارد المتطوّع بعد الاعتماد **كما هو قبله** — رسالةٌ
   * واحدة هي «تم تكليفك». وفي اللحظة نفسها صارت سمعته `completedJobs=1`
   * و`avgRating=5`. **قُيِّم ولم يُخبَر.**
   *
   * وكلُّ انتقالٍ آخر في دورة الطلب يُبلَّغ به صاحبُه: النشرُ للمتطوّعين،
   * والاهتمامُ للإمام، والتكليفُ للمنفّذ، والسحبُ للطرف الآخر، والإنجازُ
   * للإمام، والإلغاءُ للمنفّذ. **والصمت الوحيد كان على اللحظة التي يُكافأ
   * فيها المتطوّع** — وهي التي يقوم عليها المسار كلُّه في المرحلة الأولى.
   *
   * وكانت «بارك الله فيكم» تُقال في ردّ الدالّة — أي للإمام الذي ضغط الزرّ،
   * لا لمن عمل.
   */
  const worker = serviceRequest.get('assignedVolunteerId')
    || serviceRequest.get('assignedContractorId');
  if (worker) {
    const hours = serviceRequest.get('volunteerHours');
    await pushToUsers(worker, {
      alert: `اعتمد الإمام عملك في "${serviceRequest.get('title')}" — بارك الله فيك.`
        + (hours > 0 ? ` وسُجّلت لك ${hours} ساعة تطوّع.` : ''),
      requestId: serviceRequest.id,
    });
  }

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
 * المنفّذين معطّل فعلياً.
 *
 * **والحساب من الطلبات لا بالزيادة.** كان `increment` وقراءةً‑ثم‑كتابة، وقيل
 * إن اعتمادين متزامنين «نادران وأثرهما تقييم منحرف قليلاً». وقِيس على خادمٍ
 * حقيقي بنداءين متوازيين — وهو ما تفعله ضغطتان على زرٍّ لا يُعطَّل بينهما:
 * **`completedJobs = 2` لعملٍ واحد.** وليس انحرافاً قليلاً: هي السمعة التي
 * يقرؤها الإمام ليختار، والتي حُصّنت للتوّ من أن يكتبها صاحبها.
 *
 * والعلاج ليس حارساً على التزامن — جُرّب `beforeSave` بـ`request.original`
 * فلم يمنع شيئاً: المتوازيان يقرآن الحالة قبل أن يكتب أحدهما. **بل أن يُشتقّ
 * العدد من مصدره:** الطلبات المنجَزة المسنَدة إليه. فاعتمادٌ مرّتين لطلبٍ
 * واحد يعطي واحداً، لأن الطلب واحد.
 *
 * وهو نمط `openRequestsCount` نفسه في `triggers.js`: يُحسب باستعلامٍ لا
 * بعدّادٍ يُزاد — **وما يُشتقّ لا ينحرف، وما ينحرف لا يُصحَّح إلا بيد.**
 * وفوق ذلك **يُصلح ما انحرف قبله**: أوّل اعتمادٍ بعد هذا يُعيد العدّ إلى صوابه.
 */
const RATING_SAMPLE = 1000;

async function recordWorkerRating(serviceRequest) {
  const pointer = serviceRequest.get('assignedContractorId')
    || serviceRequest.get('assignedVolunteerId');
  if (!pointer) return;

  const field = serviceRequest.get('assignedContractorId')
    ? 'assignedContractorId' : 'assignedVolunteerId';
  const completedBy = () => new Parse.Query('ServiceRequests')
    .equalTo(field, pointer)
    .equalTo('status', STATUS.COMPLETED);

  // العدد بالعدّ لا بالجلب: لا سقف عليه
  const done = await completedBy().count({ useMasterKey: true });

  // والمتوسط على آخر ألف — سقفٌ معلَنٌ خيرٌ من جلبٍ بلا حدّ
  const rated = await completedBy()
    .select('imamRating').descending('createdAt').limit(RATING_SAMPLE)
    .find({ useMasterKey: true });
  const scores = rated.map((row) => row.get('imamRating'))
    .filter((value) => typeof value === 'number');

  /*
   * **وحسابٌ زال لا سمعة له تُكتب.**
   *
   * هذه تُنادى من `completeService` **بعد** حفظ الطلب منجَزاً، وكانت
   * `fetchPointer` ترمي `101` على حسابٍ محذوف — فيُعتمد العملُ في القاعدة
   * ويُقال للإمام إن اعتماده سقط. وهي علّةُ `releaseAssignment` نفسها في موضعٍ
   * آخر: **بحثٌ عن حسابٍ بعد أن ثبت الأثر، يقلب نتيجةَ ما تمّ.**
   *
   * والصمت هنا هو الصواب لا الستر: `completedJobs` و`avgRating` بيّنةٌ يقرؤها
   * إمامٌ يختار منفّذاً، ولا أحد يختار من لا حساب له.
   */
  const worker = await fetchPointer(pointer, '_User').catch(() => null);
  if (!worker) return;

  worker.set('completedJobs', done);
  if (scores.length) {
    worker.set('avgRating', scores.reduce((sum, value) => sum + value, 0) / scores.length);
  } else {
    worker.unset('avgRating');
  }
  await worker.save(null, { useMasterKey: true });
}

/**
 * مرّات التغيّب — تُشتقّ من الطلبات لا تُزاد بـ`increment`.
 *
 * **قِيس على خادمٍ حقيقي بسحبين متوازيين** — وهو ما تفعله ضغطتان على «سحب
 * التكليف — لم يحضر»: `abandonedJobs = 2` لسحبٍ واحد.
 *
 * وهذا العدّاد يُقرأ في موضعٍ واحد: بطاقةُ المهتمّ التي يختار الإمام على
 * أساسها («تغيّب عن 3 تكليفات سابقة»). **فضغطةٌ زائدة تَسِم متطوّعاً بغيابٍ
 * لم يقع، ويراه كلُّ إمامٍ بعده.** وهو أذىً لإنسانٍ بعينه لا خطأ عدٍّ.
 *
 * وقد اشتُقّ `completedJobs` و`avgRating` من قبل وتُرك هذا على `increment` —
 * **والإصلاح الجزئي يُخفي البقيّة لأنه يُطمئن.**
 *
 * والاشتقاق من `noShowBy` على الطلب: `addUnique` ذرّيّة، فالسحبان يكتبان
 * معرّفاً واحداً. **وما يُشتقّ لا ينحرف، ويُصلح ما انحرف قبله.**
 */
async function recordAbsences(worker) {
  const absences = await new Parse.Query('ServiceRequests')
    .containsAll('noShowBy', [worker.id])
    .count({ useMasterKey: true });

  worker.set('abandonedJobs', absences);
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
