/**
 * الطبقة الوحيدة التي تلمس Parse.
 *
 * قاعدة المستودع: كل كتابة تمرّ بدوال السحابة. لذلك لا `save()` هنا على أي فئة
 * — القراءات المسموحة (`ServiceRequests`) وحدها استعلامات مباشرة، وما عداها
 * `Parse.Cloud.run`. ولا وجود لـ Master Key في هذا الملف ولا في أي كود عميل.
 */

import Parse from 'parse/dist/parse.min.js';

const APP_ID = import.meta.env.VITE_PARSE_APP_ID || 'masjidi-live';
const JS_KEY = import.meta.env.VITE_PARSE_JS_KEY || 'js-live';
const SERVER_URL = import.meta.env.VITE_PARSE_SERVER_URL || 'http://127.0.0.1:41337/parse';

Parse.initialize(APP_ID, JS_KEY);
Parse.serverURL = SERVER_URL;

export const ROLES = {
  imam: 'إمام مسجد',
  volunteer: 'متطوّع',
  donor: 'متبرّع',
  contractor: 'شركة خدمات',
};

export const STATUS_LABEL = {
  pending_funding: 'بانتظار التمويل',
  open_for_volunteers: 'مفتوح للتطوّع',
  funded: 'مموّل',
  assigned: 'مُسنَد',
  in_progress: 'قيد التنفيذ',
  pending_imam_approval: 'بانتظار اعتماد الإمام',
  completed: 'منجَز',
  cancelled: 'ملغى',
};

/**
 * محافظات السلطنة كما ترد في بيانات الوزارة.
 *
 * تُعرض للتصفية لأن أسماء المساجد تتكرّر كثيراً على مستوى السلطنة: «مصلى
 * العيدين» وحده اسمٌ لـ369 مسجداً. بلا تصفية يرى الإمام مئة نتيجة متطابقة.
 */
export const GOVERNORATES = [
  'مسقط', 'ظفار', 'مسندم', 'البريمي', 'الداخلية', 'شمال الباطنة',
  'جنوب الباطنة', 'شمال الشرقية', 'جنوب الشرقية', 'الظاهرة', 'الوسطى',
];

/**
 * سجلّ المسجد كما يُقرأ.
 *
 * الشفافية هي غاية المنصّة المعلنة، وسجلّ التدقيق هو أداتها — ويُعيده الخادم
 * بأفعالٍ برمجية (`worker_assigned`) لا يفهمها أحد. والفاعل يُذكر بصفته لا
 * باسمه قصداً: المصلّي يرى ماذا جرى لمسجده، لا من فعله.
 */
export const AUDIT_LABEL = {
  request_created: 'طلب صيانة جديد',
  interest_expressed: 'سجّل متطوّع اهتمامه',
  interest_withdrawn: 'سحب متطوّع اهتمامه',
  worker_assigned: 'كُلّف منفّذ بالعمل',
  assignment_released: 'سُحب التكليف وعاد الطلب متاحاً',
  work_started: 'بدأ العمل',
  work_done: 'أُبلغ بإنجاز العمل',
  request_completed: 'اعتمد الإمام العمل',
  location_learned: 'سُجّل موقع المسجد على الخريطة',
  location_corrected: 'صوّب إمام المسجد موقعه على الخريطة',
  request_cancelled: 'أُلغي الطلب',
  claim_reviewed: 'روجعت ملكية المسجد',
  mosque_transferred: 'نُقلت إمامة المسجد',
  contractor_reviewed: 'روجع اعتماد شركة',
  contractor_suspended: 'سُحب اعتماد الشركة المكلَّفة بالعمل',
  donation_captured: 'قُيّد تبرّع',
  donation_expired: 'انتهت مهلة تبرّع',
  donation_refunded: 'استُرد تبرّع',
  payout_recorded: 'صُرفت مستحقات',
};

export const ACTOR_LABEL = {
  imam: 'الإمام', volunteer: 'متطوّع', contractor: 'شركة',
  donor: 'متبرّع', admin: 'الإدارة',
};

export const CATEGORIES = {
  electrical: 'كهرباء',
  plumbing: 'سباكة',
  ac: 'تكييف',
  paint: 'دهان',
  cleaning: 'نظافة',
  carpet: 'سجاد',
  other: 'أخرى',
};

