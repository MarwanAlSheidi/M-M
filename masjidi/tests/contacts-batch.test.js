/**
 * جهاتُ الاتصال تُطلب على دفعات — والخادم يردّ ما تجاوز عشرين.
 *
 * **العطب المقيس** على خادمٍ حقيقي: حدُّ التكليفات ثلاثة، لكنّ
 * `pending_imam_approval` خارجَ ذلك الحدّ **قصداً** — من أتمّ عمله لا يُحبس على
 * بطء غيره. فتتراكم أعمالُه المنتظِرة بلا سقف:
 *
 *     أعمالٌ تنتظر الاعتماد:      21
 *     ما تعدّه الشاشة حيّاً:      21
 *     جهات الاتصال:  ### سقط النداء — «لا تتجاوز 20 طلباً في المرّة»
 *
 * **والخادم يردّ النداء كلَّه لا الزائدَ منه، والسقوط صامت**: `contacts.error`
 * لا يُعرض في موضع. فيرى المتطوّع مهامَّه كلَّها بلا اسمٍ ولا هاتف — لا
 * لواحدةٍ منها — وهو واقفٌ عند المسجد لا يعرف بمن يتّصل، ولا كلمةَ تقول لماذا.
 *
 * ولا يُختبر بالاستيراد: `app/src/api.js` يستورد Parse، فتُستخرج الدالّة من
 * مصدرها كما في `tests/mosque-title.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'app', 'src', 'api.js'), 'utf8');

/**
 * يبني الدالّة من مصدرها ومعها `run` مزيَّف يسجّل ما طُلب.
 *
 * **وأداةُ القياس تُقاس قبل ما تقيسه**: استخراجٌ نمطيّ يُخفق صامتاً إن تغيّرت
 * الصياغة، فيصير «كلُّ الحالات تمرّ» معناه «لم أختبر شيئاً».
 */
function build() {
  const size = SOURCE.match(/const CONTACTS_PER_CALL = (\d+);/);
  assert.ok(size, 'لم يُستخرج حدُّ الدفعة من `app/src/api.js` — تغيّرت صياغته');

  const body = SOURCE.match(
    /export const getRequestContacts = (async \(requestIds\) => \{[\s\S]*?\n\};)/);
  assert.ok(body, 'لم تُستخرج `getRequestContacts` — تغيّرت صياغتها');
  assert.match(body[1], /CONTACTS_PER_CALL/, 'استُخرجت دالّةٌ لا تُقسّم — فليست هي');

  const calls = [];
  const run = async (name, params) => {
    calls.push(params.requestIds);
    return Object.fromEntries(params.requestIds.map((id) => [id, { role: 'imam', name: id }]));
  };

  // eslint-disable-next-line no-new-func
  const made = new Function('run', 'CONTACTS_PER_CALL',
    `return ${body[1].replace(/;$/, '')}`)(run, Number(size[1]));
  return { getRequestContacts: made, calls, size: Number(size[1]) };
}

const ids = (count) => Array.from({ length: count }, (_, at) => `r${at + 1}`);

test('جهاتُ الاتصال تُطلب على دفعات', async (t) => {
  /*
   * **حالةٌ يجب أن تبقى خضراء على `HEAD`** — وهي التي تُوجب القسمة أصلاً.
   *
   * بقيّةُ الحالات تسقط عليه لأن الشيفرة المُقاسة لم تكن موجودة، فتقول الأداة
   * إنها عمياء — وهي حمرةٌ صادقة لا تدلّ على شيء وحدها. وهذه تقرأ الخادم لا
   * العميل: الحدُّ عشرون، **والتجاوزُ يُردّ ولا يُقتطع**.
   */
  await t.test('الخادم يردّ ما تجاوز الحدَّ ولا يقتطعه', () => {
    const cloud = fs.readFileSync(
      path.join(__dirname, '..', 'cloud', 'functions', 'requests.js'), 'utf8');

    const cap = cloud.match(/const MAX_CONTACTS = (\d+);/);
    assert.ok(cap, 'لم يُستخرج `MAX_CONTACTS` من الخادم — الأداة عمياء');
    assert.equal(Number(cap[1]), 20, `حدُّ الخادم ${cap[1]} — والقياس بُني على عشرين`);

    assert.match(cloud, /ids\.length > MAX_CONTACTS\) E\.invalid/,
      'الخادم لم يعد يردّ التجاوز — فراجع سببَ القسمة كلَّه');
  });

  await t.test('واحدٌ وعشرون طلباً تمرّ — ولا يتجاوز نداءٌ الحدَّ', async () => {
    const { getRequestContacts, calls, size } = build();
    const got = await getRequestContacts(ids(21));

    assert.deepEqual(calls.map((each) => each.length), [size, 21 - size],
      `قُسّمت الدفعة خطأً: ${JSON.stringify(calls.map((c) => c.length))}`);
    assert.equal(Object.keys(got).length, 21,
      'ضاعت جهاتُ اتصالٍ في الجمع — والمتطوّع لا يعرف بمن يتّصل');
    assert.ok(got.r21, 'آخرُ مهمّةٍ بلا جهة اتصال');
  });

  /* ————— حدودٌ يجب أن تبقى خضراء ————— */

  await t.test('وعشرون بالضبط تبقى نداءً واحداً', async () => {
    const { getRequestContacts, calls, size } = build();
    await getRequestContacts(ids(size));
    assert.deepEqual(calls.map((each) => each.length), [size],
      `قُسّم ما لا يحتاج قسمة: ${JSON.stringify(calls.map((c) => c.length))}`);
  });

  await t.test('ولا نداءَ أصلاً بلا مهامّ', async () => {
    const { getRequestContacts, calls } = build();
    assert.deepEqual(await getRequestContacts([]), {});
    assert.deepEqual(calls, [], 'أُنفق نداءٌ على قائمةٍ فارغة');
  });

  /*
   * **والقاعدة «نداءٌ للقائمة لا لكل صفّ» قائمة**: `assignedToMe` محدودةٌ
   * بخمسين، فالنداءات ثلاثةٌ على أكثر تقدير مهما طال الطابور — لا واحدٌ لكل
   * بطاقة كما كان قبل إصلاحٍ سابق.
   */
  await t.test('والنداءات تبقى معدودةً مهما طال الطابور', async () => {
    const cap = SOURCE.match(/query\.limit\((\d+)\);/);
    assert.ok(cap, 'لم يُستخرج سقفُ القائمة من `listRequests`');

    const { getRequestContacts, calls, size } = build();
    await getRequestContacts(ids(Number(cap[1])));
    assert.ok(calls.length <= Math.ceil(Number(cap[1]) / size),
      `نداءاتٌ أكثر مما يحتمله السقف: ${calls.length}`);
    assert.ok(calls.length <= 3, `${calls.length} نداءات لشاشةٍ واحدة`);
  });
});
