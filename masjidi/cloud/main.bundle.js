/**
 * مسجدي (Masjidi) — Cloud Code كاملاً في ملف واحد
 * =================================================
 * الصق هذا الملف في: Back4app → Server Settings → Cloud Code → main.js → Deploy
 *
 * مولّد آلياً من مجلد cloud/ عبر scripts/build_single_file.py
 * للتطوير طويل الأمد استخدم النسخة المجزّأة — التعديل هنا يُفقد عند إعادة التوليد.
 */


// ======================================================================
// الأخطاء الموحّدة   [lib/errors.js]
// ======================================================================

/**
 * أخطاء موحّدة برسائل عربية وأكواد Parse قياسية.
 * لا تستخدم `throw new Error(...)` في دوال السحابة — العميل يفقد كود الخطأ.
 */

const CODES = {
  INVALID_SESSION: Parse.Error.INVALID_SESSION_TOKEN, // 209
  VALIDATION: Parse.Error.VALIDATION_ERROR, // 142
  NOT_FOUND: Parse.Error.OBJECT_NOT_FOUND, // 101
  FORBIDDEN: Parse.Error.OPERATION_FORBIDDEN, // 119
  DUPLICATE: Parse.Error.DUPLICATE_VALUE, // 137
};

function fail(code, messageAr) {
  throw new Parse.Error(code, messageAr);
}

const E = {
  CODES,
  fail,
  unauthenticated: () => fail(CODES.INVALID_SESSION, 'يجب تسجيل الدخول أولاً.'),
  forbidden: (m) => fail(CODES.FORBIDDEN, m || 'ليست لديك صلاحية لتنفيذ هذا الإجراء.'),
  invalid: (m) => fail(CODES.VALIDATION, m || 'البيانات المُرسلة غير صحيحة.'),
  notFound: (m) => fail(CODES.NOT_FOUND, m || 'العنصر المطلوب غير موجود.'),
  duplicate: (m) => fail(CODES.DUPLICATE, m || 'هذا العنصر مسجّل مسبقاً.'),
};


// ======================================================================
// الصلاحيات والأدوار   [lib/auth.js]
// ======================================================================

const ROLES = ['imam', 'volunteer', 'donor', 'contractor', 'admin'];

/** يتحقق من وجود جلسة صالحة ويعيد المستخدم. */
function requireUser(request) {
  const user = request.user;
  if (!user) E.unauthenticated();
  return user;
}

/**
 * يتحقق أن المستخدم يحمل أحد الأدوار المطلوبة.
 * ملاحظة أمنية: نقرأ الدور من الكائن المخزّن لا من request.params أبداً.
 */
function requireRole(request, ...roles) {
  const user = requireUser(request);
  const role = user.get('role');
  if (!roles.includes(role)) {
    E.forbidden(`هذه الخاصية متاحة لـ: ${roles.join('، ')} فقط.`);
  }
  return user;
}

/**
 * يعيد المسجد الذي يديره هذا الإمام.
 * الإمام قد يدير أكثر من مسجد، لذا نطلب mosqueId صراحةً عند وجود أكثر من واحد.
 */
async function mosqueForImam(imam, mosqueId) {
  const query = new Parse.Query('Mosques');
  query.equalTo('imamId', imam);
  query.equalTo('isClaimed', true);

  if (mosqueId) {
    query.equalTo('objectId', mosqueId);
    const mosque = await query.first({ useMasterKey: true });
    if (!mosque) E.forbidden('هذا المسجد غير مسجّل باسمك.');
    return mosque;
  }

  const mosques = await query.limit(2).find({ useMasterKey: true });
  if (mosques.length === 0) E.notFound('لا يوجد مسجد مسجّل باسمك بعد.');
  if (mosques.length > 1) E.invalid('تدير أكثر من مسجد — أرسل mosqueId مع الطلب.');
  return mosques[0];
}

/** جلب كائن مُشار إليه (Pointer) بشكل آمن — الـ Pointer الخام لا يحمل بياناته. */
async function fetchPointer(pointer, className) {
  if (!pointer) E.notFound(`${className} غير مرتبط بهذا السجل.`);
  if (pointer.get && pointer.get('createdAt') !== undefined && pointer.attributes && Object.keys(pointer.attributes).length > 0) {
    return pointer; // مُحمّل مسبقاً عبر include()
  }
  return pointer.fetch({ useMasterKey: true });
}


// ======================================================================
// الإشعارات   [lib/push.js]
// ======================================================================

/**
 * الإشعارات.
 *
 * ⚠️ خطأ شائع في الملف الأصلي: Parse.Push.send يستعلم على فئة _Installation
 * وليس على _User. لذلك `where: { role: "imam" }` لا يطابق شيئاً أبداً،
 * و `where: { objectId: { $in: [userIds] } }` يقارن معرّفات مستخدمين
 * بمعرّفات أجهزة. الصحيح: الاستعلام على حقل الـ pointer `user` داخل _Installation.
 *
 * شرط التشغيل: عند تسجيل الدخول في التطبيق يجب حفظ Installation
 * وربطه بالمستخدم:  installation.set('user', Parse.User.current())
 */

async function pushToUsers(users, payload) {
  const list = (Array.isArray(users) ? users : [users]).filter(Boolean);
  if (list.length === 0) return { sent: 0 };

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
    return { sent: 0, failed: true };
  }
  return { sent: list.length };
}


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
        .map(({ row }) => row);
    }

    if (volunteers.length === 0) {
      base.equalTo('governorate', mosque.get('governorate'));
      base.limit(500);
      volunteers = await base.find({ useMasterKey: true });
    }
  } catch (error) {
    // الاستعلام الجغرافي يفشل إن غاب فهرس `2dsphere` — وغيابه وارد: يُضاف
    // يدوياً من لوحة Back4app. لا يجوز أن يُسقط ذلك إنشاء طلب صيانة.
    console.error('[push] تعذّر جلب المتطوّعين القريبين:', error && error.message);
    return { sent: 0, failed: true };
  }

  return pushToUsers(volunteers, payload);
}


// ======================================================================
// بوابة الدفع   [lib/payments.js]
// ======================================================================

/**
 * محوّل بوابة الدفع.
 *
 * قاعدة ذهبية: لا يُضاف أي مبلغ إلى رصيد المسجد إلا بعد تأكيد البوابة.
 * التدفق الصحيح:
 *   1) initiateDonation  → إنشاء معاملة بحالة "pending" + جلسة دفع.
 *   2) المستخدم يدفع في صفحة البوابة.
 *   3) webhook أو التحقق اليدوي → confirmDonation → الحالة "captured" + تحديث الرصيد.
 *
 * البوابات المتاحة في عُمان: Thawani (الأكثر شيوعاً)، OmanNet عبر البنوك،
 * وAmwal. جميعها تتطلب سجلاً تجارياً وحساباً تاجراً.
 *
 * ⚠️ تنبيه تنظيمي مهم قبل تفعيل التبرعات:
 * جمع التبرعات للمساجد في السلطنة يخضع لوزارة الأوقاف والشؤون الدينية،
 * ويحتاج تصريح جمع تبرعات. لا تُفعّل هذا المسار في الإنتاج قبل الحصول
 * على الموافقة. يمكن إطلاق النسخة الأولى بمسار التطوّع العيني فقط
 * (estimatedCost = 0) دون أي حركة مالية — وهذا هو المسار الموصى به للـ MVP.
 */

const THAWANI_BASE = process.env.THAWANI_BASE_URL || 'https://uatcheckout.thawani.om/api/v1';
const THAWANI_SECRET = process.env.THAWANI_SECRET_KEY;
const THAWANI_PUBLISHABLE = process.env.THAWANI_PUBLISHABLE_KEY;

const BAISA_PER_OMR = 1000; // ثواني تتعامل بالبيسة (عدد صحيح)

function isConfigured() {
  return Boolean(THAWANI_SECRET && THAWANI_PUBLISHABLE);
}

/**
 * إنشاء جلسة دفع. يعيد { sessionId, redirectUrl }.
 * clientReferenceId هو مفتاح المنع المزدوج (idempotency) — نمرّر معرّف المعاملة.
 */
async function createCheckoutSession({ amountOmr, clientReferenceId, description, successUrl, cancelUrl }) {
  if (!isConfigured()) {
    throw new Parse.Error(Parse.Error.OTHER_CAUSE, 'بوابة الدفع غير مهيأة على الخادم.');
  }

  const response = await Parse.Cloud.httpRequest({
    method: 'POST',
    url: `${THAWANI_BASE}/checkout/session`,
    headers: { 'Content-Type': 'application/json', 'thawani-api-key': THAWANI_SECRET },
    body: {
      client_reference_id: clientReferenceId,
      mode: 'payment',
      products: [{ name: description, quantity: 1, unit_amount: Math.round(amountOmr * BAISA_PER_OMR) }],
      success_url: successUrl,
      cancel_url: cancelUrl,
    },
  });

  const session = response.data.data;
  return {
    sessionId: session.session_id,
    redirectUrl: `${THAWANI_BASE.replace('/api/v1', '')}/pay/${session.session_id}?key=${THAWANI_PUBLISHABLE}`,
  };
}

/**
 * حالات "غير مدفوع" النهائية: لا أمل في اكتمال الدفع بعدها.
 * ما عداها (unpaid مثلاً) يعني أن الجلسة ما تزال مفتوحة والمستخدم قد يدفع لاحقاً.
 * التمييز ضروري: تعليم معاملة `failed` وهي ما تزال قابلة للدفع يُسقطها من
 * شرط `pending` في confirmDonation، فيدفع المتبرع ولا يُقيَّد مبلغه أبداً.
 */
const TERMINAL_UNPAID = ['cancelled', 'canceled', 'expired', 'failed', 'refunded'];

/** التحقق من حالة الجلسة لدى البوابة — المصدر الوحيد للحقيقة. */
async function verifySession(sessionId) {
  const response = await Parse.Cloud.httpRequest({
    method: 'GET',
    url: `${THAWANI_BASE}/checkout/session/${sessionId}`,
    headers: { 'thawani-api-key': THAWANI_SECRET },
  });

  const session = response.data.data;
  const status = String(session.payment_status || '').toLowerCase();
  return {
    paid: status === 'paid',
    terminal: TERMINAL_UNPAID.includes(status),
    status,
    amountOmr: (session.total_amount || 0) / BAISA_PER_OMR,
    reference: session.invoice || session.session_id,
    raw: session,
  };
}

