/**
 * الرحلة كاملة في متصفّح حقيقي: إمام يُنشئ طلباً، ومتطوّع يسجّل اهتمامه،
 * والإمام يكلّف ويسحب ويكلّف غيره، والمنفّذ يُبلغ، والإمام يعتمد.
 *
 * ما لا يراه اختبار التكامل: أن الزرّ يظهر في حالته، وأن الشاشة تعرض ما وصل،
 * وأن الحقل يصله قارئ الشاشة. ثلاثتها وقعت هنا من قبل — شاشة «مساجدي» كانت
 * تشتقّ المساجد من مصدرٍ غير الذي يتحقّق منه الخادم، والحقول كانت بلا `htmlFor`.
 *
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:e2e`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const integration = require('../integration/harness');
const e2e = require('./harness');

const skip = integration.unavailableReason() || e2e.unavailableReason();
const options = skip ? { skip } : {};

test('الرحلة كاملة في متصفّح', options, async (t) => {
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

  const stamp = Date.now();
  const PASSWORD = 'Journey12345!';
  /** أصغر PNG صالح — يُرفع كما يرفع المنفّذ صورته. */
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  /**
   * يُلحق بالخطأ ما تعرضه الشاشة فعلاً.
   *
   * «Timeout waiting for button» وحدها لا تقول شيئاً: أهي شاشة خطأ، أم قائمة
   * فارغة، أم زرٌّ باسمٍ آخر؟ نصّ الصفحة يقول ذلك في سطرٍ واحد.
   */
  async function onScreen(page, step, run) {
    try {
      await run();
    } catch (error) {
      const text = await page.locator('main').innerText().catch(() => '(تعذّرت القراءة)');
      error.message = `${step}\n${error.message}\n— ما على الشاشة —\n${text.slice(0, 700)}`;
      throw error;
    }
  }

  /** التسجيل من الواجهة لا بالـSDK: نموذج الدخول جزء من المسار المُختبَر. */
  async function signUpVia(page, { username, fullName, role }) {
    await page.goto(site.url, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /سجّل الآن/ }).click();
    // `getByLabel` يمرّ فقط إن كان الحقل مرتبطاً بعنوانه — وهو ما يحتاجه
    // قارئ الشاشة أيضاً. فشلُه هنا يعني تعذّر الوصول لا خطأ في الاختبار.
    await page.getByLabel('اسم المستخدم').fill(username);
    await page.getByLabel('كلمة المرور').fill(PASSWORD);
    await page.getByLabel('الاسم الكامل').fill(fullName);
    await page.selectOption('select', role);
    await page.getByRole('button', { name: 'إنشاء حساب' }).click();
    await page.waitForSelector('nav.tabs');
  }

  const imam = await browser.newUserPage();
  const salim = await browser.newUserPage();
  const khalid = await browser.newUserPage();

  await t.test('التسجيل يعمل من النموذج، والحقول موصولة بعناوينها', async () => {
    await signUpVia(imam, { username: `imam_${stamp}`, fullName: 'الشيخ سعيد', role: 'imam' });
    await signUpVia(salim, { username: `salim_${stamp}`, fullName: 'سالم بن راشد', role: 'volunteer' });
    await signUpVia(khalid, { username: `khalid_${stamp}`, fullName: 'خالد بن سيف', role: 'volunteer' });

    assert.match(await imam.locator('header .who').innerText(), /إمام مسجد/);
  });

  // المسجد وملكيته يُهيّآن بالمفتاح الرئيسي: مسار طلب الملكية له اختباره في
  // `flow.test.js`، وإقحامه هنا يُطيل الرحلة بلا أن يضيف تغطية للواجهة
  const mosque = new (stack.Parse.Object.extend('Mosques'))();
  await t.test('مسجدٌ مسجَّل باسم الإمام يظهر في «مساجدي»', async () => {
    const imamId = await new stack.Parse.Query(stack.Parse.User)
      .equalTo('username', `imam_${stamp}`).first({ useMasterKey: true });
    mosque.set({
      externalId: `journey_${stamp}`, name: 'جامع الرحمة', governorate: 'مسقط',
      wilayat: 'بوشر', isClaimed: true, imamId, lat: 23.6, lng: 58.5,
    });
    await mosque.save(null, { useMasterKey: true });

    await imam.reload({ waitUntil: 'networkidle' });
    await imam.waitForSelector('text=جامع الرحمة');
  });

  await t.test('الإمام ينشر طلب صيانة', async () => {
    await onScreen(imam, 'الإمام ينشر طلب صيانة', async () => {
    await imam.getByRole('button', { name: 'طلبات الصيانة' }).click();
    await imam.getByRole('button', { name: 'طلب جديد' }).click();
    await imam.getByLabel('العنوان').fill('تصليح إنارة الصحن');
    await imam.getByLabel('الوصف').fill('إنارة صحن المسجد معطّلة منذ أسبوع.');
    await imam.getByRole('button', { name: 'نشر الطلب' }).click();
    await imam.waitForSelector('text=تصليح إنارة الصحن');
    });
  });

  await t.test('المتطوّع يرى الفرصة ويسجّل اهتمامه', async () => {
    await onScreen(salim, 'المتطوّع يرى الفرصة ويسجّل اهتمامه', async () => {
    await salim.getByRole('button', { name: 'الفرص' }).click();
    await salim.waitForSelector('text=تصليح إنارة الصحن');
    await salim.getByRole('button', { name: 'يهمّني' }).first().click();
    await salim.waitForSelector('.notice');
    assert.match(await salim.locator('.notice').innerText(), /سُجّل اهتمامك/);
    });
  });

  await t.test('الإمام يرى المهتمّ ويكلّفه', async () => {
    await onScreen(imam, 'الإمام يرى المهتمّ ويكلّفه', async () => {
    await imam.reload({ waitUntil: 'networkidle' });
    await imam.getByRole('button', { name: 'طلبات الصيانة' }).click();
    await imam.getByRole('button', { name: 'التفاصيل' }).first().click();
    await imam.waitForSelector('button:has-text("كلّفه بالعمل")');
    assert.match(await imam.locator('.card').first().innerText(), /سالم بن راشد/);

    await imam.getByRole('button', { name: 'كلّفه بالعمل' }).click();
    await imam.waitForSelector('button:has-text("سحب التكليف")');
    });
  });

  await t.test('المنفّذ يملك مخرجاً مُعلناً إلى جانب «بدأت العمل»', async () => {
    await onScreen(salim, 'المنفّذ يملك مخرجاً مُعلناً إلى جانب «بدأت العمل»', async () => {
    await salim.getByRole('button', { name: 'مهامّي' }).click();
    await salim.waitForSelector('button:has-text("بدأت العمل")');
    await salim.waitForSelector('button:has-text("أعتذر")');
    });
  });

  await t.test('السحب يُعيد الطلب متاحاً ويُخرجه من مهامّ المنفّذ', async () => {
    await onScreen(imam, 'السحب يُعيد الطلب متاحاً ويُخرجه من مهامّ المنفّذ', async () => {
    await imam.getByRole('button', { name: /سحب التكليف/ }).click();
    await imam.waitForSelector('.tag:has-text("مفتوح")');

    await salim.reload({ waitUntil: 'networkidle' });
    await salim.getByRole('button', { name: 'مهامّي' }).click();
    await salim.waitForSelector('text=لم يُسنَد إليك عمل بعد');
    });
  });

  await t.test('غير المسحوب منه يسجّل، والإمام يكلّفه', async () => {
    await onScreen(khalid, 'غير المسحوب منه يسجّل، والإمام يكلّفه', async () => {
    await khalid.getByRole('button', { name: 'الفرص' }).click();
    await khalid.waitForSelector('button:has-text("يهمّني")');
    await khalid.getByRole('button', { name: 'يهمّني' }).first().click();
    await khalid.waitForSelector('.notice');

    await imam.reload({ waitUntil: 'networkidle' });
    await imam.getByRole('button', { name: 'طلبات الصيانة' }).click();
    await imam.getByRole('button', { name: 'التفاصيل' }).first().click();
    await imam.waitForSelector('button:has-text("كلّفه بالعمل")');
    assert.match(await imam.locator('.card').first().innerText(), /خالد بن سيف/);

    await imam.getByRole('button', { name: 'كلّفه بالعمل' }).click();
    await imam.waitForSelector('button:has-text("سحب التكليف")');
    });
  });

  await t.test('المنفّذ ينفّذ ويُبلّغ بصورةٍ يرفعها', async () => {
    await onScreen(khalid, 'المنفّذ ينفّذ ويُبلّغ بصورةٍ يرفعها', async () => {
    await khalid.getByRole('button', { name: 'مهامّي' }).click();
    await khalid.waitForSelector('button:has-text("بدأت العمل")');
    await khalid.getByRole('button', { name: 'بدأت العمل' }).click();
    await khalid.waitForSelector('button:has-text("أنجزتُ العمل")');
    // صورةٌ حقيقية تمرّ بـ`Parse.File` ثم بحارس المضيف في `validatePhotos`:
    // الإبلاغ بلا صورة يعتمده الإمام على الثقة وحدها
    await khalid.setInputFiles('[data-testid="photo-input"]',
      { name: 'work.png', mimeType: 'image/png', buffer: PNG });
    await khalid.waitForSelector('text=صورة مختارة');

    await khalid.getByRole('button', { name: 'أنجزتُ العمل' }).click();
    await khalid.waitForSelector('text=بانتظار معاينة الإمام');
    });
  });

  await t.test('التنبيهات تصل الإمام في الواجهة بلا أي Installation', async () => {
    await onScreen(imam, 'التنبيهات تصل الإمام في الواجهة بلا أي Installation', async () => {
    await imam.reload({ waitUntil: 'networkidle' });
    await imam.getByRole('button', { name: /التنبيهات/ }).click();
    await imam.waitForSelector('.card');

    const bodies = await imam.locator('.card').allInnerTexts();
    assert.ok(bodies.length >= 3, `وصل ${bodies.length} تنبيهاً فقط`);
    assert.ok(bodies.some((body) => /بانتظار معاينتك/.test(body)));

    await imam.getByRole('button', { name: /تعليم/ }).click();
    await imam.waitForSelector('button:has-text("تعليم")', { state: 'detached' });
    assert.ok(await imam.locator('.card').count() > 0, 'التعليم حذف القائمة بدل أن يعلّمها');
    });
  });

  await t.test('الإمام يرى الصورة ثم يعتمد، وسجل المنفّذ يتحدّث', async () => {
    await onScreen(imam, 'الإمام يرى الصورة ثم يعتمد، وسجل المنفّذ يتحدّث', async () => {
    // الإمام واقفٌ على شاشة التنبيهات، و«طلبات الصيانة» في بطاقة المسجد
    await imam.getByRole('button', { name: 'مساجدي' }).click();
    await imam.getByRole('button', { name: 'طلبات الصيانة' }).click();
    await imam.getByRole('button', { name: 'التفاصيل' }).first().click();

    // الصورة معروضة قبل زرّ الاعتماد لا بعده
    await imam.waitForSelector('[data-testid="gallery"] img');
    const shown = await imam.locator('[data-testid="gallery"] img').first()
      .evaluate((img) => img.naturalWidth > 0 && img.complete);
    assert.ok(shown, 'الصورة في السجل ولا تُحمَّل — فالإمام يعتمد على ثقةٍ لا بيّنة');

    await imam.getByRole('button', { name: 'اعتماد العمل' }).click();
    await imam.waitForSelector('.tag:has-text("منجَز")');

    await khalid.getByRole('button', { name: 'حسابي' }).click();
    await khalid.waitForSelector('.card');
    assert.match(await khalid.locator('.card').innerText(), /أعمال منجزة: 1/);
    });
  });

  await t.test('التطبيق يقول صراحةً حين ينقطع الاتصال', async () => {
    await salim.context().setOffline(true);
    await salim.waitForSelector('[data-testid="offline"]');
    await salim.context().setOffline(false);
  });
});
