/**
 * ما يُغلَق من كود السحابة فعلاً — وما لا يُغلَق منه بحال.
 *
 * الدورة الماضية قِيست فيها الحمايةُ الأولى (حدُّ المعدّل) فإذا هي **لا
 * تُسجَّل من كود السحابة إطلاقاً**. فسُئل الباقي بالمنهج نفسه — لا يُشحن سطرٌ
 * قبل أن يُنتهك ويُنظر أيَقع المنع (القاعدة ٤٨). والنتيجة انقسامٌ حادّ:
 *
 *     كلمةُ المرور:  `beforeSave(_User)` يراها **خاماً** — تُغلق من الكود
 *     الصورة:        `beforeSave(Parse.File)` يرى النوعَ والحجم — تُغلق من الكود
 *     طولُ الجلسة:   31,536,000 ثانية (سنة) — **لا هوك له**، تهيئةُ خادمٍ وحدها
 *
 * وهذا الملفّ يقيس الثلاثة على خادمٍ حقيقي: البابان يُغلقان فعلاً، والثالث
 * يُقرأ ويُقال إنه مفتوح — **فما لا يُغلق يُسمّى، ولا يُسكت عنه**.
 *
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:integration`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');

const integration = require('./harness');

/*
 * الحدُّ يُقرأ من مصدره لا يُكتب هنا — ولا يُستورد الملفّ: `cloud/lib/auth.js`
 * يعتمد على `Parse` العامّة التي يضعها الخادم، فاستيرادُه من رأس الاختبار
 * يُسقط الملفّ كلَّه قبل أن يبدأ.
 */
/*
 * **ولا يُسقط غيابُه الملفَّ كلَّه.** أوّلُ صياغةٍ قرأت المجموعةَ الأولى من
 * النتيجة مباشرةً، فحين غاب الثابت على `HEAD` سقط الملفّ عند تحميله بـ
 * `Cannot read properties of null` — **فلا تُقرأ الحمرةُ خبراً عن الحماية**،
 * ولا تُميَّز من عطبٍ في البيئة. فيُقرأ بغيابٍ محتمَل، وتسقط الحالاتُ
 * برسائلها هي.
 */
const declared = /PASSWORD_MIN = (\d+)/.exec(
  fs.readFileSync(path.join(__dirname, '..', '..', 'cloud', 'lib', 'auth.js'), 'utf8'),
);
const PASSWORD_MIN = declared ? Number(declared[1]) : 8;

const skip = integration.unavailableReason();
const options = skip ? { skip } : {};