/**
 * الجلسة انتهت أو أُبطلت — حدثٌ يلتقطه `App` فيعيد المستخدم إلى الدخول.
 *
 * `Parse.User.current()` يقرأ من تخزين المتصفّح، فيبقى «مسجَّلاً» بعد أن يرفض
 * الخادمُ رمزَه: تنتهي الصلاحية، أو تُبطَل الجلسة، أو تُستبدل القاعدة عند نشر.
 * وحينها يرى المستخدم شاشاتٍ كاملةً تفشل واحدةً واحدة برسالةٍ لا مخرج منها،
 * ولا سبيل له إلا مسح بيانات المتصفّح. فيُقطع ذلك من موضعٍ واحد.
 */
export const SESSION_EXPIRED = 'masjidi:session-expired';

/**
 * كل خطأ يمرّ من هنا.
 *
 * والكود 209 يرسله الخادم في حالتين: رمزٌ لا يعرفه Parse، وحارسُنا
 * `requireUser` حين لا جلسة. وكلتاهما تعني الشيء نفسه عملياً — العميل يظنّ
 * نفسه داخلاً والخادم لا يعرفه — فالعلاج واحد.
 */
async function handle(error) {
  if (error && error.code === Parse.Error.INVALID_SESSION_TOKEN) {
    // الخروج قد يفشل هو نفسه برمزٍ باطل، فلا يُنتظر نجاحُه
    await Parse.User.logOut().catch(() => {});
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_EXPIRED));
  }
  throw error;
}

const run = (name, params) => Parse.Cloud.run(name, params).catch(handle);

/* ————— الجلسة ————— */

export const currentRole = () => {
  const me = Parse.User.current();
  return me ? me.get('role') : null;
};

export const currentUser = () => Parse.User.current();

export async function signUp({
  username, password, fullName, phone, role, companyName, crNumber, skills, governorate,
}) {
  const user = new Parse.User();
  user.set('username', username.trim());
  user.set('password', password);
  user.set('role', role);
  if (fullName) user.set('fullName', fullName.trim());
  if (phone) user.set('phone', phone.trim());
  // الشركة تُعتمد بسجلّها التجاري: بدونه يرى المشرف «غير مُدخَل» ولا يملك ما
  // يتحقّق منه، فتبقى الشركة معلّقة بلا سبب معروف لها ولا له
  if (role === 'contractor') {
    if (companyName) user.set('companyName', companyName.trim());
    if (crNumber) user.set('crNumber', crNumber.trim());
  }
  // المهارات والمحافظة تُقرآن في اختيار الإمام وفي الإشعار القريب، فجمعُهما
  // عند التسجيل يجنّب متطوّعاً يظهر أبداً بـ«مهارات: غير محدّدة»
  if (role === 'volunteer' && skills && skills.length) user.set('skills', skills);
  if (governorate) user.set('governorate', governorate);
  await user.signUp();
  return user;
}

export const logIn = (username, password) => Parse.User.logIn(username.trim(), password);
export const logOut = () => Parse.User.logOut();

/* ————— المساجد ————— */

export const nearbyMosques = (lat, lng, radius = 5) =>
  run('getNearbyMosques', { lat, lng, radius });

export const nearbyOpportunities = (lat, lng, radius = 15) =>
  run('getNearbyOpportunities', { lat, lng, radius });

export const updateMyLocation = (lat, lng) => run('updateMyLocation', { lat, lng });

/**
 * البحث عن مسجد — ومعه موقع الباحث إن أذن به.
 *
 * الموقع هو ما يربط المصلّي بمسجده: أسماء المساجد تتكرّر بالمئات، ومن يبحث عن
 * مسجده واقفٌ فيه أو قريبٌ منه. فالأقرب أوّلاً، ومن رفض المشاركة يرى الترتيب
 * الطبيعي كما كان.
 */
export const searchMosques = (term, governorate, point) =>
  run('searchMosques', {
    term,
    governorate,
    limit: 30,
    lat: point ? point.lat : undefined,
    lng: point ? point.lng : undefined,
  });

/** صفة مقدّم طلب الملكية — الوكيل يتولّى شؤون المسجد كالإمام في كثير منها. */
export const CAPACITIES = { imam: 'إمام المسجد', agent: 'وكيل المسجد' };

/**
 * طلب ملكية مسجد — ومعه تأكيد الموقع.
 *
 * من يدّعي مسجداً يُتوقّع أن يكون فيه. الموقع ليس دليلاً قاطعاً لكنه أقوى ما
 * يملكه المشرف قبل التكامل مع الوزارة، والخادم يرفض الطلب بلا موقعٍ حين يكون
 * للمسجد إحداثيات يُقاس إليها.
 */
