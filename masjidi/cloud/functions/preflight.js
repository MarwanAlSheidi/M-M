const E = require('../lib/errors');
const geo = require('../lib/geo');

/**
 * فحص ما قبل الإطلاق — يُشغَّل على الخادم المنشور، مرّةً بعد النشر.
 *
 * **لماذا:** كل اختبارات هذا المستودع تعمل على PostgreSQL، وBack4app على
 * MongoDB. **فأوّل نشرٍ هو أوّل تشغيلٍ حقيقي على المحوّل الآخر** — وقد كشف هذا
 * الفرق خللين فعليّين من قبل (`equalTo` على حقل مصفوفة، والفهارس المكانية):
 * مرّا في الاختبار وسقطا على خادمٍ حقيقي.
 *
 * وكان كلُّ ما بيد المُشغّل عند تلك اللحظة `health` التي تقول `{ok:true}` —
 * **وهي لا تُثبت إلا أن الملفّ قُرئ.** فبينه وبين أوّل إمامٍ يستعمل المنصّة
 * لا شيء يخبره أن استعلاماً لا يعمل، أو أن المخطط لم يُطبَّق، أو أنه بلا مشرف.
 *
 * فهذه تُشغّل الصيغ المشبوهة نفسها على القاعدة الحيّة، وتُعيد نتيجة كلٍّ منها
 * على حدة **ولا ترمي**: فحصٌ يسقط عند أوّل خطأ يُخفي ما بعده، والمُشغّل يريد
 * القائمة كاملةً في نداءٍ واحد لا خطأً واحداً يُصلحه ثم يكتشف الذي يليه.
 *
 * **وما لا تفحصه تقوله.** جدولةُ المهام والفهرسُ الفريد ورفعُ الملفات لا
 * تُقرأ من داخل Cloud Code، فتُذكر صراحةً في `unverifiable` — لأن أخطر ما في
 * فحصٍ أخضر أن يُقرأ «كلُّ شيء سليم» وهو لا يقول ذلك.
 * **غيابُ البيّنة ليس بيّنةَ نفي.**
 */

/** أصناف المخطط التي لا تعمل المنصّة بدونها. */
const REQUIRED_CLASSES = [
  'Mosques', 'MosqueClaims', 'ServiceRequests',
  'TaskInterests', 'AuditLog', 'Notifications',
];

/**
 * عدُّ كلِّ سجلّات صنف.
 *
 * **لا تُستعمل `count()` بلا قيد:** قِيست على `parse-server` فوق PostgreSQL
 * فأعادت **صفراً** بينما `find()` تُعيد ثلاثين — بلا خطأٍ ولا تحذير. وأسوأ
 * ما فيها أنها لا تسقط: فحصٌ يقول «لا مسجد في القاعدة» وفيها ثمانية عشر ألفاً
 * يُرسل المُشغّل يستورد ما هو مستورد. و`exists('objectId')` قيدٌ يصدق على كل
 * سجلّ فيُعيد العدّ إلى صوابه.
 */
const countAll = (className) =>
  new Parse.Query(className).exists('objectId').count({ useMasterKey: true });

/** يُجري فحصاً ويلتقط خطأه بدل أن يُسقط البقية. */
async function check(name, why, run) {
  try {
    const detail = await run();
    return { name, ok: true, detail: detail == null ? null : String(detail) };
  } catch (error) {
    return { name, ok: false, why, detail: (error && error.message) || String(error) };
  }
}

/**
 * الصيغ التي يختلف فيها المحوّلان، مُشغَّلةً على القاعدة الحيّة.
 *
 * ليست عيّنةً عشوائية: كلٌّ منها يقوم عليه مسارٌ يراه المستخدم، وذكرُ المسار
 * في الاسم مقصود — من يقرأ «سقط» يحتاج أن يعرف ما الذي تعطّل عند الناس.
 */
