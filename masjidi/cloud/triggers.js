const { ROLES, clampUserText } = require('./lib/auth');

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
  }

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
