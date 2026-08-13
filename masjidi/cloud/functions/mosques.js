const E = require('../lib/errors');
const { mosqueTitle } = require('../lib/mosque-name');
const { requireUser, requireRole, mosqueForImam } = require('../lib/auth');
const audit = require('../lib/audit');
const { pushToUsers } = require('../lib/push');
const geo = require('../lib/geo');
const { normalizeArabic } = require('../lib/arabic');

const PUBLIC_FIELDS = [
  'name', 'mosqueNumber', 'type', 'typeSlug', 'governorate', 'wilayat',
  'village', 'location', 'isClaimed', 'openRequestsCount',
];

const MAX_RADIUS_KM = 50;
const BOX_CANDIDATE_CAP = 500;

/** يقرأ الإحداثيات ونصف القطر من الطلب بعد التحقق. */
function readPoint(params, defaultRadius = 5) {
  const { lat, lng } = params;
  if (!geo.validCoordinates(lat, lng)) {
    E.invalid('الإحداثيات (lat, lng) مطلوبة كأرقام صحيحة.');
  }
  const radiusKm = Math.min(Math.max(Number(params.radius) || defaultRadius, 0.5), MAX_RADIUS_KM);
  return { lat, lng, radiusKm };
}

/**
 * المساجد القريبة، مرتّبةً بالأقرب ومعها المسافة.
 *
 * صندوق إحاطة على `lat`/`lng` ثم هافرساين — لا `withinKilometers`، فذلك يفرض
 * فهرساً مكانياً يُضاف يدوياً وقد يغيب. التفصيل في `cloud/lib/geo.js`.
 */
Parse.Cloud.define('getNearbyMosques', async (request) => {
  requireUser(request);
  const { lat, lng, radiusKm } = readPoint(request.params);
  const cap = Math.min(Number(request.params.limit) || 50, 100);

  const query = new Parse.Query('Mosques');
  geo.withinBox(query, geo.boundingBox(lat, lng, radiusKm));
  query.select(...PUBLIC_FIELDS, 'lat', 'lng');
  query.limit(BOX_CANDIDATE_CAP);

  const candidates = await query.find({ useMasterKey: true });

  return geo.sortByDistance(candidates, lat, lng, radiusKm)
    .slice(0, cap)
    .map(({ row, km }) => ({ ...row.toJSON(), distanceKm: Math.round(km * 100) / 100 }));
});

/**
 * محافظة نقطةٍ على الأرض، مستنبَطةً من أقرب مسجدٍ إليها.
 *
 * لا حاجة إلى خدمة ترميزٍ جغرافيٍّ خارجية: عندنا ثمانية عشر ألف نقطةٍ معلومة
 * موزّعة على السلطنة، فأقربُها إلى المستخدم يقول في أيّ محافظةٍ هو. وخمسة
 * وعشرون كيلومتراً تكفي كل مأهول؛ وما وراءها صحراء، ولها البديل.
 */
async function governorateAt(lat, lng, radiusKm = 25) {
  const query = new Parse.Query('Mosques');
  geo.withinBox(query, geo.boundingBox(lat, lng, radiusKm));
  query.select('governorate', 'lat', 'lng');
  query.limit(50);

  const [nearest] = geo.sortByDistance(
    await query.find({ useMasterKey: true }), lat, lng, radiusKm,
  );
  return nearest ? nearest.row.get('governorate') : null;
}

/**
 * فرص التطوّع القريبة — شاشة المتطوّع الأولى.
 *
 * المتطوّع لا يبحث عن مسجد بل عن عمل قريب منه، فالترتيب بالمسافة لا بالتاريخ.
 */
Parse.Cloud.define('getNearbyOpportunities', async (request) => {
  const user = requireUser(request);
  const { lat, lng, radiusKm } = readPoint(request.params, 15);

  const mosqueQuery = new Parse.Query('Mosques');
  geo.withinBox(mosqueQuery, geo.boundingBox(lat, lng, radiusKm));
  mosqueQuery.greaterThan('openRequestsCount', 0); // لا معنى لمسجد بلا طلبات
  mosqueQuery.select('name', 'type', 'wilayat', 'village', 'governorate', 'lat', 'lng');
  mosqueQuery.limit(BOX_CANDIDATE_CAP);

  const near = geo.sortByDistance(
    await mosqueQuery.find({ useMasterKey: true }), lat, lng, radiusKm,
  );

  /**
   * مساجد بلا إحداثيات — 430 بعد سحب الثقة من الكاذب منها.
   *
   * صندوق الإحاطة لا يبلغها أبداً، فكانت طلباتها لا تصل متطوّعاً شارك موقعه،
   * وتصل من رفض المشاركة وحده. تُلحق بالقائمة بمسافةٍ مجهولة لا تُسقَط منها:
   * القائمة تُرتَّب بالقرب، وما لا يُعرف قربه يأتي آخراً موسوماً لا محذوفاً.
   *
   * **وتُحصر في محافظة المستخدم.** كانت تُجلب من السلطنة كلّها — وستةَ عشرَ
   * مسجداً كانت ضجيجاً محتملاً. أمّا اليوم فمتطوّعٌ في مسندم يرى في «ما حولك»
   * فرصاً في ظفار على بُعد ألف كيلومتر، فيفقد الثقة بالقائمة كلّها. والمحافظة
   * تُستنبط من أقرب مسجدٍ إليه، فإن تعذّر فمن ملفّه، فإن تعذّر فالسلطنة كلّها —
   * وإخفاء الفرصة أسوأ من إظهارها بعيدة.
   */
  const region = await governorateAt(lat, lng) || user.get('governorate') || null;

  const unlocatedQuery = new Parse.Query('Mosques')
    .equalTo('hasLocation', false)
    .greaterThan('openRequestsCount', 0)
    .select('name', 'type', 'wilayat', 'village', 'governorate')
    // ترتيبٌ صريح: بلا ترتيبٍ يكون المقطوع بالسقف عشوائياً، فمسجدٌ بعينه قد
    // لا يظهر أبداً بلا أن يُعرف السبب
    .descending('openRequestsCount')
    .limit(50);
  if (region) unlocatedQuery.equalTo('governorate', region);

  const unlocated = await unlocatedQuery.find({ useMasterKey: true });

  const candidates = [
    ...near.map(({ row, km }) => ({ row, km })),
    ...unlocated.map((row) => ({ row, km: null })),
  ];
  if (candidates.length === 0) return [];

  const byId = new Map(candidates.map(({ row, km }) => [row.id, { mosque: row, km }]));

  const requests = await new Parse.Query('ServiceRequests')
    .containedIn('mosqueId', candidates.map(({ row }) => row))
    .equalTo('status', 'open_for_volunteers')
    .limit(100)
    .find({ useMasterKey: true });

  return requests
    .map((row) => {
      const pointer = row.get('mosqueId');
      const hit = pointer ? byId.get(pointer.id) : null;
      return { row, hit };
    })
    .filter(({ hit }) => hit)
    // المجهول قربه آخراً، لا مطروحاً من الترتيب فيتصدّر أو يختفي
    .sort((a, b) => (a.hit.km == null ? Infinity : a.hit.km)
      - (b.hit.km == null ? Infinity : b.hit.km))
    .map(({ row, hit }) => ({
      id: row.id,
      title: row.get('title'),
      description: row.get('description'),
      category: row.get('category'),
      urgency: row.get('urgency'),
      status: row.get('status'),
      mosqueId: hit.mosque.id,
      mosqueName: mosqueTitle(hit.mosque),
      wilayat: hit.mosque.get('wilayat'),
      village: hit.mosque.get('village'),
      distanceKm: hit.km == null ? null : Math.round(hit.km * 100) / 100,
    }));
});

