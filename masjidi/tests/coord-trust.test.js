/**
 * سحب الثقة من إحداثيات المساجد المكذوبة.
 *
 * `clean_mosques.py` يفحص كل صفٍّ وحده فيجيزه: الإحداثيّ داخل حدود عُمان وغير
 * مقلوب. لكن أربعمئة مسجدٍ وأربعة عشر في بيانات الوزارة تحمل إحداثيات كاذبة لا
 * يفضحها إلا النظر إلى السجلّات جملةً — نقطةٌ واحدة عليها 154 مسجداً في 45
 * ولاية، ومساجدُ في «منح» إحداثياتها في دبي.
 *
 * وأثر ذلك أن مسجد صلالة يظهر لمتطوّع مسقط على بُعد نصف كيلومتر ويختفي عن
 * أهله. فهذه الاختبارات تحرس القاعدتين اللتين تكشفانه، وتحرس ما هو أهمّ: ألّا
 * تتّسعا فتبتلعا مسجداً موقعُه صحيح.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { assessCoordinates, withdrawUntrusted } = require('../scripts/lib/coord-trust');

/** سجلٌّ مختصر بالشكل الذي يخرج به `clean_mosques.py`. */
const row = (externalId, governorate, wilayat, lat, lng) => ({
  externalId,
  name: externalId,
  governorate,
  wilayat,
  hasLocation: lat != null,
  location: lat == null ? null : { __type: 'GeoPoint', latitude: lat, longitude: lng },
  dataQuality: { number: 'ok', coordinates: 'ok' },
});

/** عنقودٌ متقارب يمثّل ولايةً طبيعية — يصلح خلفيةً لأي اختبار. */
const cluster = (governorate, wilayat, count, lat = 23.0, lng = 57.0) => Array.from(
  { length: count },
  (unused, index) => row(`${wilayat}-${index}`, governorate, wilayat, lat + index * 0.005, lng),
);

