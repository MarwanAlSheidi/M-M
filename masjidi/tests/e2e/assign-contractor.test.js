/**
 * الإمام يصل إلى الشركة من شاشته — لا من دالّةٍ لا زرَّ لها.
 *
 * مسارُ الشركات مبنيٌّ كاملاً — تسجيلٌ بسجلٍّ تجاري، وطابورُ اعتمادٍ عند
 * المشرف، و`assignedContractorId`، وتبويب «مهامّي» عندها، و`startWork`
 * و`markWorkDone` — **ولم يكن له مدخل.** وقِيس في متصفّح حقيقي على إمامٍ عنده
 * احتياجٌ مفتوح وفي القاعدة شركةٌ معتمدة:
 *
 *     شاشة الطلب: «المتطوّعون المهتمّون · لم يسجّل أحد اهتمامه بعد.»
 *     الأزرار:    ["→ رجوع", "إلغاء الطلب"]
 *     ذكرٌ لشركة: **لا**
 *
 * والخادم يقبل التكليف لو بلغه المعرّف — قِيس أن شركةً معتمدة كُلّفت على طلبٍ
 * تكلفتُه صفر فصار `assigned`. فالعطب كان في الطريق إليه لا فيه.
 *
 * ولا يُقاس هذا في اختبار تكامل: ذاك يُثبت أن الدالّة تُعيد القائمة، **ولا
 * يُثبت أن الإمام يبلغها**. وهذا الفرق بعينه هو ما كان قائماً.
 *
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:e2e`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const integration = require('../integration/harness');
const e2e = require('./harness');

const skip = integration.unavailableReason() || e2e.unavailableReason();
const options = skip ? { skip } : {};

test('الإمام يكلّف شركةً معتمدة من شاشته', options, async (t) => {
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
    externalId: `ac_${stamp}`, name: 'جامع البلاغ', governorate: 'مسقط',
    wilayat: 'بوشر', village: 'الغبرة', isClaimed: true, imamId: imam,
    lat: 23.6, lng: 58.5, locationSource: 'ministry',
  });
  await mosque.save(null, { useMasterKey: true });

  const company = new Parse.User();
  company.set({
    username: `co_${stamp}`, password: PASSWORD, role: 'contractor',
    fullName: 'مالك الشركة', companyName: 'شركة البناء الحديث',
    crNumber: '1234567', phone: '99887766', governorate: 'مسقط',
  });
  await company.signUp();
  company.set('isVerifiedContractor', true);
  await company.save(null, { useMasterKey: true });

  await Parse.Cloud.run('createServiceRequest', {
    mosqueId: mosque.id,
    title: 'صيانة مكيّفات المصلّى',
    description: 'ثلاثة مكيّفات لا تعمل، والعمل يحتاج فنّيّ تبريد بمعدّاته.',
    category: 'hvac',
  }, { sessionToken: imam.getSessionToken() });

  const page = await browser.newUserPage({ latitude: 23.6, longitude: 58.5 });
  await page.goto(site.url, { waitUntil: 'networkidle' });
  await page.getByLabel('اسم المستخدم').fill(`im_${stamp}`);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForSelector('nav.tabs');

  /*
   * **حالةٌ تبقى خضراء على `HEAD`** — بها يُميَّز السقوطُ المقصود من عطبٍ في
   * البيئة: ما بعدها يتسلسل من هذه الشاشة.
   */
  await t.test('شاشة الطلب تُفتح ومسارُ التطوّع فيها', async () => {
    await page.getByRole('button', { name: 'طلبات الصيانة' }).first().click();
    await page.waitForSelector('.card');
    await page.getByRole('button', { name: 'التفاصيل' }).first().click();
    await page.waitForTimeout(1200);

    const shown = await page.locator('main').innerText();
    assert.match(shown, /صيانة مكيّفات المصلّى/, `لم تُفتح شاشة الطلب:\n${shown}`);
    assert.match(shown, /المتطوّعون المهتمّون/, 'مسارُ التطوّع نفسه غائبٌ عن الشاشة');
  });

  await t.test('وفيها بابٌ إلى الشركات المعتمدة', async () => {
    const ask = page.locator('[data-testid="ask-contractors"]');
    const buttons = await page.locator('main button').allInnerTexts();
    assert.ok(await ask.count() > 0,
      `لا طريق إلى شركةٍ من شاشة الإمام — الأزرار: ${JSON.stringify(buttons)}`);

    await ask.first().click();
    await page.waitForSelector('[data-testid="assign-contractor"]');
    const shown = await page.locator('main').innerText();

    assert.match(shown, /شركة البناء الحديث/, `القائمة فُتحت بلا الشركة:\n${shown}`);
    // ولا يُفشى ما ليس لهذه الشاشة — الهاتف بعد التكليف، والسجلّ عند المشرف
    assert.equal(/99887766/.test(shown), false, 'الهاتف معروضٌ قبل التكليف');
    assert.equal(/1234567/.test(shown), false, 'السجل التجاري معروضٌ للإمام');
  });

  await t.test('والضغطة تُكلّفها فعلاً', async () => {
    await page.locator('[data-testid="assign-contractor"]').first().click();
    await page.waitForTimeout(1500);

    const [request] = await new Parse.Query('ServiceRequests')
      .equalTo('title', 'صيانة مكيّفات المصلّى').find({ useMasterKey: true });
    assert.equal(request.get('status'), 'assigned',
      'ضُغط الزرّ ولم يتغيّر شيءٌ في القاعدة');
    const assigned = request.get('assignedContractorId');
    assert.ok(assigned && assigned.id === company.id, 'كُلِّفت غيرُ من اختير');
  });

  /*
   * **والتكليف يُقاس عند من كُلِّف.** شركةٌ تُكلَّف ولا يبلغها التكليف هي
   * الحال التي كانت قائمة — بابٌ يُفتح على غرفةٍ لا أحد فيها.
   */
  await t.test('وتبلغ الشركةَ في «مهامّي»', async () => {
    const worker = await browser.newUserPage({ latitude: 23.6, longitude: 58.5 });
    await worker.goto(site.url, { waitUntil: 'networkidle' });
    await worker.getByLabel('اسم المستخدم').fill(`co_${stamp}`);
    await worker.getByLabel('كلمة المرور').fill(PASSWORD);
    await worker.getByRole('button', { name: 'دخول' }).click();
    await worker.waitForSelector('nav.tabs');
    await worker.getByRole('button', { name: /مهامّ/ }).click();
    await worker.waitForTimeout(1500);

    const shown = await worker.locator('main').innerText();
    assert.match(shown, /صيانة مكيّفات المصلّى/,
      `كُلِّفت الشركة ولا تراه في مهامّها:\n${shown}`);
  });
});
