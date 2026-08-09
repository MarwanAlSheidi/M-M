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
    assert.equal(report.ok, true, `بقي ساقطاً: ${report.failed.join('، ')}`);
    assert.ok(report.counts.مساجد > 0);
    assert.equal(report.counts.مشرفون, 1);
  });

  await t.test('ويقول ما لم يفحصه — فالأخضر لا يعني «كلُّ شيء سليم»', async () => {
    const report = await run();

    assert.ok(report.unverifiable.length >= 3,
      'تقريرٌ أخضر بلا حدودٍ معلنة يُقرأ ضماناً وهو ليس ضماناً');
    const text = report.unverifiable.join('\n');
    // ثلاثةٌ من خطوات النشر لا تُقرأ من داخل Cloud Code، وكلٌّ منها يُعطب
    // المنصّة صامتاً: القاعدة تمتلئ، والتكرار يقع، والصور لا تُرفع
    for (const item of ['جدولة المهام', 'الفهرس الفريد', 'رفع الملفات']) {
      assert.match(text, new RegExp(item), `${item}: لا يُفحص ولا يُذكر أنه لا يُفحص`);
    }
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