export const claimMosque = (mosqueId, evidenceNote, capacity, point) =>
  run('claimMosque', {
    mosqueId,
    evidenceNote,
    capacity,
    lat: point ? point.lat : undefined,
    lng: point ? point.lng : undefined,
  });

export const getMyMosques = () => run('getMyMosques');

/**
 * تثبيت موقع مسجدٍ مجهول الموقع — الإمام وهو عنده.
 *
 * أربعمئة مسجدٍ وأربعة عشر سُحبت ثقتنا من إحداثياتها لأنها كاذبة في المصدر،
 * فبلا هذا الطريق يبقى المسجد خارج البحث بالقرب ما لم يُعَد تسجيله.
 */
export const confirmMosqueLocation = (mosqueId, point) =>
  run('confirmMosqueLocation', { mosqueId, lat: point.lat, lng: point.lng });
export const getMyClaims = () => run('getMyClaims');

export const getMosqueAuditTrail = (mosqueId) => run('getMosqueAuditTrail', { mosqueId });

/* ————— الطلبات ————— */

/** `ServiceRequests` مقروءة للمصادَقين، فالقراءة استعلام مباشر لا دالة سحابة. */
async function listRequests(build) {
  const query = new Parse.Query('ServiceRequests');
  query.include('mosqueId');
  query.descending('createdAt');
  query.limit(50);
  build(query);

  const rows = await query.find().catch(handle);
  return rows.map((row) => {
    const mosque = row.get('mosqueId');
    return {
      id: row.id,
      title: row.get('title'),
      description: row.get('description'),
      category: row.get('category'),
      urgency: row.get('urgency'),
      status: row.get('status'),
      estimatedCost: row.get('estimatedCost'),
      workerNotes: row.get('workerNotes'),
      completionPhotos: row.get('completionPhotos') || [],
      createdAt: row.get('createdAt'),
      // متى كُلِّف ومتى بدأ. كانا يُكتبان على الخادم ولا يُقرآن في أي موضع،
      // فطلبٌ مكلَّفٌ منذ يومٍ وآخرُ منذ ثلاثة أشهر يظهران للإمام سواءً — وهو
      // يقرّر بينهما سحبَ تكليفٍ يُقيَّد غياباً على المنفّذ.
      assignedAt: row.get('assignedAt') || null,
      startedAt: row.get('startedAt') || null,
      mosqueId: mosque ? mosque.id : null,
      mosqueName: mosque ? mosque.get('name') : null,
      wilayat: mosque ? mosque.get('wilayat') : null,
      // القرية والإحداثيات: أسماء المساجد تتكرّر بالمئات على مستوى السلطنة،
      // والمنفّذ يحتاج أن يصل إلى المسجد لا أن يعرف اسمه
      village: mosque ? mosque.get('village') : null,
      mosqueLat: mosque ? mosque.get('lat') : null,
      mosqueLng: mosque ? mosque.get('lng') : null,
      // مصدرُ الموقع يصل مع الطلب: المنفّذ هو من يقود إلى هناك، ومن يُساق إلى
      // نقطةٍ مُخمَّنة بلا أن يُقال له يتّهم المنصّة لا الخريطة
      mosqueLocationSource: mosque ? mosque.get('locationSource') || null : null,
    };
  });
}

export const openOpportunities = () =>
  listRequests((query) => query.equalTo('status', 'open_for_volunteers'));

export const requestsForMosque = (mosqueId) =>
  listRequests((query) => {
    const mosque = new Parse.Object('Mosques');
    mosque.id = mosqueId;
    query.equalTo('mosqueId', mosque);
  });

/**
 * الأعمال المُسنَدة إليّ.
 *
 * المتطوّع والشركة لا يشتركان في حقلٍ واحد على الخادم، فكان الاستعلام على
 * `assignedVolunteerId` وحده يعني أن شركةً مكلَّفة لا ترى تكليفها أبداً — بينما
 * الخادم يقبل إسنادها ويقبل منها `startWork` و`markWorkDone`. الدور ثابت بعد
 * التسجيل، فالحقل يُشتقّ منه كما يفعل `assignmentField` في دوال السحابة.
 */
export const assignedToMe = () => {
  const me = Parse.User.current();
  const field = me && me.get('role') === 'contractor'
    ? 'assignedContractorId'
    : 'assignedVolunteerId';
  return listRequests((query) => query.equalTo(field, me));
};

export const createServiceRequest = (payload) => run('createServiceRequest', payload);
export const cancelServiceRequest = (requestId) => run('cancelServiceRequest', { requestId });

