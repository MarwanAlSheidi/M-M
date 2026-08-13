/**
 * كلُّ قيمةٍ يُخرجها الخادم لها اسمٌ عربيّ في الواجهة.
 *
 * الخادم يتكلّم بأسماء برمجية: `admin`، `pending_imam_approval`،
 * `worker_assigned`. والواجهة تترجمها بجداول، وكلُّ موضعٍ يقرؤها كُتب هكذا:
 *
 *     api.ROLES[role] || role
 *
 * فالجدول إن نقص **لم يُعطِ خطأً بل أعطى الاسم البرمجيّ نفسه**، فيقرأ عربيٌّ
 * في واجهةٍ عربية كلمةً إنجليزية لا تعني له شيئاً. وهذا لا يُكتشف بالتشغيل: كلُّ
 * شيء «يعمل».
 *
 * وقد وقع فعلاً. قِيس في متصفّح حقيقي على حساب مشرفٍ مرقّى:
 *
 *     الترويسة: «المشرف ·»        ← فاصلٌ يتلوه فراغ
 *     حسابي:    «الصفة: admin»
 *
 * لأن `ROLES` كانت تخدم غرضين متناقضين — قائمةَ التسجيل (ولا `admin` فيها)
 * وترجمةَ الدور المخزَّن (ولا بدّ منه). والخادم عالج نظيرها في `auth.js`
 * (`ROLE_LABEL` تشمل `admin`) وبقي البابُ الآخر مفتوحاً.
 *
 * فهذا الاختبار يسدّ **الصنف** لا الحالة: يقرأ التعدادات من مصدرها في
 * `cloud/`، والجداول من `app/src/api.js`، ويقابلها. وأيُّ قيمةٍ تُضاف على
 * الخادم بلا اسمٍ عربيّ تُسقطه.
 *
 * **وأداةُ القياس تُقاس أولاً:** الاستخراج بالتعابير النمطية يُخفق صامتاً إن
 * تغيّرت صياغة المصدر، فيصير «لا نقص» معناه «لم أقرأ شيئاً». فكلُّ قائمةٍ
 * تُستخرج يُتحقّق من أنها غير فارغة وأنها بلغت حدّاً أدنى معقولاً.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const API = read('app/src/api.js');

/**
 * يُقيّم كائناً مُصدَّراً من `api.js` كما هو في المصدر.
 *
 * لا يُستورد الملفّ لأنه يُهيّئ Parse عند التحميل فلا يعمل خارج المتصفّح؛
 * وتقييمُ النصّ يقرأ ما يُشحن فعلاً لا نسخةً منه في الاختبار.
 */
function exportedMap(name) {
  const hit = API.match(new RegExp(`export const ${name} = \\{[\\s\\S]*?\\n\\};`));
  assert.ok(hit, `تعذّر استخراج \`${name}\` من api.js — الأداة عمياء لا الشيفرة سليمة`);
  const value = new Function(`${hit[0].replace('export ', '')}\nreturn ${name};`)();
  assert.ok(Object.keys(value).length > 0, `\`${name}\` فارغ — الأداة قرأت خطأً`);
  return value;
}

