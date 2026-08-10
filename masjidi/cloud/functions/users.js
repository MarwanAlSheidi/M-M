const E = require('../lib/errors');
const { requireUser, requireRole, TEXT_LIMITS } = require('../lib/auth');
const { pushToUsers } = require('../lib/push');
const { warnImamsOfWorkerLoss } = require('../lib/worker');
const audit = require('../lib/audit');
const geo = require('../lib/geo');

/**
 * شؤون الحسابات: اعتماد الشركات، والملف الشخصي.
 *
 * اعتماد الشركة كان بلا مسار أصلاً: جدول الأدوار يقول إن المشرف «يعتمد
 * الشركات»، و`beforeSave` يحظر تعديل `isVerifiedContractor` إلا بـ Master Key —
 * فلم يكن أمام المشرف إلا تعديل السجل يدوياً من لوحة التحكم، بلا أثر في السجل.
 */

/** الشركات المنتظرة اعتماداً — مشرف فقط. */
Parse.Cloud.define('listPendingContractors', async (request) => {
  requireRole(request, 'admin');

  const contractors = await new Parse.Query(Parse.User)
    .equalTo('role', 'contractor')
    .equalTo('isVerifiedContractor', false)
    .ascending('createdAt')
    .limit(100)
    .find({ useMasterKey: true });

  return contractors.map((contractor) => ({
    id: contractor.id,
    fullName: contractor.get('fullName'),
    companyName: contractor.get('companyName'),
    crNumber: contractor.get('crNumber'), // السجل التجاري — أساس الاعتماد
    phone: contractor.get('phone'),
    createdAt: contractor.get('createdAt'),
    // مسحوبةُ الاعتماد تعود إلى هذا الطابور، فتُشبه من لم يُراجَع قطّ.
    // والمشرف قد يعتمد اليوم من سحب اعتماده أمسِ وهو لا يدري.
    previouslyReviewed: Boolean(contractor.get('contractorReviewedAt')),
    reviewedAt: contractor.get('contractorReviewedAt') || null,
  }));
});

/**
 * حال اعتماد الشركة: `verified` أو `pending` أو `revoked` — و`null` لغيرها.
 *
 * `isVerifiedContractor` وحدها لا تفرّق بين من لم يُراجَع بعدُ ومن رُوجع فسُحب
 * اعتماده، وكلاهما `false`. فكان يُقال للثاني «حسابكم بانتظار اعتماد الإدارة»
 * وهو انتظارٌ لا يأتي: قرارُه صدر، وليس عليه إلا مراسلة الإدارة.
 */
function contractorStatusOf(user) {
  if (user.get('role') !== 'contractor') return null;
  if (user.get('isVerifiedContractor')) return 'verified';
  return user.get('contractorReviewedAt') ? 'revoked' : 'pending';
}

/**
 * إبلاغ أئمّة المساجد التي عند الشركة فيها عملٌ قائم.
 *
 * سحبُ الاعتماد كان يقع في صمت: يُبلَّغ به المسحوب منه وحده، ويبقى إمامُ
 * المسجد — وهو من يتحمّل نتيجة عملٍ يجري في مسجده — لا يعلم. والمشرف يظنّ
 * أنه أوقف شيئاً ولا يُعاد إليه ما أوقف.
 *
 * والمنطق مشترَكٌ مع إيقاف الحساب في `lib/worker.js`: خروجُ المنفّذ من
 * الميدان بابان، ومن كتب البلاغ عند أحدهما تركه مفتوحاً عند الآخر.
 */
const warnImamsOfSuspension = (contractor, admin) => warnImamsOfWorkerLoss(contractor, {
  action: audit.ACTIONS.CONTRACTOR_SUSPENDED,
  actor: admin,
  alert: (name, serviceRequest, mosque) =>
    `سُحب اعتماد ${name} المكلَّفة بـ "${serviceRequest.get('title')}" `
    + `في ${mosque.get('name')}. عاين العمل، ولك سحب التكليف إن لم يبدأ.`,
});