const payments = { isConfigured, createCheckoutSession, verifySession };


// ======================================================================
// سجل التدقيق   [lib/audit.js]
// ======================================================================

/**
 * سجل التدقيق.
 *
 * وعد المنصّة للمتبرّع هو الشفافية، و`getMosqueLedger` يُظهر المال وحده: من
 * تبرّع بكم ومتى صُرف. لا يُظهر من غيّر حالة الطلب ولا متى، فلا سبيل للإجابة
 * عن "من ألغى هذا الطلب؟" أو "متى اعتُمد العمل ومن اعتمده؟".
 *
 * قيدان في التصميم:
 *
 * 1) **القيد لا يُسقط العملية أبداً.** فشل الكتابة هنا يُسجَّل في السجلّ ويُبتلع
 *    — لا يجوز أن يفشل اعتماد عملٍ منجَز لأن سطر تدقيق لم يُكتب.
 * 2) **يُستدعى صراحةً من الدوال لا من `afterSave`.** المُشغّل يرى تغيّر الحالة
 *    لكنه لا يرى الفاعل: الحفظ يجري بـ Master Key فيصل `request.user` فارغاً.
 *
 * تنبيه على التكلفة: كل قيد كتابةٌ إضافية. باقة Back4app المجانية 25 ألف طلب
 * شهرياً، فالقيد مقصور على تحوّلات الحالة وحركات المال لا على كل حفظ.
 */

const ACTIONS = {
  REQUEST_CREATED: 'request_created',
  INTEREST_EXPRESSED: 'interest_expressed',
  INTEREST_WITHDRAWN: 'interest_withdrawn',
  WORKER_ASSIGNED: 'worker_assigned',
  ASSIGNMENT_RELEASED: 'assignment_released',
  WORK_STARTED: 'work_started',
  WORK_DONE: 'work_done',
  REQUEST_COMPLETED: 'request_completed',
  REQUEST_CANCELLED: 'request_cancelled',
  DONATION_CAPTURED: 'donation_captured',
  DONATION_EXPIRED: 'donation_expired',
  PAYOUT_RECORDED: 'payout_recorded',
  CLAIM_REVIEWED: 'claim_reviewed',
  CONTRACTOR_REVIEWED: 'contractor_reviewed',
  DONATION_REFUNDED: 'donation_refunded',
};

/**
 * قيد سطر تدقيق واحد.
 *
 * @param {object}  entry
 * @param {string}  entry.action      من `ACTIONS`
 * @param {object=} entry.target      الكائن المتأثّر (طلب، معاملة، …)
 * @param {object=} entry.mosque      المسجد — مفتاح عرض السجل
 * @param {object=} entry.actor       المستخدم الفاعل، أو لا شيء للنظام
 * @param {string=} entry.fromStatus
 * @param {string=} entry.toStatus
 * @param {number=} entry.amount
 */
async function record({ action, target, mosque, actor, fromStatus, toStatus, amount }) {
  try {
    const Entry = Parse.Object.extend('AuditLog');
    const entry = new Entry();

    entry.set('action', action);
    if (target) {
      entry.set('targetClass', target.className);
      entry.set('targetId', target.id);
    }
    if (mosque) entry.set('mosqueId', mosque);
    if (actor) {
      entry.set('actorId', actor);
      entry.set('actorRole', actor.get('role') || null);
    }
    if (fromStatus) entry.set('fromStatus', fromStatus);
    if (toStatus) entry.set('toStatus', toStatus);
    if (typeof amount === 'number') entry.set('amount', amount);

    await entry.save(null, { useMasterKey: true });
  } catch (error) {
    // مقصود: التدقيق لا يُسقط العملية التي يوثّقها
    console.error('[audit] تعذّر قيد السطر:', action, error && error.message);
  }
}

const audit = { record, ACTIONS };


// ======================================================================
// القرب الجغرافي   [lib/geo.js]
// ======================================================================

/**
 * حساب القرب الجغرافي بلا فهرس مكاني.
 *
 * لماذا لا `withinKilometers`؟ لأنها تفرض فهرس `2dsphere` على MongoDB
 * (وPostGIS على PostgreSQL). و`CLAUDE.md` ينبّه أن الفهرس يُضاف **يدوياً** من
 * لوحة Back4app — أي أنه قد يغيب في أول يوم تشغيل، فيفشل الاستعلام أو يمسح
 * 18 ألف وثيقة. وموقع المسجد هو ما يربط المصلّي بمسجده، فلا يصحّ أن يتعلّق
 * بخطوة يدوية.
 *
 * البديل: صندوق إحاطة على حقلين رقميين عاديين (`lat`/`lng`) يخدمهما فهرس
 * مركّب بسيط، ثم مسافة هافرساين الدقيقة داخل الكود. الصندوق يُضيّق المرشّحين
 * إلى العشرات، والحساب الدقيق عليها لا يكلّف شيئاً.
 */

const EARTH_RADIUS_KM = 6371;
const KM_PER_DEGREE_LAT = 111.32;

const toRad = (degrees) => (degrees * Math.PI) / 180;

/** المسافة بين نقطتين بالكيلومترات. */
function distanceKm(fromLat, fromLng, toLat, toLng) {
  const dLat = toRad(toLat - fromLat);
  const dLng = toRad(toLng - fromLng);

  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(fromLat)) * Math.cos(toRad(toLat)) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * حدود صندوق يحيط بدائرة نصف قطرها `radiusKm`.
 *
 * الصندوق أوسع من الدائرة دائماً (زواياه خارجها)، فلا يُسقط نتيجة صحيحة —
 * والتصفية الدقيقة بعده. عرض درجة الطول يتقلّص باتجاه القطبين، ولذلك يُقسم
 * على جيب تمام خط العرض؛ وعُمان بعيدة عن القطبين فالحارس احتياط لا أكثر.
 */
function boundingBox(lat, lng, radiusKm) {
  const latDelta = radiusKm / KM_PER_DEGREE_LAT;
  const cosLat = Math.max(Math.cos(toRad(lat)), 0.01);
  const lngDelta = radiusKm / (KM_PER_DEGREE_LAT * cosLat);

  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}

/** يضيف قيود الصندوق إلى استعلام قائم. */
function withinBox(query, { minLat, maxLat, minLng, maxLng }, latField = 'lat', lngField = 'lng') {
  query.greaterThanOrEqualTo(latField, minLat);
  query.lessThanOrEqualTo(latField, maxLat);
  query.greaterThanOrEqualTo(lngField, minLng);
  query.lessThanOrEqualTo(lngField, maxLng);
  return query;
}

/** يُصفّي مرشّحي الصندوق إلى الدائرة، ويرتّبهم بالأقرب. */
function sortByDistance(rows, lat, lng, radiusKm, latField = 'lat', lngField = 'lng') {
  return rows
    .map((row) => ({
      row,
      km: distanceKm(lat, lng, row.get(latField), row.get(lngField)),
    }))
    .filter((hit) => Number.isFinite(hit.km) && hit.km <= radiusKm)
    .sort((a, b) => a.km - b.km);
}

/** تحقّق من إحداثيات واردة من العميل. */
function validCoordinates(lat, lng) {
  return typeof lat === 'number' && typeof lng === 'number'
    && Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

const geo = { distanceKm, boundingBox, withinBox, sortByDistance, validCoordinates };


// ======================================================================
// المُشغّلات (beforeSave / afterSave)   [triggers.js]
// ======================================================================

/** لا يُسمح للعميل بتعيين دوره بنفسه إلى admin، ولا بتعديل الحقول الحسّاسة. */
Parse.Cloud.beforeSave(Parse.User, async (request) => {
  const user = request.object;

  if (user.isNew() && !user.get('role')) user.set('role', 'donor');

  const role = user.get('role');
  if (role && !ROLES.includes(role)) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'دور غير معروف.');
  }

  // الترقية إلى admin أو اعتماد الشركات يتم عبر Master Key فقط
  if (!request.master) {
    if (user.dirty('role')) {
      if (role === 'admin') {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'غير مسموح.');
      }
      // الدور يُختار عند التسجيل ويُثبَّت بعده. تركُه مفتوحاً يعني أن متبرعاً
      // يصبح إماماً أو شركةً متى شاء، فلا يصلح الدور أساساً لأي تفويض لاحق.
      if (!user.isNew()) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'تغيير الدور يتم من الإدارة.');
      }
    }
    // ⚠️ `dirty()` وحده لا يصلح حارساً على حقل له `defaultValue` في المخطط:
    // Parse يطبّق القيمة الافتراضية عند الإنشاء فيُعلّم الحقل مُعدَّلاً، فكان
    // هذا الشرط يرفض **كل تسجيل جديد** برسالة اعتماد الشركات. الصواب: الحساب
    // الجديد يبدأ غير معتمد دائماً، والتعديل بعد ذلك بـ Master Key وحده.
    if (user.isNew()) {
      user.set('isVerifiedContractor', false);
    } else if (user.dirty('isVerifiedContractor')) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'اعتماد الشركات يتم من الإدارة.');
    }
  }

  if (user.isNew()) user.set('isActive', true);
});

/**
 * إقفال المستخدم الجديد على نفسه.
 *
 * الـ CLP وحده لا يكفي: افتراض Parse أن يمنح المستخدم الجديد قراءة عامة، فيصبح
 * `phone` و`lastKnownLocation` (موقع المتطوع) مقروءاً لكل من يملك مفتاح العميل.
 * الـ ACL لا يُضبط في beforeSave لأن `objectId` لم يُسنَد بعد عند الإنشاء.
 * قراءة بيانات مستخدم آخر تبقى ممكنة من دوال السحابة عبر Master Key.
 */
Parse.Cloud.afterSave(Parse.User, async (request) => {
  if (request.original) return; // تحديث، لا إنشاء — وهو أيضاً ما يمنع الحلقة اللانهائية

  const user = request.object;
  const acl = user.getACL();
  if (acl && !acl.getPublicReadAccess() && !acl.getPublicWriteAccess()) return;

  const own = new Parse.ACL();
  own.setReadAccess(user.id, true);
  own.setWriteAccess(user.id, true);
  user.setACL(own);
  await user.save(null, { useMasterKey: true });
});

/** الرصيد والحالات لا تُعدّل إلا من دوال السحابة. */
Parse.Cloud.beforeSave('Mosques', async (request) => {
  const mosque = request.object;
  if (!request.master && (mosque.dirty('walletBalance') || mosque.dirty('imamId') || mosque.dirty('isClaimed'))) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'تعديل غير مسموح من التطبيق.');
  }
  if ((mosque.get('walletBalance') || 0) < 0) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'الرصيد لا يمكن أن يكون سالباً.');
  }
});

