/**
 * اسم المسجد كما يسمّيه أهله — نوعُه ثم علَمُه.
 *
 * **العطب المقيس:** بيانات الوزارة تفصل الاسم عن النوع. الاسم المخزَّن علَمٌ
 * مجرَّد («العلوية»، «المجيب»)، والنوع في حقلٍ آخر. وقِيس على البيانات كاملةً:
 *
 *     «مسجد»  14,339 سجلاً · لا يحمل اسمُه الكلمةَ إلا 1,422 (10٪)
 *
 * فبطاقةٌ تعرض «العلوية» وحدها لا تُقرأ مسجداً، والإمام يمرّ على مسجده في
 * القائمة ولا يعرفه. والنوع كان **يُرسَل إلى الواجهة** ضمن حقول العرض العامّة
 * **ولا يُقرأ في موضع** — وحقلٌ يُكتب ويُرسَل ولا يُقرأ نيّةٌ لا سياسة.
 *
 * ولا يُختبر بالاستيراد: `app/src/api.js` يستورد `./errors` بلا لاحقة، وNode
 * يشترطها في الوحدات — فيُستخرج من المصدر كما في `tests/labels.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'app', 'src', 'api.js'), 'utf8');

/**
 * يستخرج `mosqueTitle` من المصدر ويبنيه دالّةً.
 *
 * **وأداةُ القياس تُقاس قبل ما تقيسه**: استخراجٌ نمطيّ يُخفق صامتاً إن تغيّرت
 * الصياغة، فيصير «كلُّ الحالات تمرّ» معناه «لم أختبر شيئاً».
 */
function extractTitle() {
  const hit = SOURCE.match(/export const mosqueTitle = (\(mosque\) => \{[\s\S]*?\n\};)/);
  assert.ok(hit, 'لم تُستخرج `mosqueTitle` من `app/src/api.js` — تغيّرت صياغتها');
  const body = hit[1].replace(/;$/, '');
  assert.match(body, /type/, 'استُخرجت دالّةٌ لا تذكر النوع — فليست هي');
  // eslint-disable-next-line no-new-func
  return new Function(`return ${body}`)();
}

test('اسم المسجد للعرض', async (t) => {
  const mosqueTitle = extractTitle();

  await t.test('يُضاف النوع إلى العلَم المجرَّد', () => {
    assert.equal(mosqueTitle({ name: 'العلوية', type: 'مسجد' }), 'مسجد العلوية');
    assert.equal(mosqueTitle({ name: 'المجيب', type: 'جامع' }), 'جامع المجيب');
  });

  await t.test('ولا يُكرَّر إن كان في الاسم أصلاً', () => {
    // 1,422 مسجداً اسمُها يحمل نوعَها — ولولا هذا الشرط لقُرئت «مسجد مسجد صومحان»
    assert.equal(mosqueTitle({ name: 'مسجد صومحان', type: 'مسجد' }), 'مسجد صومحان');
    assert.equal(mosqueTitle({ name: 'مصلى المهتدين', type: 'مصلى' }), 'مصلى المهتدين');
  });

  await t.test('ويُؤخذ رأس النوع لا النوع كاملاً', () => {
    // «مصلى نساء ( خاص )» + «النساء» تُقرأ «مصلى النساء» لا النوعَ ملصقاً
    assert.equal(mosqueTitle({ name: 'النساء', type: 'مصلى نساء ( خاص )' }), 'مصلى النساء');
    assert.equal(mosqueTitle({ name: 'العيدين', type: 'مصلى العيدين' }), 'مصلى العيدين');
  });

  await t.test('وما لا نوع له يُعرض كما هو — لا فراغٌ ولا «undefined»', () => {
    assert.equal(mosqueTitle({ name: 'الفتح', type: '' }), 'الفتح');
    assert.equal(mosqueTitle({ name: 'الفتح' }), 'الفتح');
    assert.equal(mosqueTitle({}), '');
    assert.equal(mosqueTitle(null), '');
  });
});

/**
 * وما تعرضه الشاشة يجيء من هنا لا من `mosque.name` مباشرةً.
 *
 * الحارس على **الانحراف**: شاشةٌ جديدة تعرض الاسم خاماً تُعيد العطب حيث لا
 * ينظر أحد. ويُقتصر على مواضع الاكتشاف — وهي التي يصلها النوع.
 */