/** يستخرج قيم تعداد من ملفٍّ على الخادم، ويرفض أن يعود بلا شيء. */
function serverEnum(rel, pattern, least) {
  const hit = read(rel).match(pattern);
  assert.ok(hit, `تعذّر استخراج التعداد من ${rel} — الأداة عمياء`);
  const values = [...hit[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(values.length >= least,
    `${rel}: قُرئت ${values.length} قيمة والمنتظر ${least} فأكثر — الأداة تقرأ ناقصاً`);
  return values;
}

test('لا يقرأ المستخدمُ اسماً برمجياً', async (t) => {
  await t.test('كلُّ دورٍ على الخادم له اسمٌ عربيّ', () => {
    const roles = serverEnum('cloud/lib/auth.js', /const ROLES = \[([^\]]*)\]/, 5);
    const labels = exportedMap('ROLES');

    const missing = roles.filter((role) => !labels[role]);
    assert.deepEqual(missing, [],
      `أدوارٌ تُعرض بأسمائها البرمجية: ${missing.join('، ')}`);
  });

  await t.test('وله اسمٌ في سجلّ المسجد أيضاً — فالفاعل يُذكر بصفته', () => {
    const roles = serverEnum('cloud/lib/auth.js', /const ROLES = \[([^\]]*)\]/, 5);
    const actors = exportedMap('ACTOR_LABEL');

    const missing = roles.filter((role) => !actors[role]);
    assert.deepEqual(missing, [], `أدوارٌ بلا اسمٍ في السجلّ: ${missing.join('، ')}`);
  });

  await t.test('وكلُّ حالة طلبٍ لها اسمٌ عربيّ', () => {
    const status = serverEnum('cloud/functions/requests.js', /const STATUS = \{([\s\S]*?)\n\};/, 8);
    const labels = exportedMap('STATUS_LABEL');

    const missing = status.filter((value) => !labels[value]);
    assert.deepEqual(missing, [], `حالاتٌ تُعرض بأسمائها البرمجية: ${missing.join('، ')}`);
  });

  /*
   * والاستعجالُ والنوع: كانا يُكتبان كما يصلان من العميل بلا قيدٍ بقائمة،
   * و`urgency` صارت وسماً على بطاقة الفرصة يقرأ `URGENCIES[x] || x` — فنصٌّ
   * حرٌّ يخرج كما كُتب على شاشة كل متطوّع.
   */
  await t.test('ولكلّ درجة استعجالٍ اسمٌ عربيّ', () => {
    const values = serverEnum('cloud/functions/requests.js', /const URGENCIES = \[([^\]]*)\]/, 3);
    const labels = exportedMap('URGENCIES');

    const missing = values.filter((value) => !labels[value]);
    assert.deepEqual(missing, [], `درجاتٌ تُعرض بأسمائها البرمجية: ${missing.join('، ')}`);
  });

  /*
   * والصفة التي يُسجَّل بها: إمامٌ أو وكيلٌ أو مساعد.
   *
   * **ولا أحد يملك مسجداً** — مساجد السلطنة للأوقاف، وما يُسجَّل إشرافٌ على
   * شؤون الصيانة. والجدولان — على الخادم وفي الواجهة — يفترقان بلا حارس: صفةٌ
   * يقبلها الخادم ولا اسم لها في الواجهة تُعرض بحروفها الإنجليزية على بطاقة
   * المشرف، وهي التي يقرّر عليها.
   */
  await t.test('ولكلّ صفةِ تسجيلٍ اسمٌ عربيّ', () => {
    /*
     * **والمفاتيح هي التعداد هنا لا القيم** — خلافاً لـ`STATUS`. و`serverEnum`
     * تقرأ القيم المقتبسة، فأعطت صفراً وقالت ذلك صراحةً بدل أن تمرّ خضراء:
     * «قُرئت 0 قيمة والمنتظر 3 فأكثر — الأداة تقرأ ناقصاً».
     */
    const source = read('cloud/functions/mosques.js');
    const block = source.match(/const CAPACITIES = \{([^}]*)\}/);
    assert.ok(block, 'تعذّر استخراج `CAPACITIES` من الخادم — الأداة عمياء');
    const values = [...block[1].matchAll(/(\w+)\s*:/g)].map((hit) => hit[1]);
    assert.ok(values.length >= 3,
      `قُرئت ${values.length} صفة والمنتظر 3 فأكثر — الأداة تقرأ ناقصاً`);

    const labels = exportedMap('CAPACITIES');

    const missing = values.filter((value) => !labels[value]);
    assert.deepEqual(missing, [], `صفاتٌ تُعرض بأسمائها البرمجية: ${missing.join('، ')}`);
  });

  await t.test('ولكلّ نوعِ عملٍ اسمٌ عربيّ', () => {
    const values = serverEnum('cloud/functions/requests.js', /const CATEGORIES = \[([^\]]*)\]/, 7);
    const labels = exportedMap('CATEGORIES');

    const missing = values.filter((value) => !labels[value]);
    assert.deepEqual(missing, [], `أنواعٌ تُعرض بأسمائها البرمجية: ${missing.join('، ')}`);
  });

  await t.test('وكلُّ فعلٍ في سجلّ التدقيق له اسمٌ عربيّ', () => {
    // السجلّ هو أداةُ الشفافية التي قامت عليها المنصّة، ويقرؤه المصلّي
    const actions = serverEnum('cloud/lib/audit.js', /const ACTIONS = \{([\s\S]*?)\n\};/, 19);
    const labels = exportedMap('AUDIT_LABEL');

    const missing = actions.filter((value) => !labels[value]);
    assert.deepEqual(missing, [], `أفعالٌ تُعرض بأسمائها البرمجية: ${missing.join('، ')}`);
  });

  await t.test('ولا اسمَ في الجداول بلا قيمةٍ تقابله', () => {
    // الزيادةُ ليست عطباً يراه مستخدم، لكنها تعني أن جدولاً تخلّف عن الخادم
    const actions = serverEnum('cloud/lib/audit.js', /const ACTIONS = \{([\s\S]*?)\n\};/, 19);
    const stale = Object.keys(exportedMap('AUDIT_LABEL')).filter((k) => !actions.includes(k));
    assert.deepEqual(stale, [], `ترجماتٌ لأفعالٍ لم تعد موجودة: ${stale.join('، ')}`);
  });
});

test('قائمةُ التسجيل ليست جدولَ الترجمة', async (t) => {
  // الغرضان متناقضان: الترجمة تشمل `admin`، والاختيار لا يجوز أن يعرضه —
  // فمن اختاره عند التسجيل كان الخادم يردّه، وعرضُ بابٍ مغلق إرباك.
  const roleBlock = API.match(
    /export const ROLES = \{[\s\S]*?\n\};[\s\S]*?export const SIGNUP_ROLES = [\s\S]*?\n\);/,
  );
  assert.ok(roleBlock, 'تعذّر استخراج الجدولين — الأداة عمياء');
  const { ROLES, SIGNUP_ROLES } = new Function(
    `${roleBlock[0].replace(/export /g, '')}\nreturn { ROLES, SIGNUP_ROLES };`,
  )();

  await t.test('لا `admin` فيما يُختار', () => {
    assert.ok(!SIGNUP_ROLES.admin, '«الإدارة» تُعرض خياراً عند التسجيل');
  });

  await t.test('وما عداه كلُّه معروض', () => {
    const selectable = Object.keys(ROLES).filter((role) => role !== 'admin');
    assert.deepEqual(Object.keys(SIGNUP_ROLES).sort(), selectable.sort(),
      'صفةٌ لا يجدها المسجِّل في القائمة');
  });

  await t.test('وشاشةُ التسجيل تقرأ القائمة لا الجدول', () => {
    const screens = read('app/src/screens.jsx');
    const field = screens.match(/<Field label="الصفة"[\s\S]{0,160}?\/>/);
    assert.ok(field, 'تعذّر العثور على حقل الصفة — الأداة عمياء');
    assert.match(field[0], /api\.SIGNUP_ROLES/,
      'حقل التسجيل يقرأ جدول الترجمة، فيعود الغرضان إلى جدولٍ واحد');
  });
});
