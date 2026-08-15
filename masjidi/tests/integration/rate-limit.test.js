/**
 * حدُّ معدّل الطلبات — أين يعمل، وأين يموت صامتاً.
 *
 * **الصيغة المغرية** أن يُشحن الحدُّ مع الكود:
 * `Parse.Cloud.define(name, handler, { rateLimit })` — فلا يحتاج لوحةً ولا
 * مالكاً يتذكّر. **وقِيست على `parse-server` 9.10.0 فإذا هي لا تفعل شيئاً**،
 * بلا خطأٍ ولا تحذير: صفرُ حدودٍ مسجَّلة، وخمسةٌ وسبعون نداءً على حدٍّ من
 * ستّين تمرّ كلُّها.
 *
 * والآلية: `define` ينادي `addRateLimit(route, appId, true)` → `Config.get`
 * **يبني كائناً جديداً في كل نداء**؛ وكود السحابة يُحمَّل قبل أن يُنشئ الإقلاع
 * `rateLimits` في المخزون، فتُدفع الحدود إلى مصفوفةٍ على كائنٍ يُرمى.
 *
 * وهذا الملفّ **يثبّت المقيس** لئلا يُعاد تأليفُ الوهم: أن التسجيل من التحميل
 * ميّت، وأن الإنفاذ نفسه سليمٌ حين يُسجَّل في حينه. فمن قرأ «الحدود مضبوطة في
 * المستودع» وهي ليست مضبوطة، كان أسوأ حالاً ممّن يعلم أنها ليست.
 *
 * **ولا يُقاس هذا من `127.0.0.1`**: الحدُّ يتخطّى صراحةً كلَّ طلبٍ مصدرُه
 * العودة الداخلية (`skip` في `middlewares.js`)، فحارسٌ من هناك يمرّ أخضر على
 * حدٍّ لا يعمل. ولذلك يُشغَّل الملفّ بعنوانٍ غير داخليّ — ويتخطّى نفسه إن لم
 * يجد واحداً، ويقول لماذا.
 *
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:integration`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');

const integration = require('./harness');
const { POLICY, UNLIMITED, rateLimitConfig } = require('../../scripts/lib/rate-limit');

/** أوّلُ عنوانٍ غير داخليّ — الحدُّ لا يُقاس من العودة الداخلية. */
const externalHost = () => Object.values(os.networkInterfaces()).flat()
  .find((row) => row && row.family === 'IPv4' && !row.internal)?.address || null;

const host = externalHost();
const skip = integration.unavailableReason()
  || (host ? null : 'لا عنوان غير داخليّ — والحدُّ يتخطّى 127.0.0.1 صراحةً');
const options = skip ? { skip } : {};

