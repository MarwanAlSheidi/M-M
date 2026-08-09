/**
 * قبولُ موقعٍ من خرائط جوجل — أو ردُّه.
 *
 * 430 مسجداً بلا موقع، ومواقعُها موجودة في خرائط جوجل بأسمائها. لكنّ الدرس
 * الذي كلّفنا 414 إحداثياً كاذباً في بيانات الوزارة هو ألّا يُؤخذ مصدرٌ على
 * علّاته. فهذه الاختبارات تحرس أن يبقى ردُّ المشكوك فيه هو الأصل: **موقعٌ
 * خاطئ يقود الناس ضلالاً، ومجهولٌ صدق.**
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  chooseLocation, nameMatches, distinctiveWords, PLAUSIBLE_KM, TAKEN_KM,
} = require('../scripts/lib/place-match');
const { prepare } = require('../scripts/lib/mosque-record');

/** مساجد معلومة في الولاية — بها تُقاس معقولية المرشّح. */
const KNOWN = [{ lat: 23.60, lng: 58.50 }, { lat: 23.62, lng: 58.52 }];
const at = (name, lat, lng, types = ['mosque']) => ({ name, lat, lng, types });

test('مطابقة الاسم', async (t) => {
  await t.test('الكلمات العامّة لا تميّز فتُطرح', () => {
    assert.deepEqual(distinctiveWords('مسجد النور'), ['النور']);
    assert.deepEqual(distinctiveWords('جامع السلطان قابوس'), ['السلطان', 'قابوس']);
  });

  await t.test('زيادةُ جوجل لا تضرّ، ونقصُ كلمةٍ من اسمنا يضرّ', () => {
    assert.equal(nameMatches('مسجد السلطان قابوس', 'جامع السلطان قابوس الأكبر'), true);
    assert.equal(nameMatches('مسجد السلطان قابوس', 'مسجد السلطان'), false);
  });

  await t.test('والتطبيع يشمل الطرفين', () => {
    assert.equal(nameMatches('مسجد الرحمة', 'مسجد الرحمه'), true);
    assert.equal(nameMatches('مسجد زايــد', 'مسجد زايد'), true);
  });

  await t.test('واسمٌ كلُّه عامّ لا يُطابَق به شيء', () => {
    // «مسجد» وحده يطابق كل مسجدٍ في عُمان — والمطابقة به قبولٌ أعمى
    assert.equal(nameMatches('مسجد', 'مسجد النور'), false);
  });
});

test('اختيار الموقع', async (t) => {
  const mosque = { name: 'مسجد النور' };

  await t.test('مرشّحٌ واحد مطابقٌ معقولٌ حرّ: يُقبل', () => {
    const { accepted } = chooseLocation(mosque, [at('مسجد النور', 23.61, 58.51)], KNOWN);
    assert.equal(accepted.lat, 23.61);
    assert.equal(accepted.placeName, 'مسجد النور');
    assert.ok(accepted.nearestKnownKm > 0);
  });

  await t.test('ولا نتيجة: يُردّ بسببٍ مكتوب', () => {
    assert.match(chooseLocation(mosque, [], KNOWN).rejected, /لا نتيجة/);
  });

  await t.test('واسمٌ لا يطابق: يُردّ ولو كان الموضع معقولاً', () => {
    const verdict = chooseLocation(mosque, [at('مسجد الفردوس', 23.61, 58.51)], KNOWN);
    assert.match(verdict.rejected, /لا اسم يطابق/);
  });

  await t.test('وموضعٌ بعيدٌ عن الولاية: يُردّ ولو طابق الاسم', () => {
    // ظفار من مسقط ~850 كم — «مسجد النور» هناك ليس مسجدنا
    const verdict = chooseLocation(mosque, [at('مسجد النور', 17.0, 54.1)], KNOWN);
    assert.match(verdict.rejected, /بعيدة عن الولاية/);
  });

  await t.test('وموضعٌ على مسجدٍ نعرفه: يُردّ — وإلا صار مسجدان نقطةً واحدة', () => {
    // وهو عين العطب الذي خرجنا منه: 154 مسجداً على نقطةٍ واحدة
    const verdict = chooseLocation(mosque, [at('مسجد النور', 23.60, 58.50)], KNOWN);
    assert.match(verdict.rejected, /مأخوذ/);
  });

  await t.test('ومرشّحان يجتازان: يُردّان — لا يُعرف أيُّهما', () => {
    const verdict = chooseLocation(mosque, [
      at('مسجد النور', 23.61, 58.51),
      at('مسجد النور', 23.63, 58.53),
    ], KNOWN);
    assert.match(verdict.rejected, /متعدّدون/);
  });

  await t.test('والمطابقُ الوحيد يُقبل ولو رافقه غيرُ مطابق', () => {
    const { accepted } = chooseLocation(mosque, [
      at('مسجد النور', 23.61, 58.51),
      at('مسجد الفردوس', 23.62, 58.53),
    ], KNOWN);
    assert.equal(accepted.lat, 23.61);
  });

  /**
   * «صيدلية النور» تحمل كلمة «النور» كما يحملها «مسجد النور». والكلمة العامّة
   * تُطرح قبل المقارنة، فلا يبقى ما يفصلهما — ولو كانت الصيدلية وحدها في
   * النتائج لصار موقعُها موقعَ المسجد. اكتشفه اختبارٌ سقط، لا مراجعةٌ للكود.
   */
  await t.test('وما ليس بيت صلاةٍ لا يُقبل ولو طابق اسمُه', () => {
    const pharmacy = at('صيدلية النور', 23.61, 58.51, ['pharmacy', 'store']);
    assert.match(chooseLocation(mosque, [pharmacy], KNOWN).rejected, /بيت صلاة/);
  });

  await t.test('وبلا تصنيفٍ من جوجل يُقرأ الاسم', () => {
    // الرجوع إلى الاسم حين يغيب التصنيف: «مسجد» فيه، فيُقبل
    const { accepted } = chooseLocation(
      mosque, [{ name: 'مسجد النور', lat: 23.61, lng: 58.51 }], KNOWN,
    );
    assert.equal(accepted.lat, 23.61);

    const bare = { name: 'صيدلية النور', lat: 23.61, lng: 58.51 };
    assert.match(chooseLocation(mosque, [bare], KNOWN).rejected, /بيت صلاة/);
  });

  await t.test('وولايةٌ بلا مسجدٍ معلوم: يُردّ — لا مقياس للمعقولية', () => {
    // قبولُه بلا قياسٍ يعيدنا إلى أخذ المصدر على علّاته
    const verdict = chooseLocation(mosque, [at('مسجد النور', 23.61, 58.51)], []);
    assert.match(verdict.rejected, /لا مسجد معلوم/);
  });

  await t.test('والعتبتان معقولتان بالنسبة إلى بعضهما', () => {
    assert.ok(TAKEN_KM < 1, 'عتبةُ «مأخوذ» أوسع من أن تميّز مسجدين متجاورين');
    assert.ok(PLAUSIBLE_KM > 73.4, 'أضيقُ من أقصى ما في البيانات، فتُقصي مسجداً قائماً');
  });
});

