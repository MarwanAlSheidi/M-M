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

  /**
   * ينتظر شرطاً يستقرّ.
   *
   * `waitForSelector` لا يكفي حين تتغيّر القائمة وعناصرها من النوع نفسه: يُطابق
   * بقيّةَ العرض السابق فينجح قبل أن تُحدَّث النتيجة. وكذلك حين تمرّ الشاشة
   * بنافذة «جارٍ التحميل…» بين حالتين — يُطابق ما قبلها أو ما بعدها بحسب الحظّ.
   */
  async function waitUntil(page, describe, holds) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (await holds()) return;
      await page.waitForTimeout(150);
    }
    assert.fail(`لم يستقرّ الشرط: ${describe}`);
  }

  const waitForCards = (page, expected) => waitUntil(page,
    `${expected} بطاقة`, async () => await page.locator('.card').count() === expected);

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
    if (role === 'volunteer') {
      // المهارات تُقرأ في قائمة المهتمّين، فبلا جمعها يختار الإمام بلا بيّنة
      await page.getByRole('button', { name: 'كهرباء' }).click();
    }
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

  // على مستوى السلطنة تتكرّر أسماء المساجد بكثرة — «مصلى العيدين» اسمٌ لـ369
  // مسجداً — فالوصول إلى مسجدٍ بعينه هو الاختبار الحقيقي لا وجود شاشة البحث
  await t.test('الإمام يصل إلى مسجده وسط متشابهي الاسم', async () => {
    await onScreen(imam, 'الإمام يصل إلى مسجده وسط متشابهي الاسم', async () => {
    const Mosque = stack.Parse.Object.extend('Mosques');
    // المتصفّح عند 23.6/58.5 — فالأوّل عنده، والباقيان أبعد بالترتيب
    const twins = [
      { wilayat: 'القابل', village: 'المنجرد', lat: 23.6, lng: 58.5 },
      { wilayat: 'صحار', village: 'حلال بني غيث', lat: 23.7, lng: 58.5 },
      { wilayat: 'بركاء', village: 'السلاحة', lat: 23.9, lng: 58.5 },
    ].map((where, i) => {
      const twin = new Mosque();
      twin.set({
        externalId: `twin_${stamp}_${i}`, name: 'مصلى العيدين',
        nameNormalized: 'مصلي العيدين',
        nameTokens: ['مصلي', 'العيدين', where.village],
        governorate: 'شمال الشرقية', hasLocation: true, ...where,
      });
      return twin;
    });
    await stack.Parse.Object.saveAll(twins, { useMasterKey: true });

    await imam.getByRole('button', { name: 'تسجيل مسجد' }).click();
    await imam.getByLabel('اسم المسجد').fill('مصلى العيدين');
    await imam.getByRole('button', { name: 'بحث' }).click();
    await imam.waitForSelector('.card');
    assert.equal(await imam.locator('.card').count(), 3, 'الثلاثة متطابقة الاسم');

    // القرية معروضة — بدونها لا يميّز الإمام واحداً من ثلاثة
    const shown = await imam.locator('.card').allInnerTexts();
    assert.ok(shown.some((text) => text.includes('المنجرد')),
      'القرية غائبة عن البطاقة، فالمساجد الثلاثة سواء في عين الإمام');

    // والأقرب أوّلاً: الإمام واقفٌ عند الأوّل، فهو صدر القائمة
    assert.match(shown[0], /المنجرد/,
      'الترتيب ليس بالأقرب — والإمام يختار من ثلاثة متطابقة الظاهر');

    // وإضافة القرية إلى البحث تُوصله إلى واحد — القرية ضمن الكلمات المفهرسة
    await imam.getByLabel('اسم المسجد').fill('العيدين المنجرد');
    await imam.getByRole('button', { name: 'بحث' }).click();
    await waitForCards(imam, 1);
    assert.match(await imam.locator('.card').innerText(), /المنجرد/);
    });
  });

  // التسجيل يشترط تأكيد الموقع عند المسجد — وهو أقوى ما بيد المشرف للتحقّق
  await t.test('التسجيل يؤكّد الموقع، ويُقبل من عند المسجد', async () => {
    await onScreen(imam, 'التسجيل يؤكّد الموقع', async () => {
      await imam.getByLabel('صفتك').selectOption('agent');
      await imam.getByRole('button', { name: /أؤكّد أني عنده/ }).click();

      await imam.waitForSelector('.notice');
      assert.match(await imam.locator('.notice').innerText(), /من عند المسجد/,
        'الطلب لم يُقبل بتأكيد الموقع — أو لم يُحتسب أنه عنده');
    });
  });

  await t.test('الإمام ينشر طلب صيانة', async () => {
    await onScreen(imam, 'الإمام ينشر طلب صيانة', async () => {
    // عائدٌ من شاشة تسجيل المسجد، و«طلبات الصيانة» في بطاقة المسجد بـ«مساجدي»
    await imam.getByRole('button', { name: 'مساجدي' }).click();
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
    const card = await imam.locator('.card').first().innerText();
    assert.match(card, /سالم بن راشد/);
    assert.match(card, /مهارات: كهرباء/,
      'المهارات تُعرض ولا تُجمع قطّ — فالإمام يختار المنفّذ بلا بيّنة');

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

    // الاسم وحده لا يدلّ على مسجدٍ بعينه — «مصلى العيدين» اسمٌ لـ369 مسجداً —
    // والمنفّذ يقصد المسجد بجسده، فيلزمه موضعه وطريقه لا اسمه
    const task = await khalid.locator('.card').first().innerText();
    assert.match(task, /بوشر/, 'المهمّة بلا موضع — إلى أيّ مسجدٍ يذهب؟');
    const route = khalid.getByRole('link', { name: 'الطريق إلى المسجد' });
    assert.equal(await route.count(), 1, 'لا طريق إلى المسجد');
    assert.match(await route.getAttribute('href'), /23\.6.*58\.5|58\.5.*23\.6/,
      'الرابط لا يحمل إحداثيات المسجد');
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

    // الشرط الذي لا يصدق إلا بعد استقرار الشاشة: بطاقات حاضرة ولا واحدة منها
    // غير مقروءة. وهو يختبر أثر التعليم نفسه لا مجرّد نجاة القائمة.
    //
    // **العدّان من لقطةٍ واحدة**، لا استعلامين متتاليين: بينهما تمرّ الشاشة
    // بإطار «جارٍ التحميل…» بلا بطاقات، فيقرأ الأوّل بطاقاتِ ما قبل التحديث
    // ويقرأ الثاني صفراً غير مقروء — لأنه صفرُ بطاقات أصلاً — فيصدق شرطٌ لم
    // تجتمع طرفاه في لحظة قطّ. كان الاختبار يسقط بذلك مرّةً كل ثلاث تشغيلات.
    /* global document */ // الدالة التالية تُنفَّذ في المتصفّح لا في Node
    await waitUntil(imam, 'الوارد كلّه مقروء والقائمة باقية', async () => imam.evaluate(() => {
      const cards = document.querySelectorAll('.card');
      return cards.length > 0 && document.querySelectorAll('.card.unread').length === 0;
    }));
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

  // الشفافية غاية المنصّة المعلنة، وسجلّ التدقيق أداتها — وكان يُكتب ولا يُقرأ
  await t.test('سجلّ المسجد يحكي ما جرى، ويراه المصلّي كما يراه الإمام', async () => {
    await onScreen(imam, 'سجلّ المسجد يحكي ما جرى', async () => {
      await imam.getByRole('button', { name: 'مساجدي' }).click();
      await imam.getByRole('button', { name: 'سجلّ المسجد' }).first().click();
      await imam.waitForSelector('.card');

      const entries = (await imam.locator('.card').allInnerTexts()).join('\n');
      // الرحلة كاملةً جرت على هذا المسجد، فليكن أثرها فيه
      for (const expected of ['طلب صيانة جديد', 'كُلّف منفّذ بالعمل',
        'سُحب التكليف وعاد الطلب متاحاً', 'اعتمد الإمام العمل']) {
        assert.ok(entries.includes(expected), `«${expected}» غائبة عن السجلّ`);
      }
      // بالعربية لا بأسماء الأفعال البرمجية
      assert.equal(/worker_assigned|request_created/.test(entries), false,
        'السجلّ يعرض أسماء برمجية لا يفهمها قارئه');
      // وبالصفة لا بالاسم — الشفافية لا تعني كشف الأشخاص
      assert.equal(/سالم بن راشد|خالد بن سيف/.test(entries), false,
        'السجلّ يكشف هوية الفاعل، والتصميم يذكر صفته وحدها');
    });
  });

  // من يسجّل بصفةٍ لا يستطيع بها شيئاً ينصرف — والشركة كانت ترى قائمةً فارغة
  // إلى الأبد بلا سبب، والمشرف يرى «السجل التجاري: غير مُدخَل» بلا ما يتحقّق منه
  await t.test('الشركة تُخبَر بأنها بانتظار الاعتماد، وبياناتها تصل المشرف', async () => {
    const company = await browser.newUserPage();
    await onScreen(company, 'الشركة تُخبَر بأنها بانتظار الاعتماد', async () => {
      await company.goto(site.url, { waitUntil: 'networkidle' });
      await company.getByRole('button', { name: /سجّل الآن/ }).click();
      await company.getByLabel('اسم المستخدم').fill(`co_${stamp}`);
      await company.getByLabel('كلمة المرور').fill(PASSWORD);
      await company.getByLabel('الاسم الكامل').fill('مؤسسة النور');
      await company.selectOption('select', 'contractor');

      // الحقول تظهر باختيار الصفة — بدونها يصل المشرف بلا ما يتحقّق منه
      await company.getByLabel('اسم الشركة').fill('مؤسسة النور للمقاولات');
      await company.getByLabel('رقم السجل التجاري').fill('1234567');
      await company.getByRole('button', { name: 'إنشاء حساب' }).click();
      await company.waitForSelector('nav.tabs');

      await company.getByRole('button', { name: 'مهامّي' }).click();
      await company.waitForSelector('.notice');
      assert.match(await company.locator('.notice').innerText(), /بانتظار اعتماد الإدارة/,
        'قائمةٌ فارغة بلا سبب — لا تعرف الشركة لماذا لا يصلها عمل');

      await company.getByRole('button', { name: 'حسابي' }).click();
      await company.waitForSelector('.card');
      const card = await company.locator('.card').innerText();
      assert.match(card, /1234567/, 'السجل التجاري لم يُحفظ عند التسجيل');
      assert.match(card, /بانتظار المراجعة/);
    });
  });

  await t.test('المتبرّع يُخبَر بأن التبرّع غير مُفعَّل بعد', async () => {
    const donor = await browser.newUserPage();
    await onScreen(donor, 'المتبرّع يُخبَر بأن التبرّع غير مُفعَّل', async () => {
      await donor.goto(site.url, { waitUntil: 'networkidle' });
      await donor.getByRole('button', { name: /سجّل الآن/ }).click();
      await donor.selectOption('select', 'donor');
      await donor.waitForSelector('text=التبرّع النقدي غير مُفعَّل بعد');
    });
  });

  await t.test('من سجّل بلا مهارات يستطيع إضافتها بعدُ', async () => {
    await onScreen(salim, 'من سجّل بلا مهارات يستطيع إضافتها بعدُ', async () => {
      await salim.getByRole('button', { name: 'حسابي' }).click();
      await salim.waitForSelector('.card');
      assert.match(await salim.locator('.card').innerText(), /مهاراتك: كهرباء/);

      await salim.getByRole('button', { name: 'تعديل بياناتي' }).click();
      await salim.getByRole('button', { name: 'سباكة' }).click();
      await salim.selectOption('select', 'مسقط');
      await salim.getByRole('button', { name: 'حفظ' }).click();

      await salim.waitForSelector('text=مهاراتك: كهرباء، سباكة');
      assert.match(await salim.locator('.card').innerText(), /المحافظة: مسقط/,
        'المحافظة تُقرأ في خطة الإشعار البديلة ولم تكن تُكتب قطّ');
    });
  });

  await t.test('ونسبةُ البيانات إلى أصحابها ظاهرةٌ على الشاشة', async () => {
    // ليست تجميلاً: مواقعُ المساجد المستخرَجة من OpenStreetMap مرخَّصةٌ بـODbL،
    // وهو **يشترط ذكر المصدر** عند الاستعمال العلنيّ. فالتزامٌ لا يصحّ أن يقوم
    // على سطرٍ في الشيفرة لم يره أحدٌ يُعرَض.
    await onScreen(salim, 'نسبة البيانات', async () => {
      const shown = await salim.locator('main').innerText();
      assert.match(shown, /OpenStreetMap/);
      assert.match(shown, /ODbL/);
      assert.match(shown, /وزارة الأوقاف/);
    });
  });

  /**
   * مسجدٌ بلا موقع، وإمامه يثبّته من عنده.
   *
   * 430 مسجداً على هذه الحال: ستة عشر بلا إحداثيّ في المصدر، والبقية سُحبت
   * ثقتنا من إحداثيّها الكاذب (`scripts/lib/coord-trust.js`). وهي لا تظهر
   * لمتطوّعٍ يبحث حوله. والدالة موجودة ومختبَرة، لكن قيمتها كلّها معلّقة على
   * أن يظهر الزرّ في الشاشة — وظهورُه يتوقّف على حقلٍ تُعيده `getMyMosques`،
   * وهذا ما لا يراه اختبار التكامل.
   *
   * في صفحةٍ وإمامٍ مستقلَّين: زيادة مسجدٍ إلى إمام الرحلة تُغيّر عدد البطاقات
   * الذي تعتمد عليه خطواتٌ قبلها.
   */
  await t.test('مسجدٌ مجهول الموقع يعرض لإمامه زرّ التثبيت، ويختفي بعده', async () => {
    const page = await browser.newUserPage({ latitude: 22.93, longitude: 57.53 });
    const username = `blind_imam_${stamp}`;
    await signUpVia(page, { username, fullName: 'الشيخ حمد', role: 'imam' });

    const imamId = await new stack.Parse.Query(stack.Parse.User)
      .equalTo('username', username).first({ useMasterKey: true });
    const blind = new (stack.Parse.Object.extend('Mosques'))();
    blind.set({
      externalId: `blind_${stamp}`, name: 'جامع النور بنزوى', governorate: 'الداخلية',
      wilayat: 'نزوى', isClaimed: true, imamId, hasLocation: false,
    });
    await blind.save(null, { useMasterKey: true });

    await onScreen(page, 'تثبيت موقع مسجدٍ مجهول الموقع', async () => {
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('text=جامع النور بنزوى');
      assert.match(await page.locator('.notice').innerText(), /موقع هذا المسجد غير معروف/);

      await page.getByRole('button', { name: /ثبّت موقع المسجد/ }).click();
      await waitUntil(page, 'اختفاء تنبيه «مجهول الموقع»',
        async () => await page.locator('.notice').count() === 0);
    });

    const fresh = await new stack.Parse.Query('Mosques').get(blind.id, { useMasterKey: true });
    assert.equal(fresh.get('hasLocation'), true);
    assert.equal(fresh.get('locationSource'), 'imam');
    assert.ok(Math.abs(fresh.get('lat') - 22.93) < 0.001,
      'ثُبّت موقعٌ غير موقع الجهاز');
  });

  /**
   * دعوى «يعمل بلا إنترنت» — يُتحقّق منها هنا وحدها.
   *
   * `npm run verify:pwa` يفحص وجود الـmanifest وعامل الخدمة وسلامتهما، وهو فحص
   * إعدادٍ لا سلوك: لا يُثبت أن الصفحة تُفتح فعلاً بلا شبكة. والفرق بينهما هو
   * الفرق بين تطبيقٍ مثبَّتٍ يعمل وشاشةِ خطأٍ من المتصفّح.
   */
  await t.test('التطبيق يُفتح فعلاً بلا شبكة', async () => {
    const offline = await browser.newUserPage();
    await onScreen(offline, 'التطبيق يُفتح فعلاً بلا شبكة', async () => {
      await offline.goto(site.url, { waitUntil: 'networkidle' });

      // عامل الخدمة يُسجَّل ويُخزّن مسبقاً بعد التحميل — ننتظر سيطرته على الصفحة
      await offline.waitForFunction(
        'navigator.serviceWorker && navigator.serviceWorker.controller !== null',
        null, { timeout: 15000 },
      );

      await offline.context().setOffline(true);
      await offline.reload({ waitUntil: 'domcontentloaded' });

      // الهيكل يُقدَّم من التخزين المسبق: العنوان والنموذج حاضران بلا شبكة
      await offline.waitForSelector('h1');
      assert.match(await offline.locator('h1').innerText(), /مسجدي/,
        'شاشة خطأ المتصفّح لا التطبيق — الدعوى بأنه يعمل بلا إنترنت غير صحيحة');
      await offline.waitForSelector('[data-testid="offline"]');

      await offline.context().setOffline(false);
    });
  });

  await t.test('التطبيق يقول صراحةً حين ينقطع الاتصال', async () => {
    await salim.context().setOffline(true);
    await salim.waitForSelector('[data-testid="offline"]');
    await salim.context().setOffline(false);
  });
});
