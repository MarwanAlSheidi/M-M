/**
 * اختبار تكامل: الإمام يثبّت موقع مسجده وهو عنده.
 *
 * لماذا لزم طريقٌ ثانٍ إلى جانب التعلّم من طلب الملكية: سحبنا الثقة من إحداثيات
 * 414 مسجداً كاذبةً في المصدر (`scripts/lib/coord-trust.js`)، ومنها ما هو مسجّلٌ
 * لإمامه من قبل. وذاك لا طلبَ له ينتظر اعتماداً يحمل إحداثياً، فيبقى مجهول
 * الموقع أبداً. سحبُ الموقع بلا طريقٍ لردّه نصفُ إصلاح.
 *
 * في ملفٍّ مستقلّ — خادمٌ واحد لكل عملية، ويحرس ذلك `harness.startStack`.
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:integration`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startStack, applySchema, unavailableReason } = require('./harness');

const skip = unavailableReason();
const options = skip ? { skip } : {};

test('تثبيت موقع المسجد', options, async (t) => {
  const stack = await startStack();
  const { Parse } = stack;
  t.after(() => stack.stop());

  await applySchema(Parse);

  const tokens = new Map();
  let unique = 0;
  async function signUp(role) {
    const user = new Parse.User();
    user.set({
      username: `fix_${role}_${Date.now()}_${++unique}`,
      password: 'Integration12345!',
      role,
    });
    await user.signUp();
    tokens.set(user.id, user.getSessionToken());
    return user;
  }
  const as = (user, fn, params = {}) =>
    Parse.Cloud.run(fn, params, { sessionToken: tokens.get(user.id) });

  const Mosque = Parse.Object.extend('Mosques');
  /** مسجدٌ مسجَّلٌ لإمامه — الحالة التي أوجدها سحبُ الثقة. */
  const claimedBy = async (imam, suffix, extra) => {
    const mosque = new Mosque();
    mosque.set({
      externalId: `fix_${Date.now()}_${++unique}`,
      name: `مسجد ${suffix}`,
      governorate: 'مسقط',
      wilayat: 'بوشر',
      imamId: imam,
      isClaimed: true,
      hasLocation: false,
      ...extra,
    });
    await mosque.save(null, { useMasterKey: true });
    return mosque;
  };
  const reread = (mosque) => new Parse.Query('Mosques').get(mosque.id, { useMasterKey: true });

  await t.test('الإمام يثبّت موقع مسجده، ويُقيَّد في سجلّه', async () => {
    const imam = await signUp('imam');
    const mosque = await claimedBy(imam, 'التائه');

    const result = await as(imam, 'confirmMosqueLocation',
      { mosqueId: mosque.id, lat: 23.61, lng: 58.51 });
    assert.equal(result.located, true);

    const fresh = await reread(mosque);
    assert.equal(fresh.get('lat'), 23.61);
    assert.equal(fresh.get('hasLocation'), true);
    assert.equal(fresh.get('locationSource'), 'imam',
      'بلا مصدر يمسحه الاستيراد التالي ظنّاً أنه إحداثيّ وزارة');
    assert.ok(fresh.get('location'), 'GeoPoint لم يُضبط — والفهرس المكاني يقوم عليه');

    const trail = await as(imam, 'getMosqueAuditTrail', { mosqueId: mosque.id });
    assert.ok(trail.some((entry) => entry.action === 'location_learned'),
      'تغيّرَ موقعُ مسجد بلا أثرٍ في سجلّه');
  });

  await t.test('وبعدها يظهر في البحث بالقرب', async () => {
    const imam = await signUp('imam');
    const mosque = await claimedBy(imam, 'العائد');

    const before = await as(imam, 'getNearbyMosques', { lat: 23.64, lng: 58.54, radius: 1 });
    assert.equal(before.some((row) => row.objectId === mosque.id), false);

    await as(imam, 'confirmMosqueLocation', { mosqueId: mosque.id, lat: 23.64, lng: 58.54 });

    const after = await as(imam, 'getNearbyMosques', { lat: 23.64, lng: 58.54, radius: 1 });
    assert.ok(after.some((row) => row.objectId === mosque.id),
      'ثُبّت الموقع ولا يزال المسجد خارج القرب');
  });

  /**
   * التصويب، لا التثبيت فحسب.
   *
   * موقعٌ مسجَّلٌ قد يكون خاطئاً — 414 إحداثياً كاذباً في بيانات الوزارة تشهد
   * بذلك، وما يُستخرج من الخرائط تقديرٌ لا يقين. ومن يقف عند المسجد أعلمُ
   * بموضعه من أيّ مصدر.
   */
  await t.test('والإمام يصوّب موقعاً مسجَّلاً، ويُقيَّد ما كان قبله', async () => {
    const imam = await signUp('imam');
    const mosque = await claimedBy(imam, 'المصوَّب', {
      lat: 23.60, lng: 58.50, hasLocation: true, locationSource: 'ministry',
    });
    // جارٌ معلومٌ في الولاية يُقاس إليه الموضع الجديد
    await claimedBy(imam, 'الجار', { lat: 23.61, lng: 58.51, hasLocation: true });

    const result = await as(imam, 'confirmMosqueLocation',
      { mosqueId: mosque.id, lat: 23.615, lng: 58.515 });
    assert.equal(result.corrected, true);
    assert.match(result.message, /تصويب/);

    const fresh = await reread(mosque);
    assert.equal(fresh.get('lat'), 23.615);
    assert.equal(fresh.get('locationSource'), 'imam');

    const trail = await as(imam, 'getMosqueAuditTrail', { mosqueId: mosque.id });
    const entry = trail.find((row) => row.action === 'location_corrected');
    assert.ok(entry, 'صُوّب الموقع بلا أثرٍ يميّزه عن تثبيتٍ أوّل');
    assert.match(entry.note, /23\.60000, 58\.50000/,
      'السجلّ يقول «صُوّب» ولا يقول ماذا كان — فلا يُراجَع');
    assert.match(entry.note, /ministry/);
  });

  await t.test('وتصويبٌ يقع خارج الولاية يُردّ — الجهاز يُخطئ لا الإمام', async () => {
    const imam = await signUp('imam');
    const mosque = await claimedBy(imam, 'المحفوظ', { lat: 23.60, lng: 58.50, hasLocation: true });
    await claimedBy(imam, 'جارُ المحفوظ', { lat: 23.61, lng: 58.51, hasLocation: true });

    await assert.rejects(
      as(imam, 'confirmMosqueLocation', { mosqueId: mosque.id, lat: 17.0, lng: 54.1 }),
      /بعيدٌ عن مساجد ولاية/,
    );
    assert.equal((await reread(mosque)).get('lat'), 23.60,
      'قُبل تصويبٌ يضع المسجد في محافظةٍ أخرى — وهو أسوأ من الخطأ الذي جاء يصلحه');
  });

  await t.test('وإمامٌ آخر لا يثبّت موقع مسجدٍ ليس له', async () => {
    const owner = await signUp('imam');
    const stranger = await signUp('imam');
    const mosque = await claimedBy(owner, 'المحروس');

    await assert.rejects(
      as(stranger, 'confirmMosqueLocation', { mosqueId: mosque.id, lat: 23.61, lng: 58.51 }),
      /لستَ مسجَّلاً/,
    );
    assert.equal((await reread(mosque)).get('hasLocation'), false);
  });

  await t.test('وبلا إحداثيات يُشرح السبب لا يُقبل الفراغ', async () => {
    const imam = await signUp('imam');
    const mosque = await claimedBy(imam, 'الصامت');

    await assert.rejects(
      as(imam, 'confirmMosqueLocation', { mosqueId: mosque.id }),
      /أكّد موقعك عند المسجد/,
    );
  });

  await t.test('والمتطوّع لا يثبّت موقع مسجد', async () => {
    const imam = await signUp('imam');
    const volunteer = await signUp('volunteer');
    const mosque = await claimedBy(imam, 'الممنوع');

    await assert.rejects(
      as(volunteer, 'confirmMosqueLocation', { mosqueId: mosque.id, lat: 23.61, lng: 58.51 }),
      /للقائمين على المساجد فقط/,
    );
  });

  await t.test('و`getMyMosques` تقول أيُّها بلا موقع — وإلا لم يظهر الزرّ', async () => {
    const imam = await signUp('imam');
    const blind = await claimedBy(imam, 'المجهول');
    const located = await claimedBy(imam, 'المعلوم', { lat: 23.6, lng: 58.5, hasLocation: true });

    const rows = await as(imam, 'getMyMosques');
    const find = (mosque) => rows.find((row) => row.id === mosque.id);
    assert.equal(find(blind).hasLocation, false);
    assert.equal(find(located).hasLocation, true);
  });

  await t.test('وتقول من أين جاء الموقع — فمن لا يعلم أنه مُخمَّن لا يتحقّق منه', async () => {
    // التصويب متاحٌ للجميع، لكنّ الحاجة إليه ليست واحدة: موقعٌ مستخرَجٌ من
    // خريطةٍ مفتوحة تقديرٌ يُنبَّه إمامُه إليه، وإحداثيّ وزارةٍ اجتاز فحوصنا
    // أقربُ إلى الصواب فلا يُشغَل به.
    const imam = await signUp('imam');
    const guessed = await claimedBy(imam, 'المُخمَّن', {
      lat: 23.6, lng: 58.5, hasLocation: true, locationSource: 'osm',
    });
    const official = await claimedBy(imam, 'الرسمي', {
      lat: 23.61, lng: 58.51, hasLocation: true, locationSource: 'ministry',
    });

    const rows = await as(imam, 'getMyMosques');
    const find = (mosque) => rows.find((row) => row.id === mosque.id);
    assert.equal(find(guessed).locationSource, 'osm');
    assert.equal(find(official).locationSource, 'ministry');
  });
});
