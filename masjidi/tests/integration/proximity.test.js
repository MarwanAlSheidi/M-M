/**
 * اختبار تكامل: الموقع هو ما يميّز متطابقي الاسم.
 *
 * «مسجد الغبي» في عبري بقرية الغبي: واحدٌ وعشرون مسجداً بالاسم والولاية والقرية
 * نفسها. لا اسمٌ يميّزها ولا موضعٌ مكتوب — لكن من يبحث عن مسجده واقفٌ فيه أو
 * قريبٌ منه. فالقرب هو الذي يدلّ، ورقم الوزارة يبقى للتثبّت.
 *
 * في ملفٍّ مستقلّ — انظر `contractor.test.js` لسبب ذلك.
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:integration`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startStack, applySchema, unavailableReason } = require('./harness');

const skip = unavailableReason();
const options = skip ? { skip } : {};

test('البحث يرتّب بالأقرب', options, async (t) => {
  const stack = await startStack();
  const { Parse } = stack;
  t.after(() => stack.stop());

  await applySchema(Parse);

  const user = new Parse.User();
  user.set({ username: `prox_${Date.now()}`, password: 'Integration12345!', role: 'imam' });
  await user.signUp();
  const search = (params) =>
    Parse.Cloud.run('searchMosques', params, { sessionToken: user.getSessionToken() });

  // خمسة مساجد لا يفرّق بينها اسمٌ ولا ولاية ولا قرية — كحال «مسجد الغبي»
  const Mosque = Parse.Object.extend('Mosques');
  const twins = [0.2, 0.05, 0.9, 0.4, 0.7].map((offset, i) => {
    const twin = new Mosque();
    twin.set({
      externalId: `twin_${Date.now()}_${i}`,
      name: 'مسجد الغبي',
      nameNormalized: 'مسجد الغبي',
      nameTokens: ['مسجد', 'الغبي'],
      governorate: 'الظاهرة', wilayat: 'عبري', village: 'الغبي',
      mosqueNumber: `27/${1100 + i}`,
      hasLocation: true,
      lat: 23.2 + offset, lng: 56.5,
    });
    return twin;
  });
  // وسادسٌ بلا إحداثيات إطلاقاً
  const blind = new Mosque();
  blind.set({
    externalId: `twin_blind_${Date.now()}`, name: 'مسجد الغبي',
    nameNormalized: 'مسجد الغبي', nameTokens: ['مسجد', 'الغبي'],
    governorate: 'الظاهرة', wilayat: 'عبري', village: 'الغبي',
    mosqueNumber: '27/9999', hasLocation: false,
  });
  await Parse.Object.saveAll([...twins, blind], { useMasterKey: true });

  await t.test('بلا موقع: النتائج بترتيبها الطبيعي بلا مسافة', async () => {
    const rows = await search({ term: 'مسجد الغبي' });

    assert.equal(rows.length, 6);
    assert.equal(rows[0].distanceKm, undefined,
      'مسافةٌ بلا موقع تُختلق من العدم');
  });

  await t.test('بالموقع: الأقرب أوّلاً', async () => {
    // الباحث عند 23.25 — أقرب المساجد إليه ذو الإزاحة 0.05
    const rows = await search({ term: 'مسجد الغبي', lat: 23.25, lng: 56.5 });

    assert.equal(rows[0].mosqueNumber, '27/1101',
      'الأقرب ليس في الصدارة — والإمام يختار من ستّة متطابقة الظاهر');
    const located = rows.filter((row) => row.distanceKm != null);
    for (let i = 1; i < located.length; i += 1) {
      assert.ok(located[i].distanceKm >= located[i - 1].distanceKm, 'الترتيب ليس تصاعدياً');
    }
  });

  await t.test('ومجهول الموقع آخراً لا محذوفاً', async () => {
    const rows = await search({ term: 'مسجد الغبي', lat: 23.25, lng: 56.5 });

    assert.equal(rows.length, 6, 'سقط مسجدٌ بلا إحداثيات من نتيجة البحث');
    assert.equal(rows[rows.length - 1].mosqueNumber, '27/9999');
    assert.equal(rows[rows.length - 1].distanceKm, null);
  });

  await t.test('إحداثيات فاسدة تُعامَل كغيابها لا كصفر', async () => {
    const rows = await search({ term: 'مسجد الغبي', lat: 'شمالاً', lng: 56.5 });

    assert.equal(rows.length, 6);
    assert.equal(rows[0].distanceKm, undefined,
      'نصٌّ مكان الإحداثيات صار موقعاً عند خط الاستواء');
  });

  await t.test('ورقم الوزارة يصل ليتثبّت به الإمام', async () => {
    const rows = await search({ term: 'مسجد الغبي', lat: 23.25, lng: 56.5 });
    for (const row of rows) assert.match(row.mosqueNumber, /^27\//);
  });

  /**
   * القطعُ بعد الفرز لا قبله.
   *
   * سقف النتائج ثلاثون. وكانت القاعدة تقطع عندها **قبل** أن نفرز بالقرب، فتردّ
   * ثلاثين صفاً بأي ترتيبٍ ثم نرتّبها — ومسجدُ الإمام قد لا يكون فيها أصلاً.
   * و«مصلى العيدين» في شمال الباطنة 123 مسجداً: 461 مسجداً في بيانات الوزارة
   * تقع في مجموعاتٍ أكبر من ثلاثين، فأئمّتها لا يجدون مساجدهم مهما وقفوا عندها.
   *
   * قِيس على البيانات كاملةً (200 مسجد من كل المحافظات، الإمام واقفٌ عند مسجده):
   * قبل الإصلاح 198 وُجدت و132 كانت الأولى؛ بعده **200 من 200 كلُّها الأولى**.
   */
  await t.test('ومسجدٌ خلف سقف النتائج يجده إمامه إن وقف عنده', async () => {
    const Many = Parse.Object.extend('Mosques');
    const stamp = Date.now();
    // أربعون متطابقة — أكثر من السقف (30). والإمام عند الأخيرة إدخالاً، فهي
    // آخر ما تعيده قاعدةٌ تقطع بلا ترتيب.
    const crowd = Array.from({ length: 40 }, (unused, i) => {
      const mosque = new Many();
      mosque.set({
        externalId: `crowd_${stamp}_${i}`,
        name: 'مصلى العيدين',
        nameNormalized: 'مصلي العيدين',
        nameTokens: ['مصلي', 'العيدين'],
        governorate: 'شمال الباطنة', wilayat: 'صحار', village: `قرية ${i}`,
        mosqueNumber: `07/${2000 + i}`,
        hasLocation: true,
        lat: 24.3 + i * 0.02, lng: 56.7,
      });
      return mosque;
    });
    await Parse.Object.saveAll(crowd, { useMasterKey: true });

    const mine = crowd[crowd.length - 1];
    const rows = await search({
      term: 'مصلى العيدين',
      governorate: 'شمال الباطنة',
      lat: mine.get('lat'),
      lng: mine.get('lng'),
    });

    assert.equal(rows[0].mosqueNumber, mine.get('mosqueNumber'),
      'مسجد الإمام خلف السقف: قُطعت النتائج قبل الفرز بالقرب فلم يبلغها');
    assert.ok(rows.length <= 30, `عاد ${rows.length} صفاً — السقف لم يُطبَّق بعد الفرز`);
  });
});