/* ————— التطوّع ————— */

export const expressInterest = (requestId, note) => run('expressInterest', { requestId, note });
export const withdrawInterest = (requestId) => run('withdrawInterest', { requestId });
export const getMyInterests = () => run('getMyInterests');
export const getRequestInterests = (requestId) => run('getRequestInterests', { requestId });
export const assignWorker = (requestId, workerId) => run('assignWorker', { requestId, workerId });
export const releaseAssignment = (requestId, reason) => run('releaseAssignment', { requestId, reason });
export const startWork = (requestId) => run('startWork', { requestId });
export const markWorkDone = (requestId, notes, photoUrls) =>
  run('markWorkDone', { requestId, notes, photoUrls });

/**
 * رفع صورة إنجاز.
 *
 * `Parse.File` يرفع إلى تخزين المشروع ويعيد رابطاً؛ والخادم لا يقبل إلا روابط
 * هذا التخزين، فلا يُحشر في السجل رابط خارجي. الرفع يتطلّب تفعيل
 * `fileUpload.enableForAuthenticatedUser` على الخادم.
 */
export async function uploadPhoto(file) {
  const safeName = `work-${Date.now()}.${(file.name.split('.').pop() || 'jpg').toLowerCase()}`;
  const stored = await new Parse.File(safeName, file).save();
  return stored.url();
}
export const completeService = (requestId, rating, volunteerHours) =>
  run('completeService', { requestId, rating, volunteerHours });

/* ————— الحساب ————— */

export const getMyNotifications = (limit) => run('getMyNotifications', { limit });
export const markNotificationsRead = (ids) => run('markNotificationsRead', { ids });

export const getMyProfile = () => run('getMyProfile');
export const updateMyProfile = (patch) => run('updateMyProfile', patch);
export const setFavoriteMosque = (mosqueId) => run('setFavoriteMosque', { mosqueId });

/**
 * موقع الجهاز.
 *
 * يُرفض بلا HTTPS (عدا localhost) وقد يرفضه المستخدم — والحالتان متوقّعتان، فلا
 * تُعامَلان كخطأ في النظام بل تُشرحان له.
 */
export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('جهازك لا يدعم تحديد الموقع.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }),
      (error) => reject(new Error(
        error.code === 1 ? 'لم تُسمح للتطبيق بمعرفة موقعك — فعّل الإذن لترى ما حولك.'
          : 'تعذّر تحديد موقعك، حاول في مكان مكشوف.',
      )),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}

/** «٤٥٠ متراً» أوضح من «0.45 كم». */
export const formatDistance = (km) =>
  (km < 1 ? `${Math.round(km * 1000)} متراً` : `${km.toFixed(1)} كم`);

/** رابط خرائط يفتح بتطبيق الجهاز — بلا تضمين خرائط خارجية في الصفحة. */
export const mapsLink = (lat, lng, label) =>
  `https://www.google.com/maps/search/?api=1&query=${lat},${lng}${label ? `&query_place_id=${encodeURIComponent(label)}` : ''}`;

/* ————— الإدارة ————— */

export const listPendingContractors = () => run('listPendingContractors');
export const reviewContractor = (contractorId, approve) =>
  run('reviewContractor', { contractorId, approve });
export const listPendingClaims = () => run('listPendingClaims');
export const reviewMosqueClaim = (claimId, approve) =>
  run('reviewMosqueClaim', { claimId, approve });

/** رسالة الخطأ العربية القادمة من `lib/errors.js`، لا نصّ Parse الإنجليزي. */
/**
 * رسائل Parse نفسه — إنجليزية، وتظهر في واجهةٍ عربية.
 *
 * دوالُّ السحابة عندنا تتكلّم العربية دائماً (`lib/errors.js`)، وParse يتكلّم
 * الإنجليزية دائماً. فالفصل بينهما بالحرف لا بالكود: كودٌ واحد قد يأتي من
 * الطرفين (209 من الخادم ومن حارسنا، و101 من تسجيل دخولٍ خاطئ ومن `notFound`).
 */
/**
 * الرسائل في `errors.js` — ملفٌّ بلا استيرادات ليُختبر خارج المتصفّح.
 *
 * وقِيس هناك ما كان يقع: كودٌ لا ترجمة له يُعرض بنصّ Parse الإنجليزي —
 * ورفعُ الصور إلى خادمٍ لم يُفعَّل فيه الرفع يردّ `130` بالإنجليزية.
 */
export { messageOf, PARSE_MESSAGES } from './errors';