/** بحث نصّي بالاسم أو القرية داخل ولاية/محافظة. */
Parse.Cloud.define('searchMosques', async (request) => {
  requireUser(request);
  const { term, governorate, wilayat, limit = 30, lat, lng } = request.params;

  const cleaned = term ? normalizeArabic(term) : '';
  const cap = Math.min(Number(limit) || 30, 100);

  /**
   * الموقع هو ما يربط المصلّي بمسجده.
   *
   * أسماء المساجد تتكرّر بالمئات — «مسجد الغبي» في عبري واحدٌ وعشرون مسجداً
   * بالاسم والولاية والقرية نفسها — ولا يميّزها اسمٌ ولا موضعٌ مكتوب. لكن من
   * يبحث عن مسجده واقفٌ فيه أو قريبٌ منه، فأقربها إليه هو مسجده. رقم الوزارة
   * يبقى للتثبّت، والقرب هو الذي يدلّ.
   *
   * والموقع اختياري: من رفض مشاركته يرى النتائج بترتيبها الطبيعي كما كان.
   */
  const from = geo.validCoordinates(Number(lat), Number(lng))
    ? { lat: Number(lat), lng: Number(lng) }
    : null;

  const withDistance = (rows) => {
    const shaped = rows.map((mosque) => mosque.toJSON());
    if (!from) return shaped.slice(0, cap);

    return shaped
      .map((mosque) => ({
        ...mosque,
        distanceKm: geo.validCoordinates(mosque.lat, mosque.lng)
          ? Math.round(geo.distanceKm(from.lat, from.lng, mosque.lat, mosque.lng) * 100) / 100
          : null,
      }))
      // الأقرب أوّلاً، ومجهولُ الموقع آخراً لا محذوفاً — القاعدة نفسها في الفرص
      .sort((a, b) => (a.distanceKm == null ? Infinity : a.distanceKm)
        - (b.distanceKm == null ? Infinity : b.distanceKm))
      // القطعُ **بعد** الفرز لا قبله — انظر `scoped`
      .slice(0, cap);
  };

  /**
   * قيود المحافظة والولاية مشتركة بين المحاولات الثلاث.
   *
   * **السقف هنا سقفُ مرشّحين لا سقفُ نتائج.** القاعدة تقطع قبل أن نفرز بالقرب،
   * فلو طلبنا ثلاثين صفاً أعطتنا ثلاثين **بأي ترتيب** ثم رتّبناها — ومسجد
   * الإمام قد لا يكون فيها أصلاً. و«مصلى العيدين» في شمال الباطنة 123 مسجداً،
   * وفي شمال الشرقية 82: أربعمئةٍ وواحدٌ وستون مسجداً تقع في مجموعاتٍ أكبر من
   * ثلاثين، فأئمّتها لا يجدون مساجدهم مهما وقفوا عندها.
   *
   * قِيس على البيانات كاملةً: 132 من 200 كان مسجدُهم أوّلَ النتائج قبل الفرز
   * بالقرب، و198 بعده — ولم يكتمل ذلك إلا بعد رفع السقف هنا.
   */
  const scoped = () => {
    const query = new Parse.Query('Mosques');
    if (governorate) query.equalTo('governorate', governorate);
    if (wilayat) query.equalTo('wilayat', wilayat);
    query.select(...PUBLIC_FIELDS, 'lat', 'lng');
    query.limit(from ? BOX_CANDIDATE_CAP : cap);
    return query;
  };

  if (cleaned.length < 2) {
    return withDistance(await scoped().find({ useMasterKey: true }));
  }

  const emit = withDistance;

  // ١) مطابقة الكلمات: `nameTokens` مصفوفة، وفهرس المصفوفة يخدم المطابقة
  //    التامة لعنصر منها. هذا يلتقط «النور» من «مسجد النور» بلا مسح — وهي
  //    الحالة الغالبة: المستخدم يكتب اسم المسجد لا صيغته الكاملة.
  //    كلمات متعدّدة تُجمع بـAND عبر `containsAll`، فـ«مسجد النور» يطابق
  //    الاسم كاملاً. لا تستبدلها بـ`equalTo` متكرّرة: محوّل PostgreSQL يرفضها
  //    على عمود مصفوفة، و`containsAll` تُترجم إلى `$all` فتخدمها الفهرسة نفسها.
  const words = cleaned.split(' ').filter((word) => word.length >= 2);
  if (words.length > 0) {
    const byTokens = scoped();
    byTokens.containsAll('nameTokens', words);
    const tokenHits = await byTokens.find({ useMasterKey: true });
    if (tokenHits.length > 0) return emit(tokenHits);
  }

  // ٢) بادئة مثبّتة على `nameNormalized` — تستفيد من فهرسه، وتلتقط الكتابة
  //    الناقصة مثل «الرحم».
  const byPrefix = scoped();
  byPrefix.startsWith('nameNormalized', cleaned);
  const prefixHits = await byPrefix.find({ useMasterKey: true });
  if (prefixHits.length > 0) return emit(prefixHits);

  // ٣) آخر الحيلة: `contains` يولّد `$regex` غير مثبّت فيمسح المجموعة كاملة.
  //    يبقى لحالة الجزء من داخل كلمة، وهي نادرة بعد المرحلتين أعلاه.
  const bySubstring = scoped();
  bySubstring.contains('nameNormalized', cleaned);
  return emit(await bySubstring.find({ useMasterKey: true }));
});

