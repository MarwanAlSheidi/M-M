/**
 * الاستيراد الكامل يُطلب باسمه — ولا يقع بضغطةٍ عابرة.
 *
 * `docs/DEPLOY.md` يقول منذ حين: «شغّل محافظةً أولاً، وانظر عدّاد الطلبات في
 * لوحة Back4app، ثم استورد الباقي». **وكانت نصيحةً في وثيقةٍ لا يسندها
 * السكربت** — و`npm run seed` بلا وسائط يستورد 18,214 مسجداً.
 *
 * والكلفة مقيسة: ≈911 طلباً إن احتُسبت الدفعة طلباً، و≈18,214 إن احتُسب كلُّ
 * كائنٍ على حدة — أي **ثلاثة أرباع الباقة المجانية في عمليةٍ واحدة، قبل أن
 * يصل المنصّةَ مستخدمٌ واحد**. ولا تراجع فيها.
 *
 * وهذا هو البابُ الوحيد في السكربت الذي لا رجعة منه: كلُّ ما عداه idempotent
 * ويُعاد تشغيله بلا ثمن، **وإنفاقُ الباقة لا يُعاد**.
 *
 * ويُشغَّل السكربت هنا كما يُشغّله المُشغّل — عمليةً كاملة — لأن الحارس على
 * سلوكه لا على شيفرته: قراءةُ السطر لا تُثبت أنه يُنفَّذ قبل الكتابة.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'seed_mosques.js');

/** يُشغّل السكربت بلا مفاتيح: الحارس يقع قبل أي اتصال، وهذا جزءٌ ممّا يُقاس. */
const run = (...argv) => {
  const result = spawnSync(process.execPath, [SCRIPT, ...argv], {
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, PARSE_APP_ID: '', PARSE_MASTER_KEY: '', PARSE_SERVER_URL: '' },
  });
  return { ...result, output: `${result.stdout || ''}${result.stderr || ''}` };
};

test('الاستيراد الكامل لا يقع إلا بطلبٍ صريح', async (t) => {
  await t.test('بلا وسائط: يُردّ ويُقال لماذا', () => {
    const { output, status } = run();

    assert.match(output, /استيرادٌ كامل/, 'استورد السلطنة كلَّها بضغطةٍ عابرة');
    assert.notEqual(status, 0, 'خرج بصفرٍ فيُقرأ نجاحاً في أي سكربت نشر');
  });

  await t.test('ويُعطي الرقمين معاً — فالاحتساب مجهول لا معلوم', () => {
    // الفرق بين الاحتسابين عشرون ضعفاً، و**لا نعرف أيَّهما يعتمده Back4app**.
    // فذكرُ أحدهما وحده يُطمئن أو يُفزع بلا وجه، وذكرُهما يقول الحقيقة: الحدّ
    // الأدنى والحدّ الأقصى، والقرار بعد القياس على القاعدة الحيّة.
    const { output } = run();

    assert.match(output, /911/, 'كلفة الدفعات غائبة');
    assert.match(output, /18214/, 'كلفة الكائن الواحد غائبة');
    assert.match(output, /25,000|25000/, 'الكلفة بلا الباقة رقمٌ بلا معنى');
  });

  await t.test('ويدلّ على البديل الرخيص لا على المنع وحده', () => {
    // منعٌ بلا مخرجٍ يُقرأ عطباً في الأداة، فيُبحث عن التفافٍ عليه
    const { output } = run();

    assert.match(output, /--governorate musandam/, 'يُمنع ولا يُقال ما البديل');
    assert.match(output, /--all/, 'يُمنع ولا يُقال كيف يُطلب حين يُقصد');
  });

  await t.test('ومع `--all` يمضي — الحارس ليس منعاً', () => {
    const { output } = run('--all');

    assert.doesNotMatch(output, /استيرادٌ كامل/,
      'طُلب صراحةً ومع ذلك رُدّ — فالعلمُ به لا ينفع صاحبه');
    // ويسقط بعدها على غياب المفاتيح، وهو المنتظَر في هذه البيئة
    assert.match(output, /PARSE_|مفاتيح|env/i);
  });

  await t.test('والتجربة الجافّة لا يحرسها شيء — لا تكتب ولا تُنفق', () => {
    const { output, status } = run('--dry-run');

    assert.doesNotMatch(output, /استيرادٌ كامل/, 'حُرست تجربةٌ لا تكتب شيئاً');
    assert.match(output, /لم يُكتب شيء/);
    assert.equal(status, 0);
  });
});
