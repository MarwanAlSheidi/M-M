/**
 * الخبر يقود إلى ما أخبر عنه.
 *
 * `getMyNotifications` تُرسل `requestId` مع كل إشعارٍ منذ أوّل يوم، **وكانت
 * الشاشة تُسقطه**: بطاقةُ التنبيه نصٌّ وتاريخٌ ثم لا شيء. وقِيس في متصفّح
 * حقيقي من عين المتبرّع الذي أعلن انتماءه لمسجد:
 *
 *     بطاقات التنبيه: 1 · عناصر قابلة للضغط فيها: 0
 *     «حولي» تذكر الاحتياج؟ لا · «حسابي» تذكره؟ لا
 *
 * فمن قيل له «احتياجٌ جديد في مسجدك» لم يملك أن يرى ما هو. والمتطوّع له
 * «الفرص» والإمام له «مساجدي»، **والمتبرّع لا شاشة له غير هذه** — فخبرُه قلقٌ
 * لا معرفة.
 *
 * ولا يُقاس هذا إلا في متصفّح: البوّابة الحقلية في `tests/admin-fields.test.js`
 * تُثبت أن `requestId` صار يُقرأ، ولا تُثبت أن الضغطة تُفضي إلى شيء.
 *
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:e2e`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const integration = require('../integration/harness');
const e2e = require('./harness');

const skip = integration.unavailableReason() || e2e.unavailableReason();
const options = skip ? { skip } : {};

test('من أُخبر يستطيع أن يرى', options, async (t) => {
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

  const { Parse } = stack;
  const stamp = Date.now();
  const PASSWORD = 'Journey12345!';

  const imam = new Parse.User();
  imam.set({
    username: `im_${stamp}`, password: PASSWORD, role: 'imam', fullName: 'الشيخ سعيد',
  });
  await imam.signUp();

  const mosque = new (Parse.Object.extend('Mosques'))();
  mosque.set({
    externalId: `notif_${stamp}`, name: 'جامع البلاغ', governorate: 'مسقط',
    wilayat: 'بوشر', village: 'الغبرة', isClaimed: true, imamId: imam,
    lat: 23.6, lng: 58.5, locationSource: 'ministry',
  });
  await mosque.save(null, { useMasterKey: true });

  const page = await browser.newUserPage({ latitude: 23.6, longitude: 58.5 });
  await page.goto(site.url, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /سجّل الآن/ }).click();
  await page.getByLabel('اسم المستخدم').fill(`dn_${stamp}`);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByLabel('الاسم الكامل').fill('أبو محمد');
  await page.selectOption('select', 'donor');
  await page.getByRole('button', { name: 'إنشاء حساب' }).click();
  await page.waitForSelector('nav.tabs');

  // يعلن انتماءه، ثم يُنشر في مسجده احتياج
  await page.getByRole('button', { name: 'هذا مسجدي' }).first().click();
  await page.waitForSelector('text=/مسجدك/');

  await Parse.Cloud.run('createServiceRequest', {
    mosqueId: mosque.id,
    title: 'إصلاح مكبّر الصوت',
    description: 'مكبّر الصوت لا يعمل في الأذان ولا تسمعه البيوت المجاورة للمسجد.',
    category: 'electrical',
  }, { sessionToken: imam.getSessionToken() });

  /*
   * **حالةٌ يجب أن تبقى خضراء على `HEAD`** — وبها يُميَّز السقوطُ المقصود من
   * عطبٍ في البيئة: بقيّةُ الحالات تتسلسل من بابٍ واحد، فلو احمرّت كلُّها بلا
   * هذه لما دلّت الحمرةُ على شيء.
   */
  await t.test('الخبر يصل ونصُّه صحيح', async () => {
    await page.getByRole('button', { name: 'التنبيهات' }).click();
    await page.waitForSelector('.card');

    const inbox = await page.locator('main').innerText();
    assert.match(inbox, /احتياجٌ جديد/, 'لم يصله الخبر أصلاً');
    assert.match(inbox, /جامع البلاغ/, 'خبرٌ بلا اسم المسجد الذي انتمى إليه');
  });

  await t.test('بطاقةُ الخبر تُفضي إلى الاحتياج نفسه', async () => {
    const inbox = await page.locator('main').innerText();
    const open = page.locator('[data-testid="open-notified"]');
    assert.ok(await open.count() > 0,
      `الخبر بلا بابٍ يُفتح — البطاقة نصٌّ وتاريخٌ ثم لا شيء:\n${inbox}`);

    await open.first().click();
    await page.waitForSelector('.card h3');

    const shown = await page.locator('main').innerText();
    assert.match(shown, /إصلاح مكبّر الصوت/, `فُتح البابُ على غير الاحتياج:\n${shown}`);
    assert.match(shown, /مكبّر الصوت لا يعمل في الأذان/,
      'العنوان وحده لا يقول ما المشكلة — والوصف هو ما يُعين على الحكم');
    assert.match(shown, /جامع البلاغ/, 'احتياجٌ بلا مسجدٍ يُنسب إليه');
  });

  /* ————— حدودٌ يجب أن تبقى خضراء ————— */

  await t.test('والرجوع يُعيده إلى واردِه لا يُخرجه من الشاشة', async () => {
    await page.getByRole('button', { name: /رجوع/ }).click();
    await page.waitForSelector('.card');
    assert.match(await page.locator('main').innerText(), /احتياجٌ جديد/,
      'الرجوع من الاحتياج أضاع الوارد');
  });

  await t.test('ولا يُعرض للمتبرّع فعلٌ ليس له', async () => {
    await page.locator('[data-testid="open-notified"]').first().click();
    await page.waitForSelector('.card h3');
    const shown = await page.locator('main').innerText();
    // «يهمّني» فعلُ المتطوّع، وشاشتُه «الفرص» — وعرضُه هنا وعدٌ يُردّ عند الخادم
    assert.equal(/يهمّني/.test(shown), false,
      `عُرض على المتبرّع فعلُ تطوّعٍ لا يملكه:\n${shown}`);
  });
});
