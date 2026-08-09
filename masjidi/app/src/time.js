/**
 * كم مضى — بالعربية الصحيحة.
 *
 * العدد لا يُلحق بمعدوده في العربية كما يُلحق في الإنجليزية: «2 أيام» خطأ
 * و«11 أيام» خطأ، والصواب «يومين» و«11 يوماً». وقد وقعتُ في هذا من قبل في
 * رسائل `coord-trust` فهربتُ منه إلى صيغةٍ محايدة «التسمية: العدد»؛ ولا مهرب
 * هنا — يقرؤه إمامٌ داخل جملةٍ مسوقة، فوجب ضبطه لا التحايل عليه.
 *
 * ملفٌّ بلا استيرادات قصداً: تختبره `tests/time.test.js` باستيرادٍ ديناميكي،
 * ولو لمس `parse` لما استُورد خارج المتصفّح.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * عدد الأيام التامّة منذ التاريخ، أو `null` إن لم يكن تاريخاً.
 *
 * المستقبل يُقرأ صفراً لا سالباً: ساعةُ الخادم وساعةُ الجهاز تختلفان بثوانٍ،
 * فـ«كُلِّف منذ -1 يوماً» عطبٌ ظاهرٌ للمستخدم سببه اختلافٌ لا شأن له به.
 */
export function daysSince(value, now = new Date()) {
  if (value == null) return null;
  const then = value instanceof Date ? value : new Date(value);
  const time = then.getTime();
  if (Number.isNaN(time)) return null;
  return Math.max(0, Math.floor((now.getTime() - time) / DAY_MS));
}

/** «اليوم» أو «منذ يومين» أو «منذ 12 يوماً» — أو `null` إن لم يكن تاريخاً. */
export function sinceLabel(value, now = new Date()) {
  const days = daysSince(value, now);
  if (days == null) return null;
  if (days === 0) return 'اليوم';
  if (days === 1) return 'منذ يوم';
  if (days === 2) return 'منذ يومين';
  // جمع القلّة إلى العشرة، ثم تمييزٌ مفردٌ منصوب
  if (days <= 10) return `منذ ${days} أيام`;
  return `منذ ${days} يوماً`;
}
