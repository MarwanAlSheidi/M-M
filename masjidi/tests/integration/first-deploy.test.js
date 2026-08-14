/**
 * أوّلُ نشرٍ — مُجرَّباً لا موصوفاً.
 *
 * `npm run deploy` يُشغَّل مرّةً واحدة في عمر المشروع، **وعلى خادمٍ ليس تحت
 * يد كاتبه**. فكُتب وقِيست مساراتُ سقوطه وحدها (`tests/seed-guard.test.js`)،
 * وبقي مسارُ نجاحه موصوفاً في وثيقةٍ لا مُجرَّباً.
 *
 * فهذا يُشغّله كما يُشغّله المُشغّل — **مرّتين** — على `parse-server` حقيقي:
 *
 *     التشغيلة ١:  المخطط 5.8ث · الاستيراد 0.8ث · جديد 264
 *     التشغيلة ٢:  المخطط 2.9ث · الاستيراد 1.2ث · جديد 0 — محدّث 264
 *     مساجد مسندم: 264 لا 528
 *
 * **والإعادةُ هي المقصودة**: أوّلُ نشرٍ يتعثّر فيُعاد، والباقة المجانية ٢٥ ألف
 * طلبٍ شهرياً لا تُستردّ. فتكرارٌ صامتٌ في الاستيراد يُنفقها مرّتين ويُضاعف
 * المساجد في البحث.
 *
 * **وأداةُ القياس نفسها كادت تكذب**: أوّلُ صياغةٍ لها استعملت `execFileSync`،
 * وهي تحجب حلقةَ أحداث العملية التي **تستضيف الخادم** — فلا يجيب الخادمُ
 * ابنَه، ويقف `apply_schema` ثماني دقائق وهو لا يفعل شيئاً (0.17ث معالجة،
 * `ep_poll`). والقاعدة مكتوبةٌ في `docs/REVIEW.md` منذ جولةٍ سابقة، ووقعتُ
 * فيها. فالتشغيل هنا **غيرُ حاجب** — ولو صُدِّق الوقوفُ عطباً في `deploy.js`
 * لأُصلح ما ليس معطوباً.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFile } = require('node:child_process');

const { startStack, applySchema, unavailableReason } = require('./harness');
const integration = require('./harness');

const skip = unavailableReason();
const options = skip ? { skip } : {};

const ROOT = path.join(__dirname, '..', '..');

/** يُشغّل سكربتاً **بلا حجب** — العنقود يعيش في هذه العملية نفسها. */
const runScript = (file, env, argv = []) => new Promise((resolve) => {
  execFile(process.execPath, [path.join(ROOT, 'scripts', file), ...argv],
    { cwd: ROOT, env, timeout: 600000, maxBuffer: 20e6 },
    (error, stdout, stderr) => resolve({
      code: error ? (error.code ?? error.signal) : 0,
      output: `${stdout || ''}${stderr || ''}`,
    }));
});

test('أوّلُ نشرٍ يُعاد بلا ثمن', options, async (t) => {
  const stack = await startStack();
  const { Parse } = stack;
  t.after(() => stack.stop());

  const env = {
    ...process.env,
    PARSE_APP_ID: integration.APP_ID,
    PARSE_MASTER_KEY: integration.MASTER_KEY,
    PARSE_JS_KEY: integration.JS_KEY,
    PARSE_SERVER_URL: stack.serverURL,
  };

  const countMosques = () => new Parse.Query('Mosques')
    .equalTo('governorate', 'مسندم').count({ useMasterKey: true });

  let first;
  let second;

  await t.test('التشغيلة الأولى تمضي إلى آخرها', async () => {
    first = await runScript('deploy.js', env);
    assert.equal(first.code, 0, `خرج برمز ${first.code}:\n${first.output.slice(-600)}`);
    assert.match(first.output, /جديد: 264/,
      `لم يُستورد ما يُنتظر:\n${first.output.slice(-600)}`);
    assert.equal(await countMosques(), 264, 'عددُ المساجد بعد أوّل تشغيلة ليس المنتظر');
  });

  await t.test('ولا تقول «تمّ» عمّا لم تفعله', () => {
    // خطوتان في اللوحة لا في الطرفية — والقاعدة أنّ خطوةً يدويةً تُفحص بأثرها
    assert.match(first.output, /خطوتان لا يفعلهما هذا الأمر/,
      'لم يُذكَّر بما بقي في اللوحة');
    assert.match(first.output, /فهرساً \*\*فريداً\*\*|فهرساً فريداً/,
      'لم يُذكَر الفهرس الفريد — وهو الحماية الوحيدة قبل وقوع التكرار');
  });

  await t.test('والإعادةُ لا تُضاعف مسجداً ولا تُنفق باقةً', async () => {
    second = await runScript('deploy.js', env);
    assert.equal(second.code, 0, `الإعادة خرجت برمز ${second.code}`);
    assert.match(second.output, /جديد: 0/,
      `أُنشئت مساجد في الإعادة:\n${second.output.slice(-600)}`);
    assert.equal(await countMosques(), 264,
      'تضاعفت المساجد بإعادة النشر — والباقة لا تُستردّ');
  });

  /*
   * **و`preflight` يبقى أحمر حتى تُنفَّذ اليدويّتان** — وهذا مقصود: خطوةٌ
   * يدويةٌ تُفحص بأثرها لا يُوثق بها. فالأخضرُ هنا يعني «نُسيت خطوة».
   */
  await t.test('و`preflight` يقول ما بقي ولا يُخضّره', async () => {
    const pre = await runScript('preflight.js', env);
    assert.notEqual(pre.code, 0, 'خرج بصفر والخطوتان اليدويّتان لم تُنفَّذا');
    assert.match(pre.output, /الفهرس الفريد على Mosques\.externalId/,
      `لا يسمّي الفهرس الناقص:\n${pre.output.slice(-600)}`);
    assert.match(pre.output, /مشرفٌ واحد على الأقل/, 'لا يسمّي غياب المشرف');

    // **حدٌّ يبقى أخضر**: يقرأ القاعدة فعلاً — فالحمرة ليست عجزاً عن الوصول
    assert.match(pre.output, /264 مسجداً/,
      `لا يرى ما في القاعدة، فحمرتُه عن عجزٍ لا عن نقص:\n${pre.output.slice(-600)}`);
  });

  await t.test('ولا يُطبع سرٌّ في شيءٍ من ذلك', () => {
    for (const [label, result] of [['الأولى', first], ['الإعادة', second]]) {
      assert.doesNotMatch(result.output, new RegExp(integration.MASTER_KEY),
        `طُبع المفتاح الرئيس في ${label}`);
    }
  });

  await t.test('والمخطط بعدها مطبَّقٌ كما هو مكتوب', async () => {
    // بعد تشغيلتين: الأقفال قائمة — لا صنفَ قام بصلاحياتٍ مفتوحة
    await applySchema(Parse);
    const claims = await Parse.Schema.all({ useMasterKey: true });
    const mosques = claims.find((each) => each.className === 'Mosques');
    assert.ok(mosques, 'صنف Mosques لم يقم');
    assert.deepEqual(mosques.classLevelPermissions.create, {},
      'الإنشاء مفتوحٌ على Mosques بعد النشر');
  });
});