test('كشف الإحداثيات التي لا يُوثق بها', async (t) => {
  await t.test('نقطة واحدة في ولايتين: قيمة افتراضية لا موقع', () => {
    const rows = [
      ...cluster('الداخلية', 'نزوى', 6),
      ...cluster('ظفار', 'صلالة', 6, 17.0, 54.0),
      row('a', 'الداخلية', 'نزوى', 23.59768, 58.42077),
      row('b', 'ظفار', 'صلالة', 23.59768, 58.42077),
    ];
    const verdicts = assessCoordinates(rows);
    assert.equal(verdicts.get('a').trust, 'placeholder');
    assert.equal(verdicts.get('b').trust, 'placeholder');
  });

  await t.test('مسجدان على نقطة واحدة داخل ولاية واحدة يُتركان', () => {
    // نسخٌ يدويٌّ محتمل، والخطأ — إن كان — محلّيٌّ داخل الولاية الصحيحة.
    // اتّهامهما يكلّف مسجدين موقعُهما معقول، والسكوت يكلّف دقّةً بأمتار.
    const rows = [
      ...cluster('الداخلية', 'نزوى', 6),
      row('a', 'الداخلية', 'نزوى', 23.031, 57.0),
      row('b', 'الداخلية', 'نزوى', 23.031, 57.0),
    ];
    assert.equal(assessCoordinates(rows).size, 0);
  });

  await t.test('خمسة على نقطة واحدة داخل ولاية واحدة تتجاوز الصدفة', () => {
    const rows = [
      ...cluster('الداخلية', 'نزوى', 6),
      ...Array.from({ length: 5 }, (unused, i) => row(`x${i}`, 'الداخلية', 'نزوى', 23.031, 57.0)),
    ];
    const verdicts = assessCoordinates(rows);
    assert.equal(verdicts.size, 5);
    assert.equal(verdicts.get('x0').trust, 'placeholder');
  });

  await t.test('الشاذّ عن عنقود ولايته يُرصد', () => {
    const rows = [
      ...cluster('الداخلية', 'منح', 8, 22.79, 57.60),
      row('dubai', 'الداخلية', 'منح', 25.22137, 55.86054), // دبي
    ];
    const verdict = assessCoordinates(rows).get('dubai');
    assert.equal(verdict.trust, 'outlier');
    assert.match(verdict.reason, /منح/);
  });

  await t.test('القيمة الافتراضية لا تجرّ مركز الولاية إليها', () => {
    // لو حُسب المركز قبل استبعادها لصار المركز بينها وبين الصحيح، فبرّأت
    // نفسها واتّهمت ما حولها. الترتيب هنا شرطٌ لا تفصيل.
    const rows = [
      ...cluster('ظفار', 'رخيوت', 5, 16.82, 53.42),
      ...cluster('مسقط', 'بوشر', 5, 23.58, 58.40),
      ...Array.from({ length: 5 }, (unused, i) => row(`p${i}`, 'ظفار', 'رخيوت', 23.59768, 58.42077)),
    ];
    const verdicts = assessCoordinates(rows);
    for (let i = 0; i < 5; i += 1) assert.equal(verdicts.get(`p${i}`).trust, 'placeholder');
    for (let i = 0; i < 5; i += 1) assert.equal(verdicts.has(`رخيوت-${i}`), false);
  });

  await t.test('ولاية مترامية لا تُتّهم مساجدها بالتباعد', () => {
    // «ثمريت» صحراءُ مئات الكيلومترات. عتبةٌ ثابتة بالكيلومترات تمسحها كلّها،
    // ولذلك تُقاس العتبة بانتشار الولاية نفسها لا برقمٍ واحد للسلطنة.
    const spread = Array.from({ length: 9 }, (unused, i) => row(
      `ثمريت-${i}`, 'ظفار', 'ثمريت', 17.6 + i * 0.4, 54.0 + i * 0.3,
    ));
    assert.equal(assessCoordinates(spread).size, 0);
  });

  await t.test('ولاية صغيرة العدد لا يُحكم على عنقودها', () => {
    // أربعة مساجد لا تُعرّف مركزاً ولا انتشاراً، والحكم عليها تخمين
    const rows = [row('a', 'الوسطى', 'محوت', 20.8, 58.0), row('b', 'الوسطى', 'محوت', 25.0, 56.0),
      row('c', 'الوسطى', 'محوت', 20.9, 58.1), row('d', 'الوسطى', 'محوت', 20.7, 57.9)];
    assert.equal(assessCoordinates(rows).size, 0);
  });

  await t.test('مجهول الموقع أصلاً لا يُحكم عليه', () => {
    const rows = [...cluster('الداخلية', 'نزوى', 6), row('none', 'الداخلية', 'نزوى', null, null)];
    assert.equal(assessCoordinates(rows).has('none'), false);
  });
});

test('سحب الإحداثيّ من السجلّ', async (t) => {
  const original = row('a', 'ظفار', 'صلالة', 23.59768, 58.42077);

  await t.test('بلا حكم يعود السجلّ كما هو', () => {
    assert.equal(withdrawUntrusted(original, undefined), original);
  });

  await t.test('مع الحكم: لا موقع، والسبب مكتوب', () => {
    const cleaned = withdrawUntrusted(original, { trust: 'placeholder', reason: 'مشتركة' });
    assert.equal(cleaned.location, null);
    assert.equal(cleaned.hasLocation, false);
    assert.equal(cleaned.dataQuality.coordinates, 'placeholder');
    assert.equal(cleaned.dataQuality.coordinatesReason, 'مشتركة');
    assert.equal(cleaned.dataQuality.number, 'ok'); // بقيّة الجودة لا تُمسح
  });

  await t.test('السجلّ الأصلي لا يُمسّ', () => {
    withdrawUntrusted(original, { trust: 'outlier', reason: 'بعيد' });
    assert.equal(original.hasLocation, true);
    assert.equal(original.dataQuality.coordinates, 'ok');
  });
});

