/**
 * اختبار تكامل: حدودُ النصّ على باب التسجيل.
 *
 * `updateMyProfile` تقصّ الاسم إلى ثمانين حرفاً منذ كُتبت. **والتسجيل لا يمرّ
 * بها**: `api.js#signUp` يكتب على `_User` مباشرةً بـ`user.signUp()`، و
 * `beforeSave` كان يحرس الدور والاعتماد ولا يحرس الأطوال.
 *
 * قِيس على خادمٍ حقيقي قبل الإصلاح: **اسمٌ من مئتي ألف حرفٍ قُبل وحُفظ**،
 * والحقل نفسه يُقصّ إلى ثمانين عبر الدالة. وثلاثة آثار:
 *
 * - قاعدةٌ سعتها 250 ميغابايت يملؤها بضع مئات من التسجيلات
 * - `fullName` يُعرض للإمام في بطاقة المهتمّ، فيكسر الشاشة
 * - والتسجيل مفتوحٌ لغير المصادَق، فالكلفة صفرٌ على فاعله
 *
 * ولا يراه بديل Parse: `beforeSave` على `_User` لا يُشغّله إلا خادمٌ حقيقي عند
 * تسجيلٍ حقيقي.
 *
 * في ملفٍّ مستقلّ — خادمٌ واحد لكل عملية، ويحرس ذلك `harness.startStack`.
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:integration`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startStack, applySchema, unavailableReason } = require('./harness');

const skip = unavailableReason();
const options = skip ? { skip } : {};

test('حدود نصّ الحساب', options, async (t) => {
  const stack = await startStack();
  const { Parse } = stack;
  t.after(() => stack.stop());

  await applySchema(Parse);

  // الحدود من مصدرها الواحد لا مكرَّرةً هنا. والاستيراد بعد إقلاع الخادم:
  // `cloud/lib/errors.js` يقرأ `Parse` العامّ، ولا يوجد قبل إقلاعه.
  const { TEXT_LIMITS } = require('../../cloud/lib/auth');

  const HUGE = 'م'.repeat(200_000);
  let unique = 0;
  const signUp = async (fields) => {
    const user = new Parse.User();
    user.set({
      username: `txt_${Date.now()}_${++unique}`,
      password: 'Integration12345!',
      role: 'volunteer',
      ...fields,
    });
    await user.signUp();
    return user;
  };
  const stored = (user) => new Parse.Query(Parse.User).get(user.id, { useMasterKey: true });

  await t.test('التسجيل باسمٍ ضخم يُقصّ لا يُحفَظ كما جاء', async () => {
    const user = await signUp({ fullName: HUGE });
    assert.equal((await stored(user)).get('fullName').length, TEXT_LIMITS.fullName,
      'حُفظ اسمٌ من مئتي ألف حرف — والحدُّ مكتوبٌ في `updateMyProfile` ولا يمرّ به التسجيل');
  });

  await t.test('وكل حقلٍ له حدُّه — لا الاسم وحده', async () => {
    // الشركة تُسجّل باسمها وسجلّها التجاري في النموذج نفسه
    const user = await signUp({
      role: 'contractor', fullName: HUGE, phone: HUGE, companyName: HUGE, crNumber: HUGE,
    });
    const fresh = await stored(user);

    for (const [field, limit] of Object.entries(TEXT_LIMITS)) {
      const value = fresh.get(field);
      if (value == null) continue;
      assert.equal(value.length, limit, `${field}: طولُه ${value.length} والحدّ ${limit}`);
    }
  });

  await t.test('والحدُّ يقصّ ولا يرفض — التسجيل لا يسقط بفراغٍ زائد', async () => {
    // من لصق اسمه بمسافاتٍ حوله لا يُردّ، ولا يُحفظ الفراغ معه
    const user = await signUp({ fullName: '   سالم بن راشد   ' });
    assert.equal((await stored(user)).get('fullName'), 'سالم بن راشد');
  });

  await t.test('وما دون الحدّ يمرّ كما هو حرفاً بحرف', async () => {
    const name = 'الشيخ عبدالله بن محمد الكندي';
    const user = await signUp({ fullName: name });
    assert.equal((await stored(user)).get('fullName'), name);
  });

  await t.test('والتحديث اللاحق محكومٌ بالحدّ نفسه', async () => {
    const user = await signUp({ fullName: 'قصير' });
    await Parse.Cloud.run('updateMyProfile', { fullName: HUGE },
      { sessionToken: user.getSessionToken() });
    assert.equal((await stored(user)).get('fullName').length, TEXT_LIMITS.fullName);
  });

  await t.test('وحفظٌ مباشرٌ من العميل بعد الدخول يُقصّ كذلك', async () => {
    // الطريق الثالث: `_User` مفتوحة لصاحبها، فيستطيع الكتابة بلا دالة سحابة
    const user = await signUp({ fullName: 'قصير' });
    user.set('fullName', HUGE);
    await user.save(null, { sessionToken: user.getSessionToken() });

    assert.equal((await stored(user)).get('fullName').length, TEXT_LIMITS.fullName,
      'بابٌ ثالث يتجاوز الحدّ — والحدُّ الذي يُطبَّق على بابٍ ويُترك آخر ليس حدّاً');
  });
});
