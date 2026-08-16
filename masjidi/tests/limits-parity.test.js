/**
 * الحدُّ المكتوب في الشاشة هو الحدُّ المفروض على الخادم.
 *
 * الدورة الماضية سُنّت قواعدُ على الخادم — طولُ كلمة المرور، ونوعُ الصورة
 * وحجمُها — وكلُّها تردّ بالعربية. **ثم قِيس في متصفّح حقيقي من يقف أمام
 * النموذج**:
 *
 *     نموذج التسجيل: ذكرٌ لطول كلمة المرور؟ **لا** · minLength؟ **لا شيء**
 *     بعد ملء الاسم والهاتف والصفة والمحافظة والمهارات والضغط:
 *     «كلمة المرور قصيرة — 8 أحرف على الأقل.»
 *
 * فالقاعدة لا تُعرف إلا **بالسقوط بعد دفع الثمن**. والصورةُ أسوأ: ستّةُ
 * ميغابايت تصعد كاملةً من هاتفٍ على شبكةٍ محمولة ثم تُردّ.
 *
 * فصارت تُقال قبل الضغطة. **وهذا يُنشئ خطراً جديداً**: رقمان لشيءٍ واحد —
 * واحدٌ في `cloud/` يفرض، وواحدٌ في `app/` يَعِد. فإن شُدّد الأوّل وبقي الثاني
 * أوسعَ، صار النموذج يَعِد بما يُردّ عند أوّل ضغطة — **وذلك أسوأ من ألّا يقول
 * شيئاً**. فيُقابَلان هنا: الرقم يُقرأ من مصدره في `cloud/` نصّاً، ويُقابَل
 * بما تصدّره الواجهة.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** رقمٌ معرَّفٌ في مصدره — ولا يُقرأ بالاستيراد: `cloud/` يلزمه `Parse` العامّة. */
function constantIn(rel, name) {
  const source = read(rel);
  const hit = new RegExp(`${name}\\s*=\\s*([^;]+);`).exec(source);
  assert.ok(hit, `${name} غير معرَّفٍ في ${rel} — أزال أحدُهم الحدَّ من الخادم`);
  // تعبيرٌ حسابيّ بسيط (`5 * 1024 * 1024`) يُقرأ كما كُتب
  const value = Number(new Function(`return (${hit[1].trim()})`)());
  assert.ok(Number.isFinite(value), `${name} في ${rel} ليس رقماً: ${hit[1]}`);
  return value;
}

/**
 * حدُّ الواجهة كما تُصدّره — أو `null` إن لم تكن تعرفه.
 *
 * **ولا يُقرأ في أعلى الملفّ.** أوّلُ صياغةٍ أكّدت وجود `LIMITS` عند التحميل،
 * فسقط الملفّ كلُّه على `HEAD` قبل أن تبدأ حالةٌ واحدة — **صفرُ حالاتٍ ورمزُ
 * سقوط**، لا يُميَّز من عطبٍ في البيئة. وهو الدرس نفسه الذي تكرّر في الدورة
 * الماضية، فليكن هنا مكتوباً لا مُعاداً.
 */
const clientLimit = (key) => {
  const block = /export const LIMITS = \{([\s\S]*?)\};/.exec(read('app/src/api.js'));
  if (!block) return null;
  const hit = new RegExp(`${key}:\\s*([^,\\n]+)`).exec(block[1]);
  if (!hit) return null;
  return Number(new Function(`return (${hit[1].trim()})`)());
};

test('حدود الواجهة هي حدود الخادم', async (t) => {
  await t.test('طولُ كلمة المرور', () => {
    assert.equal(clientLimit('passwordMin'), constantIn('cloud/lib/auth.js', 'PASSWORD_MIN'),
      'النموذج يَعِد بطولٍ غير الذي يفرضه الخادم — أو لا يعرفه أصلاً');
  });

  await t.test('وحجمُ الصورة', () => {
    assert.equal(clientLimit('photoBytes'), constantIn('cloud/triggers.js', 'MAX_FILE_BYTES'),
      'الشاشة تقول حجماً والخادم يردّ عند غيره');
  });

  await t.test('وعددُ الصور', () => {
    assert.equal(clientLimit('photoCount'), constantIn('cloud/functions/requests.js', 'MAX_PHOTOS'),
      'الشاشة تقبل عدداً والخادم يردّ عند غيره');
  });

  /*
   * **والنصُّ يُقال مرّةً واحدة.** رسالتان لعطبٍ واحد — واحدةٌ من الواجهة
   * وأخرى من الخادم — تُقرآن سببين، فيظنّ القارئ أن شيئين وقعا.
   */
  await t.test('ورسالةُ الردّ واحدةٌ في الموضعين', () => {
    const server = read('cloud/lib/auth.js');
    const app = read('app/src/api.js');
    for (const fragment of ['كلمة المرور قصيرة', 'اسم المستخدم نفسه', 'حرفٌ واحد مكرَّر']) {
      assert.ok(server.includes(fragment), `نصُّ الخادم تغيّر: ${fragment}`);
      assert.ok(app.includes(fragment), `الواجهة تقول غير ما يقوله الخادم: ${fragment}`);
    }
  });

  /*
   * **والشاشة تقولها فعلاً** — لا يكفي أن تعرفها `api.js`. وهذا الفرق بعينه
   * هو ما قِيس: الحدُّ كان مفروضاً ومعروفاً للخادم، وغائباً عن العين.
   */
  await t.test('والنموذجان يذكرانها للعين', () => {
    const screens = read('app/src/screens.jsx');
    assert.match(screens, /data-testid="password-rule"/,
      'شرطُ كلمة المرور لا يُعرض في نموذج التسجيل');
    assert.match(screens, /data-testid="photo-rule"/,
      'حدُّ الصورة لا يُعرض قبل الرفع');
    assert.match(screens, /api\.LIMITS\.passwordMin/,
      'الرقم مكتوبٌ باليد في الشاشة بدل قراءته من مصدره');
    assert.match(screens, /api\.LIMITS\.photoBytes/,
      'حجمُ الصورة مكتوبٌ باليد في الشاشة');
  });
});
