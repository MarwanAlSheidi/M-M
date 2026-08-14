/**
 * لا تصل المستخدمَ العربيَّ رسالةٌ إنجليزية.
 *
 * رسائلُنا نحن عربية، تُصاغ في `cloud/lib/errors.js`. لكنّ **Parse نفسه**
 * يردّ بالإنجليزية، ويصل ردُّه المستخدمَ في مسارات لا تمرّ بدوال السحابة:
 * الدخول، والتسجيل، **ورفع الصور**.
 *
 * وقِيس على خادمٍ حقيقي: خادمٌ لم يُفعَّل فيه الرفع يردّ
 * `130 · File upload by public is disabled.` — وتفعيلُ الرفع **خطوةُ نشرٍ
 * يدوية** في `docs/DEPLOY.md`، أي أنها تُنسى. فيقف المتطوّع في المسجد يُبلغ
 * عن عمله، فيُصدّه سطرٌ إنجليزيّ لا يقرؤه، ولا يعرف أن بوسعه الإبلاغ بلا صور.
 *
 * فهذه الاختبارات تسأل السؤال الوحيد الذي يهمّ القارئ: **هل ما سيُعرض عربيّ؟**
 *
 * والملفُّ المُختبَر ESM في `app/` والاختبارات CJS — فيُستورد ديناميكياً،
 * كما في `tests/time.test.js` و`tests/unread.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MODULE = pathToFileURL(path.join(__dirname, '../app/src/errors.js')).href;
const load = () => import(MODULE);

/** حرفٌ عربيّ واحد يكفي للحكم؛ وغيابُه كلُّه يكفي للسقوط. */
const hasArabic = (text) => /[؀-ۿ]/.test(text);
/** ولا يكفي أن تكون فيها عربية: يجب ألّا يتسرّب نصُّ Parse معها. */
const hasLatinWords = (text) => /[A-Za-z]{3,}/.test(text);

/** أخطاءُ Parse كما تصل فعلاً: كودٌ ورسالةٌ إنجليزية. */
const parseError = (code, message) => ({ code, message });

test('رسائل الأخطاء كما تُعرض للمستخدم', async (t) => {
  const { messageOf, PARSE_MESSAGES } = await load();

  await t.test('رفعٌ غير مفعَّل على الخادم — أرجحُ ما يقع', () => {
    // النصّ الإنجليزي منقولٌ حرفياً كما ردّ به خادمٌ حقيقي
    const shown = messageOf(parseError(130, 'File upload by public is disabled.'));

    assert.ok(hasArabic(shown), `عُرضت بلا عربية: «${shown}»`);
    assert.ok(!hasLatinWords(shown), `تسرّب نصُّ Parse: «${shown}»`);
    // ولا يُترك المتطوّع في طريقٍ مسدود: له مخرجٌ في الرسالة نفسها
    assert.match(shown, /بلا صور/);
  });

  await t.test('كودٌ لا ترجمة له: عربيةٌ ومعها رمزُه', () => {
    // 141 = خطأ في دالة سحابية لم تُصغ رسالته عندنا. وكان يُعرض نصُّه كما هو.
    const shown = messageOf(parseError(141, 'Cloud function failed.'));

    assert.ok(hasArabic(shown), `عُرضت بلا عربية: «${shown}»`);
    assert.ok(!hasLatinWords(shown), `تسرّب نصُّ Parse: «${shown}»`);
    // الرمزُ يبقى: يُعين الإدارةَ على التشخيص ولا يُربك القارئ
    assert.match(shown, /141/);
  });

  await t.test('ولا كودٍ أصلاً — انقطاعُ شبكةٍ أو خطأٌ غفل', () => {
    for (const error of [null, undefined, {}, new Error('Network request failed')]) {
      const shown = messageOf(error);
      assert.ok(hasArabic(shown), `عُرضت بلا عربية: «${shown}»`);
      assert.ok(!hasLatinWords(shown), `تسرّب نصٌّ إنجليزي: «${shown}»`);
    }
  });

  await t.test('رسالتُنا نحن تمرّ كما هي — الفصلُ بالحرف لا بالكود', () => {
    // 119 يأتي من الطرفين: من حارسنا بالعربية، ومن Parse بالإنجليزية.
    // فما فيه حرفٌ عربيّ فهو منّا، ويُعرض بنصّه لأنه أدقُّ من العامّ.
    const ours = 'هذا الطلب ليس لمسجدك.';
    assert.equal(messageOf(parseError(119, ours)), ours);
    assert.equal(messageOf(parseError(undefined, ours)), ours);
  });

  await t.test('وكلُّ ما في الجدول عربيّ خالص', () => {
    for (const [code, text] of Object.entries(PARSE_MESSAGES)) {
      assert.ok(hasArabic(text), `الرمز ${code} بلا عربية: «${text}»`);
      assert.ok(!hasLatinWords(text), `الرمز ${code} فيه إنجليزية: «${text}»`);
    }
  });

  await t.test('والأكواد التي تبلغ المستخدم فعلاً مغطّاة', () => {
    // كلُّ واحدٍ منها قِيس وصولُه إلى الواجهة في مسارٍ لا يمرّ بدوال السحابة
    for (const code of [100, 101, 119, 124, 130, 200, 201, 202, 203, 209]) {
      assert.ok(PARSE_MESSAGES[code], `الرمز ${code} غائب عن الجدول`);
    }
  });
});

