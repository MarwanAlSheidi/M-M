/**
 * المسجد يُنادى في الشاشة الواحدة باسمٍ واحد.
 *
 * `mosqueTitle` تركّب «نوعَه ثم علَمَه»، والبطاقاتُ تستعملها. **والعناوينُ التي
 * تُفتح بالضغط على البطاقة كانت تأخذ الاسم خاماً.** وقِيس في متصفّح على مصلّى
 * عيدين — و929 سجلاً في بيانات الوزارة نوعُها ذلك:
 *
 *     بطاقة «مساجدي»:        مصلى العيدين   ✓
 *     عنوان «طلبات الصيانة»: العيدين        ✗
 *     عنوان «سجلّ المسجد»:    سجلّ العيدين    ✗
 *
 * **ولماذا في متصفّح لا في المصدر:** حارسٌ على موضع النداء مرّ أخضرَ بعد إصلاح
 * ثلاثة مواضع، وبقي رابعٌ يبني كائناً بحقلين (`{ objectId, name }`) فيُسقط
 * `type` — **فتُنادى الدالّة صحيحةً وهي جائعة فتردّ العلَم عارياً**. وهو نظير
 * ما وقع في `select` بالدورة الماضية حرفاً بحرف. فالحارس على **النصّ المرسوم**.
 *
 * ولا يُوضع في `journey.test.js`: حالُ الشاشة هناك ليس تحت اليد — قِيس فإذا
 * البطاقةُ عندها «جامع الرحمة»، واسمُها يحمل نوعَه أصلاً فيستوي المركَّبُ
 * والخام، **فلا يستطيع الحارس أن يسقط ولو كان العطب قائماً**.
 *
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:e2e`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const integration = require('../integration/harness');
const e2e = require('./harness');

const skip = integration.unavailableReason() || e2e.unavailableReason();
const options = skip ? { skip } : {};

test('المسجد يُنادى باسمٍ واحد في شاشته', options, async (t) => {
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

  const page = await browser.newUserPage({ latitude: 23.6, longitude: 58.5 });
  await page.goto(site.url, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /سجّل الآن/ }).click();
  await page.getByLabel('اسم المستخدم').fill(`im_${stamp}`);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByLabel('الاسم الكامل').fill('الشيخ سعيد');
  await page.selectOption('select', 'imam');
  await page.getByRole('button', { name: 'إنشاء حساب' }).click();
  await page.waitForSelector('nav.tabs');

  // كما تُصدره الوزارة: العلَم في حقل والنوع في آخر
  const imam = await Parse.User.logIn(`im_${stamp}`, PASSWORD);
  const mosque = new (Parse.Object.extend('Mosques'))();
  mosque.set({
    externalId: `name_${stamp}`, name: 'العيدين', type: 'مصلى العيدين',
    governorate: 'مسقط', wilayat: 'بوشر', village: 'الغبرة',
    isClaimed: true, imamId: imam, lat: 23.6, lng: 58.5, locationSource: 'ministry',
  });
  await mosque.save(null, { useMasterKey: true });

  await Parse.Cloud.run('createServiceRequest', {
    mosqueId: mosque.id, title: 'فرش ساحة المصلّى', category: 'carpet',
    description: 'ساحة المصلّى بحاجةٍ إلى فرشٍ قبل صلاة العيد بأيام.',
  }, { sessionToken: imam.getSessionToken() });

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'مساجدي' }).click();
  await page.waitForSelector('.card h3');

  /** عنوانُ البطاقة — وهو المرجع الذي تُقاس به العناوين. */
  const card = await page.locator('.card h3').first().innerText();

  await t.test('البطاقة تحمل نوعه', () => {
    assert.equal(card, 'مصلى العيدين',
      `البطاقة تعرض العلَم عارياً: «${card}» — والقياس نفسه لم يقع`);
  });

  await t.test('وعنوانُ طلبات الصيانة مثلُها', async () => {
    await page.getByRole('button', { name: 'طلبات الصيانة' }).first().click();
    await page.waitForSelector('main h2');
    const heading = await page.locator('main h2').first().innerText();
    assert.equal(heading, card,
      `المسجد يُنادى باسمين: البطاقة «${card}» والعنوان «${heading}»`);
  });

  await t.test('وعنوانُ سجلّ المسجد مثلُها', async () => {
    await page.getByRole('button', { name: /رجوع/ }).click();
    await page.waitForSelector('.card h3');
    await page.getByRole('button', { name: 'سجلّ المسجد' }).first().click();
    await page.waitForSelector('main h2');
    const heading = await page.locator('main h2').first().innerText();
    assert.equal(heading, `سجلّ ${card}`,
      `المسجد يُنادى باسمين: البطاقة «${card}» والعنوان «${heading}»`);
  });

  /* ————— حدٌّ يجب أن يبقى أخضر ————— */

  await t.test('وما حمل اسمُه نوعَه لا يُثنّى', async () => {
    const jami = new (Parse.Object.extend('Mosques'))();
    jami.set({
      externalId: `jami_${stamp}`, name: 'جامع الرحمة', type: 'جامع',
      governorate: 'مسقط', wilayat: 'بوشر', isClaimed: true, imamId: imam,
      lat: 23.62, lng: 58.52, locationSource: 'ministry',
    });
    await jami.save(null, { useMasterKey: true });

    await page.getByRole('button', { name: /رجوع/ }).click();
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'مساجدي' }).click();
    await page.waitForSelector('.card h3');

    const titles = await page.locator('.card h3').allInnerTexts();
    assert.ok(titles.includes('جامع الرحمة'),
      `لم يُعرض الجامع أو ثُنّي نوعُه: ${JSON.stringify(titles)}`);
    assert.equal(titles.some((each) => /جامع جامع/.test(each)), false,
      `ثُنّي النوع: ${JSON.stringify(titles)}`);
  });
});
