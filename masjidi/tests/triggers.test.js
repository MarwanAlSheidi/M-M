/**
 * المُشغّلات: حماية الأدوار وإقفال حساب المستخدم على نفسه.
 *
 * `save` في البديل لا تُشغّل المُشغّلات تلقائياً، فتُستدعى هنا مباشرةً بطلب
 * مُركَّب — وهو ما تفعله Parse فعلياً قبل الكتابة وبعدها.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCloud } = require('./helpers/parse-mock');

test('المُشغّلات', async (t) => {
  let api;

  t.beforeEach(() => { api = loadCloud('modular'); });

  /** كائن مستخدم كما يصل إلى beforeSave. */
  const newUser = (attributes = {}) => {
    const user = api.make('_User', attributes);
    user._new = true;
    for (const key of Object.keys(attributes)) user._dirty.add(key);
    return user;
  };

  await t.test('المستخدم لا يرقّي نفسه إلى admin', async () => {
    const user = newUser({ role: 'admin' });
    await assert.rejects(
      () => api.trigger('beforeSave:_User', { object: user, master: false }),
      (error) => error.code === api.ParseError.OPERATION_FORBIDDEN);
  });

  await t.test('الإدارة ترقّي بـ Master Key', async () => {
    const user = newUser({ role: 'admin' });
    await api.trigger('beforeSave:_User', { object: user, master: true });
    assert.equal(user.get('role'), 'admin');
  });

  await t.test('المستخدم لا يعتمد نفسه شركةً معتمدة', async () => {
    const existing = api.make('_User', { role: 'contractor', isVerifiedContractor: false });
    existing.set('isVerifiedContractor', true);
    await assert.rejects(
      () => api.trigger('beforeSave:_User', { object: existing, master: false }),
      (error) => error.code === api.ParseError.OPERATION_FORBIDDEN);
  });

  // رُصد على خادم حقيقي: `isVerifiedContractor` له `defaultValue` في المخطط،
  // فيطبّقه Parse عند الإنشاء ويُعلّم الحقل مُعدَّلاً. حارسٌ يعتمد `dirty()`
  // وحده كان يرفض **كل تسجيل جديد**. البديل في الذاكرة لا يطبّق القيم
  // الافتراضية، فتُحاكى هنا بتعليم الحقل صراحةً على مستخدم جديد.
  await t.test('القيمة الافتراضية في المخطط لا تمنع التسجيل', async () => {
    const signup = newUser({ role: 'imam', isVerifiedContractor: false });

    await api.trigger('beforeSave:_User', { object: signup, master: false });

    assert.equal(signup.get('role'), 'imam');
    assert.equal(signup.get('isVerifiedContractor'), false);
  });

  await t.test('التسجيل بادّعاء الاعتماد يُخفَّض بلا رفض', async () => {
    const signup = newUser({ role: 'contractor', isVerifiedContractor: true });

    await api.trigger('beforeSave:_User', { object: signup, master: false });

    assert.equal(signup.get('isVerifiedContractor'), false,
      'الحساب الجديد يبدأ غير معتمد دائماً');
  });

  await t.test('الدور يُختار عند التسجيل ثم يُثبَّت', async () => {
    const signup = newUser({ role: 'imam' });
    await api.trigger('beforeSave:_User', { object: signup, master: false });
    assert.equal(signup.get('role'), 'imam', 'الاختيار عند التسجيل مسموح');

    const existing = api.make('_User', { role: 'donor' });
    existing.set('role', 'imam'); // متبرّع يرقّي نفسه إماماً لاحقاً
    await assert.rejects(
      () => api.trigger('beforeSave:_User', { object: existing, master: false }),
      (error) => error.code === api.ParseError.OPERATION_FORBIDDEN);
  });

  await t.test('الدور المجهول يُرفض', async () => {
    const user = newUser({ role: 'superuser' });
    await assert.rejects(
      () => api.trigger('beforeSave:_User', { object: user, master: false }),
      (error) => error.code === api.ParseError.VALIDATION_ERROR);
  });

  await t.test('الدور الافتراضي donor عند التسجيل', async () => {
    const user = newUser();
    await api.trigger('beforeSave:_User', { object: user, master: false });
    assert.equal(user.get('role'), 'donor');
    assert.equal(user.get('isActive'), true);
  });

  await t.test('حساب جديد يُقفل على صاحبه', async () => {
    const user = api.make('_User', { phone: '9xxxxxxx' });

    // بلا ACL: الافتراض قراءة عامة تكشف الهاتف وموقع المتطوع
    await api.trigger('afterSave:_User', { object: user, original: undefined });

    const acl = user.getACL();
    assert.ok(acl, 'لم يُضبط ACL');
    assert.equal(acl.getPublicReadAccess(), false);
    assert.equal(acl.getPublicWriteAccess(), false);
    assert.equal(acl.getReadAccess(user.id), true);
    assert.equal(acl.getWriteAccess(user.id), true);
  });

  await t.test('التحديث لا يُعيد ضبط ACL — وهو ما يمنع الحلقة اللانهائية', async () => {
    const user = api.make('_User', {});
    const marker = new Parse.ACL();
    marker.setReadAccess('someone_else', true);
    user.setACL(marker);

    await api.trigger('afterSave:_User', { object: user, original: user });

    assert.equal(user.getACL(), marker, 'لُمس ACL في مسار التحديث');
  });

  await t.test('الرصيد السالب مرفوض', async () => {
    const mosque = api.make('Mosques', { walletBalance: -1 });
    await assert.rejects(
      () => api.trigger('beforeSave:Mosques', { object: mosque, master: true }),
      (error) => error.code === api.ParseError.VALIDATION_ERROR);
  });

  await t.test('الطلبات والمعاملات لا تُكتب من العميل', async () => {
    for (const className of ['ServiceRequests', 'Transactions']) {
      await assert.rejects(
        () => api.trigger(`beforeSave:${className}`,
          { object: api.make(className, {}), master: false }),
        (error) => error.code === api.ParseError.OPERATION_FORBIDDEN,
        `${className} مفتوحة للكتابة من العميل`);
    }
  });
});