async function queryForms() {
  return Promise.all([
    check('البحث بالكلمات المفهرسة (containsAll على مصفوفة)',
      'هي الصيغة التي كشفت أوّل فرقٍ بين المحوّلين — والبحث بالاسم يقوم عليها',
      async () => {
        const rows = await new Parse.Query('Mosques')
          .containsAll('nameTokens', ['مسجد']).limit(1).find({ useMasterKey: true });
        return `${rows.length} نتيجة`;
      }),

    check('البحث بالقرب (صندوق الإحاطة على lat/lng)',
      'عليه يقوم «ما حولي» وترتيب الفرص بالأقرب — وهو بديلنا عن الفهرس المكاني',
      async () => {
        const query = new Parse.Query('Mosques');
        geo.withinBox(query, geo.boundingBox(23.6, 58.5, 25));
        query.select('name', 'lat', 'lng').limit(5);
        return `${(await query.find({ useMasterKey: true })).length} مسجداً حول مسقط`;
      }),

    check('البحث بالبادئة (startsWith على النصّ المطبَّع)',
      'خطة البحث الثانية حين لا تُطابق الكلمات',
      async () => {
        const rows = await new Parse.Query('Mosques')
          .startsWith('nameNormalized', 'مسجد').limit(1).find({ useMasterKey: true });
        return `${rows.length} نتيجة`;
      }),

    check('تصفية الحالات (containedIn) والعدّ (count)',
      'عليهما يقوم عدّاد الطلبات المفتوحة، وبه تُرشَّح المساجد في شاشة الفرص',
      async () => {
        const open = await new Parse.Query('ServiceRequests')
          .containedIn('status', ['open_for_volunteers', 'assigned', 'in_progress'])
          .count({ useMasterKey: true });
        return `${open} طلباً قائماً`;
      }),

    check('الترتيب والتحميل المرافق (descending + include)',
      'عليهما يقوم صندوق الوارد وسجلّ المسجد وقائمة طلبات الملكية',
      async () => {
        const rows = await new Parse.Query('AuditLog')
          .descending('createdAt').include('mosqueId').limit(1).find({ useMasterKey: true });
        return `${rows.length} سطراً`;
      }),

    check('التحميل المرافق بمسارٍ منقوط (include مؤشّرٍ داخل مؤشّر)',
      'عليه تقوم قائمة طلبات الملكية: به يعرف المشرف ممّن يُنزع المسجد',
      async () => {
        const rows = await new Parse.Query('MosqueClaims')
          .include('mosqueId').include('mosqueId.imamId').limit(1)
          .find({ useMasterKey: true });
        return `${rows.length} طلباً`;
      }),
  ]);
}

/**
 * فحص ما قبل الإطلاق. بالمفتاح الرئيسي وحده — يكشف أعداداً وبنيةً لا تُعرض
 * لمستخدم، ويُشغَّل من `scripts/preflight.js` لا من التطبيق.
 */
Parse.Cloud.define('preflight', async (request) => {
  if (!request.master) E.forbidden('هذا الفحص بالمفتاح الرئيسي وحده.');

  const classes = await Promise.all(REQUIRED_CLASSES.map((className) =>
    check(`الصنف ${className} مطبَّق`,
      'المخطط لم يُطبَّق — شغّل `npm run schema` قبل أي شيء آخر',
      async () => `${await countAll(className)} سجلاً`)));

  const forms = await queryForms();

  /** أعدادٌ تقول للمُشغّل أين هو، لا أخضر ولا أحمر. */
  const counts = {};
  const admins = await new Parse.Query(Parse.User)
    .equalTo('role', 'admin').count({ useMasterKey: true }).catch(() => null);
  counts.مساجد = await countAll('Mosques').catch(() => null);
  counts.مساجد_بلا_موقع = await new Parse.Query('Mosques')
    .equalTo('hasLocation', false).count({ useMasterKey: true }).catch(() => null);
  counts.مشرفون = admins;
  counts.طلبات_ملكية_منتظرة = await new Parse.Query('MosqueClaims')
    .equalTo('status', 'pending').count({ useMasterKey: true }).catch(() => null);

  /**
   * بلا مشرفٍ لا تعمل المنصّة وإن عمل كلُّ سطرٍ فيها: الأئمة يسجّلون، وطلباتهم
   * تبقى `pending` أبداً. وهذه أشدّ حالةٍ يبدو فيها كلُّ شيء سليماً وهو معطّل.
   */
  const blockers = await Promise.all([
    check('يوجد مشرفٌ واحد على الأقل',
      'بلا مشرف تتراكم طلبات الملكية بلا اعتماد — `npm run admin -- --username <اسمه>`',
      async () => {
        if (admins === 0) throw new Error('لا مشرف على هذا الخادم');
        return `${admins} مشرفاً`;
      }),
    check('في القاعدة مساجد',
      'الاستيراد لم يُشغَّل — `node scripts/seed_mosques.js --governorate musandam`',
      async () => {
        if (!counts.مساجد) throw new Error('لا مسجد في القاعدة');
        return `${counts.مساجد} مسجداً`;
      }),
  ]);

  const results = [...classes, ...forms, ...blockers];

  return {
    ok: results.every((row) => row.ok),
    serverTime: new Date().toISOString(),
    checks: results,
    counts,
    failed: results.filter((row) => !row.ok).map((row) => row.name),
    /**
     * ما لا يُقرأ من داخل Cloud Code. يُذكر صراحةً لأن أخطر ما في فحصٍ أخضر
     * أن يُقرأ «كلُّ شيء سليم» وهو لا يقول ذلك.
     */
    unverifiable: [
      'جدولة المهام الدورية (pruneAuditLog وpruneNotifications) — تُراجَع من لوحة Back4app',
      'الفهرس الفريد على Mosques.externalId — يُضاف يدوياً، ويكشف تكرارَه `seed_mosques.js --verify`',
      'تفعيل رفع الملفات للمستخدم المصادَق — يُراجَع من إعدادات التطبيق',
      'وصول الدفع (Parse.Push) — لا Installation مسجَّل، والوارد داخل التطبيق هو القناة',
    ],
  };
});