test('التراكب يدخل الاستيراد بمصدره', async (t) => {
  const rows = [{
    externalId: 'x1',
    name: 'مسجد النور',
    nameNormalized: 'مسجد النور',
    governorate: 'مسقط',
    wilayat: 'بوشر',
    hasLocation: false,
    location: null,
    dataQuality: { number: 'ok', coordinates: 'missing' },
  }];

  await t.test('بلا ملفّ تراكب يبقى المسجد مجهولاً', () => {
    const [record] = prepare(rows, {}).records;
    assert.equal(record.location, null);
    assert.equal(record.locationSource, undefined);
  });

  await t.test('ومع التراكب يأخذ موقعه، والمصدر مكتوب', () => {
    const [record] = prepare(rows, { x1: { lat: 23.61, lng: 58.51 } }).records;
    assert.equal(record.location.latitude, 23.61);
    assert.equal(record.hasLocation, true);
    assert.equal(record.locationSource, 'google',
      'بلا مصدر لا يُعرف أن الموقع دبّوسُ خرائط لا بيانات وزارة');
    assert.equal(record.dataQuality.coordinates, 'resolved_from_places');
  });

  await t.test('ولا ينسخ فوق إحداثيٍّ موثوق', () => {
    const located = [{
      ...rows[0],
      hasLocation: true,
      location: { __type: 'GeoPoint', latitude: 23.5, longitude: 58.4 },
    }];
    const [record] = prepare(located, { x1: { lat: 23.61, lng: 58.51 } }).records;
    assert.equal(record.location.latitude, 23.5);
    assert.equal(record.locationSource, 'ministry');
  });
});

test('ترتيب المصادر في الاستيراد', async (t) => {
  const seed = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'seed_mosques.js'), 'utf8');

  await t.test('ما أثبته إنسانٌ لا ينسخ فوقه إلا الوزارة', () => {
    // دبّوسُ جوجل وضعه غريب، والإمام وقف عند المسجد. ولولا هذا الشرط لمحا
    // ملفُّ التراكب كلَّ موقعٍ ثبّته إمامٌ بنفسه في أوّل إعادة استيراد.
    assert.match(seed, /keepLearned = prior && prior\.learnedLocation\s*\n?\s*&& row\.locationSource !== 'ministry'/,
      'شرطُ الحفظ لم يعد يميّز مصدر الوارد، فجوجل ينسخ فوق الإنسان');
    assert.match(seed, /if \(row\.location && !keepLearned\)/,
      'الكتابة تسبق الفحص، فالشرط لا أثر له');
  });

  await t.test('و«جوجل» معدودٌ من مصادر الاستيراد لا من البشرية', () => {
    const list = seed.match(/const IMPORT_SOURCES = \[(.*?)\];/);
    const sources = [...list[1].matchAll(/'([^']+)'/g)].map((hit) => hit[1]);
    assert.deepEqual(sources.sort(), ['google', 'ministry']);
  });
});