/**
 * إيقاف الحساب — الأداة الوحيدة بيد الإدارة لكفّ مسيء.
 *
 * `isActive` كان يُضبط عند التسجيل ولا يُقرأ إلا في تصفية من يصله بثُّ
 * الإشعارات. أي أن الموقوف كان ينشئ الطلبات ويسجّل الاهتمام ويتسلّم التكليف
 * ويُبلّغ بالإنجاز كما كان — **والرايةُ زينة.**
 */
test('الحساب الموقوف', async (t) => {
  const api = loadCloud('modular');
  const as = (attributes) => ({ id: 'u_1', get: (key) => attributes[key] });

  await t.test('يُردّ عند الباب فلا تُفتح له جلسة', async () => {
    await assert.rejects(
      () => api.trigger('beforeLogin:_User', { object: as({ isActive: false }) }),
      /موقوف/,
    );
  });

  await t.test('والنشِط يمرّ', async () => {
    await api.trigger('beforeLogin:_User', { object: as({ isActive: true }) });
  });

  await t.test('وجلسةٌ قائمة لا تنفعه — كل فعلٍ يُكفّ', async () => {
    // الإيقاف يقع والجلسة مفتوحة، فلا يُنتظر خروجُه ليُكفّ
    const { error } = await api.call('getMyNotifications', {},
      { user: as({ role: 'volunteer', isActive: false }) });
    assert.match(error.message, /موقوف/);
  });

  await t.test('والنشِط يمرّ من الدوال كذلك', async () => {
    const { error } = await api.call('getMyNotifications', {},
      { user: as({ role: 'volunteer', isActive: true }) });
    assert.equal(error, undefined);
  });

  await t.test('وحسابٌ قديمٌ بلا الحقل ليس موقوفاً — غيابُ البيانات لا يُدين', async () => {
    const { error } = await api.call('getMyNotifications', {},
      { user: as({ role: 'volunteer' }) });
    assert.equal(error, undefined);
  });
});
