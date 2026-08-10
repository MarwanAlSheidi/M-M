/**
 * اختبار تكامل: `scripts/apply_schema.js` — أوّل أمرٍ يُشغّله المُشغّل الجديد.
 *
 * ولا معنى له على البديل في الذاكرة: `Parse.Schema` هناك بلا فهارس ولا صلاحيات
 * حقيقية، فمسارُ العطب — وهو كلُّ ما يُقاس هنا — لا يقع أصلاً.
 *
 * **العطب المقيس:** فهرسٌ واحدٌ فاسد كان يُسقط الصنف كلَّه — لا حقوله ولا
 * صلاحياته — ويخرج الأمر بصفر. قِيس بحقن فهرسٍ على حقلٍ غير معرَّف:
 *
 *     ✗ ServiceRequests: Field … does not exist, cannot add index.
 *       ✗ فهرس status_mosque: Class ServiceRequests does not exist.
 *     ✓ الفهارس المطبَّقة في هذه الجولة: 17     ← المطبَّق فعلاً 14
 *     رمز الخروج: 0
 *
 * و`ServiceRequests` أحد الثلاثة المقفلة للكتابة من العميل عبر CLP. فيمضي
 * المُشغّل إلى ما بعده وقد بقي أخطرُ صنفٍ في المنصّة غائباً.
 *
 * والاختبار يؤكّد **الآلية لا الحال**: لا يكفي أن يصير الخروج غير صفر — يجب أن
 * تكون الصلاحيات قد وصلت القاعدة رغم سقوط الفهرس.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const { startStack, unavailableReason, APP_ID, MASTER_KEY, JS_KEY } = require('./harness');

/*
 * `execFile` غير متزامن قصداً: هذه العملية تستضيف `parse-server` نفسه، وأيُّ
 * انتظارٍ متزامن يُجمّد حلقة أحداثها فلا يصل ردُّ الخادم إلى الابن — فيتعلّق
 * الاختبار إلى الأبد. وقع ذلك في دورةٍ سابقة مع `spawnSync`.
 */
const run = promisify(execFile);

const REPO = path.join(__dirname, '..', '..');
const SCHEMA = path.join(REPO, 'cloud', 'schema.json');

const skip = unavailableReason();
const options = skip ? { skip } : {};

/** يُشغّل السكربت الحقيقي ويعيد المخرجات ورمز الخروج بلا رمي. */
async function applyWith(schemaFile, serverURL) {
  const env = {
    ...process.env,
    MASJIDI_SCHEMA_FILE: schemaFile,
    PARSE_APP_ID: APP_ID,
    PARSE_MASTER_KEY: MASTER_KEY,
    PARSE_JS_KEY: JS_KEY,
    PARSE_SERVER_URL: serverURL,
  };
  try {
    const { stdout, stderr } = await run('node', ['scripts/apply_schema.js'], { cwd: REPO, env });
    return { code: 0, out: `${stdout}${stderr}` };
  } catch (error) {
    return { code: error.code, out: `${error.stdout || ''}${error.stderr || ''}` };
  }
}