/**
 * طلب الإشراف على مسجد (الإمام يربط نفسه بمسجد من قاعدة بيانات الوزارة).
 * لا يُعتمد تلقائياً — يبقى معلقاً حتى موافقة المشرف، لأن ربط شخص بمسجد
 * يمنحه لاحقاً صلاحية استقبال تبرعات.
 */
/**
 * صفة مقدّم الطلب: إمام المسجد أو وكيله أو مساعده.
 *
 * **ولا أحد يملك مسجداً.** مساجد السلطنة تتبع وزارة الأوقاف والشؤون الدينية،
 * وما يُسجَّل هنا **إشرافٌ على شؤون الصيانة** لا ملكية — والتسمية ليست تجميلاً:
 * من قرأ «طلب إشراف المسجد» فهم أمراً لا وجود له، وقد يُفهم اقتحاماً لاختصاص
 * الوزارة.
 *
 * والوكيل يتولّى شؤون المسجد كالإمام في عُرف كثير من المساجد، ومساعدُ الإمام
 * كذلك — فحرمانهما من التسجيل يُعطّل مساجد، وإجبارُهما أن يسمّيا نفسيهما إماماً
 * كذبٌ يُدخل على المشرف. الصلاحيات واحدة، والصفة تُقال ليتحقّق المشرف بما
 * يناسبها.
 */
const CAPACITIES = { imam: 'إمام المسجد', agent: 'وكيل المسجد', assistant: 'مساعد الإمام' };

/** ما يُعدّ «عند المسجد» — نصف كيلومتر يحتمل ضعف الإشارة داخل البناء. */
const AT_MOSQUE_KM = 0.5;

/** أقصى ما ينتظره طالبٌ واحد من مراجعات. تقديريّ يُراجَع بعد أول موسم. */
const MAX_PENDING_CLAIMS = 3;

/** حقلٌ من إمام المسجد الحالي — والمؤشّر الخام لا يحمل بياناته. */
const currentImamOf = (mosque, field) => {
  const imam = mosque && mosque.get('imamId');
  return imam && imam.get ? imam.get(field) || null : null;
};

/**
 * أبعد ما يُقبل بين موقعٍ مُقدَّم وأقرب مسجدٍ معلومٍ في الولاية نفسها.
 *
 * الرقم مقيسٌ لا مُخمَّن: على المساجد الموثوق بإحداثياتها (17,784) حُسب لكل
 * مسجدٍ بُعدُه عن أقرب جارٍ له في ولايته، فكان الوسيط 260 متراً، والمئين
 * التاسع والتسعون 4.8 كم، **وأقصى ما وُجد 73.4 كم**. فثمانون كيلومتراً فوق
 * أقصى الواقع، ولا تُقصي قائماً — وتلتقط المستحيل: من يسجّل مسجداً في صلالة
 * وهو في مسقط يبعد 850 كم.
 */
const WILAYAT_PLAUSIBLE_KM = 80;

/**
 * أقرب مسجدٍ معلوم الموقع في الولاية نفسها، أو `null` إن لم يكن في المدى.
 *
 * **لماذا يلزم:** 430 مسجداً بلا موقعٍ يُوثق به، وطلبُ الإشراف على أحدها يحمل موقعاً
 * لا يُقاس إلى شيء — فيراه المشرف بلا مسافةٍ ولا حكم، ثم يُتبنّى موقعاً دائماً
 * للمسجد يقود إليه كل متطوّع. وهذه أشدّ حالةٍ يحتاج فيها إلى قرينة، وهي
 * الحالة الوحيدة التي كان يُترك فيها بلا واحدة.
 *
 * والقرينة من بياناتنا نفسها: مساجد الولاية المعلومة. مسجدٌ في نزوى لا يبعد
 * عن سائر مساجد نزوى بمئات الكيلومترات.
 */
async function nearestKnownInWilayat(mosque, point, radiusKm = WILAYAT_PLAUSIBLE_KM) {
  const wilayat = mosque.get('wilayat');
  if (!wilayat) return { km: null, blind: true };

  /** القيود المشتركة: مساجد الولاية نفسها، عدا المسجد المعنيّ. */
  const inWilayat = () => {
    const query = new Parse.Query('Mosques');
    query.equalTo('wilayat', wilayat);
    query.equalTo('governorate', mosque.get('governorate'));
    query.notEqualTo('objectId', mosque.id);
    return query;
  };

  const query = inWilayat();
  // الصندوق يقصر المرشّحين على الجوار، فالاستعلام لا يجرّ ولايةً كاملة
  geo.withinBox(query, geo.boundingBox(point.lat, point.lng, radiusKm));
  query.select('name', 'lat', 'lng');
  query.limit(BOX_CANDIDATE_CAP);

  const [nearest] = geo.sortByDistance(
    await query.find({ useMasterKey: true }), point.lat, point.lng, radiusKm,
  );
  if (nearest) return { km: nearest.km, name: nearest.row.get('name'), blind: false };

  /**
   * لا مسجد قريباً — أهو موقعٌ مريب، أم ولايةٌ لا نعرف موقع أيّ مسجدٍ فيها؟
   *
   * الفرق حاسم: **غيابُ البيّنة ليس بيّنةَ نفي**. لو خلطنا بينهما لأُقصي كل
   * إمامٍ في ولايةٍ لم تُستورد بعد — و`DEPLOY.md` يوصي بالاستيراد على مراحل،
   * فهذه حالةٌ متوقّعة لا نادرة. وفي بيانات الوزارة اليوم كل ولاية فيها خمسة
   * مساجد معلومة فأكثر، لكن ذلك خاصّةُ البيانات لا ضمانةُ الكود.
   */
  const anyKnown = await inWilayat()
    .equalTo('hasLocation', true)
    .select('objectId')
    .first({ useMasterKey: true });

  return anyKnown ? null : { km: null, blind: true };
}

