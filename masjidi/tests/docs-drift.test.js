/**
 * ما تقوله الوثائق يُنفَّذ فعلاً.
 *
 * `README.md` هو أوّل ملفٍّ يفتحه من يتسلّم المستودع. وقِيس فيه أربعةُ انحرافات
 * في وقتٍ واحد:
 *
 *   1. أمرُ الاستيراد الكامل بلا `--all` — **يُردّ اليوم** ولا يعمل.
 *   2. «فهرس 2dsphere ← إلزامي» — و`docs/DEPLOY.md` يقول إنه يُطبَّق آلياً
 *      وإن القرب يعمل بدونه. **وثيقتان تتناقضان في وجه القارئ.**
 *   3. لا ذكرَ لـ`docs/DEPLOY.md` أصلاً — فمن يتبع البابَ الأوّل لا يبلغ
 *      المرجع.
 *   4. لا ذكرَ لـ`preflight` ولا `verify` ولا `admin` — وهي أهمّ ثلاثة أوامر
 *      لمالكٍ جديد.
 *
 * **والوثيقة المنحرفة أسوأ من غيابها**: غيابُها يدفع القارئ إلى السؤال،
 * وانحرافُها يدفعه إلى الثقة. ولا يكشف ذلك تشغيلٌ ولا فحصُ شيفرة — الوثائق
 * لا تُنفَّذ، فلا تسقط.
 *
 * فهذا حارسٌ **ينفّذ ما تقوله**: كلُّ أمرٍ مذكور يُقابَل بما هو موجود، وكلُّ
 * وعدٍ متبادلٍ بين الوثائق يُقابَل بنظيره.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { MANUAL_STEPS } = require('../scripts/lib/manual');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SCRIPTS = {
  '.': JSON.parse(read('package.json')).scripts,
  app: JSON.parse(read('app/package.json')).scripts,
};
const DOCS = ['README.md', 'docs/DEPLOY.md'];

/**
 * الأوامر كما تُكتب في كتل الشيفرة، ومعها المجلّد الذي تُنفَّذ فيه.
 *
 * **و`cd` يُتتبَّع**: الواجهة مشروع npm مستقلّ، و`npm run build` بعد `cd app`
 * صحيحٌ وإن لم يكن في `package.json` الجذر. وأداةٌ تقرأ السطر بلا سياقه
 * تُعلن انحرافاً حيث لا انحراف — وقد فعلت.
 */
function commandsIn(rel) {
  const blocks = [...read(rel).matchAll(/```bash\n([\s\S]*?)```/g)].map((hit) => hit[1]);
  const found = [];

  for (const block of blocks) {
    let cwd = '.';
    for (const raw of block.split('\n')) {
      const line = raw.split('#')[0].trim();
      const moved = line.match(/^cd\s+(\S+)/);
      if (moved) { cwd = moved[1].replace(/\/$/, ''); continue; }
      if (/^(npm|node) /.test(line)) found.push({ line, cwd });
    }
  }
  return found;
}