Parse.Cloud.beforeSave('ServiceRequests', async (request) => {
  if (!request.master) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'الطلبات تُنشأ وتُحدّث عبر دوال السحابة فقط.');
  }
});

Parse.Cloud.beforeSave('Transactions', async (request) => {
  if (!request.master) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'المعاملات المالية تُنشأ عبر دوال السحابة فقط.');
  }
  if (!request.object.isNew() && request.object.get('status') === 'captured' && request.object.dirty('amount')) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'لا يجوز تعديل مبلغ معاملة مُقيّدة.');
  }
});

/** عدّاد الطلبات المفتوحة للعرض السريع في الخريطة. */
Parse.Cloud.afterSave('ServiceRequests', async (request) => {
  const serviceRequest = request.object;
  const previous = request.original ? request.original.get('status') : null;
  if (previous === serviceRequest.get('status')) return;

  const mosquePointer = serviceRequest.get('mosqueId');
  if (!mosquePointer) return;

  const openCount = await new Parse.Query('ServiceRequests')
    .equalTo('mosqueId', mosquePointer)
    .containedIn('status', ['pending_funding', 'open_for_volunteers', 'funded', 'assigned', 'in_progress'])
    .count({ useMasterKey: true });

  const mosque = await mosquePointer.fetch({ useMasterKey: true });
  mosque.set('openRequestsCount', openCount);
  await mosque.save(null, { useMasterKey: true });
});


// ======================================================================
// دوال المساجد   [functions/mosques.js]
// ======================================================================

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
  mosqueQuery.select('name', 'wilayat', 'governorate', 'lat', 'lng');
  mosqueQuery.limit(BOX_CANDIDATE_CAP);

  const near = geo.sortByDistance(
    await mosqueQuery.find({ useMasterKey: true }), lat, lng, radiusKm,
  );
  if (near.length === 0) return [];

  const byId = new Map(near.map(({ row, km }) => [row.id, { mosque: row, km }]));

  const requests = await new Parse.Query('ServiceRequests')
    .containedIn('mosqueId', near.map(({ row }) => row))
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
    .sort((a, b) => a.hit.km - b.hit.km)
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
      distanceKm: Math.round(hit.km * 100) / 100,
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

  const emit = (rows) => rows.map((m) => m.toJSON());

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


// ======================================================================
// دوال طلبات الصيانة   [functions/requests.js]
// ======================================================================

/**
 * دورة حياة الطلب:
 *   pending_funding → funded → assigned → in_progress → pending_imam_approval → completed
 *   (أو) open_for_volunteers → assigned → ... (مسار التطوّع العيني، بلا مال)
 *   يمكن الإلغاء في أي مرحلة قبل التنفيذ → cancelled
 */
const STATUS = {
  PENDING_FUNDING: 'pending_funding',
  OPEN_FOR_VOLUNTEERS: 'open_for_volunteers',
  FUNDED: 'funded',
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  PENDING_APPROVAL: 'pending_imam_approval',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

const MAX_ESTIMATE_OMR = 5000;

/**
 * حدود تمنع إغراق المنصّة.
 *
 * الاهتمام لا يحجز الطلب، فمتطوّع واحد قد يسجّل اهتمامه بكل طلب مفتوح فيتصدّر
 * قوائم الأئمة جميعاً وهو لا ينوي تنفيذ إلا واحد. والتكليف يحجز فعلاً: ثلاثة
 * مساجد تظنّ أن لها منفّذاً والمنفّذ واحد لا يسع إلا مسجداً.
 *
 * الأرقام تقديرية لا محسوبة — تُراجَع بعد أول موسم تشغيل حقيقي.
 */
const MAX_ACTIVE_INTERESTS = 10;
const MAX_ACTIVE_ASSIGNMENTS = 3;

/** حقل التكليف بحسب الدور — المتطوّع والشركة لا يشتركان في حقل واحد. */
const assignmentField = (role) =>
  (role === 'contractor' ? 'assignedContractorId' : 'assignedVolunteerId');

Parse.Cloud.define('createServiceRequest', async (request) => {
  const imam = requireRole(request, 'imam');
  const mosque = await mosqueForImam(imam, request.params.mosqueId);

  const { title, description, category, estimatedCost, urgency } = request.params;
  if (!title || String(title).trim().length < 3) E.invalid('العنوان مطلوب (3 أحرف فأكثر).');
  if (!description || String(description).trim().length < 10) E.invalid('الوصف مطلوب (10 أحرف فأكثر).');

  // `Number(x) || 0` كان يبتلع NaN فيحوّل مدخلاً فاسداً إلى طلب تطوّعي بصمت
  const cost = estimatedCost === undefined || estimatedCost === null ? 0 : Number(estimatedCost);
  if (!Number.isFinite(cost) || cost < 0 || cost > MAX_ESTIMATE_OMR) {
    E.invalid(`التكلفة التقديرية يجب أن تكون رقماً بين 0 و ${MAX_ESTIMATE_OMR} ريال.`);
  }

  // منع إغراق النظام: حد أقصى للطلبات المفتوحة لكل مسجد
  const openCount = await new Parse.Query('ServiceRequests')
    .equalTo('mosqueId', mosque)
    .containedIn('status', [STATUS.PENDING_FUNDING, STATUS.OPEN_FOR_VOLUNTEERS, STATUS.FUNDED, STATUS.ASSIGNED, STATUS.IN_PROGRESS])
    .count({ useMasterKey: true });
  if (openCount >= 10) E.invalid('لديك 10 طلبات مفتوحة — أغلق بعضها قبل إضافة طلب جديد.');

  const ServiceRequest = Parse.Object.extend('ServiceRequests');
  const serviceRequest = new ServiceRequest();
  serviceRequest.set('mosqueId', mosque);
  serviceRequest.set('createdBy', imam);
  serviceRequest.set('title', String(title).trim().slice(0, 120));
  serviceRequest.set('description', String(description).trim().slice(0, 2000));
  serviceRequest.set('category', category || 'other'); // electrical | plumbing | ac | paint | cleaning | carpet | other
  serviceRequest.set('urgency', urgency || 'normal'); // low | normal | high
  serviceRequest.set('estimatedCost', cost);
  serviceRequest.set('fundedAmount', 0);
  serviceRequest.set('status', cost > 0 ? STATUS.PENDING_FUNDING : STATUS.OPEN_FOR_VOLUNTEERS);

  await serviceRequest.save(null, { useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.REQUEST_CREATED,
    target: serviceRequest,
    mosque,
    actor: imam,
    toStatus: serviceRequest.get('status'),
  });

  if (cost === 0) {
    await pushToNearbyVolunteers(mosque, {
      alert: `فرصة تطوّع: ${serviceRequest.get('title')} — مسجد ${mosque.get('name')}`,
      requestId: serviceRequest.id,
    });
  }

  return serviceRequest.toJSON();
});

const MAX_INTEREST_NOTE = 300;
const MAX_PHOTOS = 6;

/**
 * روابط الصور المقبولة.
 *
 * `photoUrls` يصل من العميل، ولو قُبل كما هو لأمكن حشو سجلّ المسجد بروابط
 * خارجية: تتبّعاً للإمام حين يفتح الطلب، أو محتوىً يتغيّر بعد الاعتماد فيصير
 * الدليل غير ما اعتُمد. المقبول: ملفات مرفوعة إلى تخزين المشروع وحده.
 *
 * على Back4app الملفات تُخدَم من مضيف مستقلّ عن الـAPI، فالقائمة تُضبط بـ
 * `FILE_HOST_ALLOWLIST` وتشمل افتراضياً مضيف الخادم ومضيف ملفات Back4app.
 */
function allowedFileHosts() {
  const configured = (process.env.FILE_HOST_ALLOWLIST || '')
    .split(',').map((host) => host.trim()).filter(Boolean);

  const hosts = new Set([...configured, 'parsefiles.back4app.com']);
  try {
    hosts.add(new URL(Parse.serverURL).hostname);
  } catch (_) {
    // serverURL غير مضبوط في بعض بيئات الاختبار
  }
  return hosts;
}

function validatePhotos(photoUrls) {
  if (!Array.isArray(photoUrls) || photoUrls.length === 0) return [];
  if (photoUrls.length > MAX_PHOTOS) E.invalid(`أقصى عدد للصور ${MAX_PHOTOS}.`);

  const hosts = allowedFileHosts();

  return photoUrls.map((raw) => {
    let url;
    try {
      url = new URL(String(raw));
    } catch (_) {
      return E.invalid('رابط صورة غير صالح.');
    }
    // http عادي يُسقط الصور خلف HTTPS ويكشفها للشبكة
    if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      E.invalid('روابط الصور يجب أن تكون عبر HTTPS.');
    }
    if (!hosts.has(url.hostname)) {
      E.invalid('تُقبل الصور المرفوعة إلى تخزين التطبيق وحدها.');
    }
    return url.toString();
  });
}

/**
 * المتطوّع يُسجّل اهتمامه بطلب مفتوح.
 *
 * لا يُسند الطلب ولا يُغيّر حالته: الإمام يبقى صاحب القرار عبر `assignWorker`.
 * بدون هذا المسار يرى المتطوّع الفرصة القريبة ولا يملك وسيلة للتعبير عنها
 * أصلاً — وهي أكبر فجوة في مسار التطوّع العيني، وهو المسار القابل للإطلاق.
 */
