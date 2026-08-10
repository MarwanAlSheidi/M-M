/**
 * اختبار تكامل: فحص ما قبل الإطلاق على خادمٍ حقيقي.
 *
 * الفحص نفسه لا معنى له على بديل Parse في الذاكرة: غايتُه أن يُشغّل الصيغ
 * المشبوهة على محوّل قاعدةٍ حقيقي، والبديل يُنفّذها كلَّها في جافاسكربت فينجح
 * دائماً — **ونجاحٌ لا يمكن أن يسقط لا يقول شيئاً.**
 *
 * وأهمّ ما يُختبر هنا ليس نجاحه على خادمٍ سليم، بل **سلوكه على خادمٍ معطوب**:
 * أوّل ما يُنادى فيه هو أشدّ لحظاته احتمالاً للعطب — بعد نشرٍ لم يُطبَّق مخططه
 * بعد. ففحصٌ يرمي عند أوّل خطأ يُخفي ما بعده، ويُعيد المُشغّل إلى الظلام الذي
 * جاء يُخرجه منه.
 *
 * في ملفٍّ مستقلّ — خادمٌ واحد لكل عملية، ويحرس ذلك `harness.startStack`.
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:integration`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { startStack, applySchema, seedMosques, unavailableReason } = require('./harness');

const skip = unavailableReason();
const options = skip ? { skip } : {};

test('فحص ما قبل الإطلاق', options, async (t) => {
  const stack = await startStack();
  const { Parse } = stack;
  t.after(() => stack.stop());

  const run = () => Parse.Cloud.run('preflight', {}, { useMasterKey: true });
  const find = (report, fragment) =>
    report.checks.find((row) => row.name.includes(fragment));

  await t.test('على خادمٍ بلا مخطط: يقول ما العطب ولا يرمي', async () => {
    // هذه أوّل لحظةٍ يُنادى فيها فعلاً — بعد رفع الكود وقبل `npm run schema`
    const report = await run();

    assert.equal(report.ok, false, 'خادمٌ بلا مخطط اجتاز الفحص');
    assert.ok(report.failed.length > 0, 'سقط الفحص بلا أن يقول أيُّ شيءٍ سقط');
    assert.ok(report.checks.length >= 8,
      'رُدّ بأوّل خطأ فحُجب ما بعده — والمُشغّل يريد القائمة كاملةً في نداءٍ واحد');
  });

  await t.test('ويقول لمن سقط عنده ماذا يفعل', async () => {
    const report = await run();
    const broken = report.checks.filter((row) => !row.ok);

    for (const row of broken) {
      assert.ok(row.why && row.why.length > 20,
        `${row.name}: سقط بلا أن يُقال ما العمل`);
      assert.ok(row.detail, `${row.name}: سقط بلا رسالة الخطأ الأصلية`);
    }
  });

  await t.test('وبعد تطبيق المخطط تنجح الأصناف، ويبقى ما لم يُهيَّأ بعد', async () => {
    await applySchema(Parse);
    const report = await run();

    for (const className of ['Mosques', 'ServiceRequests', 'AuditLog']) {
      assert.equal(find(report, `الصنف ${className}`).ok, true,
        `طُبّق المخطط ولا يزال ${className} يُعدّ ناقصاً`);
    }

    // القاعدة فارغة والمنصّة بلا مشرف — وهما ما يجب أن يبقى أحمر
    assert.equal(report.ok, false);
    assert.equal(find(report, 'مشرف').ok, false);
    assert.equal(find(report, 'مساجد').ok, false);
  });

  await t.test('وصيغ الاستعلام تُجرَّب على القاعدة نفسها لا تُفترض', async () => {
    const report = await run();

    // هذه هي علّة وجود الفحص: الصيغة التي كشفت أوّل فرقٍ بين المحوّلين
    for (const form of ['containsAll', 'صندوق الإحاطة', 'startsWith',
      'containedIn', 'descending', 'منقوط']) {
      const row = find(report, form);
      assert.ok(row, `صيغة ${form} ليست في الفحص أصلاً`);
      assert.equal(row.ok, true, `${row.name}: ${row.detail}`);
    }
  });

  await t.test('وبمسجدٍ ومشرف يصير الخادم جاهزاً', async () => {
    await seedMosques(Parse, 30);

    const admin = new Parse.User();
    admin.set({ username: `pre_admin_${Date.now()}`, password: 'Integration12345!', role: 'donor' });
    await admin.signUp();
    admin.set('role', 'admin');
    await admin.save(null, { useMasterKey: true });

    const report = await run();
    assert.ok(report.counts.مساجد > 0);
    assert.equal(report.counts.مشرفون, 1);

    /*
     * ولا يصير أخضر بالكود وحده — وهذا مقصود.
     *
     * الخطوات اليدوية صارت **مفحوصة** لا موثوقاً بها، والفهرس الفريد ليس في
     * `schema.json` لأن مخطط Parse لا يعبّر عنه. فيبقى أحمر حتى يُضاف من
     * لوحة Back4app، **وهو الغرض**: خطوةٌ تُنسى لا تُقرأ خضراء.
     *
     * وقِيس هنا: مكدّس الاختبار نفسه بلا فهرس فريد، فالفحص يكشفه.
     */
    assert.deepEqual(report.failed, ['الفهرس الفريد على Mosques.externalId'],
      `سقط غيرُ المنتظَر: ${report.failed.join('، ')}`);
    assert.equal(report.ok, false, 'أخضرُ بلا الخطوة اليدوية — فتُنسى وتُقرأ سليمة');
  });

  await t.test('والخطوات اليدوية تُفحص لا يُوثق بها', async () => {
    const report = await run();
    const named = (part) => report.checks.find((row) => row.name.includes(part));

    // التفرّد يُختبر بمحاولته: لا سبيل إلى قراءة الفهرس من مخطط Parse
    const unique = named('الفهرس الفريد');
    assert.ok(unique, 'الفهرس الفريد لا يُفحص أصلاً');
    assert.equal(unique.ok, false, 'قُبل معرّفٌ مكرَّر ومرّ الفحص');
    assert.match(unique.why, /Database → Indexes/, 'يُقال العطب ولا يُقال الدواء');

    /*
     * **والسببُ يُقاس لا الحُكم وحده.**
     *
     * أوّل صيغةٍ من هذا الفحص كانت تسقط على `governorate is required` — أي
     * قبل أن تبلغ التكرار أصلاً — فتُعلن «لا فهرس فريد» على كل خادمٍ إلى
     * الأبد. وكان هذا الاختبار يؤكّد `ok === false` **فيمرّ لسببٍ خاطئ**:
     * أكّدتُ النتيجة ولم أؤكّد الآلية.
     *
     * وفحصٌ أحمرُ دائماً يُعلَّم أنه ضجيج فيُهمَل — وذلك أسوأ من لا فحص.
     */
    assert.match(unique.detail, /معرّفٌ خارجيّ مكرَّر/,
      `سقط لسببٍ غير التكرار: ${unique.detail}`);
    assert.doesNotMatch(unique.detail, /required/,
      'يسقط على تحقّق المخطط لا على الفهرس — ولا يبلغ ما وُضع له');

    // وما كُتب للفحص يُحذف بعده — القاعدة حيّة، والفحص لا يترك أثراً
    const leftovers = await new Parse.Query('Mosques')
      .startsWith('externalId', '__preflight__').count({ useMasterKey: true });
    assert.equal(leftovers, 0, 'الفحص خلّف مساجد وهمية في قاعدةٍ حيّة');

    // والجدولة تُقاس بأثرها الماضي: خادمٌ جديد لم تُشغَّل فيه بعد، وذلك ليس عطباً
    const jobs = named('المهام الدورية');
    assert.ok(jobs, 'الجدولة لا تُفحص ولا يُذكر أنها لا تُفحص');
    assert.equal(jobs.ok, true, 'خادمٌ في يومه الأول لا عيب فيه');
    assert.match(jobs.detail, /لم تُشغَّل بعد/);
  });

  await t.test('ويقول ما لم يفحصه — فالأخضر لا يعني «كلُّ شيء سليم»', async () => {
    const report = await run();

    assert.ok(report.unverifiable.length >= 3,
      'تقريرٌ أخضر بلا حدودٍ معلنة يُقرأ ضماناً وهو ليس ضماناً');
    const text = report.unverifiable.join('\n');
    assert.match(text, /رفع الملفات/, 'أخطر ما لا يُفحص غير مذكور');

    /*
     * ولكلِّ متروكٍ **سببُ تركه**.
     *
     * «لم يُفحص» بلا سبب يُقرأ كسلاً فيُهمَل. وأهمُّها رفع الملفات: الفحص
     * يجري بالمفتاح الرئيس، والرفع به ينجح ولو كان معطّلاً للمصادَقين —
     * فلو فُحص من هنا لأعطى **أخضرَ كاذباً**، وهو أسوأ من لا فحص.
     */
    assert.match(text, /أخضرَ كاذباً/, 'يُقال «لا يُفحص» ولا يُقال لماذا');
    assert.match(text, /بحساب متطوّع/, 'لا يُدلّ القارئ على كيف يفحصه بنفسه');
  });

  /*
   * **القفل يُقرأ من القاعدة لا من الملفّ.**
   *
   * كلُّ ما يمنع الكتابة من متصفّح في هذه المنصّة صلاحياتٌ في المخطط، وعلى
   * الحذف **لا حارس غيرها**: لا `beforeDelete` في المستودع كلِّه. وقِيس على
   * خادمٍ حقيقي أن فتح `ServiceRequests` بضغطةٍ يجعل متطوّعاً غريباً يمحو طلباً
   * ليس له — والفحص لا يتغيّر فيه حرف: ستّةَ عشرَ فحصاً لا واحدَ منها يذكر
   * الصلاحيات.
   *
   * والاختبار يؤكّد **أن الباب يُسمّى**، لا أن التقرير احمرّ: تقريرٌ أحمرُ
   * لسببٍ آخر يمرّ على `assert.equal(ok, false)` والفحصُ لا يعمل.
   */
  await t.test('وقفلٌ يُفتح على القاعدة الحيّة يُرى ويُسمّى', async () => {
    const named = (report) => report.checks.find((row) => row.name.includes('الكتابة من العميل'));

    const before = named(await run());
    assert.ok(before, 'الصلاحيات لا تُفحص أصلاً');
    assert.equal(before.ok, true, `القفل المكتوب يُقرأ مفتوحاً: ${before.detail}`);

    const written = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', 'cloud', 'schema.json'), 'utf8'))
      .classes.find((row) => row.className === 'ServiceRequests').classLevelPermissions;

    const open = new Parse.Schema('ServiceRequests');
    open.setCLP({ ...written, create: { '*': true }, delete: { '*': true } });
    await open.update();

    try {
      const report = await run();
      const row = named(report);
      assert.equal(row.ok, false, 'فُتح بابان ومرّ الفحص أخضر');

      // ويُسمّى البابُ ومن فُتح له — لا «الصلاحيات غير مطابقة»
      assert.match(row.detail, /ServiceRequests\.create/, `لم يُسمَّ الباب: ${row.detail}`);
      assert.match(row.detail, /ServiceRequests\.delete/, `ذُكر بابٌ وسُكت عن آخر: ${row.detail}`);
      assert.doesNotMatch(row.detail, /Mosques|AuditLog/,
        `اتُّهم صنفٌ قفلُه سليم: ${row.detail}`);
      assert.match(row.why, /beforeDelete|حارس آخر|npm run schema/,
        'قيل إن الباب مفتوح ولم يُقل ما العمل');

      assert.ok(report.failed.includes(row.name), 'سقط الفحص ولم يُذكر في الخلاصة');
    } finally {
      const restore = new Parse.Schema('ServiceRequests');
      restore.setCLP(written);
      await restore.update();
    }

    // وبعد الإعادة يعود أخضر — فليس أحمرَ دائماً بسببٍ لا صلة له
    assert.equal(named(await run()).ok, true, 'بقي أحمرَ بعد إعادة القفل — فهو ضجيج');
  });

  await t.test('والحقول المحجوبة تُقرأ من القاعدة كذلك', async () => {
    const named = (report) => report.checks.find((row) => row.name.includes('المحجوبة'));
    const before = named(await run());
    assert.ok(before, 'الحقول المحجوبة لا تُفحص أصلاً');
    assert.equal(before.ok, true, `الحجب المكتوب يُقرأ ساقطاً: ${before.detail}`);

    const clp = (await new Parse.Schema('_User').get({ useMasterKey: true }))
      .classLevelPermissions;
    const stripped = new Parse.Schema('_User');
    stripped.setCLP({ ...clp, protectedFields: { '*': ['crNumber'] } });
    await stripped.update();

    try {
      const row = named(await run());
      assert.equal(row.ok, false, 'كُشف هاتف كلِّ إمامٍ ومرّ الفحص أخضر');
      assert.match(row.detail, /phone/, `لم يُسمَّ الحقل المكشوف: ${row.detail}`);
      assert.doesNotMatch(row.detail, /crNumber/, `عُدّ محجوبٌ مكشوفاً: ${row.detail}`);
    } finally {
      const restore = new Parse.Schema('_User');
      restore.setCLP(clp);
      await restore.update();
    }

    assert.equal(named(await run()).ok, true, 'بقي أحمرَ بعد إعادة الحجب');
  });

  await t.test('ولا يُفتح لغير المفتاح الرئيسي — يكشف بنيةً وأعداداً', async () => {
    const user = new Parse.User();
    user.set({ username: `pre_user_${Date.now()}`, password: 'Integration12345!', role: 'imam' });
    await user.signUp();

    await assert.rejects(
      Parse.Cloud.run('preflight', {}, { sessionToken: user.getSessionToken() }),
      /المفتاح الرئيسي/);
  });
});