/**
 * ولا يُقال لأحدٍ إنّ مسجداً يُملَك.
 *
 * مساجد السلطنة تتبع **وزارة الأوقاف والشؤون الدينية**، ولا يملكها إمامٌ ولا
 * وكيلٌ ولا هذه المنصّة. وما يُسجَّل هنا إشرافٌ على شؤون الصيانة.
 *
 * وكانت الواجهةُ والخادمُ يقولان «طلب ملكية المساجد» و«اعتماد الملكية» و«هذا
 * المسجد مسجّل باسمك» و«اعتمادك يَنزعه منه» — **وهي لغةُ تملُّكٍ لا وجود له**،
 * وقد تُقرأ اقتحاماً لاختصاص الوزارة في بلدٍ تُنظَّم فيه المساجد بقانون. وهذا
 * أثقلُ من ركاكةٍ في الصياغة: هو وصفٌ خاطئ لما تفعله المنصّة.
 *
 * والحارس على **ما يُعرض** لا على التعليقات: الشيفرة تشرح لنفسها بما شاءت،
 * والمستخدم يقرأ ما بين علامات الاقتباس وما في وسم JSX.
 */
test('لا يُقال للمستخدم إنّ المسجد يُملَك', async (t) => {
  const fs = require('node:fs');
  const path = require('node:path');
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

  /**
   * المصدر بلا التعليقات — المستخدم لا يقرؤها.
   *
   * **والكتلةُ تُمحى كتلةً لا سطراً سطراً**: تعليق JSX يمتدّ على أسطرٍ لا يبدأ
   * أوّلُها بعلامة، فتصفيةٌ بالسطر تعدّ متنَه كلاماً معروضاً. وأسوأ من ذلك أنّ
   * التصفية تُزيح الترقيم، فيُشار إلى سطرٍ غير الذي وقع فيه ما وُجد.
   *
   * فتُستبدل الكتل بأسطرٍ فارغة بعددها — يُمحى المتن ويبقى الترقيم صادقاً.
   */
  const speech = (rel) => read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, (block) => '\n'.repeat((block.match(/\n/g) || []).length))
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''));

  const FILES = [
    'app/src/screens.jsx', 'app/src/api.js', 'app/src/errors.js',
    'cloud/lib/auth.js', 'cloud/lib/errors.js',
    'cloud/functions/mosques.js', 'cloud/functions/requests.js',
    'cloud/functions/users.js',
  ];

  await t.test('الأداة ترى ما تبحث عنه', () => {
    // ضابطٌ موجب: النمط يلتقط الصيغة التي وُضع لها
    assert.match('<h2>طلبات ملكية المساجد</h2>', /ملكية|يُنزع|يَنزع|مسجّل باسمك/);
    // وضابطٌ سالب: الملفّات تُقرأ فعلاً
    for (const rel of FILES) {
      assert.ok(speech(rel).join('\n').length > 500, `${rel}: قُرئ ناقصاً — الأداة عمياء`);
    }
  });

  await t.test('ولا لفظةَ تملُّكٍ فيما يُعرض', () => {
    const offenders = [];
    for (const rel of FILES) {
      speech(rel).forEach((line, at) => {
        if (/ملكية|مسجّل باسمك|يُنزع|يَنزع|تَنزع/.test(line)) {
          offenders.push(`${rel}:${at + 1} ${line.trim().slice(0, 70)}`);
        }
      });
    }
    assert.deepEqual(offenders, [],
      `لغةُ تملُّكٍ فيما يُعرض — والمساجد للأوقاف:\n${offenders.join('\n')}`);
  });
});

