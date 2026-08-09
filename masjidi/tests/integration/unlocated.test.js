/**
 * اختبار تكامل: فرصٌ في مساجد بلا إحداثيات.
 *
 * ستة عشر مسجداً في بيانات الوزارة بلا موقع صالح. صندوق الإحاطة لا يبلغها،
 * فكانت طلباتها لا تصل متطوّعاً شارك موقعه — وتصل من رفض المشاركة وحده.
 * أهلُ ستة عشر مسجداً خارج المنصّة بلا أن يعلم أحد.
 *
 * في ملفٍّ مستقلّ لأن `directAccess` يربط نسخة Parse المفردة بأوّل خادمٍ يُنشأ
 * في العملية — انظر `contractor.test.js`. لكل ملفٍ عمليته.
 *
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:integration`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startStack, applySchema, unavailableReason } = require('./harness');

const skip = unavailableReason();
const options = skip ? { skip } : {};

test('الفرص في مساجد بلا إحداثيات', options, async (t) => {
  const stack = await startStack();
  const { Parse } = stack;
  t.after(() => stack.stop());

  await applySchema(Parse);

  const imam = new Parse.User();
  imam.set({ username: `noloc_imam_${Date.now()}`, password: 'Integration12345!', role: 'imam' });
  await imam.signUp();
  const volunteer = new Parse.User();
  volunteer.set({ username: `noloc_vol_${Date.now()}`, password: 'Integration12345!', role: 'volunteer' });
  await volunteer.signUp();

  const Mosque = Parse.Object.extend('Mosques');
  const near = new Mosque();
  near.set({ externalId: `near_${Date.now()}`, name: 'مسجد قريب', governorate: 'مسقط',
    isClaimed: true, imamId: imam, lat: 23.6, lng: 58.5, hasLocation: true });
  const blind = new Mosque();
  blind.set({ externalId: `blind_${Date.now()}`, name: 'مسجد بلا موقع', governorate: 'مسقط',
    wilayat: 'بوشر', isClaimed: true, imamId: imam, hasLocation: false });
  await Parse.Object.saveAll([near, blind], { useMasterKey: true });

  const as = (user, fn, params) =>
    Parse.Cloud.run(fn, params, { sessionToken: user.getSessionToken() });

  await as(imam, 'createServiceRequest',
    { mosqueId: near.id, title: 'عمل قريب', description: 'وصف كافٍ للطلب' });
  await as(imam, 'createServiceRequest',
    { mosqueId: blind.id, title: 'عمل بلا موقع', description: 'وصف كافٍ للطلب' });

  await t.test('تظهر للمتطوّع مع المسافة المجهولة لا محذوفة', async () => {
    const rows = await as(volunteer, 'getNearbyOpportunities',
      { lat: 23.6, lng: 58.5, radius: 5 });

    const titles = rows.map((row) => row.title);
    assert.ok(titles.includes('عمل قريب'));
    assert.ok(titles.includes('عمل بلا موقع'),
      'طلبٌ في مسجدٍ بلا إحداثيات لا يصل متطوّعاً شارك موقعه — فأهله خارج المنصّة');
  });

  await t.test('المجهول قربه يأتي آخراً لا متصدّراً', async () => {
    const rows = await as(volunteer, 'getNearbyOpportunities',
      { lat: 23.6, lng: 58.5, radius: 5 });

    assert.equal(rows[rows.length - 1].title, 'عمل بلا موقع');
    assert.equal(rows[rows.length - 1].distanceKm, null,
      'مسافةٌ مُختلقة تُوهم المتطوّع بقربٍ لا يُعرف');
    assert.equal(typeof rows[0].distanceKm, 'number');
  });

  await t.test('ويصل موضعها ولو غاب موقعها', async () => {
    const rows = await as(volunteer, 'getNearbyOpportunities',
      { lat: 23.6, lng: 58.5, radius: 5 });
    const blindRow = rows.find((row) => row.title === 'عمل بلا موقع');

    assert.equal(blindRow.wilayat, 'بوشر',
      'بلا ولاية ولا قرية لا يعرف المتطوّع أين يذهب أصلاً');
  });

  /**
   * الحصر في المحافظة.
   *
   * كانت مجهولة الموقع تُجلب من السلطنة كلّها. وستةَ عشرَ مسجداً كانت ضجيجاً
   * محتملاً؛ أمّا 430 فمتطوّعٌ في مسندم يرى فرصاً في ظفار على بُعد ألف
   * كيلومتر في قائمةٍ عنوانها «ما حولك»، فيفقد الثقة بها كلّها.
   */
  const far = new Mosque();
  far.set({
    externalId: `far_${Date.now()}`, name: 'مسجد ظفار بلا موقع', governorate: 'ظفار',
    wilayat: 'صلالة', isClaimed: true, imamId: imam, hasLocation: false,
  });
  await far.save(null, { useMasterKey: true });
  await as(imam, 'createServiceRequest',
    { mosqueId: far.id, title: 'عمل في محافظة أخرى', description: 'وصف كافٍ للطلب' });

  await t.test('ومجهولُ الموقع في محافظةٍ أخرى لا يُقحَم في «ما حولك»', async () => {
    const rows = await as(volunteer, 'getNearbyOpportunities',
      { lat: 23.6, lng: 58.5, radius: 5 });
    const titles = rows.map((row) => row.title);

    assert.ok(titles.includes('عمل بلا موقع'), 'مجهولُ محافظته سقط معه');
    assert.equal(titles.includes('عمل في محافظة أخرى'), false,
      'فرصةٌ على بُعد ألف كيلومتر في قائمةٍ عنوانها «ما حولك»');
  });

  await t.test('والمحافظة تُستنبط من أقرب مسجد، لا من ملفّ المستخدم وحده', async () => {
    // المتطوّع لم يملأ محافظته قطّ، ومع ذلك حُصرت النتيجة في مسقط
    assert.equal(volunteer.get('governorate'), undefined);
    const rows = await as(volunteer, 'getNearbyOpportunities',
      { lat: 23.6, lng: 58.5, radius: 5 });
    assert.equal(rows.some((row) => row.title === 'عمل في محافظة أخرى'), false);
  });

  await t.test('وحيث لا مسجد يُستدلّ به تُقرأ المحافظة من ملفّ المستخدم', async () => {
    // في البحر: لا مسجد في خمسة وعشرين كيلومتراً، فلا استنباط. والملفّ يقول ظفار
    volunteer.set('governorate', 'ظفار');
    await volunteer.save(null, { useMasterKey: true });

    const rows = await as(volunteer, 'getNearbyOpportunities',
      { lat: 24.5, lng: 59.5, radius: 5 });
    assert.deepEqual(rows.map((row) => row.title), ['عمل في محافظة أخرى']);

    // `set(field, undefined)` لا يمحو الحقل في Parse، فيبقى أثرُ هذا الاختبار
    // على ما بعده. والمحو `unset`.
    volunteer.unset('governorate');
    await volunteer.save(null, { useMasterKey: true });
  });

  await t.test('ولا تُحجب حين لا مسجد قريباً إطلاقاً', async () => {
    // متطوّع في البحر: الصندوق يخلو، وكان الخلوّ يُرجع قائمة فارغة قبل الفحص
    // ولا محافظةَ تُستنبط ولا في الملفّ: السلطنة كلّها خيرٌ من قائمةٍ فارغة
    const rows = await as(volunteer, 'getNearbyOpportunities',
      { lat: 24.5, lng: 59.5, radius: 5 });

    assert.deepEqual(rows.map((row) => row.title).sort(),
      ['عمل بلا موقع', 'عمل في محافظة أخرى']);
  });
});
