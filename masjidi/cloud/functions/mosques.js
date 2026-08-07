const E = require('../lib/errors');
const { requireUser, requireRole } = require('../lib/auth');
const audit = require('../lib/audit');

const PUBLIC_FIELDS = [
  'name', 'mosqueNumber', 'type', 'typeSlug', 'governorate', 'wilayat',
  'village', 'location', 'isClaimed', 'openRequestsCount',
];

/**
 * المساجد القريبة.
 * إصلاحات مقابل النسخة الأصلية: حد أقصى للنتائج، تحديد الحقول المُعادة،
 * سقف لنصف القطر، ولا نُعيد كائنات كاملة بصلاحيات Master.
 */
Parse.Cloud.define('getNearbyMosques', async (request) => {
  requireUser(request);
  const { lat, lng, radius = 5, limit = 50 } = request.params;

  if (typeof lat !== 'number' || typeof lng !== 'number') {
    E.invalid('الإحداثيات (lat, lng) مطلوبة كأرقام.');
  }
  const radiusKm = Math.min(Math.max(Number(radius) || 5, 0.5), 50);

  const point = new Parse.GeoPoint({ latitude: lat, longitude: lng });
  const query = new Parse.Query('Mosques');
  query.withinKilometers('location', point, radiusKm, true); // sorted = true
  query.select(...PUBLIC_FIELDS);
  query.limit(Math.min(Number(limit) || 50, 100));

  const results = await query.find({ useMasterKey: true });
  return results.map((m) => m.toJSON());
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
  const { term, governorate, wilayat, limit = 30 } = request.params;

  const cleaned = term ? normalizeArabic(term) : '';
  const cap = Math.min(Number(limit) || 30, 100);

  /** قيود المحافظة والولاية مشتركة بين المحاولتين. */
  const scoped = () => {
    const query = new Parse.Query('Mosques');
    if (governorate) query.equalTo('governorate', governorate);
    if (wilayat) query.equalTo('wilayat', wilayat);
    query.select(...PUBLIC_FIELDS);
    query.limit(cap);
    return query;
  };

  if (cleaned.length < 2) {
    const all = await scoped().find({ useMasterKey: true });
    return all.map((m) => m.toJSON());
  }

  // البادئة المثبّتة وحدها تستفيد من فهرس `nameNormalized`. `contains` يولّد
  // `$regex` غير مثبّت فيمسح المجموعة كاملة (18 ألف وثيقة) — يبقى خطة بديلة
  // لأن المستخدم قد يبحث بكلمة من وسط الاسم، لا احتمالاً أولَ.
  const byPrefix = scoped();
  byPrefix.startsWith('nameNormalized', cleaned);
  const prefixHits = await byPrefix.find({ useMasterKey: true });
  if (prefixHits.length > 0) return prefixHits.map((m) => m.toJSON());

  const bySubstring = scoped();
  bySubstring.contains('nameNormalized', cleaned);
  const results = await bySubstring.find({ useMasterKey: true });
  return results.map((m) => m.toJSON());
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
