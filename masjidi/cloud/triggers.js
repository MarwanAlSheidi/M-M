const { ROLES, clampUserText } = require('./lib/auth');
const { warnImamsOfWorkerLoss } = require('./lib/worker');
const audit = require('./lib/audit');

/** لا يُسمح للعميل بتعيين دوره بنفسه إلى admin، ولا بتعديل الحقول الحسّاسة. */
Parse.Cloud.beforeSave(Parse.User, async (request) => {
  const user = request.object;

  if (user.isNew() && !user.get('role')) user.set('role', 'donor');

  const role = user.get('role');
  if (role && !ROLES.includes(role)) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'دور غير معروف.');
  }

  // الترقية إلى admin أو اعتماد الشركات يتم عبر Master Key فقط
  if (!request.master) {
    if (user.dirty('role')) {
      if (role === 'admin') {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'غير مسموح.');
      }
      // الدور يُختار عند التسجيل ويُثبَّت بعده. تركُه مفتوحاً يعني أن متبرعاً
      // يصبح إماماً أو شركةً متى شاء، فلا يصلح الدور أساساً لأي تفويض لاحق.
      if (!user.isNew()) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'تغيير الدور يتم من الإدارة.');
      }
    }
    // ⚠️ `dirty()` وحده لا يصلح حارساً على حقل له `defaultValue` في المخطط:
    // Parse يطبّق القيمة الافتراضية عند الإنشاء فيُعلّم الحقل مُعدَّلاً، فكان
    // هذا الشرط يرفض **كل تسجيل جديد** برسالة اعتماد الشركات. الصواب: الحساب
    // الجديد يبدأ غير معتمد دائماً، والتعديل بعد ذلك بـ Master Key وحده.
    if (user.isNew()) {
      user.set('isVerifiedContractor', false);
    } else if (user.dirty('isVerifiedContractor')) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'اعتماد الشركات يتم من الإدارة.');
    }

    /**
     * حقولٌ تملكها المنصّة — والسمعة أوّلها.
     *
     * قِيس على خادمٍ حقيقي: المتطوّع يحفظ على حسابه `completedJobs: 999`
     * و`avgRating: 5` و`abandonedJobs: 0` **فتُقبل كلُّها**. وهذه الثلاثة
     * بعينها هي ما تُعرضه `getRequestInterests` للإمام وهو يختار المنفّذ —
     * بُنيت لتكون بيّنته، **فإذا هي إقرارٌ من صاحب الشأن على نفسه.**
     *
     * وأخصُّها `abandonedJobs`: يُعرض للإمام تحذيراً («تغيّب عن ٣ تكليفات»)،
     * وكان مَن تغيّب يمحوه بسطرٍ واحد. **فالتحذير يختفي ممّن قامت به الحاجة.**
     *
     * ومعها `isActive` (إيقاف الحساب بيد الإدارة)، و`contractorReviewedAt`
     * (تُميّز المسحوب اعتمادُه ممّن لم يُراجَع)، وحقول آخر موقعٍ معروف — تكتبها
     * `updateMyLocation` بالمفتاح الرئيسي، فلا معنى لأن يكتبها العميل بيده.
     *
     * ⚠️ ثلاثةٌ منها لها `defaultValue` في المخطط، و`dirty()` وحده لا يصلح
     * حارساً عليها (انظر التعليق أعلاه): الجديد **يُفرَض** على قيمة المنصّة،
     * والقديم يُردّ إن مُسّ.
     */
    const PLATFORM_FIELDS = {
      completedJobs: 0,
      abandonedJobs: 0,
      avgRating: undefined,   // «لا تقييم بعد» — لا صفر يُقرأ تقييماً سيّئاً
      isActive: true,
      contractorReviewedAt: undefined,
      lastKnownLocation: undefined,
      lastLat: undefined,
      lastLng: undefined,
    };

    for (const [field, initial] of Object.entries(PLATFORM_FIELDS)) {
      if (user.isNew()) {
        if (initial === undefined) user.unset(field);
        else user.set(field, initial);
      } else if (user.dirty(field)) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN,
          'هذا الحقل تكتبه المنصّة لا صاحب الحساب.');
      }
    }
  }

  // بالمفتاح الرئيسي كذلك: الحساب الجديد نشِطٌ دائماً
  if (user.isNew()) user.set('isActive', true);

  // القصّ هنا لا في الدوال: التسجيل يكتب على `_User` مباشرةً بلا دالة سحابة،
  // فكان يُقبل اسمٌ من مئتي ألف حرف — قِيس على خادمٍ حقيقي. و`beforeSave` يمرّ
  // به كلُّ كتابة، فالحدُّ واحدٌ لكل الأبواب.
  clampUserText(user);
});

/**
 * الموقوف يُردّ عند الباب.
 *
 * `requireUser` يكفّه عن كل فعل، لكنه يدخل فيرى الشاشات ويصطدم بالمنع في كل
 * ضغطة. والردُّ هنا أصدق وأرحم: **يُقال له مرّةً واحدة، عند المحاولة، بلا
 * جلسةٍ تُفتح أصلاً.**
 */
Parse.Cloud.beforeLogin(async (request) => {
  if (request.object.get('isActive') === false) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'حسابك موقوف حالياً. راسل الإدارة إن كنت ترى ذلك خطأً.',
    );
  }
});