/** اعتماد شركة أو سحب اعتمادها — مشرف فقط. */
Parse.Cloud.define('reviewContractor', async (request) => {
  const admin = requireRole(request, 'admin');
  const { contractorId, approve } = request.params;
  if (!contractorId) E.invalid('معرّف الشركة مطلوب.');

  const contractor = await new Parse.Query(Parse.User)
    .get(contractorId, { useMasterKey: true })
    .catch(() => E.notFound('المستخدم غير موجود.'));

  if (contractor.get('role') !== 'contractor') E.invalid('هذا المستخدم ليس شركة خدمات.');

  const verified = Boolean(approve);
  if (verified && !contractor.get('crNumber')) {
    E.invalid('لا يُعتمد مزوّد بلا رقم سجل تجاري.');
  }

  contractor.set('isVerifiedContractor', verified);
  // يميّز المسحوب اعتمادُه ممّن لم يُراجَع بعد — وهما في `isVerifiedContractor`
  // سواء. وبلا هذا التمييز يُقال للأوّل «بانتظار اعتماد الإدارة» وهو خبرٌ
  // غير صحيح، ويعود إلى طابور المنتظرين كأنه لم يُراجَع قطّ.
  contractor.set('contractorReviewedAt', new Date());
  await contractor.save(null, { useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.CONTRACTOR_REVIEWED,
    target: contractor,
    actor: admin,
    toStatus: verified ? 'verified' : 'unverified',
  });

  const affectedRequests = verified ? 0 : await warnImamsOfSuspension(contractor, admin);

  await pushToUsers(contractor, {
    alert: verified ? 'تم اعتماد شركتكم في منصة مسجدي.' : 'أُوقف اعتماد شركتكم مؤقتاً.',
  });

  // يُعاد إلى المشرف ما ترتّب على فعله: سحبٌ يمسّ ثلاثة أعمالٍ قائمة ليس
  // كسحبٍ لا يمسّ شيئاً، ولا يعرف الفرقَ إلا إن قيل له
  return { isVerifiedContractor: verified, affectedRequests };
});

/**
 * ضبط المسجد المفضّل — نقطة الدخول الافتراضية في التطبيق.
 * تمرّ بدالة سحابة لا بكتابة مباشرة، للتحقق من وجود المسجد قبل ربط المؤشّر.
 */
Parse.Cloud.define('setFavoriteMosque', async (request) => {
  const user = requireUser(request);
  const { mosqueId } = request.params;

  if (!mosqueId) {
    user.unset('favoriteMosqueId');
    await user.save(null, { useMasterKey: true });
    return { favoriteMosqueId: null };
  }

  const mosque = await new Parse.Query('Mosques')
    .get(String(mosqueId), { useMasterKey: true })
    .catch(() => E.notFound('المسجد غير موجود.'));

  user.set('favoriteMosqueId', mosque);
  await user.save(null, { useMasterKey: true });

  return { favoriteMosqueId: mosque.id, mosqueName: mosque.get('name') };
});

/**
 * تحديث آخر موقع معروف للمستخدم.
 *
 * عليه يقوم إشعار «فرصة تطوّع قريبة»: بلا موقع محفوظ لا يصل المتطوّع خبرٌ إلا
 * إن فتح التطبيق. يُكتب الحقلان الرقميان معاً لأن البحث بالقرب يعمل عليهما.
 */
Parse.Cloud.define('updateMyLocation', async (request) => {
  const user = requireUser(request);
  const { lat, lng } = request.params;

  if (!geo.validCoordinates(lat, lng)) E.invalid('الإحداثيات مطلوبة كأرقام صحيحة.');

  user.set('lastKnownLocation', new Parse.GeoPoint({ latitude: lat, longitude: lng }));
  user.set('lastLat', lat);
  user.set('lastLng', lng);
  await user.save(null, { useMasterKey: true });

  return { lat, lng };
});

/** ملف المستخدم كما يعرضه التطبيق. */
/**
 * مهارات المتطوّع — من فئات الأعمال نفسها.
 *
 * تُطابق `category` في طلبات الصيانة قصداً: الإمام ينشر طلباً كهربائياً فيرى في
 * المهتمّين من كتب «كهرباء». قائمةٌ مغلقة لا نصٌّ حرّ، وإلا صار «كهربائي»
 * و«كهرباء» و«كهربا» ثلاثة أشياء لا يجمعها بحث.
 */
