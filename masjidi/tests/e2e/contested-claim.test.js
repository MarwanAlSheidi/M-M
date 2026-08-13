/**
 * المشرف يرى أنّ الملكية منازَعة — على الشاشة لا في السلك.
 *
 * `listPendingClaims` صارت تُرسل `contestedCount`، و`tests/integration/`
 * تُثبت أنه يُقيَّد ويصل. **ولا تُثبت أنّ المشرف يراه** — وقِيس مرّتين في
 * دورتين متتاليتين أنّ حقلاً يصل صحيحاً وتُسقطه الشاشة، أو تُنادى دالّةٌ
 * صحيحةً ويُمنع عنها ما تحتاجه.
 *
 * والقرينة هنا ليست زينة: أصعبُ سؤالٍ في هذه المنصّة كيف يُثبت الإمام أنه
 * إمام، وأن يتقدّم اثنان على مسجدٍ واحد **أقوى ما يبلغ المشرف في ذلك** —
 * فيعتمد الأوّلَ لأنه الأوّل لا لأنه الأحقّ.
 *
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:e2e`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const integration = require('../integration/harness');
const e2e = require('./harness');

const skip = integration.unavailableReason() || e2e.unavailableReason();
const options = skip ? { skip } : {};

test('المنازعة تبلغ عين المشرف', options, async (t) => {
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

  let unique = 0;
  const signUp = async (role, fullName) => {
    const user = new Parse.User();
    user.set({
      username: `${role}${stamp}_${++unique}`, password: PASSWORD, role, fullName,
    });
    await user.signUp();
    return user;
  };
  const as = (user, fn, params) =>
    Parse.Cloud.run(fn, params, { sessionToken: user.getSessionToken() });

  const first = await signUp('imam', 'الشيخ سعيد');
  const second = await signUp('imam', 'الشيخ حمد');
  const lone = await signUp('imam', 'الشيخ خالد');

  const mosque = async (name, type, lng) => {
    const row = new (Parse.Object.extend('Mosques'))();
    row.set({
      externalId: `ct_${stamp}_${lng}`, name, type, governorate: 'مسقط',
      wilayat: 'بوشر', lat: 23.6, lng, hasLocation: true,
    });
    await row.save(null, { useMasterKey: true });
    return row;
  };

  const contested = await mosque('البلاغ', 'جامع', 58.5);
  const quiet = await mosque('الفتح', 'مسجد', 58.51);

  await as(first, 'claimMosque', {
    mosqueId: contested.id, capacity: 'imam', lat: 23.6, lng: 58.5,
    evidenceNote: 'أنا إمام هذا الجامع منذ سنوات',
  });
  // يُردّ — وتُقيَّد محاولتُه على الطلب المعلّق
  await as(second, 'claimMosque', {
    mosqueId: contested.id, capacity: 'imam', lat: 23.6, lng: 58.5,
    evidenceNote: 'بل أنا إمامه',
  }).catch(() => null);

  // وطلبٌ لم ينازعه أحد — **الحدّ الذي يبقى أخضر**
  await as(lone, 'claimMosque', {
    mosqueId: quiet.id, capacity: 'imam', lat: 23.6, lng: 58.51,
    evidenceNote: 'أنا إمام هذا المسجد',
  });

  const admin = await signUp('donor', 'المشرف');
  admin.set('role', 'admin');
  await admin.save(null, { useMasterKey: true });

  const panel = await browser.newUserPage();
  await panel.goto(site.url, { waitUntil: 'networkidle' });
  await panel.getByLabel('اسم المستخدم').fill(admin.get('username'));
  await panel.getByLabel('كلمة المرور').fill(PASSWORD);
  await panel.getByRole('button', { name: 'دخول' }).click();
  await panel.waitForSelector('nav.tabs');
  await panel.getByRole('button', { name: 'الإدارة' }).click();
  await panel.waitForSelector('.card');

  const cardFor = (name) => panel.locator('article.card')
    .filter({ hasText: name }).first();

  await t.test('البطاقة المنازَعة تحمل التحذير ونصَّه', async () => {
    const warning = cardFor('جامع البلاغ').locator('[data-testid="contested-claim"]');
    assert.equal(await warning.count(), 1,
      `لا تحذير على بطاقةٍ منازَعة:\n${await cardFor('جامع البلاغ').innerText()}`);

    const said = await warning.innerText();
    assert.match(said, /منازَعة/, `تحذيرٌ لا يقول ما هو: «${said}»`);
    // **والفعل التالي لا الخبر وحده**
    assert.match(said, /تحقّق قبل الاعتماد/, `تحذيرٌ بلا فعلٍ تالٍ: «${said}»`);
    // ولا يُعرض رقمٌ برمجيّ ولا نجومُ ماركداون
    assert.equal(/\*\*|contested/.test(said), false, `نصٌّ غير مقروء: «${said}»`);
  });

  await t.test('وما لم ينازعه أحدٌ يبقى بلا تحذير', async () => {
    const quietCard = cardFor('مسجد الفتح');
    assert.ok(await quietCard.count() > 0, 'الطلب الهادئ غائبٌ عن الطابور');
    assert.equal(await quietCard.locator('[data-testid="contested-claim"]').count(), 0,
      'وُسم بالمنازعة طلبٌ لم ينازعه أحد — فالتحذير على كل بطاقةٍ لا يميّز شيئاً');
  });
});