/**
 * إقفال المستخدم الجديد على نفسه.
 *
 * الـ CLP وحده لا يكفي: افتراض Parse أن يمنح المستخدم الجديد قراءة عامة، فيصبح
 * `phone` و`lastKnownLocation` (موقع المتطوع) مقروءاً لكل من يملك مفتاح العميل.
 * الـ ACL لا يُضبط في beforeSave لأن `objectId` لم يُسنَد بعد عند الإنشاء.
 * قراءة بيانات مستخدم آخر تبقى ممكنة من دوال السحابة عبر Master Key.
 */
Parse.Cloud.afterSave(Parse.User, async (request) => {
  /*
   * إيقافُ الحساب يُبلَّغ به من ينتظر صاحبه.
   *
   * قِيس على خادمٍ حقيقي: أُوقف متطوّعٌ مكلَّفٌ بعملٍ في مسجد، فلم يتغيّر وارد
   * الإمام (1 ← 1) ولا سجلّ المسجد (3 ← 3)، ثم رُدَّ الموقوف عن `startWork`،
   * ثم سحب الإمام التكليف بالغياب فصار `abandonedJobs = 1`.
   * **المنصّة تمنعه من الحضور ثم تُقيّد عليه غيابه.**
   *
   * والحارس هنا لا عند المستدعي: الإيقاف يقع من `scripts/promote_admin.js`
   * بالمفتاح الرئيس، وقد يقع غداً من دالّةٍ أخرى — ومن ربط البلاغ بمستدعٍ
   * واحد تركه مفتوحاً عند البقيّة.
   *
   * ولا يُحفظ المستخدم هنا بحال، فلا حلقة.
   */
  const was = request.original;
  if (was && was.get('isActive') !== false && request.object.get('isActive') === false) {
    await warnImamsOfWorkerLoss(request.object, {
      action: audit.ACTIONS.WORKER_SUSPENDED,
      actor: null, // الإيقاف بالمفتاح الرئيس — لا فاعلَ في الجلسة يُنسب إليه
      alert: (name, serviceRequest, mosque) =>
        `أُوقف حساب ${name} المكلَّف بـ "${serviceRequest.get('title')}" `
        + `في ${mosque.get('name')}، فلا يستطيع الحضور. عاين العمل، ولك سحب `
        + `التكليف — ولن يُقيَّد عليه غياب.`,
    });
  }

  if (request.original) return; // تحديث، لا إنشاء — وهو أيضاً ما يمنع الحلقة اللانهائية

  const user = request.object;
  const acl = user.getACL();
  if (acl && !acl.getPublicReadAccess() && !acl.getPublicWriteAccess()) return;

  const own = new Parse.ACL();
  own.setReadAccess(user.id, true);
  own.setWriteAccess(user.id, true);
  user.setACL(own);
  await user.save(null, { useMasterKey: true });
});

/** الرصيد والحالات لا تُعدّل إلا من دوال السحابة. */
Parse.Cloud.beforeSave('Mosques', async (request) => {
  const mosque = request.object;
  if (!request.master && (mosque.dirty('walletBalance') || mosque.dirty('imamId') || mosque.dirty('isClaimed'))) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'تعديل غير مسموح من التطبيق.');
  }
  if ((mosque.get('walletBalance') || 0) < 0) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'الرصيد لا يمكن أن يكون سالباً.');
  }
});

/**
 * الطلبات تُنشأ وتُحدّث عبر دوال السحابة وحدها.
 *
 * ولا حارسَ تحوّلٍ هنا. جُرّب: `request.original` **لا يعكس ما كتبه المتوازي
 * معه** — نداءان متوازيان يقرآن الحالة قبل أن يكتب أحدهما، فالحارس لم يمنع
 * شيئاً في القياس. ثم تبيّن أنه يكسر ما يعمل: `payoutContractor` يكتب
 * `isPaidOut` على طلبٍ **منجَز**، فمنعُ تعديل المُقفَل يقطع الصرف — وهو مسارٌ
 * معطّلٌ اليوم بقرار، فكان العطب سيظهر بعد أشهرٍ عند تفعيل التبرعات وحدها.
 *
 * **وما لا يُرى ساقطاً ولا يُصلح شيئاً لا يُترك في الطريق.** وعلاجُ التزامن
 * حيث وقع أثرُه: `recordWorkerRating` تشتقّ العدد من الطلبات لا تزيده،
 * و`assignWorker` لا تُبشّر إلا من صار التكليف له.
 */
Parse.Cloud.beforeSave('ServiceRequests', async (request) => {
  if (!request.master) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'الطلبات تُنشأ وتُحدّث عبر دوال السحابة فقط.');
  }
});

Parse.Cloud.beforeSave('Transactions', async (request) => {
  if (!request.master) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'المعاملات المالية تُنشأ عبر دوال السحابة فقط.');
  }
  if (!request.object.isNew() && request.object.get('status') === 'captured' && request.object.dirty('amount')) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'لا يجوز تعديل مبلغ معاملة مُقيّدة.');
  }
});

/** عدّاد الطلبات المفتوحة للعرض السريع في الخريطة. */
Parse.Cloud.afterSave('ServiceRequests', async (request) => {
  const serviceRequest = request.object;
  const previous = request.original ? request.original.get('status') : null;
  if (previous === serviceRequest.get('status')) return;

  const mosquePointer = serviceRequest.get('mosqueId');
  if (!mosquePointer) return;

  const openCount = await new Parse.Query('ServiceRequests')
    .equalTo('mosqueId', mosquePointer)
    .containedIn('status', ['pending_funding', 'open_for_volunteers', 'funded', 'assigned', 'in_progress'])
    .count({ useMasterKey: true });

  const mosque = await mosquePointer.fetch({ useMasterKey: true });
  mosque.set('openRequestsCount', openCount);
  await mosque.save(null, { useMasterKey: true });
});
