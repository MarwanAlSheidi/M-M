/**
 * اختبار تكامل: سجلُّ المنصّة يُصدَّر قبل أن يحذفه التقليم.
 *
 * `pruneAuditLog` مُجدوَلٌ أسبوعياً في `docs/DEPLOY.md` ويحذف نهائياً ما تجاوز
 * 180 يوماً. وكُتب في `docs/REVIEW.md`: «التقليم يحذف ولا يؤرشف… فالتصدير قبل
 * الحذف **مسؤولية خارجية**». وقِيس: **لا سكربت تصدير في المستودع، ولا ذكرَ
 * لنسخةٍ احتياطية في دليل النشر.**
 *
 * فالمنصّة تَعِد بالشفافية، وتُجدوِل حذفَ دليلها، ولا تُعطي وسيلةً لحفظه.
 * ووعدٌ يُحذف دليلُه بجدولٍ أسبوعيّ ليس وعداً.
 *
 * ولماذا التكامل لا الوحدة: السكربت يقرأ بالصفحات من خادمٍ حقيقي بالمفتاح
 * الرئيس، والصنف `AuditLog` **مقفلٌ تماماً** في المخطط — فلا يقيس ذلك بديل.
 *
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:integration`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

/**
 * تشغيلٌ **غير متزامن** قصداً.
 *
 * `spawnSync` يحجب حلقةَ أحداث هذه العملية — و`parse-server` يعمل **داخلها**.
 * فالطفل يطلب HTTP ولا أحد يُجيب، ويبقى معلَّقاً حتى تقتله المهلة. وقِيس:
 * `status=null` بلا رسالة خطأٍ واحدة، والملفّ لا يُكتب.
 *
 * **وأداةُ قياسٍ تحجب المقيس لا تقيسه.**
 */
const runScript = (argv, env) => new Promise((resolve) => {
  execFile(process.execPath, argv, { encoding: 'utf8', timeout: 180000, env },
    (error, stdout, stderr) => resolve({
      status: error && error.code !== undefined ? error.code : (error ? null : 0),
      output: `${stdout || ''}${stderr || ''}`,
    }));
});

const {
  startStack, applySchema, unavailableReason, APP_ID, MASTER_KEY, JS_KEY,
} = require('./harness');

const skip = unavailableReason();
const options = skip ? { skip } : {};

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'export_records.js');

