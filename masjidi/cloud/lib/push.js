/**
 * الإشعارات — قناتان: صندوق وارد دائم، ودفعٌ فوق ذلك.
 *
 * ⚠️ خطأ شائع في الملف الأصلي: Parse.Push.send يستعلم على فئة _Installation
 * وليس على _User. لذلك `where: { role: "imam" }` لا يطابق شيئاً أبداً،
 * و `where: { objectId: { $in: [userIds] } }` يقارن معرّفات مستخدمين
 * بمعرّفات أجهزة. الصحيح: الاستعلام على حقل الـ pointer `user` داخل _Installation.
 *
 * والأهمّ: الدفع لا يصل إلا لمن سُجّل له Installation ورُبط بحسابه. تطبيق الويب
 * لا يسجّله بعد، فكان كل إشعار في المنصّة يذهب إلى لا أحد — والدالة تعيد
 * `{ sent: list.length }` فتُبلّغ بنجاحٍ لم يقع. فصار لكل إشعار موجَّه سطرٌ في
 * `Notifications` يقرأه صاحبه حين يفتح التطبيق، والدفع تحسينٌ فوقه لا شرطٌ له.
 */

const MAX_STORED = 200;

/**
 * حفظ الإشعارات في صندوق الوارد. لا يرمي أبداً — أثرٌ جانبي كالتدقيق.
 * @returns {number} كم سطراً حُفظ فعلاً
 */
async function store(users, payload) {
  try {
    const Notification = Parse.Object.extend('Notifications');
    const rows = users.slice(0, MAX_STORED).map((user) => {
      const row = new Notification();
      row.set('userId', user);
      row.set('body', String(payload.alert || '').slice(0, 500));
      // ولا `kind`: لم يمرّره مستدعٍ قطّ، وقارئُه لا يقرؤه. `Notifications.kind`
      // عمودٌ محجوز — يُملأ يوم يُطلب التصنيف، لا قبله.
      if (payload.requestId) row.set('requestId', String(payload.requestId));
      if (payload.mosqueId) row.set('mosqueId', payload.mosqueId);
      return row;
    });
    if (rows.length === 0) return 0;
    await Parse.Object.saveAll(rows, { useMasterKey: true });
    return rows.length;
  } catch (error) {
    console.error('[push] تعذّر حفظ صندوق الوارد:', error && error.message);
    return 0;
  }
}

/**
 * إشعار موجَّه: يُحفظ ويُدفَع.
 *
 * @param {object} [options.store] اجعله `false` للبثّ الواسع — انظر
 *   `pushToNearbyVolunteers`. الافتراضي الحفظ لأن الموجَّه لا قناة له سواه.
 */
async function pushToUsers(users, payload, options = {}) {
  const list = (Array.isArray(users) ? users : [users]).filter(Boolean);
  if (list.length === 0) return { stored: 0, pushed: 0 };

  const stored = options.store === false ? 0 : await store(list, payload);

  const installations = new Parse.Query(Parse.Installation);
  installations.containedIn('user', list);
  installations.limit(1000);

  try {
    await Parse.Push.send(
      {
        where: installations,
        data: { sound: 'default', ...payload },
      },
      { useMasterKey: true }
    );
  } catch (error) {
    // مقصود: الإشعار أثر جانبي لا يجوز أن يُسقط العملية التي يُبلّغ عنها
    console.error('[push] تعذّر الإرسال:', error && error.message);
    return { stored, pushed: 0, failed: true };
  }
  // `pushed` عدد من استُهدف لا من وصله: الوصول يتوقّف على Installation مسجَّل،
  // ولا سبيل لمعرفته من هنا. لذلك يبقى `stored` هو الضمان لا هذا.
  return { stored, pushed: list.length };
}

const geo = require('./geo');

/**
 * كم متطوّعاً يُبلَّغ بفرصةٍ واحدة.
 *
 * كان البثّ يجمع خمسمئة ثم **لا يحفظ لأحد** — والحجّة الباقة: خمسمئة سطر عند
 * كل طلب. والحجّة صحيحة، **والنتيجة أنّ أحداً لا يُبلَّغ أصلاً**.
 *
 * وعملُ صيانةٍ في مسجدٍ يحتاج متطوّعاً واحداً لا خمسمئة. فالعشرون الأقربُ
 * سخاءٌ لا شحّ، **وتُكتب في دفعةٍ واحدة** (`saveAll` يجمع عشرين في طلب).
 */
const NEARBY_CAP = 20;

