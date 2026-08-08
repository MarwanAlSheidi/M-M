const E = require('../lib/errors');
const { requireUser, requireRole } = require('../lib/auth');
const audit = require('../lib/audit');
const geo = require('../lib/geo');

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
 * فرص التطوّع القريبة — شاشة المتطوّع الأولى.
 *
 * المتطوّع لا يبحث عن مسجد بل عن عمل قريب منه، فالترتيب بالمسافة لا بالتاريخ.
 */
Parse.Cloud.define('getNearbyOpportunities', async (request) => {
  requireUser(request);
  const { lat, lng, radiusKm } = readPoint(request.params, 15);

  const mosqueQuery = new Parse.Query('Mosques');
  geo.withinBox(mosqueQuery, geo.boundingBox(lat, lng, radiusKm));
  mosqueQuery.greaterThan('openRequestsCount', 0); // لا معنى لمسجد بلا طلبات
  mosqueQuery.select('name', 'wilayat', 'village', 'governorate', 'lat', 'lng');
  mosqueQuery.limit(BOX_CANDIDATE_CAP);

  const near = geo.sortByDistance(
    await mosqueQuery.find({ useMasterKey: true }), lat, lng, radiusKm,
  );

  // مساجد بلا إحداثيات — ستة عشر في بيانات الوزارة. صندوق الإحاطة لا يبلغها
  // أبداً، فكانت طلباتها لا تصل متطوّعاً شارك موقعه، وتصل من رفض المشاركة
  // وحده. تُلحق بالقائمة بمسافةٍ مجهولة لا تُسقَط منها: القائمة تُرتَّب
  // بالقرب، وما لا يُعرف قربه يأتي آخراً موسوماً لا محذوفاً.
  const unlocated = await new Parse.Query('Mosques')
    .equalTo('hasLocation', false)
    .greaterThan('openRequestsCount', 0)
    .select('name', 'wilayat', 'village', 'governorate')
    .limit(50)
    .find({ useMasterKey: true });

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
      mosqueName: hit.mosque.get('name'),
      wilayat: hit.mosque.get('wilayat'),
      village: hit.mosque.get('village'),
      distanceKm: hit.km == null ? null : Math.round(hit.km * 100) / 100,
    }));
});

/**
 * تطبيع النص العربي — نظير `normalize_ar` في `scripts/clean_mosques.py`.
 *
 * البيانات مخزَّنة مطبَّعة في `nameNormalized`، وكان البحث يُرسل النص كما كتبه
 * المستخدم: فمن يكتب «الرحمة» لا يجد «الرحمه»، وهي المشكلة التي وُجد الحقل
 * لحلّها. الطرفان يجب أن يمرّا بالتطبيع نفسه، وإلا فالحقل بلا فائدة.
 */
