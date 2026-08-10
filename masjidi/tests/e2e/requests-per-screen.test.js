/**
 * كم نداءً تُنفق الشاشةُ الواحدة؟
 *
 * باقة Back4app المجانية **25 ألف طلبٍ شهرياً**، تشترك فيها بيانات 18 ألف
 * مسجد وكلُّ ضغطةٍ من كل مستخدم. ونداءٌ زائدٌ في شاشةٍ تُفتح يومياً ليس
 * تحسيناً مؤجَّلاً — هو الباقة كلُّها بعد أسابيع.
 *
 * وقد وقع هذا مرّتين في هذا المستودع: شارةُ الوارد كانت تُنفق ضعفَي الباقة،
 * ثم `getRequestContact` كانت تُستدعى **لكل بطاقةٍ على حدة**. وقِيس في متصفّح
 * حقيقي على متطوّعٍ له ثلاثة تكليفات:
 *
 *     مجموع النداءات لفتح «مهامّي»: 8 — منها getRequestContact ثلاثاً
 *
 * وحدُّ التكليفات ثلاثة (`MAX_ACTIVE_ASSIGNMENTS`)، فخمسون منفّذاً يفتحون
 * شاشتهم خمس مرّاتٍ يومياً يُنفقون الباقة كلَّها على هذا وحده.
 *
 * **والقاعدة التي يحرسها هذا الملف: ما يُطلب لقائمةٍ يُطلب مرّةً للقائمة.**
 * أي نداءٍ يتكرّر بعدد الصفوف يُسقطه — ولا يُقاس ذلك إلا في متصفّح، فالعدّ
 * على الشبكة لا في الشيفرة.
 *
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:e2e`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const integration = require('../integration/harness');
const e2e = require('./harness');

const skip = integration.unavailableReason() || e2e.unavailableReason();
const options = skip ? { skip } : {};

test('الشاشة لا تُنفق نداءً لكل صفّ', options, async (t) => {
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

  const signUp = async (page, username, role) => {
    await page.goto(site.url, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /سجّل الآن/ }).click();
    await page.getByLabel('اسم المستخدم').fill(username);
    await page.getByLabel('كلمة المرور').fill(PASSWORD);
    await page.getByLabel('الاسم الكامل').fill(username);
    await page.selectOption('select', role);
    await page.getByRole('button', { name: 'إنشاء حساب' }).click();
    await page.waitForSelector('nav.tabs');
  };

  const worker = await browser.newUserPage();
  await signUp(await browser.newUserPage(), `imam_${stamp}`, 'imam');
  await signUp(worker, `vol_${stamp}`, 'volunteer');

  const imamUser = await new Parse.Query(Parse.User)
    .equalTo('username', `imam_${stamp}`).first({ useMasterKey: true });
  const volUser = await new Parse.Query(Parse.User)
    .equalTo('username', `vol_${stamp}`).first({ useMasterKey: true });

  const mosque = new (Parse.Object.extend('Mosques'))();
  mosque.set({
    externalId: `cost_${stamp}`, name: 'جامع القياس', governorate: 'مسقط',
    wilayat: 'بوشر', isClaimed: true, imamId: imamUser, lat: 23.6, lng: 58.5,
  });
  await mosque.save(null, { useMasterKey: true });

  // ثلاثة تكليفات — وهو الحدّ الأقصى، أي أسوأ حالةٍ ممكنة لهذه الشاشة
  const token = (await Parse.User.logIn(`imam_${stamp}`, PASSWORD)).getSessionToken();
  for (const title of ['عمل أوّل', 'عمل ثانٍ', 'عمل ثالث']) {
    const created = await Parse.Cloud.run('createServiceRequest', {
      mosqueId: mosque.id, title, category: 'electrical',
      description: 'إنارة صحن المسجد معطّلة منذ أسبوع.',
    }, { sessionToken: token });
    await Parse.Cloud.run('assignWorker',
      { requestId: created.objectId, workerId: volUser.id }, { sessionToken: token });
  }

  await t.test('«مهامّي» بثلاثة تكليفات: نداءٌ واحد للتواصل لا ثلاثة', async () => {
    const calls = [];
    worker.on('request', (req) => {
      if (req.method() === 'POST' && /\/functions\/|\/classes\//.test(req.url())) {
        calls.push(req.url().split('/').slice(-2).join('/'));
      }
    });

    await worker.reload({ waitUntil: 'networkidle' });
    await worker.getByRole('button', { name: 'مهامّي' }).click();
    await worker.waitForSelector('[data-testid="counterpart"]');
    // مهلةٌ بعد الاستقرار: النداء الزائد يقع **بعد** ظهور أوّل بطاقة
    await worker.waitForTimeout(1500);

    const tally = calls.reduce((all, name) => ({ ...all, [name]: (all[name] || 0) + 1 }), {});
    const repeated = Object.entries(tally).filter(([, count]) => count > 1);

    assert.equal(await worker.locator('[data-testid="counterpart"]').count(), 3,
      'البطاقات الثلاث لم تُعرض، فالقياس على شاشةٍ غير التي يُراد قياسها');
    assert.deepEqual(repeated, [],
      `نداءٌ يتكرّر بعدد الصفوف: ${JSON.stringify(tally)}`);
  });
});
