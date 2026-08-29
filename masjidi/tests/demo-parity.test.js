/**
 * نسخةُ العرض تخدم كلَّ ما ينادي به التطبيق.
 *
 * `app/demo/` نسخةٌ تُجرَّب باليد: الشاشاتُ نفسها فوق خادمٍ يعمل داخل المتصفّح.
 * وهي **أوّلُ ما يلمسه المشتري** — ومع ذلك دخلت المستودع بلا حارسٍ واحد، ولا
 * يلمسها `npm run verify` بشيء. قِيس: صفرُ ذكرٍ لها في `scripts/verify.js`.
 *
 * **وخطرُها من جنس بنائها**: الخادم في `app/demo/server.js` يُعيد كتابة ما في
 * `cloud/` بلغةِ المتصفّح، فدالّةٌ تُضاف غداً في `api.js` لا يعرفها العرض —
 * ويُقال للمشتري في وجهه «دالّةٌ غير متاحة في العرض».
 *
 * وليس هذا احتياطاً من المستقبل: **الصنفُ وقع بالفعل ثلاث مرّات** ساعةَ بُنيت،
 * وكشفها القياسُ باليد لا حارس —
 *
 *   - الإحداثيات في `location.latitude` لا في `lat`، فكان كلُّ ما هو جغرافيّ
 *     ميّتاً: «لا مسجد ضمن هذا النطاق» على خمسين كيلومتراً.
 *   - `mosqueTitle` خُمِّنت بدل أن تُنسخ، فأعطت «مصلى نساء مصلى النساء».
 *   - ونصُّ الإشعار كتب `name` خاماً لا الاسم كما يُنادى.
 *
 * فهذا الملفّ يقابل **ما يُنادى بما يُخدَم**، اشتقاقاً من المصدرين لا بقائمةٍ
 * مكتوبةٍ باليد (القاعدة ٤٥). وأثرُه على الشاشة يقيسه `tests/e2e/demo.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** كلُّ دالّةِ سحابةٍ يناديها العميل — من `api.js` نفسه. */
const calledByClient = () => [...new Set(
  [...read('app/src/api.js').matchAll(/run\('([a-zA-Z]+)'/g)].map((hit) => hit[1]),
)].sort();

/** وكلُّ دالّةٍ يخدمها العرض — من جدول `FUNCTIONS`. */
const servedByDemo = () => {
  const block = /const FUNCTIONS = \{([\s\S]*?)\n\};/.exec(read('app/demo/server.js'));
  assert.ok(block, 'جدولُ دوال العرض غاب أو تغيّر شكلُه — والحارس أعمى بلا مصدره');
  return [...new Set(
    [...block[1].matchAll(/^ {2}([a-zA-Z]+)\(/gm)].map((hit) => hit[1]),
  )].sort();
};

test('نسخةُ العرض تطابق ما يناديه التطبيق', async (t) => {
  await t.test('المسحُ يبلغ مصدرَيه', () => {
    // حدٌّ أخضر يحرس الأداة نفسها: مسحٌ يُعيد لا شيء يجعل المقابلة تمرّ فارغة
    assert.ok(calledByClient().length >= 25,
      `قُرئ ${calledByClient().length} نداءً فقط — المسح لا يصل`);
    assert.ok(servedByDemo().length >= 25,
      `قُرئ ${servedByDemo().length} دالّة فقط في العرض — المسح لا يصل`);
  });

  await t.test('ولا دالّةَ يناديها التطبيق ولا يخدمها العرض', () => {
    const served = new Set(servedByDemo());
    const missing = calledByClient().filter((name) => !served.has(name));
    assert.deepEqual(missing, [],
      `يُقال للمشتري «دالّةٌ غير متاحة في العرض»: ${missing.join('، ')}`);
  });

  /*
   * **ولا دالّةَ في العرض لا ينادي بها أحد.** بقايا تُقرأ تغطيةً كاذبة: من
   * يقرأ الجدول يظنّ المسار مُجرَّباً وهو لا يُنادى من شاشة.
   */
  await t.test('ولا بقايا في العرض لا ينادي بها التطبيق', () => {
    const called = new Set(calledByClient());
    const dead = servedByDemo().filter((name) => !called.has(name));
    assert.deepEqual(dead, [], `دوالٌّ في العرض لا يناديها أحد: ${dead.join('، ')}`);
  });

  /*
   * **وما نُسخ يبقى منسوخاً.** `mosqueTitle` خُمِّنت أوّلَ مرّة فأعطت «مصلى
   * نساء مصلى النساء»، والصواب أن تُنسخ قاعدةُ الواجهة حرفاً بحرف: الكلمةُ
   * الأولى من النوع، وتُترك إن كان الاسم يحملها.
   */
  await t.test('واسمُ المسجد قاعدتُه واحدة في الموضعين', () => {
    const rule = /const head = \(\(m(?:osque)? && m(?:osque)?\.type\) \|\| ''\)\.trim\(\)\.split\(\/\\s\+\/\)\[0\];/;
    assert.match(read('app/src/api.js'), rule, 'تغيّرت قاعدةُ الاسم في الواجهة');
    assert.match(read('app/demo/server.js'), rule,
      'العرض يُخمّن اسم المسجد بدل أن ينسخ قاعدته — وقد أعطى «مصلى نساء مصلى النساء»');
  });

  /*
   * **والإحداثيات تُقرأ من موضعها.** بيانات الوزارة تحملها في
   * `location.latitude`، وقراءتُها من `lat` تُعطي `undefined` — فيموت كلُّ ما
   * هو جغرافيّ بلا خطأٍ واحد: «لا مسجد ضمن هذا النطاق» على خمسين كيلومتراً.
   */
  await t.test('وبياناتُ العرض تحمل إحداثيات', () => {
    const rows = JSON.parse(read('app/demo/mosques.json'));
    assert.ok(rows.length >= 100, `عيّنةٌ أصغر من أن تُجرَّب: ${rows.length}`);

    const located = rows.filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng));
    assert.equal(located.length, rows.length,
      `${rows.length - located.length} مسجداً بلا إحداثيات — والقرب يموت صامتاً`);

    // وفي عُمان لا في المحيط: خطأُ الحقل يُعطي أرقاماً، وخطأُ المحور يُعطي بحراً
    for (const row of rows) {
      assert.ok(row.lat > 16 && row.lat < 27, `خطُّ عرضٍ خارج السلطنة: ${row.lat}`);
      assert.ok(row.lng > 51 && row.lng < 60, `خطُّ طولٍ خارج السلطنة: ${row.lng}`);
    }

    const governorates = new Set(rows.map((row) => row.governorate));
    assert.ok(governorates.size >= 8,
      `العيّنة من ${governorates.size} محافظات — والبحث يُجرَّب على السلطنة`);
  });
});
