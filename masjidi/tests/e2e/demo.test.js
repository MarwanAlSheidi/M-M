/**
 * نسخةُ العرض تعمل — الحلقةُ كاملةً في صفحةٍ واحدة بلا شبكة.
 *
 * `app/demo/` هي ما يُفتح أمام المشتري ويُجرَّب بيده، وهي **الوحيدة في المنتَج
 * التي دخلت بلا حارس**. و`tests/demo-parity.test.js` يقابل الأسماء بالأسماء،
 * **ولا يُثبت أن ضغطةً واحدة تعمل** — والأعطاب الثلاثة التي وقعت ساعةَ بُنيت
 * كانت كلُّها من هذا الصنف: أسماءٌ صحيحة وسلوكٌ ميّت.
 *
 * فهذا يبنيها من مصدرها ويقودها كما يقودها هو:
 *
 *   1. متطوّعٌ يرى الفرصة القريبة ويسجّل اهتمامه.
 *   2. يُبدَّل الحساب، فيراه القائمُ على المسجد في المهتمّين ويكلّفه.
 *   3. يعود المتطوّع فيجد التكليف في «مهامّي».
 *
 * **وبلا شبكةٍ إطلاقاً**: كلُّ طلبٍ خارجيّ يُقطع في المتصفّح، فما يعمل هنا
 * يعمل داخل إطارٍ معزول. ولو تسرّب نداءٌ واحد لسقط الحارس.
 *
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:e2e`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

const e2e = require('./harness');

const skip = e2e.unavailableReason();
const options = skip ? { skip } : {};

test('نسخةُ العرض تُجرَّب باليد', options, async (t) => {
  const entry = e2e.buildDemo();
  const browser = await e2e.openBrowser();
  t.after(() => browser.close());

  // بلا إذنِ موقع: العرض يثبّت الموقع بنفسه لأن الإطار المعزول يمنعه
  const page = await browser.newUserPage(null);

  const crashes = [];
  const escaped = [];
  page.on('pageerror', (error) => crashes.push(error.message));
  await page.route('**', (route) => {
    const url = route.request().url();
    if (url.startsWith('file:') || url.startsWith('data:')) return route.continue();
    escaped.push(url);
    return route.abort();
  });

  await page.goto(pathToFileURL(entry).href, { waitUntil: 'load' });
  await page.waitForTimeout(900);

  const enter = async (label) => {
    await page.getByRole('button', { name: /حسابات التجربة/ }).click();
    await page.getByRole('button', { name: new RegExp(label) }).click();
    await page.waitForSelector('nav.tabs');
    await page.waitForTimeout(1400);
  };
  const leave = async () => {
    await page.getByRole('button', { name: 'حسابي' }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /خروج/ }).click();
    await page.waitForSelector('.auth form');
  };

  /*
   * **حدٌّ يبقى أخضر**: الصفحة تُقلع وتعرض بابَ الدخول. بلا هذه يكون كلُّ
   * سقوطٍ بعدها مقروءاً عطباً في العرض وهو قد يكون بناءً لم يتمّ.
   */
  await t.test('تُقلع بلا شبكةٍ وتعرض بابها', async () => {
    const shown = await page.locator('body').innerText();
    assert.match(shown, /مسجدي/, `لم تُقلع الصفحة:\n${shown.slice(0, 300)}`);
    assert.match(shown, /حسابات التجربة/, 'لوحةُ الحسابات غائبة — فلا مدخل للمجرِّب');
  });

  await t.test('والمتطوّع يرى الفرصة القريبة', async () => {
    await enter('متطوّع');
    await page.waitForTimeout(1600);
    const shown = await page.locator('main').innerText();
    // الموقع مثبَّتٌ على نقطة المسجد، فالمسافة تُحسب ولا تموت صامتة
    assert.match(shown, /إصلاح مكيّفات المصلّى/,
      `الفرصةُ لا تظهر — والقربُ أوّلُ ما يموت إن أخطأت الإحداثيات:\n${shown}`);
  });

  await t.test('ويسجّل اهتمامه', async () => {
    await page.getByRole('button', { name: 'يهمّني' }).first().click();
    await page.waitForSelector('.notice');
    assert.match(await page.locator('.notice').first().innerText(), /سُجّل اهتمامك/);
  });

  await t.test('ويراه القائمُ على المسجد فيكلّفه', async () => {
    await leave();
    await enter('القائم على المسجد');
    await page.getByRole('button', { name: 'طلبات الصيانة' }).first().click();
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: 'التفاصيل' }).first().click();
    await page.waitForTimeout(1200);

    const shown = await page.locator('main').innerText();
    assert.match(shown, /سالم بن علي/,
      `اهتمامُ المتطوّع لا يبلغ الإمام — والمخزن واحدٌ في الصفحة:\n${shown}`);

    await page.getByRole('button', { name: 'كلّفه بالعمل' }).first().click();
    await page.waitForTimeout(1400);
    assert.match(await page.locator('main').innerText(), /مُسنَد|بانتظار المنفّذ/,
      'ضُغط التكليف ولم تتغيّر الحال');
  });

  await t.test('ويجد المتطوّع تكليفه في «مهامّي»', async () => {
    await leave();
    await enter('متطوّع');
    await page.getByRole('button', { name: /مهامّ/ }).click();
    await page.waitForTimeout(1500);
    const shown = await page.locator('main').innerText();
    assert.match(shown, /إصلاح مكيّفات المصلّى/, `التكليف لا يصله:\n${shown}`);
  });

  /*
   * **والاسمُ كما يُنادى** — لا «مصلى نساء مصلى النساء». وقعت هذه ساعةَ بُنيت
   * النسخة لأن القاعدة خُمِّنت بدل أن تُنسخ، ولم يكشفها إلا النظرُ إلى الشاشة.
   */
  await t.test('واسمُ المسجد لا يُكرَّر نوعُه', async () => {
    await leave();
    await enter('الإدارة');
    await page.waitForTimeout(1400);
    const shown = await page.locator('main').innerText();
    /*
     * **والتكرار لا يقع متجاوراً.** أوّلُ صياغةٍ هنا اشترطت `\s+\1` — أي
     * كلمةً تليها نفسُها — فمرّت على العطب المقيس نفسه: «مصلى نساء مصلى
     * النساء»، والكلمتان بينهما كلمة. فالشرطُ أن يتكرّر لفظُ النوع **في السطر**
     * لا أن يُلاصق نفسه، وقد جُرّب بإعادة العطب فسقط الحارس كما يجب.
     */
    assert.doesNotMatch(shown, /(مصلى|جامع|مسجد)[^\n]*\1/,
      `نوعُ المسجد مكرَّرٌ في اسمه:\n${shown}`);
    assert.match(shown, /طلبات الإشراف/, 'شاشةُ الإدارة لا تعرض طابورها');
  });

  await t.test('ولا نداءَ خرج، ولا خطأَ وقع', () => {
    assert.deepEqual(escaped, [],
      `العرض يطلب من الشبكة — ولا شبكةَ في الإطار المعزول: ${escaped.slice(0, 3).join('، ')}`);
    assert.deepEqual(crashes, [], `أخطاءٌ في المتصفّح: ${crashes.slice(0, 3).join(' | ')}`);
  });
});