/** متطوعون قريبون: نطاق جغرافي أولاً، ثم المحافظة كخطة بديلة. */
async function pushToNearbyVolunteers(mosque, payload, radiusKm = 15) {
  const base = new Parse.Query(Parse.User);
  base.equalTo('role', 'volunteer');
  base.equalTo('isActive', true);

  let volunteers = [];

  try {
    // صندوق إحاطة على `lastLat`/`lastLng` لا `withinKilometers`: الأخيرة تفرض
    // فهرساً مكانياً على _User يُضاف يدوياً — انظر lib/geo.js
    const lat = mosque.get('lat');
    const lng = mosque.get('lng');

    if (geo.validCoordinates(lat, lng)) {
      const near = new Parse.Query(Parse.User);
      near.equalTo('role', 'volunteer');
      near.equalTo('isActive', true);
      geo.withinBox(near, geo.boundingBox(lat, lng, radiusKm), 'lastLat', 'lastLng');
      near.limit(500);

      volunteers = geo
        .sortByDistance(await near.find({ useMasterKey: true }), lat, lng, radiusKm,
          'lastLat', 'lastLng')
        .slice(0, NEARBY_CAP)
        .map(({ row }) => row);
    }

    if (volunteers.length === 0) {
      base.equalTo('governorate', mosque.get('governorate'));
      base.limit(NEARBY_CAP);
      volunteers = await base.find({ useMasterKey: true });
    }
  } catch (error) {
    // الاستعلام الجغرافي يفشل إن غاب فهرس `2dsphere` — وغيابه وارد: يُضاف
    // يدوياً من لوحة Back4app. لا يجوز أن يُسقط ذلك إنشاء طلب صيانة.
    console.error('[push] تعذّر جلب المتطوّعين القريبين:', error && error.message);
    return { stored: 0, pushed: 0, failed: true };
  }

  /*
   * **ويُحفظ في الوارد.**
   *
   * كان `{ store: false }` والحجّة أنّ للفرصة قناتَها — «الفرص» يفتحها
   * المتطوّع متى شاء. لكنّ `CLAUDE.md` يقول نصّاً: **«لا تبنِ مساراً يعتمد
   * على وصول الدفع وحده»**، و`Parse.Push` لا يصل اليوم أصلاً — لا Installation
   * مسجَّل. فكان هذا المسار الوحيد الذي يخالف القاعدة.
   *
   * وقِيس على خادمٍ حقيقي: متطوّعٌ موقعُه **نقطةُ المسجد نفسها** (`lastLat`
   * و`lastLng` مكتوبان بـ`updateMyLocation`)، ثم نُشر احتياجٌ تطوّعيّ في ذلك
   * المسجد — **ووارده فارغ**. فمن هو أقرب الناس إلى العمل لا يعلم به حتى يفتح
   * التطبيق من تلقاء نفسه، بينما يُبلَّغ المتبرّع الذي ضغط «هذا مسجدي».
   *
   * والباقةُ محفوظة: العشرون الأقربُ لا الخمسمئة، ودفعةٌ واحدة لكلّها.
   *
   * **وتُعيد من بلغهم** — لا عدَدَهم وحده: من كان قريباً ومنتمياً معاً يصله
   * الخبر مرّتين بصيغتين، فيحتاج نداءُ أهل المسجد أن يعرف من سبقه إليه.
   */
  const result = await pushToUsers(volunteers, payload);
  return { ...result, userIds: volunteers.map((user) => user.id) };
}

/**
 * من قال «هذا مسجدي» — يُبلَّغ بما يقع فيه.
 *
 * **العطب الذي تسدّه:** `favoriteMosqueId` هو التعبير الوحيد عن الانتماء في
 * هذه المنصّة — يضغط المستخدم «هذا مسجدي» فيُقال له «صار مسجدك»، ويُحفظ،
 * ويُعرض في «حسابي». **ثم لا يترتّب عليه شيء أبداً.**
 *
 * وقِيس في متصفّح حقيقي: متبرّعٌ اختار مسجداً، ثم نشر إمامُ ذلك المسجد
 * احتياجاً فيه:
 *
 *     وارد المتبرّع: 0 إشعاراً · «لا تنبيهات بعد.»
 *
 * لأن `pushToNearbyVolunteers` تُصفّي بـ`role === 'volunteer'` **وبموقع الجهاز
 * الآن** (`lastLat`/`lastLng`) — لا بالانتماء المُعلَن. فمن أعلن انتماءه
 * لمسجدٍ وهو في بيته على بُعد ثلاثين كيلومتراً لا يعلم أن مسجده يحتاج شيئاً،
 * والمتبرّع لا يُشعَر بحال لأن دوره ليس «متطوّع».
 *
 * **ويُحفظ في الوارد هنا خلافاً للقريبة**: تلك لها قناتها — شاشة «الفرص»
 * يفتحها المتطوّع متى شاء. ومن أعلن انتماءه لا شاشة له، فالوارد قناتُه
 * الوحيدة، وبلا حفظٍ لا يبلغه شيء.
 */
const FOLLOWER_CAP = 500;

async function pushToMosqueFollowers(mosque, payload, options = {}) {
  const exclude = new Set(options.exclude || []);

  const query = new Parse.Query(Parse.User);
  query.equalTo('favoriteMosqueId', mosque);
  // الموقوف لا يُلاحَق بالأخبار — ولا يفتح التطبيق أصلاً
  query.equalTo('isActive', true);
  query.limit(FOLLOWER_CAP);

  const followers = await query.find({ useMasterKey: true }).catch((error) => {
    // أثرٌ جانبيّ لا يُسقط ما يُبلّغ عنه — والطلب قد حُفظ قبل هذا السطر
    console.error('[push] تعذّر جلب أهل المسجد:', error && error.message);
    return [];
  });

  const list = followers.filter((user) => !exclude.has(user.id));
  if (list.length === 0) return { stored: 0, pushed: 0 };
  return pushToUsers(list, payload);
}

module.exports = { pushToUsers, pushToNearbyVolunteers, pushToMosqueFollowers };
