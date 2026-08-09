/**
 * عدّاد غير المقروء — مرّةً لا مع كل ضغطة.
 *
 * قِيس في متصفّح حقيقي: كل ضغطة تبويب كانت تُطلق `getMyNotifications` لتحديث
 * الشارة، وعلى تبويب «التنبيهات» يُجلب الشيء نفسه مرّتين. والطلبات هي القيد
 * الملزم في الباقة لا المساحة — 25 ألفاً شهرياً — **فرقمٌ فوق زرّ كان يُنفق
 * أضعافها.**
 *
 * الوحدة هنا تحرس ثلاثة: أن الطراوة تنتهي فلا يتجمّد الرقم، وأن النشر يبلغ
 * المشتركين فتتحدّث الشارة بلا طلب، وأن المحفوظ يُنسى مع الجلسة.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MODULE = pathToFileURL(path.join(__dirname, '../app/src/unread.js')).href;
/** نسخةٌ جديدة لكل اختبار: الوحدة تحمل حالةً على مستوى الملفّ. */
const load = () => import(`${MODULE}?t=${Math.random()}`);

const NOW = 1_800_000_000_000;

test('المحفوظ الطريّ', async (t) => {
  await t.test('لا شيء قبل أوّل جلب — فيُجلب', async () => {
    const { cachedUnread } = await load();
    assert.equal(cachedUnread(NOW), null);
  });

  await t.test('وبعد النشر يُقرأ بلا طلب', async () => {
    const { cachedUnread, publishUnread } = await load();
    publishUnread(4, NOW);
    assert.equal(cachedUnread(NOW + 1000), 4, 'ضغطةٌ تالية تُعيد الطلب — والباقة محدودة');
    assert.equal(cachedUnread(NOW + (59 * 1000)), 4);
  });

  await t.test('وتنتهي الطراوة فلا يتجمّد الرقم', async () => {
    const { cachedUnread, publishUnread } = await load();
    publishUnread(4, NOW);
    assert.equal(cachedUnread(NOW + (61 * 1000)), null,
      'رقمٌ محفوظٌ إلى الأبد يُصبح كذبةً بعد أوّل تنبيه');
  });

  await t.test('والصفر محفوظٌ لا مفقود', async () => {
    // `0` قيمةٌ صادقة: من قرأ تنبيهاته لا تُعاد الشارة لتسأل عنه
    const { cachedUnread, publishUnread } = await load();
    publishUnread(0, NOW);
    assert.equal(cachedUnread(NOW + 1000), 0);
  });
});

test('النشر يبلغ المشتركين', async (t) => {
  await t.test('فتتحدّث الشارة بلا طلب', async () => {
    const { onUnread, publishUnread } = await load();
    const seen = [];
    onUnread((count) => seen.push(count));

    publishUnread(3, NOW);   // شاشة التنبيهات جلبت، فعرفت العدد
    publishUnread(0, NOW);   // ثم عُلّمت مقروءةً
    assert.deepEqual(seen, [3, 0], 'الشاشة تعرف العدد ولا يبلغ الشارة');
  });

  await t.test('وفكّ الاشتراك يُنهي البلاغ', async () => {
    const { onUnread, publishUnread } = await load();
    const seen = [];
    const off = onUnread((count) => seen.push(count));
    off();
    publishUnread(9, NOW);
    assert.deepEqual(seen, []);
  });
});

test('النسيان عند زوال الجلسة', async (t) => {
  await t.test('لا يرى القادمُ شارةَ من مضى', async () => {
    // الجهاز الواحد يستعمله أكثر من واحد. ورقمٌ ليس له يقوده إلى واردٍ فارغ
    // فيحسبه عطباً — والأسوأ أنه خبرٌ عن غيره.
    const { cachedUnread, publishUnread, resetUnread } = await load();
    publishUnread(7, NOW);
    resetUnread();
    assert.equal(cachedUnread(NOW + 1000), null);
  });

  await t.test('ويُبلَّغ المشتركون بالصفر فتختفي الشارة فوراً', async () => {
    const { onUnread, publishUnread, resetUnread } = await load();
    const seen = [];
    publishUnread(7, NOW);
    onUnread((count) => seen.push(count));
    resetUnread();
    assert.deepEqual(seen, [0], 'خرج المستخدم والشارة تحمل رقمه بعد');
  });
});

test('الوصل بالشاشات لا الحساب في الفراغ', async (t) => {
  const fs = require('node:fs');
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

  await t.test('شاشة التنبيهات تنشر ما جلبته — وإلا جُلب مرّتين', () => {
    const screens = read('app/src/screens.jsx');
    assert.match(screens, /publishUnread\(result\.unread\)/,
      'الشاشة تعرف العدد ولا تنشره، فتجلبه الشارة مرّةً أخرى في الضغطة نفسها');
    assert.match(screens, /publishUnread\(0\)/,
      'عُلّمت التنبيهات مقروءةً والشارة باقية حتى تنتهي الطراوة');
  });

  await t.test('والشارة تقرأ المحفوظ قبل أن تطلب', () => {
    const app = read('app/src/App.jsx');
    assert.match(app, /cachedUnread\(\)/,
      'الشارة تطلب مع كل ضغطة تبويب — والطلبات هي القيد الملزم');
    assert.match(app, /resetUnread\(\)/, 'المحفوظ يبقى بعد الخروج');
  });
});
