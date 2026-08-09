/**
 * قبولُ موقعٍ من OpenStreetMap — أو ردُّه.
 *
 * 430 مسجداً بلا موقع، ومواقعُها موجودة في الخرائط المفتوحة. لكنّ الدرس
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
const { parseOverpass, QUERY, MIN_SANE } = require('../scripts/resolve_locations');

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

  /**
   * جرّبتُ القاعدة على البيانات الحقيقية بنقاطٍ اصطناعية، فقبلَت 24 موقعاً من
   * 32 كلُّها على بُعد **صفرٍ** من مسجدٍ معلومٍ في الولاية المجاورة — أي أنها
   * نسخُ مساجدَ أخرى لا اكتشافُ مسجدنا. والفحص كان داخل الولاية وحدها.
   */
  await t.test('والموضع المأخوذ مأخوذٌ ولو كان صاحبه في ولايةٍ أخرى', () => {
    const neighbourWilayat = [{ lat: 23.70, lng: 58.60 }];
    const verdict = chooseLocation(
      mosque, [at('مسجد النور', 23.70, 58.60)], KNOWN, neighbourWilayat,
    );
    assert.match(verdict.rejected, /مأخوذ/);
  });

  /**
   * والثمانون كيلومتراً حاجزٌ أمام الكوارث (850 كم) لا فاصلٌ بين ولايتين
   * متجاورتين. و«الغفار جل جلاله» اسمٌ في صلالة وفي رخيوت، وبينهما 74 كم —
   * فقُبل موضعُ رخيوت لمسجد صلالة حتى أُضيف هذا الفحص.
   */
  await t.test('وأقربُ معلومٍ إلى الموضع يقول في أيّ ولايةٍ هو', () => {
    const far = { lat: 23.90, lng: 58.90 };          // مرشّحٌ داخل الثمانين
    const neighbourWilayat = [{ lat: 23.91, lng: 58.91 }]; // لكنه ألصق بالجارة
    const verdict = chooseLocation(
      mosque, [at('مسجد النور', far.lat, far.lng)], KNOWN, neighbourWilayat,
    );
    assert.match(verdict.rejected, /ولايةٍ أخرى/);
  });

  await t.test('وما كان أقرب إلى ولايتنا يُقبل رغم جوار الأخرى', () => {
    const { accepted } = chooseLocation(
      mosque, [at('مسجد النور', 23.61, 58.51)], KNOWN, [{ lat: 23.90, lng: 58.90 }],
    );
    assert.equal(accepted.lat, 23.61);
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
  const blind = {
    externalId: 'x1',
    name: 'مسجد النور',
    nameNormalized: 'مسجد النور',
    governorate: 'مسقط',
    wilayat: 'بوشر',
    hasLocation: false,
    location: null,
    dataQuality: { number: 'ok', coordinates: 'missing' },
  };
  /** جارٌ معلوم في الولاية — بلا واحدٍ منه لا مقياسَ يُفحص به التراكب. */
  const neighbour = {
    ...blind,
    externalId: 'x2',
    name: 'مسجد الجار',
    hasLocation: true,
    location: { __type: 'GeoPoint', latitude: 23.60, longitude: 58.50 },
  };
  const rows = [blind, neighbour];
  const first = (result) => result.records[0];

  await t.test('بلا ملفّ تراكب يبقى المسجد مجهولاً', () => {
    const record = first(prepare(rows, {}));
    assert.equal(record.location, null);
    assert.equal(record.locationSource, undefined);
  });

  await t.test('ومع التراكب يأخذ موقعه، والمصدر مكتوب', () => {
    const record = first(prepare(rows, { x1: { lat: 23.61, lng: 58.51 } }));
    assert.equal(record.location.latitude, 23.61);
    assert.equal(record.hasLocation, true);
    assert.equal(record.locationSource, 'osm',
      'بلا مصدر لا يُعرف أن الموقع نقطةُ خرائط لا بيانات وزارة');
    assert.equal(record.dataQuality.coordinates, 'resolved_from_osm');
  });

  await t.test('ولا ينسخ فوق إحداثيٍّ موثوق', () => {
    const record = first(prepare([{
      ...blind,
      hasLocation: true,
      location: { __type: 'GeoPoint', latitude: 23.5, longitude: 58.4 },
    }, neighbour], { x1: { lat: 23.61, lng: 58.51 } }));
    assert.equal(record.location.latitude, 23.5);
    assert.equal(record.locationSource, 'ministry');
  });

  /**
   * الملفّ يُراجَع بيدٍ بشرية قبل إيداعه — وهذا ما يوصي به `DEPLOY.md`. ومدخلةٌ
   * محرَّرة تُكتب في `Mosques.location` مباشرةً: رقمان مقلوبان أو فاصلةٌ زائدة
   * تضع مسجداً في البحر. فآخرُ من يلمس البيانات قبل القاعدة يفحصها.
   */
  await t.test('وإحداثيٌّ فاسد في الملفّ يُردّ لا يُكتب', () => {
    for (const bad of [
      { lat: 'شمالاً', lng: 58.51 },
      { lat: 623.61, lng: 58.51 },
      { lat: null, lng: null },
      {},
    ]) {
      const result = prepare(rows, { x1: bad });
      assert.equal(first(result).location, null, JSON.stringify(bad));
      assert.equal(result.overlayRejected.length, 1);
      assert.match(result.overlayRejected[0].reason, /غير صالحة/);
    }
  });

  await t.test('وموقعٌ بعيدٌ عن الولاية يُردّ ولو كان إحداثياً صالحاً', () => {
    // ظفار من مسقط ~850 كم — تحريرٌ خاطئ للملفّ يضع مسجد بوشر هناك
    const result = prepare(rows, { x1: { lat: 17.0, lng: 54.1 } });
    assert.equal(first(result).location, null);
    assert.match(result.overlayRejected[0].reason, /بعيد عن ولاية بوشر/);
  });

  await t.test('والردّ يُذكر لا يُبتلع', () => {
    // مدخلةٌ رُدّت بصمتٍ تعني مسجداً ظنّ المُشغّل أنه استعاد موقعه ولم يستعده
    const { overlayRejected } = prepare(rows, { x1: { lat: 0, lng: 0 } });
    assert.equal(overlayRejected.length, 1);
    assert.equal(overlayRejected[0].externalId, 'x1');
    assert.equal(overlayRejected[0].name, 'مسجد النور');
  });

  await t.test('والمقبول لا يُذكر في المردود', () => {
    assert.deepEqual(prepare(rows, { x1: { lat: 23.61, lng: 58.51 } }).overlayRejected, []);
  });
});