test('الوثائق تقول ما يُنفَّذ', async (t) => {
  for (const doc of DOCS) {
    await t.test(`${doc}: كلُّ أمرٍ فيه موجود`, () => {
      const commands = commandsIn(doc);
      assert.ok(commands.length >= 3,
        `${doc}: قُرئ ${commands.length} أمراً — الأداة لا تقرأ كتل الشيفرة`);

      for (const { line, cwd } of commands) {
        const runScript = line.match(/^npm run ([\w:]+)/);
        if (runScript) {
          const table = SCRIPTS[cwd];
          assert.ok(table, `${doc}: «${line}» في مجلّدٍ لا نعرفه (${cwd})`);
          assert.ok(table[runScript[1]],
            `${doc}: «${line}» — لا سكربت بهذا الاسم في ${cwd}/package.json`);
        }
        const file = line.match(/^node (scripts\/[\w-]+\.js)/);
        if (file) {
          assert.ok(fs.existsSync(path.join(ROOT, cwd, file[1])),
            `${doc}: «${line}» — لا ملفّ بهذا المسار`);
        }
      }
    });
  }

  await t.test('ولا أمرَ استيرادٍ كاملٍ بلا `--all`', () => {
    // هذا بعينه ما انحرف: أمرٌ كان يعمل، ثم حُرس، وبقي في الوثيقة كما كان.
    // ومن ينسخه اليوم يُردّ — فيظنّ العطبَ في الأداة لا في السطر.
    for (const doc of DOCS) {
      for (const { line } of commandsIn(doc)) {
        if (!/seed_mosques\.js/.test(line)) continue;
        assert.match(line, /--(all|limit|governorate|dry-run|verify|coord-report|governorates)\b/,
          `${doc}: «${line}» يستورد السلطنة كلَّها — ويُردّ اليوم`);
      }
    }
  });

  await t.test('والبابُ الأوّل يدلّ على المرجع', () => {
    // من يقرأ README ولا يبلغ DEPLOY ينشر بأربع خطواتٍ ناقصة
    assert.match(read('README.md'), /docs\/DEPLOY\.md/,
      'README لا يذكر دليل النشر — فمن يتبعه لا يبلغه');
  });

  /*
   * وأوامرُ النشر كلُّها مذكورةٌ في الباب الأوّل — **لا ثلاثةٌ منتقاة**.
   *
   * كان الحارس قائمةً مكتوبةً باليد (`preflight`, `verify`, `admin`)، فلمّا
   * أُضيف `npm run deploy` — وهو **أوّلُ ما يُشغّله المالك الجديد** — مرّ
   * الحارسُ أخضرَ وبقي الأمرُ غائباً عن README وحده، مذكوراً في `DEPLOY.md`
   * و`CLAUDE.md`. فمن يقرأ الباب الأوّل يتبع الطريق الطويل ولا يعلم بالقصير.
   *
   * **فالقائمة تُشتقّ من `package.json` لا تُكتب بجانبه.** وما لا يخصّ مالكاً
   * جديداً يُستثنى **بسببٍ مكتوب** — كما في `ALLOWED_UNREAD`.
   */
  await t.test('وأوامرُ المالك الجديد كلُّها في الباب الأوّل', () => {
    const readme = read('README.md');
    const scripts = Object.keys(
      JSON.parse(read('package.json')).scripts || {});
    assert.ok(scripts.length >= 10,
      `قُرئ ${scripts.length} أمراً — الأداة تقرأ ناقصاً`);

    /** أوامرُ لا يحتاجها من يتسلّم المستودع — ولكلٍّ سببُه. */
    const NOT_FOR_OWNER = {
      // طبقاتُ الفحص تُشغَّل بـ`npm run verify` وحده، وهو مذكور
      test: 'يُشغَّل ضمن verify',
      lint: 'يُشغَّل ضمن verify',
      'test:integration': 'يُشغَّل ضمن verify',
      'test:e2e': 'يُشغَّل ضمن verify',
      // تنظيف البيانات جرى مرّةً واحدة، وناتجُه في المستودع
      'clean:data': 'البيانات منظّفةٌ ومحفوظة في data/',
      // صيغٌ فرعية من `seed`، وتفصيلُها في DEPLOY لا في الباب الأوّل
      'seed:dry': 'صيغةٌ فرعية من الاستيراد',
      'seed:verify': 'صيغةٌ فرعية من الاستيراد',
      seed: 'يُذكر بصيغته الكاملة `node scripts/seed_mosques.js` في README',
    };

    const missing = scripts.filter((name) => !NOT_FOR_OWNER[name]
      && !readme.includes(`run ${name}`));
    assert.deepEqual(missing, [],
      `أوامرُ يحتاجها المالك الجديد وليست في الباب الأوّل: ${missing.join('، ')}`);
  });

  await t.test('ولا تتناقض وثيقتان في وجه القارئ', () => {
    // «2dsphere إلزامي» في README مقابل «تحسينٌ لا شرط» في DEPLOY: قارئٌ
    // واحد، وجوابان. فالتناقض يُقاس لا يُترك للانتباه.
    const readme = read('README.md');
    const claimsMandatory = /2dsphere[^\n]*إلزامي|إلزامي[^\n]*2dsphere/.test(readme);
    assert.equal(claimsMandatory, false,
      'README يجعل الفهرس المكاني شرطاً، وDEPLOY يجعله تحسيناً');
    assert.match(read('docs/DEPLOY.md'), /القرب يعمل بدونها/,
      'تغيّر موقف الدليل من الفهرس المكاني ولم يتغيّر الحارس');
  });

  /*
   * **وما يبقى بيد المُشغّل في اللوحة يُسمّى كلُّه.**
   *
   * المسار السريع في `docs/DEPLOY.md` كان يقول «وخطوتان لا يفعلهما» ويعدّ
   * اثنتين، وبابا الوثيقة الخامس والسادس يفصّلان اثنتين أخريين — جدولةَ
   * المهامّ الدورية وتفعيلَ رفع الملفات — **وكلتاهما ساقطةٌ من المسار السريع
   * وحده**، وهو الذي يقرؤه المستعجل. وأثرُ نسيانهما لا يظهر يومَ يقع: القاعدة
   * تمتلئ بعد أشهر، والمنفّذ يُصدّ عن صورة إنجازه.
   */
  await t.test('وما بقي في اللوحة مسمّىً في المسار السريع لا في التفصيل وحده', () => {
    const deploy = read('docs/DEPLOY.md');

    /*
     * بابُ «الطريق القصير» وحده — وهو ما يُقرأ مستعجلاً.
     *
     * وأوّلُ صياغةٍ لهذا الحارس أخذت ما **قبل** أوّل عنوانٍ فرعيّ، وهو مقدّمةُ
     * الوثيقة لا مسارُها السريع. فسقط على `Cloud Code` — أي على خطوةٍ كانت
     * مذكورةً فعلاً — **فاحمرّ لسببٍ غير الذي وُضع له**، وكاد يُقرأ بيّنةً على
     * عطبٍ ليس هو العطب.
     */
    const at = deploy.indexOf('### الطريق القصير');
    assert.notEqual(at, -1, 'بابُ الطريق القصير غاب عن الوثيقة أو تغيّر عنوانه');
    const rest = deploy.slice(at + 4);
    const quick = rest.slice(0, rest.indexOf('\n### '));

    for (const manual of MANUAL_STEPS) {
      assert.ok(quick.includes(manual.where),
        `خطوةٌ في اللوحة غائبةٌ عن المسار السريع: ${manual.where}`);
    }

    // **وما يُفحص يُميَّز عمّا لا يُفحص**: «أربع خطوات» يُقرأ ضماناً أن
    // `preflight` يكشف تركَ أيٍّ منها، وهو لا يكشف إلا اثنتين.
    assert.match(quick, /يكشفها `preflight`/,
      'تُسمّى الخطوات ولا يُقال أيُّها يُفحص أثرُه وأيُّها لا يُفحص بحال');
  });

  await t.test('والترخيص الذي يشترط النسبة مذكورٌ في الباب الأوّل', () => {
    // OpenStreetMap بترخيص ODbL، والنسبة شرطٌ فيه — ومن يتسلّم المستودع
    // ولا يعلم بذلك قد يحذفها من الواجهة وهو يظنّها زينة.
    assert.match(read('README.md'), /OpenStreetMap/,
      'التزامٌ قانوني على المالك الجديد غائبٌ عن أوّل ما يقرأ');
    assert.match(read('README.md'), /ODbL/);
  });
});