test('شاشات الاكتشاف تعرض النوع', () => {
  const screens = fs.readFileSync(
    path.join(__dirname, '..', 'app', 'src', 'screens.jsx'), 'utf8');

  const used = screens.match(/api\.mosqueTitle\(/g) || [];
  assert.ok(used.length >= 5,
    `لم تُستعمل \`mosqueTitle\` إلا في ${used.length} موضع — والاكتشاف أكثر`);

  // ولا يبقى عنوانُ بطاقةٍ يقرأ الاسم خاماً
  const raw = screens.match(/<h3>\{(?:selected|mosque)\.name\}<\/h3>/g) || [];
  assert.deepEqual(raw, [],
    `بطاقةٌ تعرض الاسم بلا نوعه: ${raw.join('، ')}`);
});

/**
 * والنسختان — السحابة والواجهة — تتطابقان.
 *
 * الإشعارات كانت تكتب البادئة بيدها: `` `مسجد ${mosque.get('name')}` `` في
 * خمسة مواضع، وستّةٌ أخرى تكتب الاسم عارياً. وقِيس على البيانات كاملةً:
 * **5,297 من 18,214 (29.1٪)** يُخطئ فيها نصُّ «مسجد ‹الاسم›» — ومنها ما ليس
 * خطأً في الدقّة وحدها: «مصلى العيدين» يُنادى «مسجد العيدين»، و«مصلى نساء»
 * يُنادى «مسجد النساء».
 *
 * فمنطقٌ واحدٌ في نسختين بلا حارسٍ يفترق بلا أن يُلحَظ، فيُنادى المسجد في
 * الإشعار بغير ما يُنادى به في الشاشة — كما يحرس `text-clean` المطبِّعَين.
 */
test('نسختا اسم المسجد — السحابة والواجهة — تتطابقان', async (t) => {
  const cloud = require('../cloud/lib/mosque-name');
  const client = extractTitle();

  await t.test('على بيانات الوزارة كاملةً', () => {
    const rows = require('../data/mosques.json');
    assert.ok(rows.length > 18000, `قُرئ ${rows.length} سجلاً — الأداة تقرأ ناقصاً`);

    const differ = rows.filter((row) => cloud.mosqueTitle(row) !== client(row));
    assert.deepEqual(differ.slice(0, 3).map((r) => ({
      name: r.name, type: r.type,
      cloud: cloud.mosqueTitle(r), client: client(r),
    })), [], `النسختان تفترقان في ${differ.length} سجلاً`);
  });

  await t.test('وتقبل كائن Parse كما تقبل السجلّ', () => {
    const asParse = { get: (key) => ({ name: 'المجيب', type: 'جامع' }[key]) };
    assert.equal(cloud.mosqueTitle(asParse), 'جامع المجيب');
    // والحدود نفسها — فالنسخة السحابية ليست تخفيفاً
    assert.equal(cloud.mosqueTitle({ name: 'جامع نبر', type: 'جامع' }), 'جامع نبر');
    assert.equal(cloud.mosqueTitle(null), '');
  });

  await t.test('ولا تبقى بادئةٌ مكتوبةٌ بيدٍ في نصّ إشعار', () => {
    const files = ['cloud/functions/requests.js', 'cloud/functions/users.js',
      'cloud/functions/donations.js', 'cloud/triggers.js'];
    const offenders = [];
    for (const rel of files) {
      const source = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      // ضابط: الملفّ قُرئ فعلاً
      assert.ok(source.length > 1000, `${rel}: قُرئ ناقصاً — الأداة عمياء`);
      for (const hit of source.match(/(مسجد|بمسجد) \$\{mosque/g) || []) {
        offenders.push(`${rel}: ${hit}`);
      }
      for (const hit of source.match(/\$\{mosque\.get\('name'\)\}/g) || []) {
        offenders.push(`${rel}: ${hit}`);
      }
    }
    assert.deepEqual(offenders, [],
      `اسمُ المسجد يُركَّب بيدٍ لا بـ\`mosqueTitle\`: ${offenders.join(' · ')}`);
  });
});
