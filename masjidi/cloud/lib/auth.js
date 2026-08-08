const E = require('./errors');

const ROLES = ['imam', 'volunteer', 'donor', 'contractor', 'admin'];

/**
 * أسماء الأدوار كما تُعرض للمستخدم.
 *
 * الرسالة كانت تسرد الأسماء البرمجية: «متاحة لـ: volunteer فقط» — إنجليزيةٌ في
 * واجهة عربية، وتكشف تسمية داخلية لا تعني قارئها شيئاً.
 */
const ROLE_LABEL = {
  imam: 'أئمة المساجد',
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

/** يتحقق من وجود جلسة صالحة ويعيد المستخدم. */
function requireUser(request) {
  const user = request.user;
  if (!user) E.unauthenticated();
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
    if (!mosque) E.forbidden('هذا المسجد غير مسجّل باسمك.');
    return mosque;
  }

  const mosques = await query.limit(2).find({ useMasterKey: true });
  if (mosques.length === 0) E.notFound('لا يوجد مسجد مسجّل باسمك بعد.');
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

module.exports = { ROLES, requireUser, requireRole, mosqueForImam, fetchPointer };