/**
 * طلب الإشراف على مسجد، ومعه تأكيد موقع مقدّمه.
 *
 * السؤال المفتوح منذ أوّل يوم: كيف يُثبت الإمام أنه إمام هذا المسجد؟ لا جواب
 * تامّ دون تكامل مع الوزارة، لكن **من يدّعي مسجداً يُتوقّع أن يكون فيه**.
 * فيُطلب موقعه لحظة التقديم وتُحسب مسافته من المسجد وتُعرض للمشرف: طلبٌ من
 * داخل المسجد ليس دليلاً قاطعاً، لكنه أقوى بكثير من طلبٍ من مدينة أخرى.
 *
 * ولا يُرفض البعيد تلقائياً — القرار للمشرف: قد يُسجّل الإمام مساءً من بيته.
 * الرفض الآلي يُقصي محقّاً بلا مراجعة.
 *
 * **إلا في حالةٍ واحدة:** مسجدٌ بلا موقعٍ معلوم. فالموقع المُقدَّم هناك ليس
 * قرينةً على الهوية فحسب، بل يصير **موقع المسجد الدائم** إن اعتُمد الطلب —
 * يقود إليه كل متطوّع بعدها. فيُقاس إلى مساجد ولايته المعلومة، ويُردّ ما جاوز
 * ثمانين كيلومتراً منها: ذاك ليس تسجيلاً من البيت، بل موقعٌ لا يمكن أن يكون
 * مسجدَ تلك الولاية. وردُّه هنا أرحم من قبوله: يُقال للإمام الآن، لا بعد
 * انتظار مراجعةٍ ثم رفض.
 */