test('ما يُغلَق من كود السحابة', options, async (t) => {
  const stack = await integration.startStack();
  const { Parse } = stack;
  t.after(() => stack.stop());

  await integration.applySchema(Parse);

  const stamp = Date.now();
  const signUp = async (username, password, extra = {}) => {
    const user = new Parse.User();
    user.set({ username, password, role: 'volunteer', ...extra });
    return user.signUp().then(() => null, (error) => error.message);
  };

  /*
   * **حالةٌ تبقى خضراء** (القاعدة ٤٦): كلمةٌ سليمة تمرّ. بلا هذه يكون «رُدَّ
   * كلُّ شيء» مقروءاً حمايةً وهو قد يكون تسجيلاً معطوباً من أصله.
   */
  await t.test('كلمةٌ سليمة تمرّ', async () => {
    const failed = await signUp(`ok_${stamp}`, 'Volunteer12345');
    assert.equal(failed, null, `رُدَّ تسجيلٌ سليم: ${failed}`);
  });

  await t.test('والقصيرة تُردّ ويُقال طولُها', async () => {
    const failed = await signUp(`short_${stamp}`, 'abc');
    assert.ok(failed, 'قُبلت كلمةُ مرورٍ من ثلاثة أحرف');
    assert.match(failed, new RegExp(String(PASSWORD_MIN)),
      `رُدّت بلا أن يُقال الحدُّ المطلوب: ${failed}`);
    // والرسالة عربية — لا تصل المستخدمَ إنجليزية (القاعدة ٢٨)
    assert.doesNotMatch(failed, /[A-Za-z]{4,}/, `رسالةٌ إنجليزية: ${failed}`);
  });

  await t.test('وكلمةٌ هي اسمُ المستخدم نفسه تُردّ', async () => {
    const name = `sameuser_${stamp}`;
    const failed = await signUp(name, name);
    assert.ok(failed, 'قُبلت كلمةُ مرورٍ هي اسمُ الحساب — وهي أوّلُ ما يُجرَّب');
    assert.match(failed, /اسم المستخدم/);
  });

  await t.test('وحرفٌ واحد مكرَّر يُردّ ولو طال', async () => {
    const failed = await signUp(`rep_${stamp}`, 'aaaaaaaaaaaa');
    assert.ok(failed, 'اثنا عشر حرفاً متطابقاً مرّت لأن الطول وحده فُحص');
  });

  /*
   * **ولا يُحاسَب حسابٌ قائم على قاعدةٍ سُنّت بعده.** الحفظ الذي لا يمسّ
   * الكلمة لا يحمل الحقل أصلاً، فلو فُحص ما ليس مكتوباً لتجمّد كلُّ حسابٍ
   * أُنشئ قبل اليوم — وهو أسوأ من ألّا تُفحص.
   */
  await t.test('وحفظٌ لا يمسّ الكلمة لا يُفحص', async () => {
    const user = new Parse.User();
    user.set({ username: `keep_${stamp}`, password: 'Volunteer12345', role: 'volunteer' });
    await user.signUp();

    user.set('fullName', 'سالم المتطوّع');
    await user.save(null, { sessionToken: user.getSessionToken() });
    assert.equal(user.get('fullName'), 'سالم المتطوّع');
  });

  /* ————— الصور ————— */

  const png = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ];

  await t.test('وصورةٌ صغيرة تُرفع — وهي الحدُّ الأخضر هنا', async () => {
    const file = new Parse.File('work.png', [...png], 'image/png');
    await file.save({ useMasterKey: true });
    assert.ok(file.url(), 'لم تُرفع صورةٌ سليمة أصلاً');
  });

  await t.test('وما ليس صورةً يُردّ', async () => {
    const file = new Parse.File('payload.txt', [65, 66, 67], 'text/plain');
    const failed = await file.save({ useMasterKey: true })
      .then(() => null, (error) => error.message);
    assert.ok(failed, 'رُفع ملفٌّ نصّيّ — والرفع مفتوحٌ لكل مصادَق');
    assert.match(failed, /الصور/, `رُدّ لسببٍ آخر: ${failed}`);
  });

  await t.test('والكبيرة تُردّ ويُقال حجمُها', async () => {
    // ستّةُ ميغابايت فوق الحدّ — والملفّ صورةٌ صحيحة النوع، فالردُّ للحجم وحده
    const big = new Parse.File('huge.png', Array.from({ length: 6 * 1024 * 1024 },
      (_, at) => png[at % png.length]), 'image/png');
    const failed = await big.save({ useMasterKey: true })
      .then(() => null, (error) => error.message);
    assert.ok(failed, 'رُفعت ستّةُ ميغابايت — والباقة ٢٥٠ كلُّها');
    assert.match(failed, /كبيرة/, `رُدّت لسببٍ غير الحجم: ${failed}`);
    assert.match(failed, /٥ م\.ب|5 م\.ب/, `لا يُقال الحدُّ المسموح: ${failed}`);
  });

  /* ————— وما لا يُغلَق ————— */

  /*
   * **نتيجةٌ سالبة تُقال ولا تُحوَّل عملاً.** طولُ الجلسة خيارُ إقلاعٍ لا هوك
   * له، فلا سبيل إليه من الكود المرفوع. ويُقاس هنا ليُعرف مقدارُه ولئلا يُظنّ
   * أنه مضبوط: سنةٌ كاملة تعني أن هاتفاً ضائعاً يبقى داخلاً اثني عشر شهراً.
   */
  await t.test('وطولُ الجلسة لا يُغلَق من هنا — ويُقال مقدارُه', () => {
    const Config = require('parse-server/lib/Config');
    const seconds = Config.get(integration.APP_ID).sessionLength;
    assert.equal(typeof seconds, 'number');
    assert.equal(seconds, 365 * 24 * 3600,
      'تغيّر الافتراض — راجع خطوة اللوحة في `scripts/lib/manual.js`');

    const { MANUAL_STEPS } = require('../../scripts/lib/manual');
    const named = MANUAL_STEPS.some((step) => /SESSION_LENGTH/.test(step.title));
    assert.ok(named, 'سنةٌ كاملة للجلسة، ولا خطوةَ تقول للمالك كيف يقصّرها');
  });
});
