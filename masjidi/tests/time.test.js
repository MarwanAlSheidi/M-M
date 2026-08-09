/**
 * «كم مضى» — بالحساب وبالعربية.
 *
 * الحقلان `assignedAt` و`startedAt` كانا يُكتبان على الخادم منذ أول يوم ولا
 * يُقرآن في موضع واحد. فكان الإمام يرى «كُلِّف المنفّذ ولمّا يبدأ بعد» نفسها
 * في اليوم الأول وفي الشهر الثالث، وتحتها زرٌّ يُقيِّد على المنفّذ غياباً
 * يراه كل إمامٍ بعده. **حكمٌ يُطلب بلا المدّة التي يقوم عليها.**
 *
 * وهذا الملف ESM في `app/`، والاختبارات CJS — فيُستورد ديناميكياً. ولذلك
 * لا يستورد `app/src/time.js` شيئاً: لو لمس `parse` لما عمل خارج المتصفّح.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MODULE = pathToFileURL(path.join(__dirname, '../app/src/time.js')).href;
const load = () => import(MODULE);

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-03-01T12:00:00Z');
const ago = (days, hours = 0) => new Date(NOW.getTime() - (days * DAY) - (hours * 3600000));

test('عدّ الأيام', async (t) => {
  const { daysSince } = await load();

  await t.test('اليوم صفر، ولو مضت ساعات', () => {
    assert.equal(daysSince(ago(0), NOW), 0);
    assert.equal(daysSince(ago(0, 23), NOW), 0);
  });

  await t.test('واليوم التامّ واحد', () => {
    assert.equal(daysSince(ago(1), NOW), 1);
    assert.equal(daysSince(ago(1, 23), NOW), 1);
    assert.equal(daysSince(ago(40), NOW), 40);
  });

  await t.test('ويقبل النصّ كما يصل من Parse', () => {
    assert.equal(daysSince(ago(3).toISOString(), NOW), 3);
  });

  await t.test('وما ليس تاريخاً لا يُحسب صفراً بل يُعلَن مجهولاً', () => {
    // `null` عادي: طلبٌ لم يُكلَّف بعدُ. ولو قُرئ صفراً لقال «كُلِّف اليوم»
    for (const value of [null, undefined, '', 'ليس تاريخاً', NaN]) {
      assert.equal(daysSince(value, NOW), null, `قُبل ${String(value)} تاريخاً`);
    }
  });

  await t.test('والمستقبل صفرٌ لا سالب — ساعةُ الخادم غيرُ ساعة الجهاز', () => {
    assert.equal(daysSince(new Date(NOW.getTime() + (2 * DAY)), NOW), 0);
  });
});

test('صياغة المدّة بالعربية', async (t) => {
  const { sinceLabel } = await load();

  await t.test('العدد لا يُلحق بمعدوده كما في الإنجليزية', () => {
    // «منذ 1 يوم» و«منذ 2 أيام» و«منذ 11 أيام» ثلاثتها خطأ
    assert.equal(sinceLabel(ago(0), NOW), 'اليوم');
    assert.equal(sinceLabel(ago(1), NOW), 'منذ يوم');
    assert.equal(sinceLabel(ago(2), NOW), 'منذ يومين');
    assert.equal(sinceLabel(ago(3), NOW), 'منذ 3 أيام');
    assert.equal(sinceLabel(ago(10), NOW), 'منذ 10 أيام');
    assert.equal(sinceLabel(ago(11), NOW), 'منذ 11 يوماً');
    assert.equal(sinceLabel(ago(90), NOW), 'منذ 90 يوماً');
  });

  await t.test('ولا رقم في أيّ صيغة دون الثلاثة — فالعربية تُثنّي', () => {
    for (const days of [0, 1, 2]) {
      assert.doesNotMatch(sinceLabel(ago(days), NOW), /\d/,
        'رقمٌ ظهر حيث تكفي الصيغة — «منذ 2 يومين»');
    }
  });

  await t.test('وبلا تاريخٍ لا نصّ يُلفَّق', () => {
    assert.equal(sinceLabel(null, NOW), null);
  });
});

test('المدّة موصولةٌ بالشاشة لا محسوبةً في الفراغ', async (t) => {
  const fs = require('node:fs');
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

  await t.test('`listRequests` تُعيد الحقلين — وإلا لم يصلا الشاشة أصلاً', () => {
    const api = read('app/src/api.js');
    for (const field of ['assignedAt', 'startedAt']) {
      assert.match(api, new RegExp(`${field}:\\s*row\\.get\\('${field}'\\)`),
        `${field} يُكتب على الخادم ولا يُرسَل إلى العميل — فيبقى غير مقروء`);
    }
  });

  await t.test('وشاشة الإمام تعرضها عند زرّ «لم يحضر»', () => {
    const screens = read('app/src/screens.jsx');
    assert.match(screens, /assignedLabel/,
      'زرّ «سحب التكليف — لم يحضر» بلا مدّةٍ يقوم عليها الحكم');
    assert.match(screens, /STALE_ASSIGNED_DAYS/);
  });
});