function normalizeArabic(text) {
  return String(text)
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670]/g, '') // التشكيل
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

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
    if (!from) return shaped;

    return shaped
      .map((mosque) => ({
        ...mosque,
        distanceKm: geo.validCoordinates(mosque.lat, mosque.lng)
          ? Math.round(geo.distanceKm(from.lat, from.lng, mosque.lat, mosque.lng) * 100) / 100
          : null,
      }))
      // الأقرب أوّلاً، ومجهولُ الموقع آخراً لا محذوفاً — القاعدة نفسها في الفرص
      .sort((a, b) => (a.distanceKm == null ? Infinity : a.distanceKm)
        - (b.distanceKm == null ? Infinity : b.distanceKm));
  };

  /** قيود المحافظة والولاية مشتركة بين المحاولتين. */
  const scoped = () => {
    const query = new Parse.Query('Mosques');
    if (governorate) query.equalTo('governorate', governorate);
    if (wilayat) query.equalTo('wilayat', wilayat);
    query.select(...PUBLIC_FIELDS, 'lat', 'lng');
    query.limit(cap);
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
 * طلب ملكية مسجد (الإمام يربط نفسه بمسجد من قاعدة بيانات الوزارة).
 * لا يُعتمد تلقائياً — يبقى معلقاً حتى موافقة المشرف، لأن ربط شخص بمسجد
 * يمنحه لاحقاً صلاحية استقبال تبرعات.
 */
Parse.Cloud.define('claimMosque', async (request) => {
  const imam = requireRole(request, 'imam');
  const { mosqueId, evidenceNote } = request.params;
  if (!mosqueId) E.invalid('معرّف المسجد مطلوب.');

  const mosque = await new Parse.Query('Mosques').get(mosqueId, { useMasterKey: true })
    .catch(() => E.notFound('المسجد غير موجود.'));

  if (mosque.get('isClaimed')) E.duplicate('هذا المسجد مسجّل لإمام آخر بالفعل.');

  const existing = await new Parse.Query('MosqueClaims')
    .equalTo('mosqueId', mosque)
    .equalTo('status', 'pending')
    .first({ useMasterKey: true });
  if (existing) E.duplicate('يوجد طلب ملكية معلّق لهذا المسجد.');

  const Claim = Parse.Object.extend('MosqueClaims');
  const claim = new Claim();
  claim.set('mosqueId', mosque);
  claim.set('imamId', imam);
  claim.set('status', 'pending');
  claim.set('evidenceNote', String(evidenceNote || '').slice(0, 500));
  await claim.save(null, { useMasterKey: true });

  return { message: 'تم استلام طلبك، سيُراجع خلال أيام عمل.', claimId: claim.id };
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
    wilayat: mosque.get('wilayat'),
    village: mosque.get('village'),
    mosqueNumber: mosque.get('mosqueNumber'),
    governorate: mosque.get('governorate'),
    openRequestsCount: mosque.get('openRequestsCount') || 0,
  }));
});

/**
 * طلبات الملكية الخاصة بالإمام المستدعي.
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
      evidenceNote: claim.get('evidenceNote'),
      createdAt: claim.get('createdAt'),
      reviewedAt: claim.get('reviewedAt'),
      mosqueId: mosque ? mosque.id : null,
      mosqueName: mosque ? mosque.get('name') : null,
      wilayat: mosque ? mosque.get('wilayat') : null,
      village: mosque ? mosque.get('village') : null,
      mosqueNumber: mosque ? mosque.get('mosqueNumber') : null,
    };
  });
});

/**
 * طلبات الملكية المنتظرة — مشرف فقط.
 *
 * `MosqueClaims` مقفلة على Master Key، فلم يكن أمام المشرف إلا `reviewMosqueClaim`
 * ومعه معرّف لا سبيل له إليه من التطبيق. انضمام كل إمام يتوقّف على هذه المراجعة.
 */
Parse.Cloud.define('listPendingClaims', async (request) => {
  requireRole(request, 'admin');

  const claims = await new Parse.Query('MosqueClaims')
    .equalTo('status', 'pending')
    .include('mosqueId')
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
      mosqueName: mosque ? mosque.get('name') : null,
      wilayat: mosque ? mosque.get('wilayat') : null,
      village: mosque ? mosque.get('village') : null,
      mosqueNumber: mosque ? mosque.get('mosqueNumber') : null,
      governorate: mosque ? mosque.get('governorate') : null,
      imamName: imam ? imam.get('fullName') : null,
      imamPhone: imam ? imam.get('phone') : null, // المشرف يتحقّق بالاتصال
    };
  });
});

/** اعتماد أو رفض طلب الملكية (مشرف فقط). */
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

  if (approve) {
    const mosque = claim.get('mosqueId');
    mosque.set('imamId', claim.get('imamId'));
    mosque.set('isClaimed', true);
    await mosque.save(null, { useMasterKey: true });
  }

  await audit.record({
    action: audit.ACTIONS.CLAIM_REVIEWED,
    target: claim,
    mosque: claim.get('mosqueId'),
    actor: admin,
    toStatus: claim.get('status'),
  });

  return { status: claim.get('status') };
});
