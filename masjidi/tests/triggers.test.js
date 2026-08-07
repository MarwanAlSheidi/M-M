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
    const user = newUser({ role: 'contractor', isVerifiedContractor: true });
    await assert.rejects(
      () => api.trigger('beforeSave:_User', { object: user, master: false }),
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
