/**
 * دُعي إلى العمل — فهل يستطيع أن يقول «نعم»؟
 *
 * صار نداءُ القرب يُحفظ في الوارد، فصار الوارد **قناةَ الدعوة** لا الخبر
 * وحده. والدعوة تُرسل بموقع المتطوّع **ساعةَ النشر**، و«الفرص» تُحسب من
 * موقعه **ساعةَ الفتح** — وبين الساعتين يعود إلى بيته. وقِيس في متصفّح حقيقي:
 *
 *     الوارد:   فرصة تطوّع: إصلاح مكبّر الصوت — جامع البلاغ
 *     الدعوة:   إصلاح مكبّر الصوت · مفتوح للتطوّع · جامع البلاغ
 *     الأزرار:  ["→ رجوع"]
 *     الفرص:    «لا توجد فرص مفتوحة الآن.»
 *
 * **دُعي، ولا يملك إلا أن ينصرف.** وهي أعلى لحظةِ نيّةٍ في المنتَج كلِّه:
 * أُخبر باسمه بعملٍ قريبٍ منه، ففتحه، فلم يجد ما يضغطه.
 *
 * ولا يُقاس هذا إلا في متصفّح: الخادم يقبل `expressInterest` من هذا المتطوّع
 * على هذا الطلب قبل الإصلاح وبعده — **العطب في أنّ أحداً لا يعرضه عليه.**
 *
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:e2e`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const integration = require('../integration/harness');
const e2e = require('./harness');

const skip = integration.unavailableReason() || e2e.unavailableReason();
const options = skip ? { skip } : {};

test('المدعوّ يستطيع أن يقول نعم', options, async (t) => {
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
    externalId: `inv_${stamp}`, name: 'جامع البلاغ', governorate: 'مسقط',
    wilayat: 'بوشر', village: 'الغبرة', isClaimed: true, imamId: imam,
    lat: 23.6, lng: 58.5, locationSource: 'ministry',
  });
  await mosque.save(null, { useMasterKey: true });

  // **ويفتح التطبيق من بيته** — على بُعدٍ يتجاوز أوسع نطاقٍ في الشاشة (٥٠ كم)
  const page = await browser.newUserPage({ latitude: 24.1, longitude: 58.9 });
  await page.goto(site.url, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /سجّل الآن/ }).click();
  await page.getByLabel('اسم المستخدم').fill(`vl_${stamp}`);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByLabel('الاسم الكامل').fill('سالم المتطوّع');
  await page.selectOption('select', 'volunteer');
  await page.getByRole('button', { name: 'إنشاء حساب' }).click();
  await page.waitForSelector('nav.tabs');

  const volunteer = await new Parse.Query(Parse.User)
    .equalTo('username', `vl_${stamp}`).first({ useMasterKey: true });

  // وكان عند المسجد ساعةَ النشر — `lastLat`/`lastLng` حقلان تكتبهما المنصّة
  volunteer.set('lastLat', 23.6);
  volunteer.set('lastLng', 58.5);
  await volunteer.save(null, { useMasterKey: true });

  await Parse.Cloud.run('createServiceRequest', {
    mosqueId: mosque.id,
    title: 'إصلاح مكبّر الصوت',
    description: 'مكبّر الصوت لا يعمل في الأذان ولا تسمعه البيوت المجاورة للمسجد.',
    category: 'electrical',
  }, { sessionToken: imam.getSessionToken() });

  /*
   * **حالةٌ تبقى خضراء على `HEAD`** — وبها يُميَّز السقوطُ المقصود من عطبٍ في
   * البيئة: ما بعدها يتسلسل من هذا الباب، فلو احمرّ كلُّه بلا هذه لما دلّت
   * الحمرةُ على شيء.
   */
  await t.test('الدعوة تصل وتُفتح على العمل نفسه', async () => {
    await page.getByRole('button', { name: 'التنبيهات' }).click();
    await page.waitForSelector('.card');

    const inbox = await page.locator('main').innerText();
    assert.match(inbox, /فرصة تطوّع/, 'لم تصله الدعوة أصلاً');

    await page.locator('[data-testid="open-notified"]').first().click();
    await page.waitForSelector('.card h3');
    const shown = await page.locator('main').innerText();
    assert.match(shown, /إصلاح مكبّر الصوت/, `فُتحت الدعوة على غير عملها:\n${shown}`);
    assert.match(shown, /مفتوح للتطوّع/, 'العمل لم يعد مفتوحاً، فلا معنى للقياس');
  });

  /*
   * **وحدٌّ ثانٍ يبقى أخضر — وهو سببُ وجود هذا الحارس كلِّه.**
   *
   * لو صارت «الفرص» تعرض هذا العمل لَبطَل الاختبار لا لأنه أُصلح بل لأن
   * فرضَه سقط. فيُقاس صراحةً: الشاشة التي أُحيل إليها **لا تعرضه**.
   */
  await t.test('و«الفرص» من بيته لا تعرضه — فليست هي البابَ', async () => {
    await page.getByRole('button', { name: /رجوع/ }).click();
    await page.getByRole('button', { name: 'الفرص' }).click();
    await page.waitForSelector('h2');
    await page.waitForTimeout(2500); // حسمُ الموقع ثم الجلب

    const opportunities = await page.locator('main').innerText();
    assert.equal(/مكبّر الصوت/.test(opportunities), false,
      `صار العمل يظهر في «الفرص» من بيته، فسقط فرضُ هذا القياس:\n${opportunities}`);
  });

  await t.test('وفي الدعوة نفسها يملك أن يقول «يهمّني»', async () => {
    await page.getByRole('button', { name: 'التنبيهات' }).click();
    await page.locator('[data-testid="open-notified"]').first().click();
    await page.waitForSelector('.card h3');

    const buttons = await page.locator('main button').allInnerTexts();
    const join = page.locator('[data-testid="join-notified"]');
    assert.ok(await join.count() > 0,
      `دُعي ولا يملك إلا أن ينصرف — الأزرار: ${JSON.stringify(buttons)}`);

    await join.first().click();
    await page.waitForSelector('.notice');
    const said = await page.locator('.notice').innerText();
    assert.ok(said.trim().length > 0, 'ضُغط الزرّ ولم يُقل له شيء');
  });

  /*
   * **والضغطةُ تُقاس بأثرها عند الإمام لا برسالةٍ على الشاشة.** رسالةٌ خضراء
   * فوق نداءٍ لم يقع هي أسوأ ما يمكن أن يُبنى هنا.
   */
  await t.test('ويبلغ اسمُه قائمةَ المهتمّين عند الإمام', async () => {
    const interests = await new Parse.Query('TaskInterests')
      .equalTo('volunteerId', volunteer)
      .equalTo('status', 'active')
      .find({ useMasterKey: true });

    assert.equal(interests.length, 1,
      `قيل له إنه سُجّل ولا سطرَ له في القاعدة (${interests.length})`);

    const [request] = await new Parse.Query('ServiceRequests')
      .equalTo('title', 'إصلاح مكبّر الصوت').find({ useMasterKey: true });
    assert.equal(interests[0].get('requestId').id, request.id,
      'سُجّل اهتمامُه بعملٍ غير الذي دُعي إليه');
  });
});
