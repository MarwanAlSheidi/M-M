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
 * الأصناف التي **لا يكتب فيها عميلٌ بحال** — إنشاءً ولا تعديلاً ولا حذفاً.
 *
 * وهذه ليست تفضيلاً بل هي **الطبقة الوحيدة** على الحذف: الكتابة يحرسها
 * `beforeSave` فوق الصلاحيات، **ولا `beforeDelete` في المستودع كلِّه**. وقِيس
 * على خادمٍ حقيقي بفتح `ServiceRequests` بضغطةٍ كما تُفتح من لوحة Back4app:
 *
 *     بالقفل المكتوب — حذفَ غريبٌ الطلب: رُدّ (119) Permission denied
 *     بالقفل المفتوح — حذفَ غريبٌ الطلب: **نجح** · ذهب فعلاً من القاعدة
 *
 * متطوّعٌ لا صلة له بالطلب محاه. ولو كان `AuditLog` لَمَحا الشفافيةَ نفسها.
 *
 * والقائمة تُقابَل بـ`cloud/schema.json` في `tests/schema.test.js`: صنفٌ يُقفل
 * هناك ولا يُذكر هنا يبقى بلا فحص، وهو أخطر من ألّا يُقفل — لأن أحداً لن يسأل.
 */
const LOCKED_CLASSES = [
  'Mosques', 'MosqueClaims', 'ServiceRequests',
  'Transactions', 'TaskInterests', 'AuditLog', 'Notifications',
];

/**
 * ما لا يصل العميلَ ولو قرأ الصفّ — `protectedFields` وحدها تحجبه.
 *
 * `_User` مقصودٌ هنا وليس في المقفلة: التسجيل يكتب عليه، فبابُ الإنشاء مفتوحٌ
 * قصداً. والحاجب الوحيد على هاتف الإمام هو هذا السطر.
 */
const HIDDEN_FIELDS = {
  Mosques: ['walletBalance', 'dataQuality'],
  Transactions: ['donorId', 'paymentSessionId', 'paymentGatewayRef'],
  _User: ['phone', 'lastKnownLocation', 'crNumber'],
};

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
 * الأقفال كما هي في القاعدة الآن — لا كما كُتبت في `cloud/schema.json`.
 *
 * **العطب الذي يسدّه:** كلُّ ما يمنع العميل من الكتابة في هذه المنصّة صلاحياتٌ
 * في المخطط، ولا شيء غيرها على الحذف. وقِيس: فُتح `ServiceRequests` على خادمٍ
 * حقيقي بـ`create/update/delete: {"*":true}`، ثم شُغّل الفحص:
 *
 *     قبل الفتح — الساقط: ["الفهرس الفريد على Mosques.externalId"]  · 16 فحصاً
 *     بعد الفتح — الساقط: ["الفهرس الفريد على Mosques.externalId"]  · لا شيء تغيّر
 *
 * ستّةَ عشرَ فحصاً **لا واحدَ منها يذكر الصلاحيات**. وثلاثة أبوابٍ تُفتح من
 * لوحة Back4app بثلاث ضغطات، أو لا تُطبَّق أصلاً إن تعثّر `npm run schema` —
 * ولا يقول ذلك أحد.
 *
 * ولا يُقرأ الملفّ للمقابلة: **الحقيقة في القاعدة**. وملفٌّ صحيحٌ لم يُطبَّق هو
 * الحالة التي نبحث عنها بعينها، فمقابلةُ الملفّ بنفسه تُخضِّرها.
 */