test('ترتيب المصادر في الاستيراد', async (t) => {
  const seed = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'seed_mosques.js'), 'utf8');

  await t.test('ما أثبته إنسانٌ لا ينسخ فوقه إلا الوزارة', () => {
    // نقطةُ OSM وضعها متطوّع، والإمام وقف عند المسجد. ولولا هذا الشرط لمحا
    // ملفُّ التراكب كلَّ موقعٍ ثبّته إمامٌ بنفسه في أوّل إعادة استيراد.
    assert.match(seed, /keepLearned = prior && prior\.learnedLocation\s*\n?\s*&& row\.locationSource !== 'ministry'/,
      'شرطُ الحفظ لم يعد يميّز مصدر الوارد، فالخرائط تنسخ فوق الإنسان');
    assert.match(seed, /if \(row\.location && !keepLearned\)/,
      'الكتابة تسبق الفحص، فالشرط لا أثر له');
  });

  await t.test('و«OSM» معدودٌ من مصادر الاستيراد لا من البشرية', () => {
    const list = seed.match(/const IMPORT_SOURCES = \[(.*?)\];/);
    const sources = [...list[1].matchAll(/'([^']+)'/g)].map((hit) => hit[1]);
    assert.deepEqual(sources.sort(), ['ministry', 'osm']);
  });
});

/**
 * قراءة ردّ Overpass.
 *
 * **الشبكة محجوبة في بيئة تطوير هذا المستودع**، فلا سبيل إلى تشغيل `--fetch`
 * هنا. وأكثرُ ما يُخطئ في مثل هذا شكلُ العنصر: `node` يحمل الإحداثيّ مباشرةً،
 * و`way` و`relation` يحملانه في `center`. فيبقى خارج التغطية النقلُ وحده،
 * لا فهمُ ما نُقل.
 */
test('قراءة ردّ Overpass', async (t) => {
  await t.test('العقدة تحمل الإحداثيّ مباشرةً', () => {
    assert.deepEqual(parseOverpass({
      elements: [{ type: 'node', lat: 23.6, lon: 58.5, tags: { name: 'مسجد النور' } }],
    }), [{ name: 'مسجد النور', lat: 23.6, lng: 58.5 }]);
  });

  await t.test('والمساحة والعلاقة تحملانه في `center`', () => {
    const places = parseOverpass({
      elements: [
        { type: 'way', center: { lat: 23.61, lon: 58.51 }, tags: { name: 'جامع أ' } },
        { type: 'relation', center: { lat: 23.62, lon: 58.52 }, tags: { name: 'جامع ب' } },
      ],
    });
    assert.deepEqual(places.map((place) => place.lat), [23.61, 23.62]);
    assert.deepEqual(places.map((place) => place.lng), [58.51, 58.52]);
  });

  await t.test('والاستعلام يطلب `out center` — وبدونه لا إحداثيّ لمساحة', () => {
    // بلا هذه الكلمة يعود `way` بلا `center` فتسقط كل المساجد المرسومة مساحاتٍ
    assert.match(QUERY, /out center/);
  });

  await t.test('و`name:ar` يُقدَّم على الاسم العامّ', () => {
    const [place] = parseOverpass({
      elements: [{ lat: 23.6, lon: 58.5, tags: { name: 'Al Noor Mosque', 'name:ar': 'مسجد النور' } }],
    });
    assert.equal(place.name, 'مسجد النور');
  });

  await t.test('وما لا اسم له أو لا إحداثيّ يُسقَط لا يُمرَّر', () => {
    assert.deepEqual(parseOverpass({
      elements: [
        { lat: 23.6, lon: 58.5, tags: {} },                       // بلا اسم
        { lat: 23.6, lon: 58.5 },                                 // بلا وسوم أصلاً
        { tags: { name: 'مسجد بلا موضع' } },                       // بلا إحداثيّ
        { type: 'way', tags: { name: 'مساحة بلا مركز' } },         // `out center` غاب
        { lat: 999, lon: 58.5, tags: { name: 'خارج المدى' } },
      ],
    }), []);
  });

  await t.test('وردٌّ فارغ لا يرمي', () => {
    assert.deepEqual(parseOverpass({}), []);
    assert.deepEqual(parseOverpass({ elements: [] }), []);
  });

  await t.test('وحدُّ التصديق أكبر من صفر بكثير', () => {
    // ردٌّ مبتورٌ فيه عشرُ نقاطٍ يُكتب فيُردّ الجميع في المطابقة بلا سببٍ ظاهر
    assert.ok(MIN_SANE >= 100, `حدّ التصديق ${MIN_SANE} أضعفُ من أن يكشف ردّاً مبتوراً`);
  });
});