Parse.Cloud.define('claimMosque', async (request) => {
  const claimant = requireRole(request, 'imam');
  const { mosqueId, evidenceNote, capacity = 'imam', lat, lng } = request.params;
  if (!mosqueId) E.invalid('معرّف المسجد مطلوب.');
  if (!CAPACITIES[capacity]) E.invalid('الصفة: إمام المسجد أو وكيله أو مساعده.');

  const mosque = await new Parse.Query('Mosques').get(mosqueId, { useMasterKey: true })
    .catch(() => E.notFound('المسجد غير موجود.'));

  // مسجدٌ مسجَّل يُطلب نقلاً لا تسجيلاً أوّل.
  //
  // كان يُردّ عند الباب، فيبقى المسجد مربوطاً بأوّل من سجّله أبداً: إمامٌ
  // يُنقل أو يتقاعد أو يُوقَف حسابه لإساءة، فيتجمّد مسجده — لا طلبَ جديد،
  // ولا اعتماد لعملٍ أُنجز، ومنفّذٌ أتمّ عملَه يبقى بلا عدٍّ في سجلّه. فتقع
  // عقوبةُ الإمام على جماعة المسجد، ولا مخرج إلا تعديلٌ يدويّ بلا أثر.
  const currentImam = mosque.get('imamId');
  const isTransfer = Boolean(mosque.get('isClaimed') && currentImam);
  if (currentImam && currentImam.id === claimant.id) {
    E.duplicate('أنت مسجَّلٌ على هذا المسجد بالفعل.');
  }

  /*
   * طلبٌ معلّقٌ على المسجد يمنع غيرَه — وكان يمنعه بسطرٍ واحد لا يقول شيئاً.
   *
   * **وثلاثةُ أعطابٍ في هذا السطر**، قِيست على خادمٍ حقيقي:
   *
   * ١) لا يُفرَّق بين طلبي أنا وطلبِ غيري: من أعاد الإرسال قيل له «يوجد طلب
   *    إشرافٍ معلّق لهذا المسجد» فيظنّ أنّ غيرَه سبقه إلى مسجده.
   * ٢) ولا بابَ بعده: إمامُ المسجد الحقيقيّ يُردّ ولا يُقال له ماذا يفعل ولا
   *    كم ينتظر — وقاعدةُ المستودع أنّ خبراً بلا فعلٍ تالٍ نصفُ خبر.
   * ٣) **والمشرف لا يعلم**. وأصعبُ سؤالٍ في هذه المنصّة: كيف يُثبت الإمام أنه
   *    إمام؟ وأن يتقدّم اثنان على مسجدٍ واحد **قرينةٌ من الطراز الأول** على
   *    أنّ الإشراف منازَع وأنّ الطلب المعلّق يحتاج تحقّقاً أشدّ — وكانت
   *    تُلقى في السلّة.
   */
  const existing = await new Parse.Query('MosqueClaims')
    .equalTo('mosqueId', mosque)
    .equalTo('status', 'pending')
    .first({ useMasterKey: true });

  if (existing) {
    const owner = existing.get('imamId');
    if (owner && owner.id === claimant.id) {
      E.duplicate('طلبُك على هذا المسجد قيد المراجعة — يصلك القرار إشعاراً.');
    }

    /*
     * والعدّاد يُزاد ذرّياً — وهو **سجلُّ الحدث لا اشتقاقٌ منه**: الطلب
     * المُبعَد لا يُحفظ، فلا مصدرَ يُحسب منه. ولا يُسقط الردَّ إن أخفق:
     * منعُ التسجيل قائمٌ بذاته، والقرينة أثرٌ جانبيّ لا شرط.
     */
    existing.increment('contestedCount');
    await existing.save(null, { useMasterKey: true }).catch((error) => {
      console.error('[claim] تعذّر قيد المنازعة:', error && error.message);
    });

    E.duplicate('تقدّم غيرُك بطلبٍ على هذا المسجد وهو قيد المراجعة. '
      + 'سُجّلت محاولتُك وستُعرض على المشرف مع طلبه — فإن كنتَ إمامَه فراجع الإدارة.');
  }

  // فتحُ المسجَّل للطلبات يجعل الثمانية عشر ألفاً كلَّها قابلةً للمنازعة،
  // والمشرف وحده هو الحاجز. فيُحدّ ما ينتظره منه الطالب الواحد.
  // **والرقم تقديريّ** يُراجَع بعد أول موسم، كحدّي الاهتمامات والتكليفات.
  const pending = await new Parse.Query('MosqueClaims')
    .equalTo('imamId', claimant)
    .equalTo('status', 'pending')
    .count({ useMasterKey: true });
  if (pending >= MAX_PENDING_CLAIMS) {
    E.forbidden(`لديك ${pending} طلبات معلّقة — انتظر مراجعتها قبل طلب مسجدٍ آخر.`);
  }

  const here = geo.validCoordinates(Number(lat), Number(lng))
    ? { lat: Number(lat), lng: Number(lng) }
    : null;

  // الموقع يُطلب حين يكون للمسجد إحداثيات يُقاس إليها. وحين لا تكون له — ستة
  // عشر مسجداً — لا يُطلب لأنه لا يُقارن بشيء، فلا يُحرم أهلها من التسجيل.
  const mosqueLocated = geo.validCoordinates(mosque.get('lat'), mosque.get('lng'));
  if (mosqueLocated && !here) {
    E.invalid('أكّد موقعك عند المسجد لإتمام التسجيل — فعّل إذن الموقع وأعد المحاولة.');
  }

  const Claim = Parse.Object.extend('MosqueClaims');
  const claim = new Claim();
  claim.set('mosqueId', mosque);
  claim.set('imamId', claimant);
  claim.set('status', 'pending');
  claim.set('capacity', capacity);
  claim.set('evidenceNote', String(evidenceNote || '').slice(0, 500));

  if (here) {
    claim.set('claimLat', here.lat);
    claim.set('claimLng', here.lng);
    if (mosqueLocated) {
      claim.set('claimDistanceKm', Math.round(geo.distanceKm(
        here.lat, here.lng, mosque.get('lat'), mosque.get('lng'),
      ) * 1000) / 1000);
    } else {
      // مسجدٌ بلا موقع: الموقع المُقدَّم سيصير موقعه الدائم إن اعتُمد الطلب،
      // فيُقاس إلى مساجد ولايته المعلومة — وهي القرينة الوحيدة المتاحة هنا
      const near = await nearestKnownInWilayat(mosque, here);
      if (!near) {
        E.invalid(`الموقع الذي أُرسل بعيدٌ عن كل مساجد ولاية ${mosque.get('wilayat')} `
          + 'المعروفة. سجّل وأنت عند المسجد — موقعك سيصير موقعه على الخريطة.');
      }
      // `blind` يعني: لا نعرف موقع أيّ مسجدٍ في الولاية، فلا قياس ولا اتّهام
      if (!near.blind) claim.set('wilayatNearestKm', Math.round(near.km * 1000) / 1000);
    }
  }
  await claim.save(null, { useMasterKey: true });

  const distance = claim.get('claimDistanceKm');
  const atMosque = distance != null && distance <= AT_MOSQUE_KM;
  // النقل يُقال للطالب صراحةً: مراجعتُه أبطأ وأثقل — يُتحقّق فيها من إمامٍ
  // قائم — ومن ظنّ طلبَه تسجيلاً عادياً انتظر ما لا يأتي في أيام
  const received = isTransfer
    ? 'تم استلام طلب نقل إمامة هذا المسجد. المسجد مسجَّل باسم إمامٍ آخر، '
      + 'وللمشرف أن يتواصل بكما قبل القرار.'
    : atMosque
      ? 'تم استلام طلبك من عند المسجد، سيُراجع خلال أيام عمل.'
      : 'تم استلام طلبك، سيُراجع خلال أيام عمل.';

  return { claimId: claim.id, atMosque, isTransfer, message: received };
});

/**
 * مساجد الإمام المستدعي.
 *
 * مصدر الحقيقة هو `Mosques.imamId` — وهو ما تتحقّق منه `mosqueForImam` قبل كل
 * إجراء. اشتقاق القائمة من `MosqueClaims` بدلاً منه يجعل الواجهة تختلف عن
 * الخادم: مسجدٌ أُسند بغير مسار الطلب (ترحيل بيانات أو تدخّل إداري) لا يراه
 * إمامه أصلاً.
 */
Parse.Cloud.define('getMyMosques', async (request) => {
  const imam = requireRole(request, 'imam');

  const mosques = await new Parse.Query('Mosques')
    .equalTo('imamId', imam)
    .equalTo('isClaimed', true)
    .ascending('name')
    .limit(20)
    .find({ useMasterKey: true });

  return mosques.map((mosque) => ({
    id: mosque.id,
    name: mosque.get('name'),
    // النوع مع الاسم: المخزَّن علَمٌ مجرَّد («العلوية»)، وبطاقةٌ بلا نوعه لا
    // تُقرأ مسجداً. وهذه الدالّة كانت الوحيدة من دوالّ العرض التي لا تُرسله
    type: mosque.get('type'),
    wilayat: mosque.get('wilayat'),
    village: mosque.get('village'),
    mosqueNumber: mosque.get('mosqueNumber'),
    governorate: mosque.get('governorate'),
    openRequestsCount: mosque.get('openRequestsCount') || 0,
    // بلا هذا الحقل لا تعرف الواجهة أن المسجد مجهول الموقع، فلا تعرض للإمام
    // زرّ التثبيت — وتبقى `confirmMosqueLocation` دالّةً لا طريق إليها
    hasLocation: geo.validCoordinates(mosque.get('lat'), mosque.get('lng')),
    // ومصدرُ الموقع: التصويب متاحٌ للجميع، لكنّ الحاجة إليه ليست واحدة.
    // موقعٌ مستخرَجٌ من الخرائط تقديرٌ يُنبَّه إمامُه إليه، وإحداثيّ وزارةٍ
    // اجتاز فحوصنا أقربُ إلى الصواب فلا يُشغَل به.
    locationSource: mosque.get('locationSource') || null,
  }));
});

