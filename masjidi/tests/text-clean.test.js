/**
 * التطويل، وتطابقُ المطبِّعَين.
 *
 * التطويل (`ـ` — U+0640) زخرفةٌ تمدّ الحرف بصرياً ولا تحمل معنى. وفي بيانات
 * الوزارة **1,836 مسجداً** — عُشر السجلّات — تحمل ولايةً ممدودة: «عبـري»،
 * «ضـ__نـك»، «السـنينه». فبطاقة كل واحدٍ منها كانت تعرض اسم ولايته مشوّهاً،
 * وإمامٌ في عبري يرى «عبـري» فيشكّ أن التطبيق أخطأ في مسجده.
 *
 * وفيه ما هو أخفى: `normalizeArabic` في السحابة و`normalize_ar` في بايثون
 * **يجب أن يتطابقا**، وإلا فحقل `nameNormalized` بلا فائدة — يُخزَّن بتطبيعٍ
 * ويُستعلَم بآخر. ولم يكن بينهما حارس، فهذا الملفّ يضعه.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { stripTatweel, normalizeArabic } = require('../cloud/lib/arabic');
const { tokenize } = require('../scripts/lib/tokenize');
const { descriptiveFields, prepare } = require('../scripts/lib/mosque-record');

const ROOT = path.join(__dirname, '..');
const TATWEEL = 'ـ';

test('تجريد التطويل', async (t) => {
  await t.test('يُزال ولا يُغيّر الكلمة', () => {
    assert.equal(stripTatweel('عبـري'), 'عبري');
    assert.equal(stripTatweel('ضـ__نـك'.replace(/_/g, '')), 'ضنك');
    assert.equal(stripTatweel('زايــد'), 'زايد');
  });

  await t.test('وما لا تطويل فيه يبقى حرفاً بحرف', () => {
    for (const text of ['مسقط', 'مسجد النور', 'الحمراء', '']) {
      assert.equal(stripTatweel(text), text);
    }
  });

  await t.test('وغير النصّ يمرّ كما هو', () => {
    assert.equal(stripTatweel(null), null);
    assert.equal(stripTatweel(undefined), undefined);
    assert.equal(stripTatweel(7), 7);
  });

  await t.test('وكلمات البحث تُجرَّد، وإلا صارت «زايد» و«زايــد» كلمتين', () => {
    assert.deepEqual(tokenize('مسجد زايــد'), ['مسجد', 'زايد']);
  });
});

test('حقول السجلّ كما تدخل القاعدة', async (t) => {
  const row = {
    externalId: 'x|زايــد|قرية',
    mosqueNumber: '05/1979',
    name: 'مسجد زايــد',
    nameNormalized: 'مسجد زايــد',
    type: 'مسجد',
    typeSlug: 'masjid',
    governorate: 'الظاهرة',
    governorateSlug: 'dhahirah',
    wilayat: 'عبـري',
    village: 'قرية',
    source: 'MARA',
    dataQuality: { number: 'ok', coordinates: 'ok' },
  };

  await t.test('النصّ المعروض والمطابَق مجرَّد', () => {
    const fields = descriptiveFields(row);
    for (const key of ['name', 'nameNormalized', 'wilayat', 'type', 'governorate', 'village']) {
      assert.equal(String(fields[key]).includes(TATWEEL), false, key);
    }
    assert.equal(fields.wilayat, 'عبري');
    assert.deepEqual(fields.nameTokens, ['مسجد', 'زايد', 'قرية']);
  });

  await t.test('و`externalId` لا يُمسّ — هو هويّة السجلّ', () => {
    // تنظيفُه يجعل كل مسجدٍ يبدو جديداً في الاستيراد التالي، فتُنشأ نسخةٌ
    // ثانية ويُهجر الأصل بطلباته وملكيّته
    assert.equal(descriptiveFields(row).externalId, 'x|زايــد|قرية');
  });
});

test('المطبِّعان — بايثون وجافاسكربت — يتطابقان', async (t) => {
  /**
   * `normalize_ar` تُستخرج من مصدرها نصّاً ثم تُنفَّذ.
   *
   * الاستيراد المباشر يجرّ `pandas` مع الوحدة كلّها، وهي حزمةٌ ثقيلة قد لا
   * تكون مثبّتة. والدالة نفسها لا تستعمل غير `unicodedata` من المكتبة القياسية.
   */
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'clean_mosques.py'), 'utf8');
  const start = source.indexOf('def normalize_ar');
  const end = source.indexOf('\ndef ', start + 1);
  assert.ok(start > 0 && end > start, 'تعذّر العثور على normalize_ar في مصدرها');

  const words = [
    'عبـري', 'زايــد', 'مسجد الرحمة', 'الرحمه', 'مُحَمَّد', 'أحمد', 'إبراهيم',
    'آل سعيد', 'مصلى العيدين', 'ضـنـك', 'السـنينه', 'مسْجِد   النّور', 'الفردوس',
  ];

  const script = `${source.slice(start, end)}
import json, sys, unicodedata
print(json.dumps([normalize_ar(w) for w in json.loads(sys.argv[1])], ensure_ascii=False))
`;

  let fromPython;
  try {
    fromPython = JSON.parse(execFileSync('python3', ['-c', script, JSON.stringify(words)], {
      encoding: 'utf8',
    }));
  } catch (error) {
    t.skip(`python3 غير متاح: ${error.message}`);
    return;
  }

  await t.test('كلمةً كلمة', () => {
    const fromJs = words.map(normalizeArabic);
    assert.deepEqual(fromJs, fromPython,
      'انفصل المطبِّعان: `nameNormalized` يُخزَّن بتطبيعٍ ويُستعلَم بآخر، فالحقل بلا فائدة');
  });

  await t.test('وكلاهما يجرّد التطويل', () => {
    assert.equal(fromPython[0], 'عبري');
    assert.equal(normalizeArabic('عبـري'), 'عبري');
  });
});

test('البيانات الحقيقية', async (t) => {
  const rows = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'mosques.json'), 'utf8'));

  await t.test('العطب موجودٌ فعلاً وبحجمٍ معلوم', () => {
    const withTatweel = rows.filter((row) => String(row.wilayat).includes(TATWEEL));
    assert.equal(withTatweel.length, 1836);
    assert.deepEqual([...new Set(withTatweel.map((row) => row.wilayat))].sort(),
      ['السـنينه', 'ضـنـك', 'عبـري'].sort());
  });

  await t.test('ولا ولايةَ ينقسم اسمها بين ممدودٍ ومجرَّد', () => {
    // لو انقسمت لصارت ولايةً واحدة ولايتين في تجميع `coord-trust`، فيُحسب لكلٍّ
    // مركزٌ وانتشارٌ على نصف مساجدها
    const groups = new Map();
    for (const row of rows) {
      const key = `${row.governorate}|${stripTatweel(row.wilayat)}`;
      if (!groups.has(key)) groups.set(key, new Set());
      groups.get(key).add(row.wilayat);
    }
    const split = [...groups].filter(([, spellings]) => spellings.size > 1);
    assert.deepEqual(split, []);
  });

  await t.test('وما يدخل القاعدة خالٍ منه', () => {
    const { records } = prepare(rows);
    const dirty = records
      .map(descriptiveFields)
      .filter((fields) => ['name', 'wilayat', 'village', 'governorate', 'type', 'nameNormalized']
        .some((key) => String(fields[key]).includes(TATWEEL)));
    assert.deepEqual(dirty, []);
  });
});