const SKILLS = ['electrical', 'plumbing', 'ac', 'paint', 'cleaning', 'carpet', 'other'];

const GOVERNORATES = [
  'مسقط', 'ظفار', 'مسندم', 'البريمي', 'الداخلية', 'شمال الباطنة',
  'جنوب الباطنة', 'شمال الشرقية', 'جنوب الشرقية', 'الظاهرة', 'الوسطى',
];

/**
 * تحديث بيانات الحساب — لصاحبه وحده.
 *
 * `skills` و`governorate` كانا يُقرآن ولا يُكتبان قطّ: الإمام يرى «مهارات: غير
 * محدّدة» لكل متطوّع فيختار بلا بيّنة، وخطةُ الإشعار البديلة في `push.js` تُطابق
 * المتطوّعين بالمحافظة فلا تُطابق أحداً. لا يقبل `role` ولا حقول الاعتماد —
 * تلك للإدارة عبر مسارها.
 */
Parse.Cloud.define('updateMyProfile', async (request) => {
  const user = requireUser(request);
  const { fullName, phone, skills, governorate, wilayat } = request.params;

  // الأطوال من `TEXT_LIMITS` لا مكتوبةً هنا: `beforeSave` يقصّ بها كذلك،
  // ورقمان في موضعين يفترقان بلا أن يُلحَظ
  if (fullName !== undefined) user.set('fullName', String(fullName).trim().slice(0, TEXT_LIMITS.fullName));
  if (phone !== undefined) user.set('phone', String(phone).trim().slice(0, TEXT_LIMITS.phone));
  if (wilayat !== undefined) user.set('wilayat', String(wilayat).trim().slice(0, TEXT_LIMITS.wilayat));

  if (skills !== undefined) {
    if (!Array.isArray(skills)) E.invalid('المهارات تُرسل كقائمة.');
    // التحقّق قبل طيّ التكرار: مقارنة الطولين بعده تعدّ المكرّر مجهولاً
    const asked = skills.map(String);
    const unknown = asked.find((skill) => !SKILLS.includes(skill));
    if (unknown) E.invalid(`مهارة غير معروفة: ${unknown}`);
    user.set('skills', [...new Set(asked)]);
  }

  if (governorate !== undefined) {
    if (governorate && !GOVERNORATES.includes(governorate)) E.invalid('محافظة غير معروفة.');
    user.set('governorate', governorate || undefined);
  }

  await user.save(null, { useMasterKey: true });
  return { updated: true };
});

Parse.Cloud.define('getMyProfile', async (request) => {
  const user = requireUser(request);
  await user.fetch({ useMasterKey: true });

  const favorite = user.get('favoriteMosqueId');
  let favoriteName = null;
  if (favorite) {
    const loaded = await favorite.fetch({ useMasterKey: true }).catch(() => null);
    favoriteName = loaded ? loaded.get('name') : null;
  }

  return {
    id: user.id,
    role: user.get('role'),
    fullName: user.get('fullName'),
    phone: user.get('phone'),
    skills: user.get('skills') || [],
    governorate: user.get('governorate'),
    wilayat: user.get('wilayat'),
    companyName: user.get('companyName'),
    crNumber: user.get('crNumber'),
    isVerifiedContractor: Boolean(user.get('isVerifiedContractor')),
    // ثلاث حالاتٍ لا اثنتان: معتمدة، ولم تُراجَع بعد، وسُحب اعتمادها.
    // والحساب يُشتقّ هنا لا في الواجهة — الشرط واحدٌ فليكن في موضعٍ واحد.
    contractorStatus: contractorStatusOf(user),
    completedJobs: user.get('completedJobs') || 0,
    avgRating: user.get('avgRating'),
    favoriteMosqueId: favorite ? favorite.id : null,
    favoriteMosqueName: favoriteName,
  };
});