test('السجلّ يُصدَّر، ولا تُصدَّر معه أسرارُ الناس', options, async (t) => {
  const stack = await startStack();
  const { Parse } = stack;
  t.after(() => stack.stop());

  await applySchema(Parse);

  const tokens = new Map();
  let unique = 0;
  async function signUp(role, fullName, phone) {
    const user = new Parse.User();
    user.set('username', `${role}_${Date.now()}_${++unique}`);
    user.set('password', 'Integration12345!');
    user.set({ role, fullName, phone });
    await user.signUp();
    tokens.set(user.id, user.getSessionToken());
    return user;
  }
  const as = (user, fn, params = {}) =>
    Parse.Cloud.run(fn, params, { sessionToken: tokens.get(user.id) });

  const imam = await signUp('imam', 'الشيخ سعيد', '99001122');
  const salim = await signUp('volunteer', 'سالم بن راشد', '99334455');

  const mosque = new (Parse.Object.extend('Mosques'))();
  mosque.set({
    externalId: `export_${Date.now()}`, name: 'جامع السجلّ',
    governorate: 'مسقط', wilayat: 'بوشر', isClaimed: true, imamId: imam,
    lat: 23.6, lng: 58.5,
  });
  await mosque.save(null, { useMasterKey: true });

  // حركةٌ حقيقية تُنتج قيوداً في `AuditLog` وصفوفاً في بقيّة الأصناف
  const created = await as(imam, 'createServiceRequest', {
    mosqueId: mosque.id, title: 'تصليح إنارة الصحن', category: 'electrical',
    description: 'إنارة صحن المسجد معطّلة منذ أسبوع.',
  });
  await as(salim, 'expressInterest', { requestId: created.objectId, note: 'أستطيع غداً' });
  await as(imam, 'assignWorker', { requestId: created.objectId, workerId: salim.id });

  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'masjidi-')), 'dump.json');
  const result = await runScript([SCRIPT, '--out', out], {
    ...process.env,
    // مفاتيح المِرقاة ثوابتُ الوحدة لا خصائصُ المكدّس — و`stack.APP_ID`
    // كانت `undefined`، فمضى السكربت بمفتاحٍ خاطئ.
    PARSE_APP_ID: APP_ID,
    PARSE_MASTER_KEY: MASTER_KEY,
    PARSE_JS_KEY: JS_KEY,
    PARSE_SERVER_URL: stack.serverURL,
  });
  const { output } = result;

  await t.test('يُصدَّر فعلاً ويخرج بصفر', () => {
    assert.equal(result.status, 0, `فشل التصدير: ${output}`);
    assert.ok(fs.existsSync(out), 'لم يُكتب ملفّ');
  });

  const dump = JSON.parse(fs.readFileSync(out, 'utf8'));

  await t.test('وفيه ما جرى في المسجد — لا ملفّاً فارغاً', () => {
    assert.ok(dump.data.AuditLog.length > 0, 'سجلّ التدقيق فارغ — وهو المقصود بالحفظ');
    assert.ok(dump.data.ServiceRequests.length > 0);
    assert.ok(dump.data.TaskInterests.length > 0);

    const actions = dump.data.AuditLog.map((row) => row.action);
    assert.ok(actions.includes('request_created'), `الأفعال: ${actions.join('، ')}`);
    assert.ok(actions.includes('worker_assigned'));
  });

  await t.test('ولا يحمل هاتف أحد — والسجلّ يذكر الصفة لا الهوية', () => {
    // تصديرُ `_User` يُنشئ ملفّاً نصّياً ببيانات الناس يُنسخ ويُرسل ويُنسى على
    // قرص. وسجلّ التدقيق مبنيٌّ على أن الفاعل يُذكر بصفته — فتصديرُ الحسابات
    // معه ينقض ذلك من الباب الخلفي.
    const text = fs.readFileSync(out, 'utf8');
    assert.doesNotMatch(text, /99001122/, 'هاتف الإمام في ملفّ التصدير');
    assert.doesNotMatch(text, /99334455/, 'هاتف المتطوّع في ملفّ التصدير');
    assert.equal(dump.data._User, undefined, 'الحسابات مُصدَّرة');
  });

  await t.test('ويقول ما ينقصه — فنسخةٌ لا تقول ذلك تُقرأ كاملة', () => {
    // من يفتح الملفّ بعد سنةٍ لا يقرأ السكربت الذي أنشأه
    assert.ok(dump.skipped._User, 'لا يُذكر أن الحسابات مستثناة ولا لماذا');
    assert.match(dump.skipped.Mosques, /seed|mosques\.json|الاستيراد/,
      'يُقال إن المساجد مستثناة ولا يُقال كيف تُستعاد');
    assert.match(dump.note, /لا يستعيدها/,
      'ملفٌّ يُظنّ به استرجاعٌ آليّ وليس فيه');
    assert.ok(dump.counts.AuditLog > 0, 'الأعداد لا تُطابق ما فيه');
  });

  await t.test('ويقول على أي خادمٍ عمل — كسائر الأدوات', () => {
    assert.match(output, /التصدير على/, 'أداةٌ تقرأ خادماً ولا تقول أيَّه');
  });

  await t.test('ولا يسقط صفٌّ في التصفّح ولو تساوت الطوابع', async () => {
    /*
     * أخطرُ ما في نسخةٍ احتياطية: أن تنقص ولا يُعلم.
     *
     * `createdAt` **ليس فريداً**: صفوفٌ تُكتب دفعةً واحدة (`saveAll` في
     * `closeInterests` و`warnImamsOfWorkerLoss`) تحمل الطابع نفسه، وترتيبُ
     * المتساويَين غير معرَّف — فيتكرّر صفٌّ في صفحةٍ ويسقط آخر.
     *
     * وقِيس قبل الإصلاح: 56 صفّاً، منها 50 فريداً — **مفقود 6**.
     * فيلزم مفتاحٌ ثانٍ فريد (`objectId`).
     */
    const Log = Parse.Object.extend('AuditLog');
    const batch = Array.from({ length: 60 }, (_, i) => {
      const row = new Log();
      row.set({ action: 'request_created', targetClass: 'Probe', targetId: `t${i}` });
      return row;
    });
    await Parse.Object.saveAll(batch, { useMasterKey: true });

    const expected = await new Parse.Query('AuditLog')
      .exists('objectId').count({ useMasterKey: true });

    const second = path.join(path.dirname(out), 'paged.json');
    const run = await runScript([SCRIPT, '--class', 'AuditLog', '--out', second], {
      ...process.env,
      PARSE_APP_ID: APP_ID,
      PARSE_MASTER_KEY: MASTER_KEY,
      PARSE_JS_KEY: JS_KEY,
      PARSE_SERVER_URL: stack.serverURL,
      // صفحةٌ صغيرة تُجبر التصفّح على العمل — وبلا ذلك لا يُقاس شيء
      MASJIDI_EXPORT_PAGE: '7',
    });
    assert.equal(run.status, 0, run.output);

    const paged = JSON.parse(fs.readFileSync(second, 'utf8')).data.AuditLog;
    const unique = new Set(paged.map((row) => row.objectId));

    assert.equal(paged.length, expected,
      `صُدّر ${paged.length} من ${expected} — نسخةٌ ناقصة لا يُعلم نقصُها`);
    assert.equal(unique.size, paged.length, 'تكرّر صفٌّ في التصفّح');
  });
});