test('حدُّ المعدّل: أين يعمل وأين يموت صامتاً', options, async (t) => {
  process.env.MASJIDI_IT_BIND = '0.0.0.0';
  const stack = await integration.startStack();
  const { Parse } = stack;
  t.after(() => stack.stop());

  await integration.applySchema(Parse);

  const user = new Parse.User();
  user.set({ username: `rl_${Date.now()}`, password: 'Integration12345!', role: 'volunteer' });
  await user.signUp();
  const token = user.getSessionToken();

  /* المفاتيح في الجسم — هكذا ترسلها حزمة Parse للمتصفّح، فالقياس على ما يفعله
     العميل الحقيقي. والعنوان خارجيٌّ لا `127.0.0.1`. */
  const base = stack.serverURL.replace('127.0.0.1', host);
  const call = (name) => fetch(`${base}/functions/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      _ApplicationId: integration.APP_ID,
      _JavaScriptKey: integration.JS_KEY,
      _SessionToken: token,
      query: 'جامع',
    }),
  });

  const Config = require('parse-server/lib/Config');
  const registered = () => (Config.get(integration.APP_ID).rateLimits || []).length;

  /*
   * **حالةٌ خضراء تُثبت أن المِرقاة تعمل** (القاعدة ٤٦): لولاها لكان «لا يُردّ
   * أحد» مقروءاً حدّاً ميّتاً وهو قد يكون اتصالاً ميّتاً.
   */
  await t.test('النداء يصل من عنوانٍ خارجيّ', async () => {
    const res = await call('health');
    assert.equal(res.status, 200, `لا يصل النداء أصلاً من ${host}`);
  });

  await t.test('والتسجيل من كود السحابة لا يُسجّل شيئاً — بلا خطأ', () => {
    // كودُ السحابة محمَّلٌ كاملاً، وفيه ٣٨ دالّة. فلو كان `define` يسجّل
    // الحدود لكان العدد بعددها.
    assert.equal(registered(), 0,
      'صار التسجيل من التحميل يعمل — راجع `scripts/lib/rate-limit.js`، '
      + 'فالحدود يمكن أن تُشحن مع الكود وتُسقَط الخطوة اليدوية');
  });

  await t.test('وحدٌّ يُسجَّل بعد الإقلاع يلتصق ويعمل فعلاً', async () => {
    const before = registered();
    /* `Parse` هنا هو `parse/node` بلا `Cloud.define` — والتسجيل يقع على
       النسخة العامّة التي يضعها `parse-server` نفسه، وهي التي يقرؤها. */
    const cloud = global.Parse;
    cloud.Cloud.define('__ratelimit_probe__', async () => ({ ok: true }), {
      rateLimit: {
        requestCount: 3, requestTimeWindow: 60000, zone: 'user',
        errorResponseMessage: 'كثيرٌ جداً.',
      },
    });
    assert.equal(registered(), before + 1, 'لم يلتصق الحدُّ ولو بعد الإقلاع');

    const statuses = [];
    for (let at = 0; at < 6; at += 1) {
      statuses.push((await call('__ratelimit_probe__')).status);
    }
    assert.deepEqual(statuses, [200, 200, 200, 429, 429, 429],
      `الإنفاذ نفسه معطوب — لا التسجيل وحده: ${statuses.join(' ')}`);
  });

  /*
   * **وكلُّ دالّةٍ لها قرار** (القاعدة ٤٥): سياسةٌ في `POLICY`، أو سببٌ مكتوب
   * في `UNLIMITED`. فدالّةٌ تُضاف غداً لا تمرّ في صمت — والصمتُ هنا هو العطب.
   */
  await t.test('ولا دالّةَ بلا قرار', () => {
    const api = require('../helpers/parse-mock').loadCloud('modular');
    const undecided = Object.keys(api.functions)
      .filter((name) => !POLICY[name] && !UNLIMITED[name])
      .sort();
    assert.deepEqual(undecided, [],
      `دوالٌّ بلا قرارٍ في حدّ المعدّل: ${undecided.join('، ')}`);

    // ولا قرارَ لدالّةٍ زالت — قائمةٌ تحمل أسماءً ميّتة تُقرأ تغطيةً كاذبة
    const gone = [...Object.keys(POLICY), ...Object.keys(UNLIMITED)]
      .filter((name) => !api.functions[name]).sort();
    assert.deepEqual(gone, [], `قرارٌ لدالّةٍ لا وجود لها: ${gone.join('، ')}`);
  });

  await t.test('والقيمة المطبوعة تشمل بابَي الدخول والتسجيل', () => {
    const paths = rateLimitConfig().map((row) => row.requestPath);
    // وهما ليسا دالّتَي سحابة، فلا سبيل إلى حدّهما إلا من إعدادات الخادم —
    // وعليهما تخمينُ كلمات المرور وإغراقُ التسجيل
    assert.ok(paths.includes('/login'), 'بابُ الدخول بلا قفلٍ على التخمين');
    assert.ok(paths.includes('/users'), 'التسجيل بلا حدٍّ على الإغراق');
    assert.equal(paths.length, Object.keys(POLICY).length + 2);

    // وكلُّ سطرٍ صالحٌ لـ`parse-server` — مفتاحٌ مجهول يُسقط الإقلاع كلَّه
    const allowed = new Set(['requestPath', 'requestCount', 'requestTimeWindow',
      'requestMethods', 'zone', 'errorResponseMessage', 'includeInternalRequests',
      'includeMasterKey', 'redisUrl']);
    for (const row of rateLimitConfig()) {
      for (const key of Object.keys(row)) {
        assert.ok(allowed.has(key), `مفتاحٌ لا يقبله الخادم: ${key}`);
      }
    }
  });
});