/**
 * طلبات الإشراف الخاصة بالإمام المستدعي.
 * `MosqueClaims` مقفلة على Master Key، فبلا هذه الدالة لا يعرف الإمام أبداً
 * إن كان طلبه قد اعتُمد أو رُفض.
 */
Parse.Cloud.define('getMyClaims', async (request) => {
  const imam = requireRole(request, 'imam');

  const claims = await new Parse.Query('MosqueClaims')
    .equalTo('imamId', imam)
    .include('mosqueId')
    .descending('createdAt')
    .limit(20)
    .find({ useMasterKey: true });

  return claims.map((claim) => {
    const mosque = claim.get('mosqueId');
    return {
      id: claim.id,
      status: claim.get('status'),
      capacity: claim.get('capacity') || 'imam',
      evidenceNote: claim.get('evidenceNote'),
      createdAt: claim.get('createdAt'),
      reviewedAt: claim.get('reviewedAt'),
      mosqueId: mosque ? mosque.id : null,
      mosqueName: mosque ? mosqueTitle(mosque) : null,
      wilayat: mosque ? mosque.get('wilayat') : null,
      village: mosque ? mosque.get('village') : null,
      mosqueNumber: mosque ? mosque.get('mosqueNumber') : null,
      // طلبٌ معلّق على مسجدٍ مسجَّل هو طلب نقل: مراجعتُه أثقل — يُتحقّق فيها
      // من إمامٍ قائم — ومن ظنّه تسجيلاً عادياً انتظر «أيام عمل» لا تأتي.
      // ويُشتقّ من المسجد لا يُخزَّن: حالتُه اليوم هي ما يعني الطالب.
      isTransfer: Boolean(claim.get('status') === 'pending'
        && mosque && mosque.get('isClaimed') && mosque.get('imamId')),
    };
  });
});

/**
 * طلبات الإشراف المنتظرة — مشرف فقط.
 *
 * `MosqueClaims` مقفلة على Master Key، فلم يكن أمام المشرف إلا `reviewMosqueClaim`
 * ومعه معرّف لا سبيل له إليه من التطبيق. انضمام كل إمام يتوقّف على هذه المراجعة.
 */
Parse.Cloud.define('listPendingClaims', async (request) => {
  requireRole(request, 'admin');

  const claims = await new Parse.Query('MosqueClaims')
    .equalTo('status', 'pending')
    .include('mosqueId')
    .include('mosqueId.imamId') // إمامُ المسجد الحالي — ممّن يُنزع إن اعتُمد
    .include('imamId')
    .ascending('createdAt')
    .limit(100)
    .find({ useMasterKey: true });

  return claims.map((claim) => {
    const mosque = claim.get('mosqueId');
    const imam = claim.get('imamId');
    return {
      id: claim.id,
      evidenceNote: claim.get('evidenceNote'),
      createdAt: claim.get('createdAt'),
      mosqueName: mosque ? mosqueTitle(mosque) : null,
      wilayat: mosque ? mosque.get('wilayat') : null,
      village: mosque ? mosque.get('village') : null,
      mosqueNumber: mosque ? mosque.get('mosqueNumber') : null,
      governorate: mosque ? mosque.get('governorate') : null,
      capacity: claim.get('capacity') || 'imam',
      /*
       * وكم أُبعد عن هذا المسجد بسبب هذا الطلب.
       *
       * أن يتقدّم اثنان على مسجدٍ واحد قرينةٌ على أنّ الإشراف منازَع — وهي
       * من أقوى ما يملكه المشرف في أصعب سؤالٍ عنده: كيف يُثبت الإمام أنه
       * إمام؟ وكانت المحاولةُ الثانية تُردّ ولا يُقيَّد منها شيء.
       */
      contestedCount: claim.get('contestedCount') || 0,
      // المسافة لحظة التقديم: طلبٌ من داخل المسجد ليس دليلاً قاطعاً، لكنه أقوى
      // بكثير من طلبٍ من مدينة أخرى — والقرار يبقى للمشرف
      claimDistanceKm: claim.get('claimDistanceKm') ?? null,
      atMosque: claim.get('claimDistanceKm') != null
        && claim.get('claimDistanceKm') <= AT_MOSQUE_KM,
      // مسجدٌ بلا موقع لا مسافة له تُقاس، فكان المشرف يقرّر بلا قرينة —
      // وهي أشدّ حالةٍ يحتاجها: اعتمادُه يمنح المسجد موقعاً دائماً. البديل
      // بُعدُ الموقع المُقدَّم عن أقرب مسجدٍ معلومٍ في الولاية نفسها.
      wilayatNearestKm: claim.get('wilayatNearestKm') ?? null,
      willSetLocation: claim.get('claimLat') != null && claim.get('claimDistanceKm') == null,
      imamName: imam ? imam.get('fullName') : null,
      imamPhone: imam ? imam.get('phone') : null, // المشرف يتحقّق بالاتصال
      // نقلٌ لا تسجيلٌ أوّل: اعتمادُه يَنزع مسجداً من إمامٍ قائم. وبلا هذا
      // التمييز تُضغط الضغطةُ نفسها في الحالتين، وأثرُها ليس واحداً.
      isTransfer: Boolean(mosque && mosque.get('isClaimed') && mosque.get('imamId')),
      currentImamName: currentImamOf(mosque, 'fullName'),
      currentImamPhone: currentImamOf(mosque, 'phone'),
    };
  });
});

