/**
 * ما يُرسَل إلى لوحة المشرف يُقرأ فيها — أو يُذكر سببُ تركه.
 *
 * لوحة المشرف هي عنق المنصّة: `docs/DEPLOY.md` يقول إن بلا مراجعةٍ يومية
 * «تتراكم الطلبات وينصرف الأئمة». وقرارُه يُتّخذ بما على الشاشة وحده.
 *
 * وقِيس فوُجد حقلان يعبران السلك ولا يُقرآن قطّ:
 *
 *     listPendingClaims      → createdAt
 *     listPendingContractors → createdAt، phone
 *
 * فالمشرف كان يراجع طلباً عمرُه أربعون يوماً كما يراجع طلب اليوم — **والمنصّة
 * قالت لصاحبه «سيُراجع خلال أيام عمل»**. ويعتمد شركةً تدخل مساجد الناس بسجلٍّ
 * تجاريّ وحده، ورقمُها مُرسَلٌ إليه ولا يراه.
 *
 * ونظيرُ هذا عولج من قبل في `assignedAt`: «حكمٌ يُطلب بلا المدّة التي يقوم
 * عليها». والحقل كان يصل الخادم صحيحاً، والعطب أنه لا يصل العين.
 *
 * وهذا الحارس هو أداةُ القياس نفسها، صارت دائمة. و`ALLOWED_UNREAD` تبدأ
 * **فارغة** قصداً: حقلٌ يُضاف ولا يُعرض يُسقط الاختبار، فيُعرَض أو يُكتب هنا
 * سببُ تركه — والقرار يُتّخذ ولا يُسكت عنه.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

/** حقولٌ تُرسَل عمداً ولا تُعرض — ولكلٍّ سببُه مكتوباً. */
const ALLOWED_UNREAD = {
  // (فارغة قصداً — انظر رأس الملف)
};

/** الكائن الذي تُعيده الدالّة، حقلاً حقلاً. */
function returnedFields(source, fn) {
  const body = source.match(new RegExp(`define\\('${fn}'[\\s\\S]*?\\n\\}\\);`));
  assert.ok(body, `تعذّر استخراج \`${fn}\` — الأداة عمياء لا الشيفرة سليمة`);

  const shape = body[0].slice(body[0].lastIndexOf('return'));
  const fields = [...new Set([...shape.matchAll(/^\s{4,6}([a-zA-Z]+):/gm)].map((m) => m[1]))];
  assert.ok(fields.length >= 5,
    `${fn}: قُرئ ${fields.length} حقلاً فقط — الأداة تقرأ ناقصاً`);
  return fields;
}

/** جسم مكوّن React كما هو في المصدر. */
function component(name) {
  const screens = read('app/src/screens.jsx');
  const hit = screens.match(new RegExp(`export function ${name}\\(\\)[\\s\\S]*?\\n\\}\\n`));
  assert.ok(hit, `تعذّر استخراج \`${name}\` من screens.jsx — الأداة عمياء`);
  return hit[0];
}

test('لوحة المشرف تقرأ ما يصلها', async (t) => {
  const admin = component('AdminHome');

  const QUEUES = [
    { fn: 'listPendingClaims', from: 'cloud/functions/mosques.js' },
    { fn: 'listPendingContractors', from: 'cloud/functions/users.js' },
  ];

  for (const queue of QUEUES) {
    await t.test(`${queue.fn} — لا حقلَ يُرسَل ولا يُقرأ`, () => {
      const fields = returnedFields(read(queue.from), queue.fn);
      const allowed = ALLOWED_UNREAD[queue.fn] || [];

      const unread = fields
        .filter((name) => !new RegExp(`row\\.${name}\\b`).test(admin))
        .filter((name) => !allowed.includes(name));

      assert.deepEqual(unread, [],
        `حقولٌ تعبر السلك ولا تصل عين المشرف: ${unread.join('، ')}`);
    });
  }

  await t.test('والمدّة تُعرض بالأداة الموجودة لا بحسابٍ في الشاشة', () => {
    // `sinceLabel` كانت على هذه الشاشة تُستعمل لتاريخ سحب اعتماد شركة — أي
    // لتفصيلٍ ثانوي — دون المدّة التي ينتظرها الناس. والعربية فيها دقيقة
    // (اليوم/يوم/يومين/أيام/يوماً) فلا تُكرَّر بيدٍ ثانية.
    assert.match(read('app/src/screens.jsx'), /const Waited = /,
      'حساب المدّة مبثوثٌ في البطاقات بدل مكوّنٍ واحد');
    assert.match(admin, /<Waited\s/, 'اللوحة لا تعرض مدّة الانتظار أصلاً');
  });

  await t.test('والوعد المقطوع هو الحدّ — لا رقمٌ مخترَع', () => {
    // «سيُراجع خلال أيام عمل» هو ما قيل لمقدّم الطلب في `claimMosque`
    assert.match(read('cloud/functions/mosques.js'), /سيُراجع خلال أيام عمل/,
      'الوعد تغيّر في الخادم ولم يتغيّر الحدّ المبنيّ عليه');
    assert.match(read('app/src/screens.jsx'), /OVERDUE_REVIEW_DAYS = 7/);
  });
});