/**
 * سلكُ تعثّر على التوصيل.
 *
 * الوحدة قد تكون صحيحةً تماماً ولا تُستدعى: هكذا بقي `apply_schema.js` يتجاهل
 * كتلة الفهارس كلّها. ولا اختبارَ تشغيليّ هنا يكشفه — السكربت يستدعي `main()`
 * عند تحميله فلا يُستورَد، والاستيراد الحقيقي يحتاج خادماً وMaster Key.
 */
test('الحكم موصولٌ بما يدخل القاعدة', async (t) => {
  const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
  const record = read('scripts', 'lib', 'mosque-record.js');
  const seed = read('scripts', 'seed_mosques.js');
  const harness = read('tests', 'integration', 'harness.js');

  await t.test('`prepare` تُطبّق الحكم على الملفّ كاملاً', () => {
    assert.match(record, /assessCoordinates\(rows\)/,
      'الحكم على شريحةٍ من الملفّ يُعمي القاعدة الأولى — النقطة الواحدة في ولايات شتّى');
    assert.match(record, /withdrawUntrusted\(/);
  });

  await t.test('والاستيراد يمرّ بها، لا بالسجلّات الخام', () => {
    assert.match(seed, /prepare\(raw\)/);
    assert.equal(/\bpool = raw\b/.test(seed), false,
      'عاد الاستيراد إلى السجلّات الخام، فالإحداثيّ الكاذب يدخل القاعدة');
  });

  await t.test('والمِرقاة تمرّ بها كذلك — وإلا زرعت ما لا يزرعه الإنتاج', () => {
    // كانت المِرقاة تنسخ الصفوف خاماً، فتزرع إحداثياتٍ سحب الاستيرادُ ثقتَه
    // منها. واختبارٌ أخضرُ على بياناتٍ لا وجود لها أسوأ من لا اختبار.
    assert.match(harness, /prepare\(/);
    assert.match(harness, /descriptiveFields\(/);
  });

  await t.test('والاستيراد يمحو إحداثيّاً سبق أن كتبه', () => {
    // بلا `unset` يبقى ما كتبته تشغيلةٌ سابقة: مسجد صلالة في مسقط إلى الأبد
    assert.match(seed, /unset\('lat'\)/);
    assert.match(seed, /unset\('lng'\)/);
    assert.match(seed, /unset\('location'\)/);
  });

  await t.test('ولا يمحو موقعاً تعلّمه المسجد من إمامه', () => {
    assert.match(seed, /learnedLocation/,
      'إعادة الاستيراد تُعيد المسجد مجهولاً كلّما شُغّلت، وتُضيّع ما أثبته إمامه');
  });
});

test('البيانات الحقيقية', async (t) => {
  const rows = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'data', 'mosques.json'), 'utf8'),
  );
  const verdicts = assessCoordinates(rows);

  await t.test('العطب موجودٌ فعلاً وبحجمٍ معلوم', () => {
    // رقمٌ صريح لا نطاق: تغيّره يعني تغيّر البيانات أو القاعدة، وكلاهما يستحقّ
    // أن يوقف البناء حتى يُنظر فيه
    assert.equal(verdicts.size, 414);
    const counts = [...verdicts.values()].reduce((acc, { trust }) => (
      { ...acc, [trust]: (acc[trust] || 0) + 1 }), {});
    assert.deepEqual(counts, { placeholder: 305, outlier: 109 });
  });

  await t.test('لا يبتلع أكثر من ثلاثة في المئة', () => {
    // حارسٌ على القاعدتين نفسيهما: قاعدةٌ تتّسع فتُعمي المنصّة عن ولايةٍ كاملة
    assert.ok(verdicts.size / rows.length < 0.03, `نسبة ${verdicts.size / rows.length}`);
  });

  await t.test('ما بقي موثوقاً يغطّي كل المحافظات الإحدى عشرة', () => {
    const kept = new Set(rows
      .filter((r) => r.hasLocation && !verdicts.has(r.externalId))
      .map((r) => r.governorate));
    assert.equal(kept.size, 11);
  });
});