Parse.Cloud.define('expressInterest', async (request) => {
  const volunteer = requireRole(request, 'volunteer');
  const { requestId, note } = request.params;
  if (!requestId) E.invalid('معرّف الطلب مطلوب.');

  const serviceRequest = await new Parse.Query('ServiceRequests')
    .get(requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  if (serviceRequest.get('status') !== STATUS.OPEN_FOR_VOLUNTEERS) {
    E.invalid('هذا الطلب لا يستقبل المتطوّعين حالياً.');
  }

  const existing = await new Parse.Query('TaskInterests')
    .equalTo('requestId', serviceRequest)
    .equalTo('volunteerId', volunteer)
    .equalTo('status', 'active')
    .first({ useMasterKey: true });
  if (existing) E.duplicate('سبق أن سجّلت اهتمامك بهذا الطلب.');

  // سُحب منه هذا الطلب من قبل: بلا هذا الشرط يعيد التسجيل فوراً فتدور الحلقة
  // تكليفٌ ثم غياب ثم تكليف، والإمام يرى اسمه في القائمة كأن شيئاً لم يكن.
  const released = await new Parse.Query('TaskInterests')
    .equalTo('requestId', serviceRequest)
    .equalTo('volunteerId', volunteer)
    .equalTo('status', 'released')
    .first({ useMasterKey: true });
  if (released) E.forbidden('سُحب منك هذا الطلب سابقاً، فلا يمكن التسجيل فيه من جديد.');

  const active = await new Parse.Query('TaskInterests')
    .equalTo('volunteerId', volunteer)
    .equalTo('status', 'active')
    .count({ useMasterKey: true });
  if (active >= MAX_ACTIVE_INTERESTS) {
    E.forbidden(`لديك ${active} اهتماماً مفتوحاً — اسحب بعضها قبل تسجيل اهتمام جديد.`);
  }

  const Interest = Parse.Object.extend('TaskInterests');
  const interest = new Interest();
  interest.set('requestId', serviceRequest);
  interest.set('volunteerId', volunteer);
  interest.set('status', 'active');
  interest.set('note', String(note || '').trim().slice(0, MAX_INTEREST_NOTE));
  await interest.save(null, { useMasterKey: true });

  const mosque = await fetchPointer(serviceRequest.get('mosqueId'), 'Mosques');

  await audit.record({
    action: audit.ACTIONS.INTEREST_EXPRESSED,
    target: interest,
    mosque,
    actor: volunteer,
  });

  const imam = mosque.get('imamId');
  if (imam) {
    await pushToUsers(imam, {
      alert: `متطوّع مهتمّ بـ "${serviceRequest.get('title')}" — اختر المنفّذ من قائمة المهتمّين.`,
      requestId: serviceRequest.id,
    });
  }

  return { interestId: interest.id, message: 'سُجّل اهتمامك، والإمام يختار المنفّذ.' };
});

/** سحب الاهتمام قبل الاختيار. */
Parse.Cloud.define('withdrawInterest', async (request) => {
  const volunteer = requireRole(request, 'volunteer');
  const { requestId } = request.params;
  if (!requestId) E.invalid('معرّف الطلب مطلوب.');

  const serviceRequest = new Parse.Object('ServiceRequests');
  serviceRequest.id = requestId;

  const interest = await new Parse.Query('TaskInterests')
    .equalTo('requestId', serviceRequest)
    .equalTo('volunteerId', volunteer)
    .equalTo('status', 'active')
    .first({ useMasterKey: true });
  if (!interest) E.notFound('لا يوجد اهتمام مسجّل لك بهذا الطلب.');

  interest.set('status', 'withdrawn');
  await interest.save(null, { useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.INTEREST_WITHDRAWN,
    target: interest,
    actor: volunteer,
  });

  return { status: 'withdrawn' };
});

/**
 * اهتمامات المتطوّع المستدعي — `TaskInterests` مقفلة فلا يصلها العميل مباشرةً.
 */
Parse.Cloud.define('getMyInterests', async (request) => {
  const volunteer = requireRole(request, 'volunteer');

  const interests = await new Parse.Query('TaskInterests')
    .equalTo('volunteerId', volunteer)
    .descending('createdAt')
    .include('requestId')
    .limit(50)
    .find({ useMasterKey: true });

  return interests.map((interest) => {
    const serviceRequest = interest.get('requestId');
    return {
      id: interest.id,
      status: interest.get('status'),
      note: interest.get('note'),
      createdAt: interest.get('createdAt'),
      requestId: serviceRequest ? serviceRequest.id : null,
      requestTitle: serviceRequest ? serviceRequest.get('title') : null,
      requestStatus: serviceRequest ? serviceRequest.get('status') : null,
    };
  });
});

/**
 * قائمة المهتمّين بطلب — للإمام صاحب المسجد وحده.
 *
 * تُعاد المهارات والتقييم ليختار الإمام عن بيّنة. لا يُعاد رقم الهاتف: التواصل
 * يبدأ بعد التكليف عبر الإشعار، فلا داعي لكشفه لكل من سجّل اهتماماً.
 */
Parse.Cloud.define('getRequestInterests', async (request) => {
  const imam = requireRole(request, 'imam');
  const { requestId } = request.params;
  if (!requestId) E.invalid('معرّف الطلب مطلوب.');

  const serviceRequest = await new Parse.Query('ServiceRequests')
    .get(requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  await mosqueForImam(imam, serviceRequest.get('mosqueId').id);

  const interests = await new Parse.Query('TaskInterests')
    .equalTo('requestId', serviceRequest)
    .equalTo('status', 'active')
    .include('volunteerId')
    .ascending('createdAt')
    .limit(50)
    .find({ useMasterKey: true });

  return interests.map((interest) => {
    const volunteer = interest.get('volunteerId');
    return {
      interestId: interest.id,
      volunteerId: volunteer ? volunteer.id : null,
      fullName: volunteer ? volunteer.get('fullName') : null,
      skills: (volunteer && volunteer.get('skills')) || [],
      completedJobs: (volunteer && volunteer.get('completedJobs')) || 0,
      // يُعرض ليختار الإمام عن بيّنة — لا يمنع الاختيار تلقائياً: الغياب مرّةً
      // له أسبابه، والمنع الآلي يُقصي متطوّعاً بلا مراجعة
      abandonedJobs: (volunteer && volunteer.get('abandonedJobs')) || 0,
      avgRating: volunteer ? volunteer.get('avgRating') : null,
      note: interest.get('note'),
      createdAt: interest.get('createdAt'),
    };
  });
});

/** تعيين منفّذ: متطوع أو شركة. الإمام هو من يعيّن. */
Parse.Cloud.define('assignWorker', async (request) => {
  const imam = requireRole(request, 'imam');
  const { requestId, workerId } = request.params;
  if (!requestId || !workerId) E.invalid('معرّف الطلب ومعرّف المنفّذ مطلوبان.');

  const serviceRequest = await new Parse.Query('ServiceRequests')
    .get(requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  // التحقق من الملكية يدوياً — query.get يتجاهل قيود equalTo
  const mosque = await mosqueForImam(imam, serviceRequest.get('mosqueId').id);

  const allowed = [STATUS.FUNDED, STATUS.OPEN_FOR_VOLUNTEERS];
  if (!allowed.includes(serviceRequest.get('status'))) {
    E.invalid('لا يمكن التعيين في هذه المرحلة — تأكد من تمويل الطلب أولاً.');
  }

  const worker = await new Parse.Query(Parse.User).get(workerId, { useMasterKey: true })
    .catch(() => E.notFound('المستخدم غير موجود.'));

  const role = worker.get('role');
  if (role !== 'volunteer' && role !== 'contractor') {
    E.invalid('المستخدم ليس متطوعاً ولا شركة خدمات.');
  }

  // التكليف يحجز المنفّذ فعلياً — لا يُكلَّف بما لا يسع. يُحسب قبل أي `set`
  // فلا يبقى الكائن في الذاكرة محمّلاً بتكليفٍ رُفض.
  const openAssignments = await new Parse.Query('ServiceRequests')
    .equalTo(assignmentField(role), worker)
    .containedIn('status', [STATUS.ASSIGNED, STATUS.IN_PROGRESS])
    .count({ useMasterKey: true });
  if (openAssignments >= MAX_ACTIVE_ASSIGNMENTS) {
    E.forbidden(`لدى هذا المنفّذ ${openAssignments} أعمال لم تُنجَز بعد — اختر غيره.`);
  }

  if (role === 'volunteer') {
    if (serviceRequest.get('estimatedCost') > 0) E.invalid('الطلبات المموّلة تُسند إلى شركة معتمدة.');
    serviceRequest.set('assignedVolunteerId', worker);
  } else {
    if (!worker.get('isVerifiedContractor')) E.forbidden('هذه الشركة غير معتمدة بعد.');
    serviceRequest.set('assignedContractorId', worker);
  }

  const previousStatus = serviceRequest.get('status');
  serviceRequest.set('status', STATUS.ASSIGNED);
  serviceRequest.set('assignedAt', new Date());
  await serviceRequest.save(null, { useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.WORKER_ASSIGNED,
    target: serviceRequest,
    mosque,
    actor: imam,
    fromStatus: previousStatus,
    toStatus: STATUS.ASSIGNED,
  });

  await closeInterests(serviceRequest);

  await pushToUsers(worker, {
    alert: `تم تكليفك بـ "${serviceRequest.get('title')}" في مسجد ${mosque.get('name')}.`,
    requestId: serviceRequest.id,
  });

  return serviceRequest.toJSON();
});

/**
 * إقفال الاهتمامات المعلّقة بعد اختيار المنفّذ.
 * تركُها `active` يُبقي القائمة تعرض من لم يُختَر كأنه ما زال بالانتظار.
 */
async function closeInterests(serviceRequest) {
  const open = await new Parse.Query('TaskInterests')
    .equalTo('requestId', serviceRequest)
    .equalTo('status', 'active')
    .limit(100)
    .find({ useMasterKey: true });

  for (const interest of open) interest.set('status', 'closed');
  if (open.length > 0) await Parse.Object.saveAll(open, { useMasterKey: true });
}

/**
 * سحب التكليف وإعادة الطلب إلى المتاح.
 *
 * كان التكليف طريقاً بلا رجعة: منفّذٌ لا يحضر يترك الطلب معلّقاً في `assigned`
 * بلا أجل، وليس أمام الإمام إلا إلغاء الطلب كلّه — فيسقط سجلّه والحاجة قائمة،
 * ثم يُنشئ طلباً جديداً يبدأ من الصفر. والمنفّذ لا يُقيَّد عليه شيء فيكرّرها.
 *
 * تُفتح للطرفين قصداً: الإمام حين لا يحضر المنفّذ، والمنفّذ حين يتبيّن له أنه
 * لا يستطيع. جعل الانسحاب المُعلن متاحاً وبلا عقوبة هو خير ما يُقلّل التغيّب —
 * إغلاقه لا يجعل المتخلّف يحضر، بل يجعله يصمت.
 */
Parse.Cloud.define('releaseAssignment', async (request) => {
  const user = requireRole(request, 'imam', 'volunteer', 'contractor');
  const { requestId, reason } = request.params;
  if (!requestId) E.invalid('معرّف الطلب مطلوب.');

  const serviceRequest = await new Parse.Query('ServiceRequests')
    .get(requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  // بعد `startWork` يصير للمنفّذ جهدٌ مبذول وحقٌّ في المعاينة — كقيد الإلغاء
  if (serviceRequest.get('status') !== STATUS.ASSIGNED) {
    E.invalid('لا يُسحب التكليف إلا قبل بدء التنفيذ.');
  }

  const pointer = serviceRequest.get('assignedVolunteerId')
    || serviceRequest.get('assignedContractorId');
  if (!pointer) E.invalid('لا يوجد منفّذ مكلَّف بهذا الطلب.');

  const byImam = user.get('role') === 'imam';
  const mosque = byImam
    ? await mosqueForImam(user, serviceRequest.get('mosqueId').id)
    : await fetchPointer(serviceRequest.get('mosqueId'), 'Mosques');
  if (!byImam && pointer.id !== user.id) E.forbidden('هذا الطلب غير مُسند إليك.');

  // الغياب وحده يُقيَّد على المنفّذ؛ الانسحاب المُعلن لا يُعاقَب عليه
  const noShow = byImam && reason === 'no_show';

  // الرجوع إلى ما كان: طلبٌ بتكلفة مرّ بالتمويل، وطلب التطوّع العيني لا مال فيه
  const backTo = (serviceRequest.get('estimatedCost') || 0) > 0
    ? STATUS.FUNDED
    : STATUS.OPEN_FOR_VOLUNTEERS;

  serviceRequest.set('status', backTo);
  serviceRequest.unset('assignedVolunteerId');
  serviceRequest.unset('assignedContractorId');
  serviceRequest.unset('assignedAt');
  await serviceRequest.save(null, { useMasterKey: true });

  const worker = await fetchPointer(pointer, '_User');
  if (noShow) {
    worker.increment('abandonedJobs', 1);
    await worker.save(null, { useMasterKey: true });
  }

  // اهتمام هذا المنفّذ بالذات يُوسم `released` فلا يعود يسجّله على الطلب نفسه.
  // اهتمامات الآخرين تبقى `closed` كما أقفلها التكليف: الطلب عاد مفتوحاً
  // فليسجّلوا من جديد إن شاؤوا، ولا يُحيا اهتمامٌ قد يكون صاحبه انصرف عنه.
  const interest = await new Parse.Query('TaskInterests')
    .equalTo('requestId', serviceRequest)
    .equalTo('volunteerId', pointer)
    .first({ useMasterKey: true });
  if (interest) {
    interest.set('status', 'released');
    await interest.save(null, { useMasterKey: true });
  }

  await audit.record({
    action: audit.ACTIONS.ASSIGNMENT_RELEASED,
    target: serviceRequest,
    mosque,
    actor: user,
    fromStatus: STATUS.ASSIGNED,
    toStatus: backTo,
  });

  // يُبلَّغ الطرف الآخر وحده: من طلب السحب يعلمه
  if (byImam) {
    await pushToUsers(worker, {
      alert: `سُحب تكليفك بـ "${serviceRequest.get('title')}" في مسجد ${mosque.get('name')}.`,
      requestId: serviceRequest.id,
    });
  } else if (mosque.get('imamId')) {
    await pushToUsers(mosque.get('imamId'), {
      alert: `اعتذر المنفّذ عن "${serviceRequest.get('title')}" — الطلب متاح من جديد.`,
      requestId: serviceRequest.id,
    });
  }

  return { status: backTo, noShowRecorded: noShow };
});

/** المنفّذ يبدأ العمل. */
Parse.Cloud.define('startWork', async (request) => {
  const user = requireRole(request, 'volunteer', 'contractor');
  const serviceRequest = await loadAssignedRequest(request.params.requestId, user);

  if (serviceRequest.get('status') !== STATUS.ASSIGNED) E.invalid('الطلب ليس في حالة تكليف.');
  serviceRequest.set('status', STATUS.IN_PROGRESS);
  serviceRequest.set('startedAt', new Date());
  await serviceRequest.save(null, { useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.WORK_STARTED,
    target: serviceRequest,
    mosque: serviceRequest.get('mosqueId'),
    actor: user,
    fromStatus: STATUS.ASSIGNED,
    toStatus: STATUS.IN_PROGRESS,
  });

  return serviceRequest.toJSON();
});

/** المنفّذ يبلّغ بانتهاء العمل — لا يُقفل الطلب، بل ينتظر معاينة الإمام. */
Parse.Cloud.define('markWorkDone', async (request) => {
  const user = requireRole(request, 'volunteer', 'contractor');
  const { requestId, notes, photoUrls } = request.params;
  const serviceRequest = await loadAssignedRequest(requestId, user);

  if (serviceRequest.get('status') !== STATUS.IN_PROGRESS) E.invalid('الطلب ليس قيد التنفيذ.');

  // التحقّق قبل أي تعديل: الترتيب المعكوس يترك الكائن بحالة `pending_approval`
  // في الذاكرة رغم رفض الصور — لا يُحفظ لأن `save` لا تُنفَّذ، لكن أي قراءة
  // لاحقة من الكائن نفسه تصدّق حالةً لم تقع.
  const photos = validatePhotos(photoUrls);

  serviceRequest.set('status', STATUS.PENDING_APPROVAL);
  serviceRequest.set('workerNotes', String(notes || '').slice(0, 1000));
  serviceRequest.set('completionPhotos', photos);
  serviceRequest.set('workDoneAt', new Date());
  await serviceRequest.save(null, { useMasterKey: true });

  const mosque = await fetchPointer(serviceRequest.get('mosqueId'), 'Mosques');

  await audit.record({
    action: audit.ACTIONS.WORK_DONE,
    target: serviceRequest,
    mosque,
    actor: user,
    fromStatus: STATUS.IN_PROGRESS,
    toStatus: STATUS.PENDING_APPROVAL,
  });

  const imam = mosque.get('imamId');
  if (imam) {
    await pushToUsers(imam, {
      alert: `تم إنجاز "${serviceRequest.get('title')}" — بانتظار معاينتك واعتمادك.`,
      requestId: serviceRequest.id,
    });
  }

  return serviceRequest.toJSON();
});

/** الإمام يعاين ويعتمد. هنا فقط يُقفل الطلب وتُسجّل ساعات التطوّع. */
Parse.Cloud.define('completeService', async (request) => {
  const imam = requireRole(request, 'imam');
  const { requestId, rating, volunteerHours } = request.params;

  const serviceRequest = await new Parse.Query('ServiceRequests')
    .get(requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  await mosqueForImam(imam, serviceRequest.get('mosqueId').id);

  if (serviceRequest.get('status') !== STATUS.PENDING_APPROVAL) {
    E.invalid('الطلب ليس بانتظار الاعتماد.');
  }

  const score = Math.min(Math.max(Number(rating) || 5, 1), 5);
  serviceRequest.set('status', STATUS.COMPLETED);
  serviceRequest.set('imamRating', score);
  serviceRequest.set('imamApprovalDate', new Date());
  serviceRequest.set('volunteerHours', Math.min(Number(volunteerHours) || 0, 24));
  await serviceRequest.save(null, { useMasterKey: true });

  await recordWorkerRating(serviceRequest, score);

  await audit.record({
    action: audit.ACTIONS.REQUEST_COMPLETED,
    target: serviceRequest,
    mosque: serviceRequest.get('mosqueId'),
    actor: imam,
    fromStatus: STATUS.PENDING_APPROVAL,
    toStatus: STATUS.COMPLETED,
  });

  // TODO: صرف المستحقات للشركة يتم عبر دالة payout منفصلة بعد الاعتماد (functions/donations.js)
  // TODO: تسجيل ساعات التطوّع في منصة "أيادي" — يحتاج اتفاقية وAPI key رسمي.

  return { message: 'تم اعتماد العمل، بارك الله فيكم.', status: STATUS.COMPLETED };
});

/** إلغاء الطلب — الإمام فقط، وقبل بدء التنفيذ، وبشرط عدم وجود تمويل مُحصّل. */
Parse.Cloud.define('cancelServiceRequest', async (request) => {
  const imam = requireRole(request, 'imam');
  const serviceRequest = await new Parse.Query('ServiceRequests')
    .get(request.params.requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  const mosque = await mosqueForImam(imam, serviceRequest.get('mosqueId').id);
  const status = serviceRequest.get('status');

  if ([STATUS.COMPLETED, STATUS.CANCELLED].includes(status)) {
    E.invalid('الطلب مغلق بالفعل.');
  }
  // العمل بدأ فعلاً: إلغاؤه يُضيّع جهد المنفّذ ويُسقط حقّه في المعاينة
  if ([STATUS.IN_PROGRESS, STATUS.PENDING_APPROVAL].includes(status)) {
    E.forbidden('بدأ التنفيذ — عاين العمل واعتمده، أو تواصل مع المنفّذ.');
  }
  if ((serviceRequest.get('fundedAmount') || 0) > 0) {
    E.forbidden('لا يمكن إلغاء طلب استلم تبرعات — تواصل مع الإدارة لإعادة توجيه المبلغ.');
  }

  serviceRequest.set('status', STATUS.CANCELLED);
  serviceRequest.set('cancelledAt', new Date());
  await serviceRequest.save(null, { useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.REQUEST_CANCELLED,
    target: serviceRequest,
    mosque,
    actor: imam,
    fromStatus: status,
    toStatus: STATUS.CANCELLED,
  });

  // المنفّذ المكلَّف قد يكون في طريقه إلى المسجد — يجب أن يعلم
  const worker = serviceRequest.get('assignedVolunteerId')
    || serviceRequest.get('assignedContractorId');
  if (worker) {
    await pushToUsers(worker, {
      alert: `أُلغي طلب "${serviceRequest.get('title')}" في مسجد ${mosque.get('name')}.`,
      requestId: serviceRequest.id,
    });
  }

  return { status: STATUS.CANCELLED };
});

/**
 * تحديث سجل المنفّذ عند اعتماد العمل.
 *
 * `completedJobs` و`avgRating` كانا معرّفين في المخطط ولا يُكتبان أبداً، فتقييم
 * المنفّذين معطّل فعلياً. المتوسط يُحسب تراكمياً من العدد السابق فلا نحتفظ بكل
 * التقييمات. قراءة‑ثم‑كتابة هنا مقبولة: اعتمادان متزامنان للمنفّذ نفسه نادران
 * وأثرهما تقييم منحرف قليلاً لا مال ضائع — بخلاف `walletBalance`.
 */
async function recordWorkerRating(serviceRequest, score) {
  const pointer = serviceRequest.get('assignedContractorId')
    || serviceRequest.get('assignedVolunteerId');
  if (!pointer) return;

  const worker = await fetchPointer(pointer, '_User');
  const done = worker.get('completedJobs') || 0;
  const average = worker.get('avgRating');

  worker.set('avgRating', average == null ? score : ((average * done) + score) / (done + 1));
  worker.increment('completedJobs', 1);
  await worker.save(null, { useMasterKey: true });
}

async function loadAssignedRequest(requestId, user) {
  if (!requestId) E.invalid('معرّف الطلب مطلوب.');
  const serviceRequest = await new Parse.Query('ServiceRequests')
    .get(requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  const volunteer = serviceRequest.get('assignedVolunteerId');
  const contractor = serviceRequest.get('assignedContractorId');
  const assignedId = (volunteer && volunteer.id) || (contractor && contractor.id);
  if (assignedId !== user.id) E.forbidden('هذا الطلب غير مُسند إليك.');
  return serviceRequest;
}


// ======================================================================
// دوال التبرعات والصرف   [functions/donations.js]
// ======================================================================

const crypto = require('crypto');

/**
 * ⚠️ ثلاثة أخطاء جوهرية في النسخة الأصلية من fundRequest تم إصلاحها هنا:
 *
 * 1) كانت تُحدّث الرصيد فور استدعاء الدالة — أي أن أي مستخدم يستطيع
 *    "التبرع" بمليون ريال دون أن يدفع فلساً. الآن: المال يُقيَّد فقط بعد
 *    تأكيد البوابة عبر confirmDonation.
 * 2) كانت تعتبر الطلب مموّلاً بالكامل مهما كان المبلغ. الآن: تمويل جزئي
 *    تراكمي عبر fundedAmount، والحالة تتغيّر عند بلوغ التكلفة التقديرية.
 * 3) mosque كان Pointer غير مُحمّل، فـ get('walletBalance') يعيد undefined
 *    والنتيجة NaN في الرصيد. الآن نجلب الكائن قبل التعديل، ونستخدم
 *    increment() الذرّية بدل قراءة-ثم-كتابة (تفادي حالات التسابق).
 */

const MIN_DONATION_OMR = 1;
const MAX_DONATION_OMR = 1000;

// مهلة حجز نيّة التبرّع. بعدها تُعتبر الجلسة مهجورة ويُفرَج عن مبلغها
// ليتبرّع به غيره — وإلا عطّل متبرّعٌ لم يُكمل الدفع تمويلَ الطلب إلى الأبد.
const PENDING_TTL_MINUTES = 30;

/**
 * مجموع نيّات التبرّع المعلّقة الحيّة لهذا الطلب.
 *
 * `fundedAmount` لا يعدّ إلا المبالغ المُقيَّدة، فلو اعتمدنا عليه وحده لرأى كل
 * متبرّع المتبقي كاملاً متاحاً: خمسة متبرّعين يبدأون معاً بـ500 ريال لطلب
 * تكلفته 500، ويدفعون جميعاً، فتُقبض 2500 ريال بلا مسار استرداد.
 */
async function reservedAmount(serviceRequest) {
  const cutoff = new Date(Date.now() - PENDING_TTL_MINUTES * 60 * 1000);
  const pending = await new Parse.Query('Transactions')
    .equalTo('requestId', serviceRequest)
    .equalTo('type', 'donation')
    .equalTo('status', 'pending')
    .greaterThan('createdAt', cutoff)
    .limit(1000)
    .find({ useMasterKey: true });

  return pending.reduce((sum, t) => sum + (Number(t.get('amount')) || 0), 0);
}

/** الخطوة 1: إنشاء نيّة تبرّع + جلسة دفع. لا يتحرك أي رصيد هنا. */
Parse.Cloud.define('initiateDonation', async (request) => {
  const donor = requireRole(request, 'donor', 'imam', 'volunteer', 'contractor', 'admin');
  const { requestId, amount, successUrl, cancelUrl } = request.params;

  const value = Number(amount);
  if (!Number.isFinite(value) || value < MIN_DONATION_OMR || value > MAX_DONATION_OMR) {
    E.invalid(`المبلغ يجب أن يكون بين ${MIN_DONATION_OMR} و ${MAX_DONATION_OMR} ريال.`);
  }

  const serviceRequest = await new Parse.Query('ServiceRequests')
    .get(requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  if (serviceRequest.get('status') !== STATUS.PENDING_FUNDING) {
    E.invalid('هذا الطلب لا يقبل التمويل حالياً.');
  }

  const funded = serviceRequest.get('fundedAmount') || 0;
  const reserved = await reservedAmount(serviceRequest);
  const remaining = serviceRequest.get('estimatedCost') - funded - reserved;

  if (remaining <= 0) {
    E.invalid(`الطلب محجوز بالكامل حالياً — أعد المحاولة بعد ${PENDING_TTL_MINUTES} دقيقة.`);
  }
  if (value > remaining) E.invalid(`المتاح للتبرّع الآن ${remaining} ريال فقط.`);

  const mosque = await fetchPointer(serviceRequest.get('mosqueId'), 'Mosques');

  const Transaction = Parse.Object.extend('Transactions');
  const transaction = new Transaction();
  transaction.set('donorId', donor);
  transaction.set('mosqueId', mosque);
  transaction.set('requestId', serviceRequest);
  transaction.set('amount', value);
  transaction.set('type', 'donation');
  transaction.set('status', 'pending');
  await transaction.save(null, { useMasterKey: true });

  const session = await payments.createCheckoutSession({
    amountOmr: value,
    clientReferenceId: transaction.id, // مفتاح المطابقة والمنع المزدوج
    description: `تبرع: ${serviceRequest.get('title')} — ${mosque.get('name')}`,
    successUrl: successUrl || process.env.PAYMENT_SUCCESS_URL,
    cancelUrl: cancelUrl || process.env.PAYMENT_CANCEL_URL,
  });

  transaction.set('paymentSessionId', session.sessionId);
  await transaction.save(null, { useMasterKey: true });

  return { transactionId: transaction.id, redirectUrl: session.redirectUrl };
});

/**
 * الخطوة 2: التأكيد. تُستدعى من webhook البوابة أو عند عودة المستخدم.
 * تعتمد حصراً على استعلام البوابة، لا على ما يرسله العميل.
 * idempotent: استدعاؤها مرتين لا يضاعف الرصيد.
 */
Parse.Cloud.define('confirmDonation', async (request) => {
  const caller = request.master ? null : requireUser(request);
  const { transactionId } = request.params;

  const transaction = await new Parse.Query('Transactions')
    .get(transactionId, { useMasterKey: true })
    .catch(() => E.notFound('المعاملة غير موجودة.'));

  // صاحب المعاملة وحده — أو استدعاء بـ Master Key من webhook البوابة.
  // بدون هذا الشرط يستطيع أي مستخدم مصادَق أن يستدعيها على معاملة غيره.
  if (caller) {
    const owner = transaction.get('donorId');
    if (!owner || owner.id !== caller.id) E.forbidden('هذه المعاملة ليست لك.');
  }

  if (transaction.get('status') === 'captured') {
    return { status: 'captured', message: 'سبق تأكيد هذه المعاملة.' };
  }
  if (transaction.get('status') !== 'pending') E.invalid('حالة المعاملة لا تسمح بالتأكيد.');

  const verification = await payments.verifySession(transaction.get('paymentSessionId'));
  if (!verification.paid) {
    // الجلسة ما تزال مفتوحة: تبقى المعاملة `pending` ليصحّ التأكيد بعد الدفع.
    // تعليمها `failed` هنا يُسقطها نهائياً من مسار التأكيد ويضيّع مبلغ المتبرع.
    if (!verification.terminal) {
      return { status: 'pending', message: 'لم يكتمل الدفع بعد — أعد المحاولة بعد إتمامه.' };
    }
    transaction.set('status', 'failed');
    await transaction.save(null, { useMasterKey: true });
    return { status: 'failed', message: 'أُلغيت عملية الدفع أو انتهت صلاحية الجلسة.' };
  }

  // تطابق المبلغ — حماية من التلاعب في صفحة الدفع
  if (Math.abs(verification.amountOmr - transaction.get('amount')) > 0.001) {
    transaction.set('status', 'mismatch');
    await transaction.save(null, { useMasterKey: true });
    E.invalid('المبلغ المدفوع لا يطابق المبلغ المسجّل — راجع الإدارة.');
  }

  return captureDonation(transaction, verification);
});

/**
 * قيد تبرّع مؤكَّد الدفع. مشتركة بين `confirmDonation` والمهمة الدورية، فلا
 * يوجد مساران يُقيّدان المال بمنطقين مختلفين.
 */
async function captureDonation(transaction, verification) {
  transaction.set('status', 'captured');
  transaction.set('paymentGatewayRef', verification.reference);
  transaction.set('capturedAt', new Date());
  await transaction.save(null, { useMasterKey: true });

  const amount = transaction.get('amount');
  const mosque = await fetchPointer(transaction.get('mosqueId'), 'Mosques');
  const serviceRequest = await fetchPointer(transaction.get('requestId'), 'ServiceRequests');

  // increment ذرّي على مستوى قاعدة البيانات — آمن مع التبرعات المتزامنة
  mosque.increment('walletBalance', amount);
  await mosque.save(null, { useMasterKey: true });

  serviceRequest.increment('fundedAmount', amount);
  await serviceRequest.save(null, { useMasterKey: true });
  await serviceRequest.fetch({ useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.DONATION_CAPTURED,
    target: transaction,
    mosque,
    actor: transaction.get('donorId'),
    amount,
  });

  if (serviceRequest.get('fundedAmount') >= serviceRequest.get('estimatedCost')) {
    serviceRequest.set('status', STATUS.FUNDED);
    serviceRequest.set('isFundedByDonors', true);
    serviceRequest.set('fundedAt', new Date());
    await serviceRequest.save(null, { useMasterKey: true });

    const imam = mosque.get('imamId');
    if (imam) {
      await pushToUsers(imam, {
        alert: `اكتمل تمويل "${serviceRequest.get('title')}" — يمكنك تعيين المنفّذ الآن.`,
        requestId: serviceRequest.id,
      });
    }
  }

  return { status: 'captured', fundedAmount: serviceRequest.get('fundedAmount') };
}

/**
 * مقارنة السرّ بزمن ثابت — المقارنة بـ`===` تُسرّب طول البادئة المطابقة.
 */
function secretMatches(provided, expected) {
  if (!expected || typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * نقطة نهاية البوابة.
 *
 * تُستدعى من ثواني لا من مستخدم، فلا جلسة معها — التوثيق بسرّ مشترك يُضبط في
 * `PAYMENT_WEBHOOK_SECRET` ويُسجَّل في لوحة البوابة.
 *
 * **جسم الطلب لا يُصدَّق إطلاقاً.** كل ما يُؤخذ منه هو معرّف المعاملة، ثم تُسأل
 * البوابة عن حالتها الحقيقية. من يعرف السرّ يستطيع أن يطلب إعادة الفحص، لا أن
 * يُقرّر أن الدفع تمّ.
 *
 * أفضلُ من المهمة الدورية لأن القيد يتمّ لحظة الدفع لا بعد ساعة، والمهمة تبقى
 * شبكة أمان لما يضيع من الطلبات.
 */
Parse.Cloud.define('paymentWebhook', async (request) => {
  const expected = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!expected) E.forbidden('نقطة نهاية البوابة غير مهيأة.');
  if (!secretMatches(request.params.secret, expected)) E.forbidden('توثيق غير صالح.');

  // ثواني تُعيد معرّف المعاملة في client_reference_id كما أُرسل عند إنشاء الجلسة
  const transactionId = request.params.clientReferenceId || request.params.client_reference_id;
  if (!transactionId) E.invalid('معرّف المعاملة مطلوب.');

  const transaction = await new Parse.Query('Transactions')
    .get(String(transactionId), { useMasterKey: true })
    .catch(() => E.notFound('المعاملة غير موجودة.'));

  if (transaction.get('status') === 'captured') {
    return { status: 'captured', message: 'سبق قيد هذه المعاملة.' };
  }
  if (transaction.get('status') !== 'pending') {
    return { status: transaction.get('status'), message: 'حالة المعاملة لا تسمح بالقيد.' };
  }

  const verification = await payments.verifySession(transaction.get('paymentSessionId'));

  if (!verification.paid) {
    if (!verification.terminal) return { status: 'pending' };
    transaction.set('status', 'failed');
    await transaction.save(null, { useMasterKey: true });
    return { status: 'failed' };
  }

  if (Math.abs(verification.amountOmr - transaction.get('amount')) > 0.001) {
    transaction.set('status', 'mismatch');
    await transaction.save(null, { useMasterKey: true });
    E.invalid('المبلغ المدفوع لا يطابق المبلغ المسجّل.');
  }

  return captureDonation(transaction, verification);
});

/**
 * صرف المستحقات للشركة بعد اعتماد الإمام. مشرف فقط.
 * التحويل الفعلي يتم خارج النظام (حوالة بنكية) — هنا نسجّل القيد فقط.
 */
Parse.Cloud.define('payoutContractor', async (request) => {
  const admin = requireRole(request, 'admin');
  const { requestId, amount, bankRef } = request.params;

  const serviceRequest = await new Parse.Query('ServiceRequests')
    .include('mosqueId').include('assignedContractorId')
    .get(requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  if (serviceRequest.get('status') !== STATUS.COMPLETED) E.invalid('لم يُعتمد العمل بعد.');
  if (serviceRequest.get('isPaidOut')) E.duplicate('تم الصرف لهذا الطلب مسبقاً.');

  const mosque = serviceRequest.get('mosqueId');
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) E.invalid('المبلغ غير صحيح.');

  // الخصم أولاً بعملية ذرّية ثم التحقق. فحصُ الرصيد قبل الخصم لا يمنع صرفين
  // متزامنين من اجتيازه معاً، و`increment` ذرّي لكن القراءة التي تسبقه ليست كذلك.
  mosque.increment('walletBalance', -value);
  await mosque.save(null, { useMasterKey: true });
  await mosque.fetch({ useMasterKey: true });

  if ((mosque.get('walletBalance') || 0) < 0) {
    mosque.increment('walletBalance', value); // تعويض: إعادة ما خُصم
    await mosque.save(null, { useMasterKey: true });
    E.invalid('رصيد المسجد لا يكفي.');
  }

  // يُعلَّم الطلب مصروفاً فور تأمين المبلغ، قبل قيد المعاملة، تضييقاً لنافذة
  // الصرف المزدوج. الإغلاق التام يحتاج قيداً على مستوى قاعدة البيانات.
  serviceRequest.set('isPaidOut', true);
  await serviceRequest.save(null, { useMasterKey: true });

  const Transaction = Parse.Object.extend('Transactions');
  const payout = new Transaction();
  payout.set('mosqueId', mosque);
  payout.set('requestId', serviceRequest);
  payout.set('payeeId', serviceRequest.get('assignedContractorId'));
  payout.set('amount', value);
  payout.set('type', 'payout');
  payout.set('status', 'captured');
  payout.set('paymentGatewayRef', String(bankRef || ''));
  payout.set('approvedBy', admin);
  await payout.save(null, { useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.PAYOUT_RECORDED,
    target: payout,
    mosque,
    actor: admin,
    amount: value,
  });

  return { message: 'تم تسجيل الصرف.', transactionId: payout.id };
});

/**
 * استرداد تبرّع مُقيَّد — مشرف فقط.
 *
 * كان المسار مفقوداً كلياً: طلبٌ يُلغى بعد التمويل، أو تمويلٌ زائد أفلت من
 * الحجز، كلاهما بلا مخرج إلا تعديل قاعدة البيانات يدوياً. التحويل الفعلي يتم
 * خارج النظام كما في الصرف — هنا يُسجَّل القيد ويُعاد الطلب إلى حالة التمويل.
 */
Parse.Cloud.define('refundDonation', async (request) => {
  const admin = requireRole(request, 'admin');
  const { transactionId, reason } = request.params;
  if (!transactionId) E.invalid('معرّف المعاملة مطلوب.');

  const original = await new Parse.Query('Transactions')
    .get(String(transactionId), { useMasterKey: true })
    .catch(() => E.notFound('المعاملة غير موجودة.'));

  if (original.get('type') !== 'donation') E.invalid('الاسترداد للتبرعات وحدها.');
  if (original.get('status') === 'refunded') E.duplicate('سبق استرداد هذه المعاملة.');
  if (original.get('status') !== 'captured') E.invalid('لا يُسترد إلا مبلغ مُقيَّد.');

  const amount = original.get('amount');
  const mosque = await fetchPointer(original.get('mosqueId'), 'Mosques');
  const serviceRequest = await fetchPointer(original.get('requestId'), 'ServiceRequests');

  if (serviceRequest.get('isPaidOut')) {
    E.forbidden('صُرفت مستحقات هذا الطلب — الاسترداد بعده تسوية محاسبية يدوية.');
  }

  // الخصم أولاً ثم التحقق، كما في الصرف: الرصيد قد يكون أُنفق على طلب آخر
  mosque.increment('walletBalance', -amount);
  await mosque.save(null, { useMasterKey: true });
  await mosque.fetch({ useMasterKey: true });

  if ((mosque.get('walletBalance') || 0) < 0) {
    mosque.increment('walletBalance', amount); // تعويض
    await mosque.save(null, { useMasterKey: true });
    E.invalid('رصيد المسجد لا يكفي للاسترداد — رُوجع في طلبات أخرى.');
  }

  original.set('status', 'refunded');
  await original.save(null, { useMasterKey: true });

  serviceRequest.increment('fundedAmount', -amount);
  await serviceRequest.save(null, { useMasterKey: true });
  await serviceRequest.fetch({ useMasterKey: true });

  // الطلب لم يعد مموّلاً بالكامل، فيعود لاستقبال التمويل
  if (serviceRequest.get('status') === STATUS.FUNDED
      && serviceRequest.get('fundedAmount') < serviceRequest.get('estimatedCost')) {
    serviceRequest.set('status', STATUS.PENDING_FUNDING);
    serviceRequest.set('isFundedByDonors', false);
    await serviceRequest.save(null, { useMasterKey: true });
  }

  const Transaction = Parse.Object.extend('Transactions');
  const entry = new Transaction();
  entry.set('mosqueId', mosque);
  entry.set('requestId', serviceRequest);
  entry.set('payeeId', original.get('donorId'));
  entry.set('amount', amount);
  entry.set('type', 'refund');
  entry.set('status', 'captured');
  entry.set('paymentGatewayRef', String(reason || ''));
  entry.set('approvedBy', admin);
  await entry.save(null, { useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.DONATION_REFUNDED,
    target: entry,
    mosque,
    actor: admin,
    amount,
  });

  return { message: 'سُجّل الاسترداد.', transactionId: entry.id, fundedAmount: serviceRequest.get('fundedAmount') };
});

/** سجل شفاف لكل مسجد — متاح للجميع، بلا بيانات شخصية للمتبرعين. */
Parse.Cloud.define('getMosqueLedger', async (request) => {
  requireUser(request);
  const { mosqueId, limit = 50 } = request.params;
  if (!mosqueId) E.invalid('معرّف المسجد مطلوب.');

  const mosque = new Parse.Object('Mosques');
  mosque.id = mosqueId;

  const transactions = await new Parse.Query('Transactions')
    .equalTo('mosqueId', mosque)
    .equalTo('status', 'captured')
    .descending('createdAt')
    .limit(Math.min(Number(limit) || 50, 100))
    .find({ useMasterKey: true });

  return transactions.map((t) => ({
    id: t.id,
    amount: t.get('amount'),
    type: t.get('type'),
    createdAt: t.get('createdAt'),
    requestId: t.get('requestId') ? t.get('requestId').id : null,
  }));
});

/**
 * مراجعة المعاملات المعلّقة.
 *
 * `confirmDonation` تُستدعى عند عودة المستخدم من صفحة الدفع، فإن أغلق التطبيق
 * بعد الدفع مباشرة بقيت معاملته `pending` ومالُه غير مقيَّد. تُجدوَل هذه المهمة
 * من لوحة Back4app (Server Settings → Background Jobs) كل ساعة.
 *
 * تسأل البوابة عن كل معاملة معلّقة تجاوزت مهلة الحجز:
 *   دُفعت    → تُقيَّد عبر `captureDonation` نفسها التي تستعملها الدالة
 *   انتهت    → `failed`
 *   مفتوحة   → تُترك، إلا إذا تجاوزت المهلة القصوى فتصير `expired`
 */
const PENDING_MAX_AGE_HOURS = 24;

Parse.Cloud.job('reviewPendingDonations', async (request) => {
  const { message } = request;

  if (!payments.isConfigured()) {
    message('بوابة الدفع غير مهيأة — لا شيء لمراجعته.');
    return 'skipped';
  }

  const cutoff = new Date(Date.now() - PENDING_TTL_MINUTES * 60 * 1000);
  const stale = await new Parse.Query('Transactions')
    .equalTo('type', 'donation')
    .equalTo('status', 'pending')
    .lessThan('createdAt', cutoff)
    .limit(100)
    .find({ useMasterKey: true });

  const counts = { captured: 0, failed: 0, expired: 0, open: 0, errors: 0 };
  const expiryLimit = new Date(Date.now() - PENDING_MAX_AGE_HOURS * 3600 * 1000);

  for (const transaction of stale) {
    try {
      const verification = await payments.verifySession(transaction.get('paymentSessionId'));

      if (verification.paid) {
        // نفس فحص المطابقة الذي في confirmDonation — لا يُقيَّد مبلغ مخالف
        if (Math.abs(verification.amountOmr - transaction.get('amount')) > 0.001) {
          transaction.set('status', 'mismatch');
          await transaction.save(null, { useMasterKey: true });
          counts.errors += 1;
          continue;
        }
        await captureDonation(transaction, verification);
        counts.captured += 1;
      } else if (verification.terminal) {
        transaction.set('status', 'failed');
        await transaction.save(null, { useMasterKey: true });
        counts.failed += 1;
      } else if (transaction.get('createdAt') < expiryLimit) {
        transaction.set('status', 'expired');
        await transaction.save(null, { useMasterKey: true });
        await audit.record({
          action: audit.ACTIONS.DONATION_EXPIRED,
          target: transaction,
          mosque: transaction.get('mosqueId'),
          amount: transaction.get('amount'),
        });
        counts.expired += 1;
      } else {
        counts.open += 1;
      }
    } catch (error) {
      counts.errors += 1;
      console.error('[reviewPendingDonations]', transaction.id, error && error.message);
    }
  }

  const summary = `فُحصت ${stale.length}: قُيّدت ${counts.captured}، فشلت ${counts.failed}، `
    + `انتهت ${counts.expired}، ما تزال مفتوحة ${counts.open}، أخطاء ${counts.errors}`;
  message(summary);
  return summary;
});

/**
 * سجل التدقيق لمسجد — من فعل ماذا ومتى.
 * `getMosqueLedger` يُظهر المال، وهذا يُظهر القرارات. هوية الفاعل لا تُعاد،
 * دوره فقط: الغرض تتبّع المسار لا كشف الأشخاص.
 */
Parse.Cloud.define('getMosqueAuditTrail', async (request) => {
  requireUser(request);
  const { mosqueId, limit = 50 } = request.params;
  if (!mosqueId) E.invalid('معرّف المسجد مطلوب.');

  const mosque = new Parse.Object('Mosques');
  mosque.id = mosqueId;

  const entries = await new Parse.Query('AuditLog')
    .equalTo('mosqueId', mosque)
    .descending('createdAt')
    .limit(Math.min(Number(limit) || 50, 100))
    .find({ useMasterKey: true });

  return entries.map((entry) => ({
    action: entry.get('action'),
    targetClass: entry.get('targetClass'),
    targetId: entry.get('targetId'),
    fromStatus: entry.get('fromStatus'),
    toStatus: entry.get('toStatus'),
    actorRole: entry.get('actorRole'),
    amount: entry.get('amount'),
    createdAt: entry.get('createdAt'),
  }));
});


// ======================================================================
// شؤون الحسابات   [functions/users.js]
// ======================================================================

/**
 * شؤون الحسابات: اعتماد الشركات، والملف الشخصي.
 *
 * اعتماد الشركة كان بلا مسار أصلاً: جدول الأدوار يقول إن المشرف «يعتمد
 * الشركات»، و`beforeSave` يحظر تعديل `isVerifiedContractor` إلا بـ Master Key —
 * فلم يكن أمام المشرف إلا تعديل السجل يدوياً من لوحة التحكم، بلا أثر في السجل.
 */

/** الشركات المنتظرة اعتماداً — مشرف فقط. */
Parse.Cloud.define('listPendingContractors', async (request) => {
  requireRole(request, 'admin');

  const contractors = await new Parse.Query(Parse.User)
    .equalTo('role', 'contractor')
    .equalTo('isVerifiedContractor', false)
    .ascending('createdAt')
    .limit(100)
    .find({ useMasterKey: true });

  return contractors.map((contractor) => ({
    id: contractor.id,
    fullName: contractor.get('fullName'),
    companyName: contractor.get('companyName'),
    crNumber: contractor.get('crNumber'), // السجل التجاري — أساس الاعتماد
    phone: contractor.get('phone'),
    createdAt: contractor.get('createdAt'),
  }));
});

/** اعتماد شركة أو سحب اعتمادها — مشرف فقط. */
Parse.Cloud.define('reviewContractor', async (request) => {
  const admin = requireRole(request, 'admin');
  const { contractorId, approve } = request.params;
  if (!contractorId) E.invalid('معرّف الشركة مطلوب.');

  const contractor = await new Parse.Query(Parse.User)
    .get(contractorId, { useMasterKey: true })
    .catch(() => E.notFound('المستخدم غير موجود.'));

  if (contractor.get('role') !== 'contractor') E.invalid('هذا المستخدم ليس شركة خدمات.');

  const verified = Boolean(approve);
  if (verified && !contractor.get('crNumber')) {
    E.invalid('لا يُعتمد مزوّد بلا رقم سجل تجاري.');
  }

  contractor.set('isVerifiedContractor', verified);
  await contractor.save(null, { useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.CONTRACTOR_REVIEWED,
    target: contractor,
    actor: admin,
    toStatus: verified ? 'verified' : 'unverified',
  });

  await pushToUsers(contractor, {
    alert: verified ? 'تم اعتماد شركتكم في منصة مسجدي.' : 'أُوقف اعتماد شركتكم مؤقتاً.',
  });

  return { isVerifiedContractor: verified };
});

/**
 * ضبط المسجد المفضّل — نقطة الدخول الافتراضية في التطبيق.
 * تمرّ بدالة سحابة لا بكتابة مباشرة، للتحقق من وجود المسجد قبل ربط المؤشّر.
 */
Parse.Cloud.define('setFavoriteMosque', async (request) => {
  const user = requireUser(request);
  const { mosqueId } = request.params;

  if (!mosqueId) {
    user.unset('favoriteMosqueId');
    await user.save(null, { useMasterKey: true });
    return { favoriteMosqueId: null };
  }

  const mosque = await new Parse.Query('Mosques')
    .get(String(mosqueId), { useMasterKey: true })
    .catch(() => E.notFound('المسجد غير موجود.'));

  user.set('favoriteMosqueId', mosque);
  await user.save(null, { useMasterKey: true });

  return { favoriteMosqueId: mosque.id, mosqueName: mosque.get('name') };
});

/**
 * تحديث آخر موقع معروف للمستخدم.
 *
 * عليه يقوم إشعار «فرصة تطوّع قريبة»: بلا موقع محفوظ لا يصل المتطوّع خبرٌ إلا
 * إن فتح التطبيق. يُكتب الحقلان الرقميان معاً لأن البحث بالقرب يعمل عليهما.
 */
Parse.Cloud.define('updateMyLocation', async (request) => {
  const user = requireUser(request);
  const { lat, lng } = request.params;

  if (!geo.validCoordinates(lat, lng)) E.invalid('الإحداثيات مطلوبة كأرقام صحيحة.');

  user.set('lastKnownLocation', new Parse.GeoPoint({ latitude: lat, longitude: lng }));
  user.set('lastLat', lat);
  user.set('lastLng', lng);
  await user.save(null, { useMasterKey: true });

  return { lat, lng };
});

/** ملف المستخدم كما يعرضه التطبيق. */
Parse.Cloud.define('getMyProfile', async (request) => {
  const user = requireUser(request);
  await user.fetch({ useMasterKey: true });

  const favorite = user.get('favoriteMosqueId');
  let favoriteName = null;
  if (favorite) {
    const loaded = await favorite.fetch({ useMasterKey: true }).catch(() => null);
    favoriteName = loaded ? loaded.get('name') : null;
  }

  return {
    id: user.id,
    role: user.get('role'),
    fullName: user.get('fullName'),
    phone: user.get('phone'),
    skills: user.get('skills') || [],
    governorate: user.get('governorate'),
    wilayat: user.get('wilayat'),
    companyName: user.get('companyName'),
    crNumber: user.get('crNumber'),
    isVerifiedContractor: Boolean(user.get('isVerifiedContractor')),
    completedJobs: user.get('completedJobs') || 0,
    avgRating: user.get('avgRating'),
    favoriteMosqueId: favorite ? favorite.id : null,
    favoriteMosqueName: favoriteName,
  };
});


// ======================================================================
// الصيانة الدورية   [functions/maintenance.js]
// ======================================================================

/**
 * صيانة دورية للبيانات المتراكمة.
 */

// `AuditLog` ينمو بسطر لكل تحوّل حالة وكل حركة مال، وباقة Back4app المجانية
// 250 ميغابايت تشترك فيها بيانات 18 ألف مسجد. ستة أشهر تكفي للمساءلة أمام
// المتبرّع، وما قبلها يُؤرشَف خارج المنصّة إن لزم.
const AUDIT_RETENTION_DAYS = 180;
const PRUNE_BATCH = 500;

Parse.Cloud.job('pruneAuditLog', async (request) => {
  const { params, message } = request;

  const days = Math.max(Number(params.retentionDays) || AUDIT_RETENTION_DAYS, 30);
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);

  let removed = 0;
  for (;;) {
    const batch = await new Parse.Query('AuditLog')
      .lessThan('createdAt', cutoff)
      .limit(PRUNE_BATCH)
      .find({ useMasterKey: true });

    if (batch.length === 0) break;
    await Parse.Object.destroyAll(batch, { useMasterKey: true });
    removed += batch.length;

    message(`حُذف ${removed} سطراً حتى الآن…`);
    if (batch.length < PRUNE_BATCH) break;
  }

  const summary = `حُذف ${removed} سطر تدقيق أقدم من ${days} يوماً.`;
  message(summary);
  return summary;
});


// ======================================================================
// فحص حالة الخادم
// ======================================================================

Parse.Cloud.define('health', async () => ({
  ok: true,
  version: '1.0.0',
  serverTime: new Date().toISOString(),
  paymentsConfigured: payments.isConfigured(),
}));
