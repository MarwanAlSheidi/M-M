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

  // مسجدٌ اسمه أكثر من كلمة، تُؤخذ منه كلمة من غير أوّله
  const sample = await new Parse.Query('Mosques')
    .exists('nameTokens').limit(300).find({ useMasterKey: true });
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

  await t.test('التصفية بالمحافظة تُقيّد', async () => {
    const governorate = multi.get('governorate');
    const hits = await search(lastWord, { governorate });
    for (const hit of hits) assert.equal(hit.governorate, governorate);
  });
});