/** اعتماد أو رفض طلب الإشراف (مشرف فقط). */
Parse.Cloud.define('reviewMosqueClaim', async (request) => {
  const admin = requireRole(request, 'admin');
  const { claimId, approve } = request.params;

  const claim = await new Parse.Query('MosqueClaims').include('mosqueId').include('imamId')
    .get(claimId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  if (claim.get('status') !== 'pending') E.invalid('تمت مراجعة هذا الطلب مسبقاً.');

  claim.set('status', approve ? 'approved' : 'rejected');
  claim.set('reviewedBy', admin);
  claim.set('reviewedAt', new Date());
  await claim.save(null, { useMasterKey: true });

  let locationLearned = false;
  let locationRejected = false;
  // مَن كان قبله — يُقرأ قبل الكتابة فوقه، ولا سبيل إليه بعدها
  const previousImam = claim.get('mosqueId') && claim.get('mosqueId').get('imamId');
  const transferred = approve && Boolean(previousImam)
    && previousImam.id !== claim.get('imamId').id;

  if (approve) {
    const mosque = claim.get('mosqueId');
    mosque.set('imamId', claim.get('imamId'));
    mosque.set('isClaimed', true);

    // مسجدٌ بلا إحداثيات سجّله إمامه من عنده: فقد عرفنا أين هو. 430 مسجداً
    // بلا موقع يُوثق به، وأهلها خارج البحث بالقرب وفرصهم في ذيل
    // القائمة — فتُتبنّى إحداثيات الطلب بعد اعتماد المشرف لها.
    //
    // **ولا تُمسّ إحداثيات موجودة أبداً.** بيانات الوزارة مرجع، وموقع مقدّم
    // الطلب تقديرٌ بدقّة الجهاز: يملأ فراغاً ولا ينسخ فوق مرجع.
    const hasCoordinates = geo.validCoordinates(mosque.get('lat'), mosque.get('lng'));
    const claimed = { lat: claim.get('claimLat'), lng: claim.get('claimLng') };
    const offersLocation = !hasCoordinates && geo.validCoordinates(claimed.lat, claimed.lng);

    // القياس يُعاد هنا ولا يُكتفى بما حُفظ لحظة التقديم: الاعتماد هو اللحظة
    // التي يصير فيها الموقع دائماً، فليكن الفحص عندها. وقد يكون الطلب أُنشئ
    // قبل وجود هذا الفحص أصلاً، فلا يحمل قياساً.
    const plausible = offersLocation ? await nearestKnownInWilayat(mosque, claimed) : null;

    // موقعٌ مريب لا يُبطل الطلب: الرجل قد يكون إمام المسجد حقاً وجهازُه هو
    // المخطئ. يُعتمد إمامَ مسجده، ويبقى المسجد مجهول الموقع حتى يثبّته من عنده
    // بـ`confirmMosqueLocation`. وموقعٌ مجهول أهون من موقعٍ يقود الناس ضلالاً.
    locationRejected = offersLocation && !plausible;

    if (offersLocation && plausible) {
      mosque.set('lat', claimed.lat);
      mosque.set('lng', claimed.lng);
      mosque.set('location', new Parse.GeoPoint({
        latitude: claimed.lat, longitude: claimed.lng,
      }));
      mosque.set('hasLocation', true);
      // المصدر يُقال: من يقرأ الحقل لاحقاً يعرف أنه تقديرٌ لا بيانات وزارة
      mosque.set('locationSource', 'claim');
      locationLearned = true;
    }

    await mosque.save(null, { useMasterKey: true });
  }

  await audit.record({
    action: audit.ACTIONS.CLAIM_REVIEWED,
    target: claim,
    mosque: claim.get('mosqueId'),
    actor: admin,
    toStatus: claim.get('status'),
  });

  if (locationLearned) {
    await audit.record({
      action: audit.ACTIONS.LOCATION_LEARNED,
      target: claim.get('mosqueId'),
      mosque: claim.get('mosqueId'),
      actor: admin,
    });
  }

  if (transferred) {
    // بلا `note`: سجلّ المسجد يقرؤه كل مستخدم، و`getMosqueAuditTrail` تُعيد
    // الدور دون الهوية قصداً — فلا تُوضع أسماء الأئمّة فيه من الباب الخلفي
    await audit.record({
      action: audit.ACTIONS.MOSQUE_TRANSFERRED,
      target: claim.get('mosqueId'),
      mosque: claim.get('mosqueId'),
      actor: admin,
    });

    // من يُنزع منه مسجده أولى الناس بأن يعلم. وقد يكون حسابه موقوفاً فلا
    // يفتح التطبيق — والقيد في وارده يبقى له إن عادت إتاحته.
    await pushToUsers(previousImam, {
      alert: `نُقل الإشراف على ${mosqueTitle(claim.get('mosqueId'))} إلى غيرك بقرار الإدارة. `
        + 'راجع الإدارة إن كان ذلك خطأً.',
    });
  }

  /*
   * ومقدّم الطلب يُخبَر بما صار إليه طلبُه — قبولاً كان أو رفضاً.
   *
   * قِيس على خادمٍ حقيقي:
   *
   *     ما قيل لمقدّم الطلب: «تم استلام طلبك… **سيُراجع خلال أيام عمل**»
   *     وارده بعد الاعتماد:  []
   *     وارده بعد الرفض:     []
   *
   * **وعدٌ يُقطع ثم لا يُوفى.** والمراجعة بيد إنسانٍ فتطول أياماً، وهذه أوّلُ
   * معاملةٍ للإمام مع المنصّة — وبلا مسجدٍ معتمَد لا يستطيع شيئاً البتّة. فكان
   * عليه أن يتذكّر وحده أن يعود ويفتح «تسجيل مسجد» لينظر.
   *
   * و«من يُنزع منه مسجده أولى الناس بأن يعلم» مكتوبةٌ فوق بلاغ الإمام السابق
   * منذ حين — **والمبدأ نفسه لم يُطبَّق على صاحب الطلب.**
   *
   * والموقع المردود يُقال له هنا لا للمشرف وحده: التعليق تحت `return` يقول إن
   * المشرف «يُنبّه إمامه إلى الزرّ» — وتلك خطوةٌ بشرية تُنسى.
   */
  const applicant = claim.get('imamId');
  if (applicant) {
    const name = claim.get('mosqueId') ? claim.get('mosqueId').get('name') : 'المسجد';
    await pushToUsers(applicant, {
      alert: approve
        ? `اعتُمدت إمامتك لـ${name}.`
          + (locationRejected
            ? ' ولم يُعتمد الموقع المُرسل، فالمسجد ما زال مجهول الموقع —'
              + ' ثبّته من «مساجدي» وأنت عنده ليجده المتطوّعون.'
            : ' يمكنك الآن نشر طلبات الصيانة من «مساجدي».')
        : `لم يُعتمد طلبك لإمامة ${name}. راجع الإدارة، ولك تقديم طلبٍ جديد`
          + ' من عند المسجد.',
      mosqueId: claim.get('mosqueId'),
    });
  }

  // يُقال للمشرف صراحةً: اعتمد الإمام ولم يعتمد موقعه. بلا هذا يظنّ المسجد
  // صار على الخريطة، فلا يتابع ولا يُنبّه إمامه إلى الزرّ.
  return {
    status: claim.get('status'),
    locationLearned,
    locationRejected,
    ...(locationRejected ? {
      message: 'اعتُمد الإمام، ولم يُعتمد الموقع المُرسل — بعيدٌ عن مساجد الولاية. '
        + 'المسجد يبقى مجهول الموقع حتى يثبّته إمامه من عنده.',
    } : {}),
  };
});

/**
 * الإمام يثبّت موقع مسجده وهو عنده.
 *
 * لماذا لزمت هذه الدالة: أربعمئة مسجدٍ وأربعة عشر سُحبت ثقتنا من إحداثياتها
 * (انظر `scripts/lib/coord-trust.js`)، وطريق التعلّم الوحيد كان اعتماد طلب
 * التسجيل. ومسجدٌ سُجّل قبل ذلك يبقى مجهول الموقع أبداً: لا طلبَ ينتظر اعتماداً
 * يحمل إحداثياً. فسحبُ الموقع بلا طريقٍ لردّه نصفُ إصلاح.
 *
 * والشرط نفسه شرط التسجيل: أن يكون الإمام **عند مسجده**. لا مقياس هنا يُقاس
 * إليه — فالمسجد بلا موقع — والضمانة أن المُثبِّت إمامٌ اعتمده مشرف، وأن ما
 * يُثبته يُكتب في سجلّ التتبّع باسمه.
 *
 * ولا يُمسّ موقعٌ قائم: بيانات الوزارة مرجع، وهذا يملأ فراغاً لا ينسخ فوقه.
 */
Parse.Cloud.define('confirmMosqueLocation', async (request) => {
  const imam = requireRole(request, 'imam');
  const { mosqueId, lat, lng } = request.params;

  const mosque = await mosqueForImam(imam, mosqueId);
  const point = { lat: Number(lat), lng: Number(lng) };
  if (!geo.validCoordinates(point.lat, point.lng)) {
    E.invalid('أكّد موقعك عند المسجد — فعّل إذن الموقع وأعد المحاولة.');
  }

  const previous = geo.validCoordinates(mosque.get('lat'), mosque.get('lng'))
    ? { lat: mosque.get('lat'), lng: mosque.get('lng'), source: mosque.get('locationSource') }
    : null;

  /**
   * الموضع الجديد يُقاس إلى مساجد الولاية كما يُقاس موضعُ طلب الإشراف.
   *
   * الفحص هنا **ليس شكّاً في الإمام** بل في الجهاز: إشارةٌ ضعيفة داخل البناء
   * تعطي إحداثياً بعيداً بكيلومترات، ولا يظهر ذلك لصاحبه. وتصويبٌ يضع المسجد
   * في محافظةٍ أخرى أسوأ من الخطأ الذي جاء يصلحه.
   */
  const plausible = await nearestKnownInWilayat(mosque, point);
  if (!plausible) {
    E.invalid(`الموقع المُرسل بعيدٌ عن مساجد ولاية ${mosque.get('wilayat')} المعروفة. `
      + 'تأكّد أنك عند المسجد وأن إشارة الموقع جيّدة، ثم أعد المحاولة.');
  }

  mosque.set('lat', point.lat);
  mosque.set('lng', point.lng);
  mosque.set('location', new Parse.GeoPoint({ latitude: point.lat, longitude: point.lng }));
  mosque.set('hasLocation', true);
  // المصدر يُقال: من يقرأ الحقل لاحقاً يعرف أنه تقدير جهازٍ لا بيانات وزارة —
  // وعليه يعتمد سكربت الاستيراد فلا يمسحه في تشغيلةٍ تالية
  mosque.set('locationSource', 'imam');
  await mosque.save(null, { useMasterKey: true });

  /**
   * التصويب يُقيَّد بغير ما يُقيَّد به التثبيت، ومعه الموضع السابق.
   *
   * تغييرُ موقعٍ قائم ليس كملء فراغ: من يقرأ سجلّ المسجد بعد شهرٍ يحتاج أن
   * يعرف **ما كان** لا أنه «سُجّل موقع» فحسب. والشفافية غاية المنصّة، ومن
   * يملك تغيير البيانات يجب أن يُرى وهو يغيّرها.
   */
  await audit.record({
    action: previous ? audit.ACTIONS.LOCATION_CORRECTED : audit.ACTIONS.LOCATION_LEARNED,
    target: mosque,
    mosque,
    actor: imam,
    note: previous
      ? `من ${previous.lat.toFixed(5)}, ${previous.lng.toFixed(5)}`
        + `${previous.source ? ` (${previous.source})` : ''}`
      : undefined,
  });

  return {
    located: true,
    corrected: Boolean(previous),
    message: previous
      ? 'تم تصويب موقع المسجد، بارك الله فيكم.'
      : 'تم تثبيت موقع المسجد، بارك الله فيكم.',
  };
});