async function permissions() {
  /** يقرأ صلاحيات صنفٍ من القاعدة، أو يُعيد سببَ تعذّرها. */
  const clpOf = async (className) => new Parse.Schema(className)
    .get({ useMasterKey: true })
    .then((schema) => ({ clp: schema.classLevelPermissions || {} }))
    .catch((error) => ({ failed: (error && error.message) || String(error) }));

  return Promise.all([
    check('الكتابة من العميل مقفلة (CLP)',
      'هذه الأقفال هي كلُّ ما يمنع الكتابة من متصفّح، ولا حارس آخر على الحذف — '
      + 'أعِد `npm run schema`، ولا تفتحها من اللوحة',
      async () => {
        const open = [];
        await Promise.all(LOCKED_CLASSES.map(async (className) => {
          const { clp, failed } = await clpOf(className);
          if (failed) { open.push(`${className}: تعذّرت قراءة صلاحياته — ${failed}`); return; }

          for (const door of ['create', 'update', 'delete']) {
            const who = clp[door];
            /*
             * الغياب يُعدّ فتحاً لا قفلاً: `parse-server` يعيد المفاتيح كلَّها
             * صريحةً (قِيس: `{}` للمقفل و`{"*":true}` للافتراضي)، فمفتاحٌ غائبٌ
             * يعني محوّلاً يتكلّم غير ما نعرف — **وغيابُ البيّنة ليس بيّنةَ قفل**.
             */
            if (!who) { open.push(`${className}.${door}: لا جواب`); continue; }
            const granted = Object.keys(who);
            if (granted.length) open.push(`${className}.${door} ← ${granted.join('، ')}`);
          }
        }));

        if (open.length) throw new Error(`أبوابٌ مفتوحة: ${open.join(' · ')}`);
        return `${LOCKED_CLASSES.length} أصنافاً مقفلة`;
      }),

    check('الحقول المحجوبة محجوبةٌ فعلاً (protectedFields)',
      'هواتف الأئمة ومراجع الدفع وأرصدة المساجد — تُقرأ من العميل إن سقط الحجب',
      async () => {
        const exposed = [];
        await Promise.all(Object.entries(HIDDEN_FIELDS).map(async ([className, fields]) => {
          const { clp, failed } = await clpOf(className);
          if (failed) { exposed.push(`${className}: تعذّرت قراءة صلاحياته — ${failed}`); return; }

          const hidden = (clp.protectedFields && clp.protectedFields['*']) || [];
          const gap = fields.filter((field) => !hidden.includes(field));
          if (gap.length) exposed.push(`${className}: ${gap.join('، ')}`);
        }));

        if (exposed.length) throw new Error(`مكشوفة للعميل: ${exposed.join(' · ')}`);
        return `${Object.keys(HIDDEN_FIELDS).length} أصنافاً محجوبة الحقول`;
      }),
  ]);
}

/**
 * فحص ما قبل الإطلاق. بالمفتاح الرئيسي وحده — يكشف أعداداً وبنيةً لا تُعرض
 * لمستخدم، ويُشغَّل من `scripts/preflight.js` لا من التطبيق.
 */
/**
 * الخطوات اليدوية — تُفحص لا يُوثق بها.
 *
 * ثلاثُ خطواتٍ في `docs/DEPLOY.md` تُنفَّذ بيد إنسانٍ من لوحة Back4app: الفهرس
 * الفريد، وجدولة المهام، وتفعيل رفع الملفات. **وكلُّ خطوةٍ يدوية في مسارٍ
 * يُنفَّذ مرّةً تُنسى** — ثم لا يظهر أثرُها إلا بعد أشهر: قاعدةٌ تمتلئ، أو
 * مساجد تتكرّر، أو متطوّعٌ يُصدّ عن رفع صورته.
 *
 * فاثنتان منها تُفحصان هنا فعلاً، والثالثة تبقى في `unverifiable` **مع سبب
 * امتناعها** — لا مجرّد ذكرها.
 */