/**
 * ولا يُنادى القائمُ على المسجد إماماً وهو وكيلٌ أو مساعد.
 *
 * صُحّح اسمُ الدور، وبقيت الجُمل: «بانتظار اعتماد الإمام» يقرؤها المنفّذ،
 * و«اعتمد الإمام العمل» يقرؤها المصلّي في سجلّ المسجد، و«إمام المسجد» على
 * بطاقة التواصل — **يقرؤها منفّذٌ على وشك أن يهاتفه**، فيُناديه بما ليس له.
 *
 * والاستثناءُ مكتوبٌ لا مسكوتٌ عنه: `CAPACITIES` تُسمّي الصفات الثلاث قصداً،
 * وهي الموضع الوحيد الذي يُقال فيه «إمام المسجد» — لأنه اختيارُ صاحبه.
 */
test('لا يُنادى القائمُ على المسجد إماماً', async (t) => {
  const fs = require('node:fs');
  const path = require('node:path');
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

  const speech = (rel) => read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, (block) => '\n'.repeat((block.match(/\n/g) || []).length))
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''));

  const FILES = [
    'app/src/api.js', 'app/src/screens.jsx', 'app/src/errors.js',
    'cloud/functions/requests.js', 'cloud/functions/mosques.js',
    'cloud/functions/users.js', 'cloud/lib/auth.js', 'cloud/lib/worker.js',
  ];

  /** مواضع تُسمّي الصفة قصداً — ولكلٍّ سببُه. */
  const ALLOWED = [
    // جدولا الصفات: «إمام المسجد» فيهما اختيارٌ يختاره صاحبه لا وصفٌ يُفرض عليه
    /CAPACITIES = \{/,
    /imam: 'إمام المسجد'/,
    /assistant: 'مساعد الإمام'/,
    // ونصُّ الرفض يعدّد الصفات الثلاث ليعرف المخطئ ما المقبول
    /الصفة: إمام المسجد أو وكيله أو مساعده/,
    // والدلالة تحت اختيار الدور: تقول للوكيل إنّ هذا بابُه
    /إمامُ المسجد أو وكيلُه أو مساعدُ الإمام/,
  ];

  await t.test('الأداة ترى ما تبحث عنه', () => {
    assert.match("'اعتمد الإمام العمل'", /الإمام|إمام المسجد/);
    for (const rel of FILES) {
      assert.ok(speech(rel).join('\n').length > 400, `${rel}: قُرئ ناقصاً — الأداة عمياء`);
    }
    // وضابطٌ يمنع أن يبتلع الاستثناءُ كلَّ شيء
    assert.equal(ALLOWED.some((each) => each.test("'اعتمد الإمام العمل'")), false,
      'الاستثناء يبتلع جملةً ليست منه');
  });

  await t.test('ولا جملةَ تفترض إمامةً فيما يُعرض', () => {
    const offenders = [];
    for (const rel of FILES) {
      speech(rel).forEach((line, at) => {
        if (!/الإمام|إمام المسجد|الأئمة/.test(line)) return;
        if (ALLOWED.some((each) => each.test(line))) return;
        offenders.push(`${rel}:${at + 1} ${line.trim().slice(0, 70)}`);
      });
    }
    assert.deepEqual(offenders, [],
      `جُملٌ تفترض إمامةً — والمسجَّل قد يكون وكيلاً أو مساعداً:\n${offenders.join('\n')}`);
  });
});
