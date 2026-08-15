const E = require('../lib/errors');
const { requireUser, requireRole, TEXT_LIMITS } = require('../lib/auth');
const { pushToUsers } = require('../lib/push');
const { mosqueTitle } = require('../lib/mosque-name');
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
 * الشركات المعتمدة — لعينِ الإمام وحده، ليختار منها منفّذاً.
 *
 * **العطب الذي تسدّه: مسارُ الشركات كان مبنيّاً كاملاً ولا مدخل له.** قِيس في
 * متصفّح حقيقي على إمامٍ عنده احتياجٌ مفتوح وفي القاعدة شركةٌ معتمدة:
 *
 *     شاشة الطلب: «المتطوّعون المهتمّون · لم يسجّل أحد اهتمامه بعد.»
 *     الأزرار:    ["→ رجوع", "إلغاء الطلب"]
 *     ذكرٌ لشركة: **لا**
 *
 * والخادم يقبل التكليف لو بلغه المعرّف — قِيس أيضاً: شركةٌ معتمدة كُلّفت على
 * طلبٍ تكلفتُه صفر **فنجح** وصار `assigned`. فالطريق سالكٌ من طرفيه ومقطوعٌ
 * في وسطه: `expressInterest` **للمتطوّعين وحدهم** (والشركة لا تُبدي اهتماماً
 * قصداً — الإمام يختارها)، وزرُّ التكليف الوحيد في الشاشة يقرأ معرّفه من قائمة
 * المهتمّين. **فلا دالّة في المستودع كلِّه تُعطي الإمامَ معرّفَ شركة.**
 *
 * وعلى ذلك يتعلّق كلُّ ما بُني للشركات: التسجيل بالسجل التجاري، وطابور
 * الاعتماد عند المشرف، و`isVerifiedContractor`، و`assignedContractorId`،
 * وتبويب «مهامّي» عندها، و`startWork` و`markWorkDone` — **كلُّه خلف خطوةٍ
 * واحدة غائبة.** وشركةٌ تُسجَّل وتُعتمد ثم لا يبلغها عملٌ أبداً تنصرف.
 *
 * **ولا هاتفَ هنا ولا سجلٌّ تجاري.** الهاتف يصل بعد التكليف عبر
 * `getRequestContacts` — مقصوراً على طرفَي العمل وعلى مدّته؛ والسجلّ التجاري
 * أساسُ الاعتماد عند المشرف لا عند الإمام، وهو محجوبٌ في `protectedFields`.
 * فما يُعطى الإمامُ هو ما يُبنى عليه الاختيار: الاسم، وما أنجزت، وما تغيّبت
 * عنه، وأين هي.
 *
 * **ولا تُحصر في محافظة المسجد.** الشركات قليلة والسلطنة صغيرة، وحصرٌ على حقلٍ
 * قد يكون فارغاً يُفرغ القائمة كلَّها فيبدو أن لا شركة معتمدة — وذلك أسوأ من
 * قائمةٍ فيها بعيدٌ يُرى بُعدُه. فتُعرض المحافظة ويبقى الحكم للإمام.
 */
Parse.Cloud.define('listApprovedContractors', async (request) => {
  requireRole(request, 'imam');

  const contractors = await new Parse.Query(Parse.User)
    .equalTo('role', 'contractor')
    .equalTo('isVerifiedContractor', true)
    // الموقوف لا يُعرض ولو كان معتمداً — والشرط `=== false` معناه هنا
    // «غير موقوف»، فيمرّ من لا قيمة له كما يمرّ من قيمتُه `true`
    .notEqualTo('isActive', false)
    .descending('completedJobs')
    // ترتيبٌ ثانٍ فريد: المتساوون في الإنجاز — وأوّلُ يومٍ كلُّهم أصفار
    .addAscending('objectId')
    .limit(50)
    .find({ useMasterKey: true });

  return contractors.map((contractor) => ({
    id: contractor.id,
    fullName: contractor.get('fullName'),
    companyName: contractor.get('companyName') || null,
    governorate: contractor.get('governorate') || null,
    completedJobs: contractor.get('completedJobs') || 0,
    // `noShowBy` على **الطلب** لا على الحساب؛ والمحسوب منه يُخزَّن هنا
    // (`requests.js` يشتقّه ويكتبه). وقراءتُه من الحساب كمصفوفة تُعطي صفراً
    // أبداً — أي «لا غياب» على من تغيّب.
    abandonedJobs: contractor.get('abandonedJobs') || 0,
    avgRating: contractor.get('avgRating') ?? null,
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
    + `في ${mosqueTitle(mosque)}. عاين العمل، ولك سحب التكليف إن لم يبدأ.`,
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

  return { favoriteMosqueId: mosque.id, mosqueName: mosqueTitle(mosque) };
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
  const { fullName, phone, skills, governorate } = request.params;

  // الأطوال من `TEXT_LIMITS` لا مكتوبةً هنا: `beforeSave` يقصّ بها كذلك،
  // ورقمان في موضعين يفترقان بلا أن يُلحَظ
  if (fullName !== undefined) user.set('fullName', String(fullName).trim().slice(0, TEXT_LIMITS.fullName));
  if (phone !== undefined) user.set('phone', String(phone).trim().slice(0, TEXT_LIMITS.phone));
  // ولا `wilayat`: لا يُرسله نموذج ولا يقرؤه أحد. `_User.wilayat` عمودٌ محجوز.

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
    /*
     * و`wilayat` كان يُرسَل هنا وهو ميّتٌ في الجهات الثلاث: **لا نموذجَ يكتبه**
     * (شاشة التعديل تعرض المحافظة وحدها)، ولا شاشةَ تعرضه، ولا قارئَ له على
     * الخادم — كلُّ `get('wilayat')` في المستودع على `Mosques` لا على الحساب.
     * فرُفع من السلك ومن مُدخلات `updateMyProfile`، والعمود محجوزٌ في المخطط.
     * والمحافظة تبقى: تُقرأ فعلاً في خطة الإشعار البديلة.
     */
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