test('تطبيق المخطط', options, async (t) => {
  const stack = await startStack();
  const { Parse } = stack;
  t.after(() => stack.stop());

  const written = JSON.parse(fs.readFileSync(SCHEMA, 'utf8'));
  const locked = written.classes.find((row) => row.className === 'ServiceRequests');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'masjidi-schema-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  await t.test('على مخططٍ سليم: يخرج بصفر ولا تُسقطه الفهارس المكانية', async () => {
    const { code, out } = await applyWith(SCHEMA, stack.serverURL);

    // الفهارس المكانية تسقط على PostgreSQL بلا PostGIS في كل تشغيلة — وسقوطها
    // تحذيرٌ لا عطب. فلو عدّها المسار الجديد فشلاً لصار الأمرُ أحمرَ دائماً
    assert.match(out, /فهرس مكاني geo لم يُطبَّق/, 'لم يُجرَّب المسار المكاني أصلاً');
    assert.equal(code, 0, `مخططٌ سليم خرج بـ${code}:\n${out}`);
    assert.match(out, /✓ الفهارس المطبَّقة/);
  });

  await t.test('وفهرسٌ فاسد لا يمنع الصلاحيات من الوصول', async () => {
    // صنفٌ جديد كلَّ مرّة: الإنقاذ على صنفٍ قائمٍ من التشغيلة السابقة يشهد
    // لنفسه — الصلاحيات هناك موجودة قبل أن يبدأ
    const fresh = `ProbeLocked${Date.now()}`;
    const doc = JSON.parse(fs.readFileSync(SCHEMA, 'utf8'));
    doc.classes = [{
      className: fresh,
      fields: { mosqueId: { type: 'String', required: true }, note: { type: 'String' } },
      classLevelPermissions: locked.classLevelPermissions,
      indexes: {
        by_mosque: { mosqueId: 1 },
        broken_idx: { fieldThatDoesNotExist: 1 },
      },
    }];
    const file = path.join(dir, 'broken.json');
    fs.writeFileSync(file, JSON.stringify(doc, null, 2));

    const { code, out } = await applyWith(file, stack.serverURL);

    assert.equal(code, 1, `سقط الفهرس وخرج الأمر بـ${code}:\n${out}`);
    assert.doesNotMatch(out, /✓ الفهارس المطبَّقة/,
      'طُبع سطرُ نجاحٍ فوق عطب — وهو ما يقرؤه المُشغّل ويمضي');

    // وهنا الآلية: الصنف قائم، وقفلُه هو المكتوب في `cloud/schema.json`
    const got = await new Parse.Schema(fresh).get();
    assert.deepEqual(got.classLevelPermissions.create, locked.classLevelPermissions.create,
      'قام الصنف بصلاحياتٍ ليست المكتوبة — والكتابة من العميل مفتوحة');
    assert.deepEqual(got.classLevelPermissions.delete, locked.classLevelPermissions.delete);
    assert.ok(got.fields.mosqueId, 'قام الصنف بلا حقوله');

    // والفهرس السليم لا يُهدر بذنب الفاسد
    assert.match(out, /✓ فهرس by_mosque/, 'أُسقط الفهرس السليم مع الفاسد');
    assert.match(out, /✗ فهرس broken_idx/);
    assert.match(out, new RegExp(`أصنافٌ بلا بعض فهارسها.*${fresh}`),
      'لم يُذكر في الخلاصة أيُّ صنفٍ نقص');
  });

  await t.test('وصنفٌ لم يقم يُقال إنه لم يقم — لا يُعدّ ناقص فهرس', async () => {
    const fresh = `ProbeDead${Date.now()}`;
    const doc = {
      classes: [{
        className: fresh,
        // اسم حقلٍ يرفضه الخادم: يسقط إنشاء الصنف نفسه لا فهرسه. ويُختار
        // ما يرفضه **الخادم** لا ما يرفضه العميل — خطأٌ يُرمى في `Parse.Schema`
        // قبل الطلب يخرج من المسار المقيس كلَّه
        fields: { 'bad-name': { type: 'String' } },
        classLevelPermissions: locked.classLevelPermissions,
      }],
    };
    const file = path.join(dir, 'dead.json');
    fs.writeFileSync(file, JSON.stringify(doc, null, 2));

    const { code, out } = await applyWith(file, stack.serverURL);

    assert.equal(code, 1, `صنفٌ لم يقم وخرج الأمر بـ${code}:\n${out}`);
    assert.match(out, new RegExp(`أصنافٌ لم تقم.*${fresh}`),
      `سقط الصنف ولم يُذكر في «لم تقم»:\n${out}`);
    assert.match(out, /لا تُشغّل شيئاً بعدها/, 'قيل إنه سقط ولم يُقل ما العمل');

    await assert.rejects(() => new Parse.Schema(fresh).get(),
      'الصنف قائم — فالقياس يشهد لحالةٍ غير التي وُضع لها');
  });
});
