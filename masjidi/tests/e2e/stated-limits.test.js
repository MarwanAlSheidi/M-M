/**
 * الشرطُ يُقال قبل الضغطة — في المتصفّح لا في الشيفرة.
 *
 * `tests/limits-parity.test.js` يُثبت أن الرقمين متطابقان وأن الشاشة تذكرهما
 * في مصدرها. **ولا يُثبت أن العين تراهما** — وهذا الفرقُ بعينه هو ما قِيس:
 *
 *     نموذج التسجيل: ذكرٌ لطول كلمة المرور؟ **لا** · minLength؟ **لا شيء**
 *     بعد ملء الاسم والهاتف والصفة والمحافظة والمهارات والضغط:
 *     «كلمة المرور قصيرة — 8 أحرف على الأقل.»
 *
 * فالقاعدة كانت تُعرف بالسقوط بعد دفع الثمن. وهذا يقيس أنها تُقرأ قبله،
 * **وأن الردّ يقع بلا نداءٍ إلى الخادم** — فالباقة ٢٥ ألف طلبٍ شهرياً.
 *
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:e2e`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const integration = require('../integration/harness');
const e2e = require('./harness');

const skip = integration.unavailableReason() || e2e.unavailableReason();
const options = skip ? { skip } : {};

test('الشرطُ يُقرأ قبل أن يُدفع ثمنُه', options, async (t) => {
  const stack = await integration.startStack();
  await integration.applySchema(stack.Parse);

  e2e.buildApp(stack.serverURL, integration.APP_ID, integration.JS_KEY);
  const site = await e2e.serveDist();
  const browser = await e2e.openBrowser();

  t.after(async () => {
    await browser.close();
    await site.stop();
    await stack.stop();
  });

  const page = await browser.newUserPage({ latitude: 23.6, longitude: 58.5 });
  await page.goto(site.url, { waitUntil: 'networkidle' });

  /*
   * **حدٌّ يبقى أخضر**: بابُ الدخول لا يعرض الشرط. حسابٌ أُنشئ قبل أن تُسنّ
   * القاعدة قد تكون كلمتُه أقصر، وتذكيرُه بشرطٍ لا يخصّه إقلاقٌ بلا فائدة.
   */
  await t.test('ولا يُعرض الشرط على باب الدخول', async () => {
    await page.waitForSelector('form');
    const shown = await page.locator('form').innerText();
    assert.equal(/أحرف على الأقل/.test(shown), false,
      `شرطُ التسجيل معروضٌ لمن يدخل بحسابٍ قائم:\n${shown}`);
  });

  await t.test('ونموذجُ التسجيل يقول الشرط قبل أن يُكتب حرف', async () => {
    await page.getByRole('button', { name: /سجّل الآن/ }).click();
    await page.waitForSelector('[data-testid="password-rule"]');

    const rule = await page.locator('[data-testid="password-rule"]').innerText();
    assert.match(rule, /8/, `لا يقول كم حرفاً: ${rule}`);
    assert.match(rule, /اسم المستخدم/, 'يقول الطول ويسكت عن بقيّة الشرط');
  });

  /*
   * **والردُّ يقع بلا نداء.** كان الشرط يُفحص على الخادم وحده، فكلُّ محاولةٍ
   * خاطئة ذهابٌ وإيابٌ على شبكة هاتف ومن باقةٍ محدودة. ويُقاس ذلك **بعدّ
   * النداءات على الشبكة** لا بالنظر إلى الشاشة.
   */
  await t.test('وكلمةٌ قصيرة تُردّ في الجهاز بلا نداءٍ إلى الخادم', async () => {
    const calls = [];
    page.on('request', (request) => {
      if (/\/parse\/(users|login|functions)/.test(request.url())) calls.push(request.url());
    });

    const stamp = Date.now();
    await page.getByLabel('اسم المستخدم').fill(`u_${stamp}`);
    await page.getByLabel('كلمة المرور').fill('12345');
    await page.getByLabel('الاسم الكامل').fill('سالم');
    await page.selectOption('select', 'volunteer');
    await page.getByRole('button', { name: 'إنشاء حساب' }).click();
    await page.waitForSelector('.error');

    const said = await page.locator('.error').innerText();
    assert.match(said, /قصيرة/, `رُدّ بغير سببه: ${said}`);
    assert.equal(calls.length, 0,
      `أُنفق نداءٌ على ما يُعرف أنه يُردّ: ${calls.join('، ')}`);

    // ولا يزال في النموذج — وما كتبه باقٍ، فلا يُعيد ملأه
    assert.equal(await page.getByLabel('الاسم الكامل').inputValue(), 'سالم',
      'ضاع ما كتبه عند الردّ، فيُعيد النموذج من أوّله');
  });

  /*
   * **وحدٌّ ثالث يبقى أخضر**: كلمةٌ سليمة تمضي إلى الخادم فعلاً. بلا هذه يكون
   * «رُدَّ كلُّ شيء بلا نداء» مقروءاً حمايةً وهو قد يكون نموذجاً معطوباً.
   */
  await t.test('والسليمة تمضي ويُنشأ الحساب', async () => {
    await page.getByLabel('كلمة المرور').fill('Volunteer12345');
    await page.getByRole('button', { name: 'إنشاء حساب' }).click();
    await page.waitForSelector('nav.tabs');
    assert.ok(await page.locator('nav.tabs').count() > 0, 'لم يُنشأ الحساب السليم');
  });

  await t.test('وحدُّ الصورة مقروءٌ قبل اختيارها', async () => {
    // شاشةُ الإبلاغ للمكلَّف — والنصّ يُقرأ من مصدره في الحزمة المبنيّة
    /* eslint-disable no-undef -- يُنفَّذ داخل المتصفّح لا في Node */
    const bundle = await page.evaluate(async () => {
      const found = [...document.querySelectorAll('script[src]')].map((tag) => tag.src);
      const bodies = await Promise.all(found.map((src) => fetch(src).then((r) => r.text())));
      return bodies.join('\n');
    });
    /* eslint-enable no-undef */
    assert.match(bundle, /حتى .*صور، وكلُّ صورةٍ دون/,
      'حدُّ الصورة غائبٌ عن الحزمة المبنيّة — فلا يبلغ عيناً');
    assert.match(bundle, /لم تُضَف/,
      'الكبيرةُ تُرفع ثم تُردّ — ولا تُردّ قبل الرفع');
  });
});
