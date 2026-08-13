/**
 * درجةُ الاستعجال — كانت مُعطَّلةً من طرفيها.
 *
 * `createServiceRequest` تقبلها وتكتبها على كل طلب، و`getNearbyOpportunities`
 * وقائمةُ العميل تُرسلانها مع كل صفّ، **ولا نموذجَ يرسلها ولا شاشةَ تذكرها** —
 * قِيس فلم تُذكر كلمة `urgency` في `screens.jsx` كلِّها ولا مرّة. فكلُّ طلبٍ في
 * الإنتاج `normal` إلى الأبد، وقارئُ `schema.json` يرى `low | normal | high`
 * فيظنّ أنّ في المنصّة أولويةً — وهي أوّل ما يقرؤه مشترٍ.
 *
 * **وكانت تُكتب كما تصل بلا قيدٍ بقائمة**: `urgency || 'normal'`. ولمّا صارت
 * تُعرض وسماً يقرأ `URGENCIES[x] || x`، صار نصٌّ حرٌّ من إمامٍ يظهر كما كُتب على
 * شاشة كل متطوّع.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startStack, applySchema, unavailableReason } = require('./harness');

const skip = unavailableReason();
const options = skip ? { skip } : {};

test('الاستعجال يُكتب ويُقرأ ولا يُقبل على علّاته', options, async (t) => {
  const stack = await startStack();
  const { Parse } = stack;
  t.after(() => stack.stop());

  await applySchema(Parse);

  let unique = 0;
  const tokens = new Map();
  async function signUp(role, fullName) {
    const user = new Parse.User();
    user.set('username', `${role}_${Date.now()}_${++unique}`);
    user.set('password', 'Integration12345!');
    user.set('role', role);
    user.set('fullName', fullName);
    await user.signUp();
    tokens.set(user.id, user.getSessionToken());
    return user;
  }
  const as = (user, fn, params = {}) =>
    Parse.Cloud.run(fn, params, { sessionToken: tokens.get(user.id) });

  const imam = await signUp('imam', 'الشيخ سعيد');
  const salim = await signUp('volunteer', 'سالم بن راشد');

  const mosque = new (Parse.Object.extend('Mosques'))();
  mosque.set({
    externalId: `urg_${Date.now()}`, name: 'البلاغ', type: 'جامع', governorate: 'مسقط',
    wilayat: 'بوشر', isClaimed: true, imamId: imam, lat: 23.6, lng: 58.5,
  });
  await mosque.save(null, { useMasterKey: true });

  const create = (title, urgency) => as(imam, 'createServiceRequest', {
    mosqueId: mosque.id, title, category: 'ac', urgency,
    description: 'وصفٌ كافٍ لهذا الاحتياج حتى يفهمه من يقرؤه في المسجد.',
  });

  const stored = async (id) => new Parse.Query('ServiceRequests')
    .get(id, { useMasterKey: true });

  await t.test('ما وسمه الإمام عاجلاً يُحفظ عاجلاً', async () => {
    const created = await create('إصلاح مكيّفات المصلّى', 'high');
    const row = await stored(created.objectId);
    assert.equal(row.get('urgency'), 'high',
      `وُسم عاجلاً فحُفظ «${row.get('urgency')}» — والوسمُ الذي لا يُحفظ ليس وسماً`);
  });

  await t.test('ويصل المتطوّعَ في قائمة الفرص', async () => {
    const nearby = await as(salim, 'getNearbyOpportunities', {
      lat: 23.6, lng: 58.5, radiusKm: 5,
    });
    const hit = nearby.find((row) => row.title === 'إصلاح مكيّفات المصلّى');
    assert.ok(hit, `الفرصة لم تصل المتطوّع أصلاً: ${JSON.stringify(nearby.map((r) => r.title))}`);
    assert.equal(hit.urgency, 'high', 'الفرصة تصل بلا درجة استعجالها');

    /*
     * **ومعها اسمُ المسجد كما يُنادى.** الاستعلام كان يقصر `select` على
     * `name` دون `type`، فتردّ `mosqueTitle` العلَم عارياً وهي تظنّ أنها
     * ركّبته — إصلاحٌ يبدو مطبَّقاً ولا يقع. ولم تكشفه بوّابةٌ ولا اختبار
     * وحدة: كشفته **لقطةُ شاشةٍ للبطاقة نفسها**.
     */
    assert.equal(hit.mosqueName, 'جامع البلاغ',
      `الفرصة تحمل اسم المسجد عارياً: «${hit.mosqueName}»`);
  });

  await t.test('ونصٌّ حرٌّ لا يمرّ إلى شاشة المتطوّعين', async () => {
    const created = await create('تجديد الفرش', '<b>عاجل جداً</b> اتصلوا بي');
    const row = await stored(created.objectId);
    assert.equal(row.get('urgency'), 'normal',
      `نصٌّ حرٌّ حُفظ درجةَ استعجال: «${row.get('urgency')}»`);
  });

  await t.test('والنوع كذلك يُقيَّد بقائمته', async () => {
    const created = await create('صيانة الأبواب', 'low');
    const row = await stored(created.objectId);
    assert.equal(row.get('urgency'), 'low', 'المؤجَّل لم يُحفظ');

    const loose = await as(imam, 'createServiceRequest', {
      mosqueId: mosque.id, title: 'دهان الجدران', category: 'ليس نوعاً',
      description: 'وصفٌ كافٍ لهذا الاحتياج حتى يفهمه من يقرؤه في المسجد.',
    });
    assert.equal((await stored(loose.objectId)).get('category'), 'other',
      'نوعٌ خارج القائمة حُفظ كما وصل');
  });

  /* ————— حدٌّ يجب أن يبقى أخضر ————— */

  await t.test('ومن لم يسمِّ درجةً فطلبُه عاديّ', async () => {
    const created = await as(imam, 'createServiceRequest', {
      mosqueId: mosque.id, title: 'تنظيف الخزّان', category: 'cleaning',
      description: 'وصفٌ كافٍ لهذا الاحتياج حتى يفهمه من يقرؤه في المسجد.',
    });
    assert.equal((await stored(created.objectId)).get('urgency'), 'normal',
      'الافتراضيّ تغيّر — ولا يجوز أن يصير السكوتُ استعجالاً');
  });
});
