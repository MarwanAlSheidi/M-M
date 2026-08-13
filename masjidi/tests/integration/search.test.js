/**
 * اختبار تكامل: البحث بالكلمات المفهرسة على بيانات الوزارة الحقيقية.
 *
 * لا يُغطّيه البديل في الذاكرة: صياغة الاستعلام على حقل مصفوفة تختلف بين
 * محوّلَي MongoDB وPostgreSQL. `equalTo` المتكرّرة كانت تعمل في البديل وترمي
 * «invalid input syntax for type json» على خادم حقيقي — راجع «جولة ثامنة».
 *
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:integration`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startStack, applySchema, seedMosques, unavailableReason } = require('./harness');

const skip = unavailableReason();
const options = skip ? { skip } : {};

test('البحث على بيانات حقيقية', options, async (t) => {
  const stack = await startStack();
  const { Parse } = stack;
  t.after(() => stack.stop());

  await applySchema(Parse);
  const seeded = await seedMosques(Parse, 300);

  const user = new Parse.User();
  user.set('username', `search_${Date.now()}`);
  user.set('password', 'Integration12345!');
  user.set('role', 'donor');
  await user.signUp();

  const search = (term, extra = {}) =>
    Parse.Cloud.run('searchMosques', { term, ...extra },
      { sessionToken: user.getSessionToken() });

  /*
   * مسجدٌ اسمه أكثر من كلمة، تُؤخذ منه كلمة من غير أوّله.
   *
   * **والترتيب صريحٌ لا مُهمَل.** كان الاستعلام بلا ترتيبٍ ومقطوعاً بسقف،
   * فيختار «أوّل» ما ردّته القاعدة — وهو ما تشاؤه لا ما نقصده. فكانت العيّنة
   * تختلف بين تشغيلٍ وآخر، والكلمةُ المبحوث عنها معها، **فسقط الاختبار مرّةً
   * وقام ثلاثاً بلا تغيير شيفرة**.
   *
   * وهذا الدرس بعينه مكتوبٌ في `getNearbyOpportunities`: «بلا ترتيبٍ يكون
   * المقطوع بالسقف عشوائياً» — طُبّق على شيفرة الإنتاج ولم يُطبَّق على
   * مِرقاة الاختبار. **وحارسٌ يتذبذب أسوأ من لا حارس**: يُعلَّم يوماً بأنه
   * غير مستقرّ فيُهمَل سقوطُه الحقيقي.
   */
  const sample = await new Parse.Query('Mosques')
    .exists('nameTokens').ascending('externalId').limit(300)
    .find({ useMasterKey: true });
  const multi = sample.find((m) => (m.get('nameTokens') || []).length >= 2);
  const tokens = multi.get('nameTokens');
  const lastWord = tokens[tokens.length - 1];

  await t.test('البيانات المستوردة تحمل كلماتها', () => {
    assert.equal(seeded, 300);
    assert.ok(sample.length > 0, 'لا مسجد يحمل nameTokens — الاستيراد لا يحسبها');
    assert.ok(multi, 'لا مسجد بكلمتين فأكثر');
  });

  await t.test('كلمة من غير أوّل الاسم تُطابِق', async () => {
    const hits = await search(lastWord);
    assert.ok(hits.length > 0, `«${lastWord}» لم تُطابِق شيئاً`);
    assert.ok(hits.some((m) => m.objectId === multi.id),
      'البادئة وحدها لا تلتقط «النور» من «مسجد النور» — ولهذا وُجدت الكلمات');
  });

  await t.test('كلمتان تُضيّقان ولا تُوسّعان', async () => {
    const one = await search(lastWord);
    const two = await search(`${tokens[0]} ${lastWord}`);
    assert.ok(two.length <= one.length,
      'الكلمات تُجمع بـAND — لو صارت OR لأغرقت النتيجة');
  });

  await t.test('التطبيع يعمل مع الكلمات', async () => {
    const plain = await search(lastWord);
    const shaped = await search(lastWord.replace(/ه$/, 'ة').replace(/^ا/, 'أ'));
    assert.equal(shaped.length, plain.length,
      'مستخدمٌ كتب التاء المربوطة أو الهمزة فلم يجد مسجده');
  });

  await t.test('الاسم الكامل يُطابِق نفسه', async () => {
    const hits = await search(multi.get('name'));
    assert.ok(hits.length > 0, 'الاسم كما هو في البيانات لا يجد صاحبه');
  });

  await t.test('ما لا وجود له لا يُطابِق شيئاً', async () => {
    assert.deepEqual(await search('مسجد لا وجود له إطلاقا'), []);
  });

  /*
   * **ومن يبحث عن مسجده كما يسمّيه يجده.**
   *
   * بيانات الوزارة تفصل الاسم عن النوع: الاسم علَمٌ مجرَّد («العلوية»)، والنوع
   * في حقلٍ آخر — و**14,339 مسجداً من 18,214 نوعُها «مسجد»، ولا يحمل اسمَها
   * الكلمةَ إلا 10٪**. وكانت `nameTokens` تُبنى من الاسم والقرية وحدهما.
   *
   * وقِيس على خادمٍ حقيقي بثلاثة آلاف مسجد قبل الإصلاح:
   *
   *     بحث «العلوية»        → 2 نتيجة · وجده
   *     بحث «مسجد العلوية»   → **0 نتيجة**
   *
   * أربعٌ من ستّ أنواعٍ جُرّبت أعطت صفراً تامّاً — لأن `containsAll` تشترط
   * الكلَّ، فكلمةٌ واحدة خارج الفهرس تُلغي البحث كلَّه. وهذا أوّل باب المنصّة:
   * إمامٌ لا يجد مسجده لا يسجّله، ولا يصل إليه متطوّع.
   */
  await t.test('ومن كتب نوع مسجده مع اسمه وجده', async () => {
    const bare = sample.find((m) => {
      const type = (m.get('type') || '').split(/\s+/)[0];
      return type && !(m.get('name') || '').includes(type);
    });
    assert.ok(bare, 'لا مسجد في العيّنة اسمُه بلا نوعه — فالقياس لا يشهد لشيء');

    const type = bare.get('type').split(/\s+/)[0];
    const name = bare.get('name');

    // **الحالة التي يجب أن تبقى خضراء**: العلَم وحده كان يعمل ويبقى
    const withoutType = await search(name);
    assert.ok(withoutType.some((row) => row.objectId === bare.id),
      `العلَم وحده لم يعد يجد صاحبه: «${name}»`);

    const withType = await search(`${type} ${name}`);
    assert.ok(withType.some((row) => row.objectId === bare.id),
      `«${type} ${name}» لا يجد مسجداً نوعُه «${type}» واسمُه «${name}»`);
  });

  await t.test('والنوع يُطبَّع كما يُطبَّع ما يكتبه الباحث', async () => {
    /*
     * `normalizeArabic('مصلى')` تُعيد `'مصلي'`، والاستعلام يُطبَّع كذلك. فلو
     * أُضيف النوع إلى الفهرس **خاماً** لَما طابق أبداً — ولَبدا الإصلاح واقعاً
     * وهو لم يقع. فتُقرأ الكلمات من القاعدة ويُنظر أهي المطبَّعة.
     */
    const alef = sample.find((m) => /ى/.test(m.get('type') || ''));
    if (!alef) return; // لا نوع فيه ألف مقصورة في هذه العيّنة

    const tokensOf = alef.get('nameTokens') || [];
    assert.ok(tokensOf.some((word) => /مصلي/.test(word)),
      `النوع «${alef.get('type')}» دخل الفهرس خاماً: ${tokensOf.join('، ')}`);
    assert.ok(!tokensOf.some((word) => /مصلى/.test(word)),
      'كلمةٌ بألفٍ مقصورة في الفهرس — لن يبلغها استعلامٌ مطبَّع');
  });

  await t.test('التصفية بالمحافظة تُقيّد', async () => {
    const governorate = multi.get('governorate');
    const hits = await search(lastWord, { governorate });
    for (const hit of hits) assert.equal(hit.governorate, governorate);
  });
});
