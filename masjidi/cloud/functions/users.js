const E = require('../lib/errors');
const { requireUser, requireRole } = require('../lib/auth');
const { pushToUsers } = require('../lib/push');
const audit = require('../lib/audit');

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
  }));
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
  await contractor.save(null, { useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.CONTRACTOR_REVIEWED,
    target: contractor,
    actor: admin,
    toStatus: verified ? 'verified' : 'unverified',
  });

  await pushToUsers(contractor, {
    alert: verified ? 'تم اعتماد شركتكم في منصة مسجدي.' : 'أُوقف اعتماد شركتكم مؤقتاً.',
  });

  return { isVerifiedContractor: verified };
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

/** ملف المستخدم كما يعرضه التطبيق. */
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
    completedJobs: user.get('completedJobs') || 0,
    avgRating: user.get('avgRating'),
    favoriteMosqueId: favorite ? favorite.id : null,
    favoriteMosqueName: favoriteName,
  };
});
