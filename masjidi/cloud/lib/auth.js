const E = require('./errors');

const ROLES = ['imam', 'volunteer', 'donor', 'contractor', 'admin'];

/**
 * أسماء الأدوار كما تُعرض للمستخدم.
 *
 * الرسالة كانت تسرد الأسماء البرمجية: «متاحة لـ: volunteer فقط» — إنجليزيةٌ في
 * واجهة عربية، وتكشف تسمية داخلية لا تعني قارئها شيئاً.
 */
const ROLE_LABEL = {
  imam: 'القائمين على المساجد',
  volunteer: 'المتطوّعين',
  donor: 'المتبرّعين',
  contractor: 'شركات الخدمات المعتمدة',
  admin: 'الإدارة',
};

/**
 * إلحاق لام الجرّ بالاسم.
 *
 * لام الجرّ مع «الـ» تُدغم فتصير «لل» وتسقط الألف: «للمتطوّعين» لا
 * «لـالمتطوّعين». وما لا ألف لام فيه تدخل عليه اللام مباشرةً.
 */
const withLam = (label) => `ل${label.startsWith('ال') ? label.slice(1) : label}`;

/**
 * يتحقق من وجود جلسة صالحة **ومن أن الحساب لم يُوقَف**، ويعيد المستخدم.
 *
 * `isActive` كان يُضبط عند التسجيل ولا يُقرأ إلا في تصفية من يصله بثُّ
 * الإشعارات — أي أن إيقاف الحساب، وهو **الأداة الوحيدة** بيد الإدارة لكفّ
 * مسيء، لم يكن يكفّ شيئاً: الموقوف ينشئ الطلبات ويسجّل الاهتمام ويتسلّم
 * التكليف ويُبلّغ بالإنجاز كما كان.
 *
 * والشرط `=== false` لا `!isActive`: حسابٌ قديمٌ بلا الحقل ليس موقوفاً،
 * **وغيابُ البيانات لا يُقرأ إدانةً.**
 */
function requireUser(request) {
  const user = request.user;
  if (!user) E.unauthenticated();
  if (user.get('isActive') === false) {
    E.forbidden('حسابك موقوف حالياً. راسل الإدارة إن كنت ترى ذلك خطأً.');
  }
  return user;
}

/**
 * يتحقق أن المستخدم يحمل أحد الأدوار المطلوبة.
 * ملاحظة أمنية: نقرأ الدور من الكائن المخزّن لا من request.params أبداً.
 */
function requireRole(request, ...roles) {
  const user = requireUser(request);
  const role = user.get('role');
  if (!roles.includes(role)) {
    const named = roles.map((name) => withLam(ROLE_LABEL[name] || name));
    // «فقط» لا «وحدهم»: الأخيرة تلزمها مطابقة العدد والجنس، و«الإدارة»
    // مفرد مؤنّث فتصير «وحدها» — و«فقط» لا تتغيّر مع شيء
    E.forbidden(`هذه الخاصية ${named.join(' و')} فقط.`);
  }
  return user;
}

/**
 * يعيد المسجد الذي يديره هذا الإمام.
 * الإمام قد يدير أكثر من مسجد، لذا نطلب mosqueId صراحةً عند وجود أكثر من واحد.
 */
async function mosqueForImam(imam, mosqueId) {
  const query = new Parse.Query('Mosques');
  query.equalTo('imamId', imam);
  query.equalTo('isClaimed', true);

  if (mosqueId) {
    query.equalTo('objectId', mosqueId);
    const mosque = await query.first({ useMasterKey: true });
    if (!mosque) E.forbidden('لستَ مسجَّلاً على هذا المسجد.');
    return mosque;
  }

  const mosques = await query.limit(2).find({ useMasterKey: true });
  if (mosques.length === 0) E.notFound('لم تُسجَّل على أيّ مسجدٍ بعد.');
  if (mosques.length > 1) E.invalid('تدير أكثر من مسجد — أرسل mosqueId مع الطلب.');
  return mosques[0];
}

/** جلب كائن مُشار إليه (Pointer) بشكل آمن — الـ Pointer الخام لا يحمل بياناته. */
async function fetchPointer(pointer, className) {
  if (!pointer) E.notFound(`${className} غير مرتبط بهذا السجل.`);
  if (pointer.get && pointer.get('createdAt') !== undefined && pointer.attributes && Object.keys(pointer.attributes).length > 0) {
    return pointer; // مُحمّل مسبقاً عبر include()
  }
  return pointer.fetch({ useMasterKey: true });
}

