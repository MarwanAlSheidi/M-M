/**
 * اختبار تكامل: الحساب الموقوف على خادمٍ حقيقي.
 *
 * إيقاف الحساب هو **الأداة الوحيدة** بيد الإدارة لكفّ مسيء. وكان `isActive`
 * يُضبط عند التسجيل ولا يُقرأ إلا في تصفية من يصله بثُّ الإشعارات — فالموقوف
 * ينشئ الطلبات ويسجّل الاهتمام ويتسلّم التكليف كما كان. **والرايةُ زينة.**
 *
 * وما لا يراه البديل هنا: `beforeLogin` لا يُشغّله إلا خادمٌ حقيقي عند تسجيل
 * دخولٍ حقيقي، وجلسةٌ قائمة لموقوفٍ لا تُحاكى بكائنٍ في الذاكرة.
 *
 * في ملفٍّ مستقلّ — خادمٌ واحد لكل عملية، ويحرس ذلك `harness.startStack`.
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:integration`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startStack, applySchema, unavailableReason } = require('./harness');

const skip = unavailableReason();
const options = skip ? { skip } : {};

test('الحساب الموقوف', options, async (t) => {
  const stack = await startStack();
  const { Parse } = stack;
  t.after(() => stack.stop());

  await applySchema(Parse);

  const PASSWORD = 'Integration12345!';
  let unique = 0;

  async function signUp(role = 'volunteer') {
    const user = new Parse.User();
    const username = `stop_${role}_${Date.now()}_${++unique}`;
    user.set({ username, password: PASSWORD, role });
    await user.signUp();
    return { user, username, token: user.getSessionToken() };
  }

  const suspend = async (user, stopped = true) => {
    user.set('isActive', !stopped);
    await user.save(null, { useMasterKey: true });
  };

  await t.test('التسجيل يُنشئ حساباً نشِطاً', async () => {
    const { user } = await signUp();
    const stored = await new Parse.Query(Parse.User).get(user.id, { useMasterKey: true });
    assert.equal(stored.get('isActive'), true);
  });

  await t.test('والموقوف لا يدخل أصلاً', async () => {
    const { user, username } = await signUp();
    await suspend(user);

    await assert.rejects(Parse.User.logIn(username, PASSWORD), /موقوف/,
      'دخل الموقوف — و`beforeLogin` لا يُشغّله إلا خادمٌ حقيقي، فلا يكشفه البديل');
  });

  await t.test('وجلسةٌ قائمة لا تنفعه: كل فعلٍ يُكفّ', async () => {
    // الإيقاف يقع والجلسة مفتوحة. ولو انتُظر خروجُه ليُكفّ لبقي يعمل ما شاء.
    const { user, token } = await signUp();
    await Parse.Cloud.run('getMyNotifications', {}, { sessionToken: token });

    await suspend(user);
    await assert.rejects(
      Parse.Cloud.run('getMyNotifications', {}, { sessionToken: token }),
      /موقوف/,
    );
  });

  await t.test('والإمام الموقوف لا يُنشئ طلباً على مسجده', async () => {
    const { user: imam, token } = await signUp('imam');
    const mosque = new (Parse.Object.extend('Mosques'))();
    mosque.set({
      externalId: `stop_${Date.now()}_${++unique}`,
      name: 'مسجد المُوقَف', governorate: 'مسقط', wilayat: 'بوشر',
      isClaimed: true, imamId: imam, lat: 23.6, lng: 58.5, hasLocation: true,
    });
    await mosque.save(null, { useMasterKey: true });

    await suspend(imam);
    await assert.rejects(
      Parse.Cloud.run('createServiceRequest', {
        mosqueId: mosque.id, title: 'طلبٌ من موقوف', description: 'وصف كافٍ للطلب',
      }, { sessionToken: token }),
      /موقوف/,
      'الموقوف ينشر طلباً يصل المتطوّعين — والإيقاف لم يكفّ شيئاً',
    );
  });

  await t.test('وتُعاد إتاحته فيعود كما كان', async () => {
    const { user, username, token } = await signUp();
    await suspend(user);
    await suspend(user, false);

    await Parse.Cloud.run('getMyNotifications', {}, { sessionToken: token });
    const back = await Parse.User.logIn(username, PASSWORD);
    assert.ok(back.getSessionToken());
  });

  await t.test('وحسابٌ بلا الحقل ليس موقوفاً — غيابُ البيانات لا يُدين', async () => {
    // حساباتٌ سبقت الحقل: `!isActive` كان سيُقصيها كلَّها
    const { user, username, token } = await signUp();
    user.unset('isActive');
    await user.save(null, { useMasterKey: true });

    await Parse.Cloud.run('getMyNotifications', {}, { sessionToken: token });
    assert.ok((await Parse.User.logIn(username, PASSWORD)).getSessionToken());
  });
});