async function manualSteps() {
  return Promise.all([
    /*
     * التفرّد يُختبر بمحاولته: مخطط Parse لا يعبّر عن الفهرس الفريد، فلا سبيل
     * إلى قراءته — والسبيل الوحيد أن يُكتب صفٌّ مكرَّر ويُنظر أيُردّ.
     *
     * والكتابة على قاعدةٍ حيّة لا تُترك للحظّ: المعرّف موسومٌ بـ`__preflight__`
     * فلا يشبه معرّفاً حقيقياً، والحذف في `finally` فيقع وإن سقط الفحص.
     *
     * **والصفُّ يحمل كلَّ ما يشترطه المخطط.** وقِيس أن أوّل صيغةٍ منه كانت
     * تسقط على `governorate is required` **قبل أن تبلغ التكرار أصلاً**، فتُعلن
     * «لا فهرس فريد» على كل خادمٍ إلى الأبد — بسببٍ لا صلة له بالفهرس.
     * **وفحصٌ أحمرُ دائماً يُعلَّم أنه ضجيج فيُهمَل**، وذلك أسوأ من لا فحص.
     *
     * ولذلك يُميَّز الردّ عن العطب: ما رُدّ لأجل التفرّد يُقبل، وما سقط لسببٍ
     * آخر يُرفع كما هو لا يُقرأ نجاحاً ولا فشلاً في التفرّد.
     */
    check('الفهرس الفريد على Mosques.externalId',
      'بلا فهرسٍ فريد يُستورد المسجد مرّتين عند إعادة التشغيل، ولا يظهر ذلك إلا بالبحث — '
      + 'أضِفه من لوحة Back4app: Database → Indexes',
      async () => {
        const Mosque = Parse.Object.extend('Mosques');
        const externalId = `__preflight__${Date.now()}`;
        // كلُّ ما يشترطه المخطط: externalId وname وgovernorate
        const fields = {
          externalId,
          name: 'فحص ما قبل الإطلاق',
          governorate: 'فحص',
          hasLocation: false,
        };
        const made = [];
        try {
          const first = new Mosque();
          first.set(fields);
          await first.save(null, { useMasterKey: true });
          made.push(first);

          const second = new Mosque();
          second.set(fields);
          let rejection = null;
          await second.save(null, { useMasterKey: true }).then(
            () => made.push(second),
            (error) => { rejection = error; },
          );

          if (made.length > 1) throw new Error('قُبل معرّفٌ خارجيّ مكرَّر — لا فهرس فريد');

          // الردّ لأجل التفرّد يُقبل؛ وردٌّ لسببٍ آخر ليس بيّنةً على الفهرس
          const said = (rejection && rejection.message) || '';
          if (!/duplicate|unique|E11000/i.test(said)) {
            throw new Error(`رُدّ لسببٍ غير التفرّد: ${said || 'بلا رسالة'}`);
          }
          return 'التكرار مرفوض';
        } finally {
          if (made.length) await Parse.Object.destroyAll(made, { useMasterKey: true })
            .catch(() => null);
        }
      }),

    /*
     * الجدولة لا تُقرأ من هنا، **لكن أثرَها يُقرأ**: كلُّ تشغيلٍ لمهمّةٍ يكتب
     * صفّاً في `_JobStatus`. فغيابُه بعد أسبوعٍ من النشر يعني أنها لم تُجدوَل
     * قطّ — وهو أشيعُ إخفاقٍ لهذه الخطوة.
     *
     * ولا يُسقط الفحصَ خادمٌ جديد: يُقال «لم تُشغَّل بعد» ويُترك القرار للقارئ،
     * فالخادم في يومه الأول لا عيب فيه.
     */
    check('المهام الدورية شُغّلت فعلاً',
      'صندوق الوارد وسجلّ التدقيق ينموان بلا حدّ حتى تمتلئ الباقة — '
      + 'جدوِلهما من Server Settings → Background Jobs',
      async () => {
        const runs = await new Parse.Query('_JobStatus')
          .containedIn('jobName', ['pruneAuditLog', 'pruneNotifications'])
          .descending('createdAt').limit(1)
          .find({ useMasterKey: true });

        if (runs.length === 0) return 'لم تُشغَّل بعد — طبيعيٌّ قبل أوّل موعد، وعطبٌ بعده';
        const last = runs[0].get('createdAt');
        const days = Math.floor((Date.now() - last.getTime()) / 86400000);
        if (days > 14) throw new Error(`آخر تشغيل منذ ${days} يوماً — الجدولة متوقّفة`);
        return `آخر تشغيل منذ ${days} يوماً`;
      }),
  ]);
}

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

  const results = [
    ...classes, ...forms, ...(await permissions()), ...blockers, ...(await manualSteps()),
  ];

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
      // ولكلٍّ **سببُ امتناعه** لا مجرّد ذكره: «لم يُفحص» بلا سبب يُقرأ كسلاً،
      // فيُهمَل. وسببُ الامتناع هو ما يدلّ القارئ على كيف يفحصه بنفسه.
      'تفعيل رفع الملفات للمستخدم المصادَق — **لا يُفحص من هنا بحال**: الفحص '
      + 'يجري بالمفتاح الرئيس، والرفع بالمفتاح الرئيس ينجح ولو كان معطّلاً '
      + 'للمصادَقين. فيُعطي أخضرَ كاذباً. جرِّبه من التطبيق بحساب متطوّع.',
      'وصول الدفع (Parse.Push) — لا Installation مسجَّل، والوارد داخل التطبيق هو '
      + 'القناة المعتمَدة، وهو مفحوصٌ في `tests/integration/inbox.test.js`',
      'أن الجدولة قائمةٌ للمستقبل — يُفحص أثرُها الماضي أعلاه (`_JobStatus`) '
      + 'لا وجودُها، فراجع اللوحة إن كان الخادم في أيامه الأولى',
    ],
  };
});