/**
 * أطوال حقول الحساب النصّية — **مصدرٌ واحد**.
 *
 * كانت مكتوبةً في `updateMyProfile` وحدها، والتسجيل يكتب على `_User` مباشرةً
 * بلا دالة سحابة فلا يمرّ بها. قِيس على خادمٍ حقيقي: **تسجيلٌ باسمٍ من مئتي
 * ألف حرفٍ يُقبل ويُحفَظ**، والحقل نفسه يُقصّ إلى ثمانين عبر الدالة.
 *
 * وثلاثة آثار: قاعدةٌ سعتها 250 ميغابايت يملؤها بضع مئات من التسجيلات،
 * واسمٌ يُعرض للإمام في بطاقة المهتمّ **فيكسر الشاشة**، والتسجيل مفتوحٌ
 * لغير المصادَق فالكلفة صفر على فاعله.
 *
 * فالحدُّ هنا لا هناك: `beforeSave` يمرّ به **كل** كتابة — تسجيلاً كانت أو
 * تحديثاً أو حفظاً مباشراً. **والحدُّ الذي يُطبَّق على بابٍ ويُترك آخر ليس حدّاً.**
 */
const TEXT_LIMITS = {
  fullName: 80,
  phone: 20,
  wilayat: 60,
  governorate: 40,
  companyName: 120,
  crNumber: 30,
};

/**
 * كلمةُ المرور — **الطولُ وحده، ولا رموزَ مفروضة**.
 *
 * `parse-server` لا يفرض شيئاً ما لم يُضبط `passwordPolicy` في تهيئة الخادم،
 * وهي بيدِ Back4app لا بيدنا. **لكنّ `beforeSave` يرى الكلمةَ خاماً** — قِيس
 * على خادمٍ حقيقي: التسجيل يمرّ بـ`beforeSave(_User)` وفيه
 * `password: "abc"` قبل التعمية، ورميُ خطأٍ هناك يردّ التسجيل فعلاً. فهذا
 * أحدُ البابين اللذين يُغلقان من الكود وحده — بخلاف حدِّ المعدّل الذي قِيس
 * فإذا هو لا يُسجَّل من كود السحابة إطلاقاً.
 *
 * **وثمانيةٌ طولاً بلا اشتراط رموز**: فرضُ الرموز على ناسٍ يدخلون من هواتفهم
 * يدفعهم إلى كتابتها على ورقةٍ أو إلى `Aa1!` وأخواتها، والطولُ وحده أنفعُ من
 * التعقيد المفروض. ويُردّ ما كان اسمَ المستخدم نفسه أو حرفاً واحداً مكرَّراً —
 * وهما ما يقع فعلاً لا ما يُتخيَّل.
 *
 * ولا تُفحص إلا حين تُكتب: حفظٌ لا يمسّ الكلمة لا يحمل الحقل أصلاً، فلا
 * يُحاسَب صاحبُ حسابٍ قديم على قاعدةٍ سُنّت بعده.
 */
const PASSWORD_MIN = 8;

function checkPassword(user) {
  const password = user.get('password');
  if (typeof password !== 'string' || password === '') return;

  if (password.length < PASSWORD_MIN) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR,
      `كلمة المرور قصيرة — ${PASSWORD_MIN} أحرف على الأقل.`);
  }
  const username = user.get('username');
  if (username && password.toLowerCase() === String(username).toLowerCase()) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR,
      'كلمة المرور لا تكون اسم المستخدم نفسه.');
  }
  if (new Set(password).size === 1) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR,
      'كلمة المرور حرفٌ واحد مكرَّر — اخترْ غيرها.');
  }
}

/** يقصّ حقول الحساب النصّية إلى حدودها، ويُعيد ما قُصّ منها. */
function clampUserText(user) {
  const trimmed = [];
  for (const [field, limit] of Object.entries(TEXT_LIMITS)) {
    const value = user.get(field);
    if (typeof value !== 'string') continue;
    const cleaned = value.trim().slice(0, limit);
    if (cleaned !== value) {
      user.set(field, cleaned);
      trimmed.push(field);
    }
  }
  return trimmed;
}

module.exports = {
  PASSWORD_MIN, checkPassword,
  ROLES, requireUser, requireRole, mosqueForImam, fetchPointer,
  TEXT_LIMITS, clampUserText,
};
