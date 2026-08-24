/**
 * خادمُ العرض — يعمل **داخل المتصفّح** لا على الشبكة.
 *
 * صفحةُ العرض معزولةٌ عن الشبكة، فلا تبلغ خادم Parse. والحلُّ ألّا تُمسّ شاشةٌ
 * واحدة من التطبيق: يُبدَّل **ناقلُ الطلبات** في حزمة Parse نفسها
 * (`CoreManager.setRESTController`)، فيمضي كلُّ ما يفعله `api.js` كما هو —
 * تسجيلُ الدخول، والاستعلامات، و`Parse.Cloud.run` — ويُجاب من مخزنٍ في الذاكرة.
 *
 * **وهذا عرضٌ لا خادم.** المنطق هنا مبسَّطٌ يكفي للتجربة، والمنطقُ الحقيقي في
 * `cloud/` وعليه ٧٤١ حالة فحص. ولا يُقاس هذا الملفّ بذاك ولا يُغني عنه.
 *
 * والبيانات حقيقية: ٤٩٥ مسجداً من البيانات المفتوحة لوزارة الأوقاف.
 */

import Parse from 'parse/dist/parse.min.js';
import MOSQUES from './mosques.json';

const now = () => new Date();
const iso = (date) => ({ __type: 'Date', iso: new Date(date).toISOString() });
const pointer = (className, objectId) => ({ __type: 'Pointer', className, objectId });

let seq = 0;
const nextId = (prefix) => `${prefix}${(seq += 1).toString(36)}${Date.now().toString(36).slice(-4)}`;

/* ————— المخزن ————— */

const db = {
  users: [],
  mosques: MOSQUES.map((row) => ({
    ...row, objectId: row.externalId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) + (seq += 1),
    isClaimed: false, imamId: null, openRequestsCount: 0,
    createdAt: now(), updatedAt: now(),
  })),
  requests: [],
  interests: [],
  claims: [],
  notifications: [],
  audit: [],
};

const byId = (list, id) => list.find((row) => row.objectId === id) || null;
const err = (code, message) => Promise.reject(new Parse.Error(code, message));

/* ————— الجلسات ————— */

const sessions = new Map();
let currentToken = null;

function userJSON(user, withToken) {
  const { password, ...rest } = user;
  return {
    ...rest,
    className: '_User',
    createdAt: new Date(user.createdAt).toISOString(),
    updatedAt: new Date(user.updatedAt).toISOString(),
    favoriteMosqueId: user.favoriteMosqueId ? pointer('Mosques', user.favoriteMosqueId) : undefined,
    ...(withToken ? { sessionToken: withToken } : {}),
  };
}

const whoIs = (options = {}) => {
  const token = options.sessionToken || currentToken;
  return token ? sessions.get(token) || null : null;
};

/* ————— بذورُ العرض ————— */

function makeUser(fields) {
  const user = {
    objectId: nextId('u'), isActive: true, completedJobs: 0, abandonedJobs: 0,
    avgRating: undefined, createdAt: now(), updatedAt: now(), ...fields,
  };
  db.users.push(user);
  return user;
}

function record(action, mosqueId, actor, extra = {}) {
  db.audit.push({
    objectId: nextId('a'), action, mosqueId,
    actorRole: actor ? actor.role : null, createdAt: now(), ...extra,
  });
}

function notify(user, body, requestId) {
  db.notifications.push({
    objectId: nextId('n'), userId: user.objectId, body,
    requestId: requestId || null, readAt: null, createdAt: now(),
  });
}

function countOpen(mosqueId) {
  const live = ['pending_funding', 'open_for_volunteers', 'funded', 'assigned',
    'in_progress', 'pending_imam_approval'];
  const mosque = byId(db.mosques, mosqueId);
  if (mosque) {
    mosque.openRequestsCount = db.requests
      .filter((row) => row.mosqueId === mosqueId && live.includes(row.status)).length;
  }
}

const HOME = db.mosques.find((row) => row.governorate === 'مسقط'
  && row.type.includes('جامع') && Number.isFinite(row.lat)) || db.mosques[0];

/** موقعُ المستخدم في العرض — نقطةُ المسجد المُهيَّأ. */
export const DEMO_POINT = { latitude: HOME.lat, longitude: HOME.lng };

const imam = makeUser({
  username: 'امام', password: 'Masjidi12345', role: 'imam',
  fullName: 'سعيد بن محمد', phone: '99112233', governorate: HOME.governorate,
});
const volunteer = makeUser({
  username: 'متطوع', password: 'Masjidi12345', role: 'volunteer',
  fullName: 'سالم بن علي', phone: '99445566', governorate: HOME.governorate,
  skills: ['electrical', 'ac'], lastLat: HOME.lat, lastLng: HOME.lng,
});
const admin = makeUser({
  username: 'مشرف', password: 'Masjidi12345', role: 'admin', fullName: 'خالد المشرف',
});
makeUser({
  username: 'شركة', password: 'Masjidi12345', role: 'contractor',
  fullName: 'مالك الشركة', companyName: 'شركة البناء الحديث', crNumber: '1234567',
  isVerifiedContractor: true, governorate: HOME.governorate, completedJobs: 7, avgRating: 4.6,
});

export const DEMO_ACCOUNTS = [
  { username: 'امام', label: 'القائم على المسجد', note: 'له مسجدٌ معتمد واحتياجٌ مفتوح' },
  { username: 'متطوع', label: 'متطوّع', note: 'يرى الفرص القريبة ويسجّل اهتمامه' },
  { username: 'مشرف', label: 'الإدارة', note: 'عنده طلبُ إشرافٍ ينتظر المراجعة' },
];
export const DEMO_PASSWORD = 'Masjidi12345';

// مسجدٌ معتمدٌ للإمام، وفيه احتياجٌ مفتوح
HOME.isClaimed = true;
HOME.imamId = imam.objectId;
record('claim_reviewed', HOME.objectId, admin);

const seedRequest = {
  objectId: nextId('r'), mosqueId: HOME.objectId, imamId: imam.objectId,
  title: 'إصلاح مكيّفات المصلّى', status: 'open_for_volunteers',
  description: 'ثلاثة مكيّفات لا تعمل، وحرُّ الظهيرة يشقّ على المصلّين.',
  category: 'ac', urgency: 'high', estimatedCost: 0, completionPhotos: [],
  createdAt: new Date(Date.now() - 2 * 86400000), updatedAt: now(),
};
db.requests.push(seedRequest);
record('request_created', HOME.objectId, imam, { subject: seedRequest.title });
countOpen(HOME.objectId);
const seedNotice = seedRequest;

// طلبُ إشرافٍ ينتظر المشرف، من مسجدٍ آخر
const WAITING = db.mosques.find((row) => row.objectId !== HOME.objectId
  && row.governorate === HOME.governorate);
const pendingImam = makeUser({
  username: 'امام2', password: 'Masjidi12345', role: 'imam',
  fullName: 'ناصر بن حمد', phone: '99778899', governorate: WAITING.governorate,
});
db.claims.push({
  objectId: nextId('c'), mosqueId: WAITING.objectId, imamId: pendingImam.objectId,
  status: 'pending', capacity: 'agent', claimDistanceKm: 0.2, contestedCount: 0,
  evidenceNote: 'وكيل المسجد، وأتولّى شؤون صيانته منذ سنتين.',
  createdAt: new Date(Date.now() - 3 * 86400000),
});

/* ————— أدواتٌ للدوال ————— */

const KM = (aLat, aLng, bLat, bLng) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
};

/**
 * نظيرةُ `mosqueTitle` في `app/src/api.js` حرفاً بحرف.
 *
 * وأوّلُ صياغةٍ هنا كانت تقريباً من عندي، فأعطت «مصلى نساء مصلى النساء» —
 * والصواب أن تُنسخ القاعدة لا أن تُخمَّن: الكلمةُ الأولى من النوع، وتُترك إن
 * كان الاسم يحملها.
 */
const mosqueTitle = (m) => {
  const name = ((m && m.name) || '').trim();
  const head = ((m && m.type) || '').trim().split(/\s+/)[0];
  if (!head || !name || name.includes(head)) return name;
  return `${head} ${name}`;
};

const mosqueRow = (m, km) => ({
  objectId: m.objectId, id: m.objectId, name: m.name, type: m.type,
  mosqueNumber: m.mosqueNumber, governorate: m.governorate, wilayat: m.wilayat,
  village: m.village, lat: m.lat, lng: m.lng, hasLocation: true,
  isClaimed: m.isClaimed, openRequestsCount: m.openRequestsCount,
  ...(km == null ? {} : { distanceKm: Math.round(km * 100) / 100 }),
});

const requestRow = (r) => {
  const m = byId(db.mosques, r.mosqueId);
  return {
    objectId: r.objectId,
    className: 'ServiceRequests',
    createdAt: new Date(r.createdAt).toISOString(),
    updatedAt: new Date(r.updatedAt).toISOString(),
    title: r.title, description: r.description, category: r.category,
    urgency: r.urgency, status: r.status, estimatedCost: r.estimatedCost,
    workerNotes: r.workerNotes, completionPhotos: r.completionPhotos || [],
    assignedAt: r.assignedAt ? iso(r.assignedAt) : undefined,
    startedAt: r.startedAt ? iso(r.startedAt) : undefined,
    mosqueId: {
      __type: 'Object', className: 'Mosques', objectId: m.objectId,
      createdAt: new Date(m.createdAt).toISOString(),
      updatedAt: new Date(m.updatedAt).toISOString(),
      name: m.name, type: m.type, wilayat: m.wilayat, village: m.village,
      governorate: m.governorate, mosqueNumber: m.mosqueNumber,
      lat: m.lat, lng: m.lng,
    },
    assignedVolunteerId: r.assignedVolunteerId ? pointer('_User', r.assignedVolunteerId) : undefined,
    assignedContractorId: r.assignedContractorId
      ? pointer('_User', r.assignedContractorId) : undefined,
  };
};

const normalize = (text) => String(text || '')
  .replace(/[ً-ْـ]/g, '')
  .replace(/[إأآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .trim().toLowerCase();

/* ————— دوال السحابة ————— */

// بذرةُ الوارد بعد تعريف `mosqueTitle` — الاسمُ كما يُنادى لا كما يُخزَّن
notify(volunteer, `فرصة تطوّع: ${seedNotice.title} — ${mosqueTitle(HOME)}`, seedNotice.objectId);

const FUNCTIONS = {
  searchMosques({ query, governorate, lat, lng }) {
    const needle = normalize(query);
    let hits = db.mosques.filter((m) => normalize(`${m.type} ${m.name} ${m.wilayat} ${m.village || ''}`)
      .includes(needle));
    if (governorate) hits = hits.filter((m) => m.governorate === governorate);
    const withKm = hits.map((m) => ({
      m, km: lat != null ? KM(lat, lng, m.lat, m.lng) : null,
    }));
    if (lat != null) withKm.sort((a, b) => a.km - b.km);
    return withKm.slice(0, 40).map(({ m, km }) => mosqueRow(m, km));
  },

  getNearbyMosques({ lat, lng, radiusKm = 5, limit = 50 }) {
    return db.mosques
      .map((m) => ({ m, km: KM(lat, lng, m.lat, m.lng) }))
      .filter(({ km }) => km <= radiusKm)
      .sort((a, b) => a.km - b.km)
      .slice(0, limit)
      .map(({ m, km }) => mosqueRow(m, km));
  },

  getNearbyOpportunities({ lat, lng, radiusKm = 15 }) {
    const near = db.mosques
      .map((m) => ({ m, km: KM(lat, lng, m.lat, m.lng) }))
      .filter(({ km }) => km <= radiusKm);
    const ids = new Map(near.map(({ m, km }) => [m.objectId, km]));
    return db.requests
      .filter((r) => r.status === 'open_for_volunteers' && ids.has(r.mosqueId))
      .map((r) => {
        const m = byId(db.mosques, r.mosqueId);
        const km = ids.get(r.mosqueId);
        return {
          id: r.objectId, title: r.title, description: r.description,
          category: r.category, urgency: r.urgency, status: r.status,
          mosqueId: m.objectId, mosqueName: mosqueTitle(m),
          wilayat: m.wilayat, village: m.village,
          distanceKm: Math.round(km * 100) / 100,
        };
      })
      .sort((a, b) => a.distanceKm - b.distanceKm);
  },

  updateMyLocation({ lat, lng }, me) {
    if (me) { me.lastLat = lat; me.lastLng = lng; }
    return { ok: true };
  },

  claimMosque({ mosqueId, evidenceNote, capacity, lat, lng }, me) {
    const m = byId(db.mosques, mosqueId);
    if (!m) return err(101, 'المسجد غير موجود.');
    if (db.claims.some((c) => c.mosqueId === mosqueId && c.imamId === me.objectId
      && c.status === 'pending')) {
      return err(137, 'لديك طلبٌ معلّقٌ على هذا المسجد.');
    }
    db.claims.push({
      objectId: nextId('c'), mosqueId, imamId: me.objectId, status: 'pending',
      capacity: capacity || 'imam', evidenceNote: evidenceNote || '', contestedCount: 0,
      claimDistanceKm: lat != null ? KM(lat, lng, m.lat, m.lng) : null,
      createdAt: now(),
    });
    return {
      status: 'pending',
      message: m.isClaimed
        ? 'قُدّم طلبُ نقل الإشراف، وسيُراجع خلال أيام عمل.'
        : 'قُدّم طلبُ التسجيل، وسيُراجع خلال أيام عمل.',
    };
  },

  getMyClaims(_params, me) {
    return db.claims.filter((c) => c.imamId === me.objectId).map((c) => {
      const m = byId(db.mosques, c.mosqueId);
      return {
        id: c.objectId, status: c.status, createdAt: c.createdAt,
        reviewedAt: c.reviewedAt || null, capacity: c.capacity,
        mosqueName: mosqueTitle(m), wilayat: m.wilayat, village: m.village,
      };
    });
  },

  getMyMosques(_params, me) {
    return db.mosques.filter((m) => m.imamId === me.objectId).map((m) => ({
      id: m.objectId, objectId: m.objectId, name: m.name, type: m.type,
      wilayat: m.wilayat, village: m.village, governorate: m.governorate,
      mosqueNumber: m.mosqueNumber, lat: m.lat, lng: m.lng, hasLocation: true,
      locationSource: 'ministry', openRequestsCount: m.openRequestsCount,
    }));
  },

  confirmMosqueLocation({ mosqueId, lat, lng }, me) {
    const m = byId(db.mosques, mosqueId);
    m.lat = lat; m.lng = lng;
    record('location_corrected', mosqueId, me);
    return { status: 'saved', message: 'حُفظ موقع المسجد.' };
  },

  listPendingClaims(_params) {
    return db.claims.filter((c) => c.status === 'pending').map((c) => {
      const m = byId(db.mosques, c.mosqueId);
      const who = byId(db.users, c.imamId);
      return {
        id: c.objectId, evidenceNote: c.evidenceNote, createdAt: c.createdAt,
        mosqueName: mosqueTitle(m), wilayat: m.wilayat, village: m.village,
        mosqueNumber: m.mosqueNumber, governorate: m.governorate,
        capacity: c.capacity, contestedCount: c.contestedCount,
        claimDistanceKm: c.claimDistanceKm,
        atMosque: c.claimDistanceKm != null && c.claimDistanceKm <= 0.5,
        wilayatNearestKm: null, willSetLocation: false,
        imamName: who.fullName, imamPhone: who.phone,
        isTransfer: Boolean(m.isClaimed && m.imamId),
        currentImamName: m.imamId ? (byId(db.users, m.imamId) || {}).fullName : null,
        currentImamPhone: m.imamId ? (byId(db.users, m.imamId) || {}).phone : null,
      };
    });
  },

  reviewMosqueClaim({ claimId, approve }, me) {
    const c = byId(db.claims, claimId);
    if (!c) return err(101, 'الطلب غير موجود.');
    c.status = approve ? 'approved' : 'rejected';
    c.reviewedAt = now();
    const m = byId(db.mosques, c.mosqueId);
    if (approve) { m.isClaimed = true; m.imamId = c.imamId; }
    record('claim_reviewed', c.mosqueId, me);
    notify(byId(db.users, c.imamId), approve
      ? `اعتُمد تسجيلك على ${mosqueTitle(m)} — يمكنك الآن نشر احتياجاته.`
      : `لم يُعتمد طلبُك على ${mosqueTitle(m)}. راسل الإدارة إن كان لديك ما يُثبت صفتك.`);
    return { status: c.status };
  },

  createServiceRequest({ mosqueId, title, description, category, urgency }, me) {
    const m = byId(db.mosques, mosqueId);
    if (!m || m.imamId !== me.objectId) return err(119, 'لست القائم على هذا المسجد.');
    const row = {
      objectId: nextId('r'), mosqueId, imamId: me.objectId, title, description,
      category: category || 'other', urgency: urgency || 'normal',
      status: 'open_for_volunteers', estimatedCost: 0, completionPhotos: [],
      createdAt: now(), updatedAt: now(),
    };
    db.requests.push(row);
    record('request_created', mosqueId, me, { subject: title });
    countOpen(mosqueId);
    for (const user of db.users) {
      if (user.role === 'volunteer' && user.objectId !== me.objectId) {
        notify(user, `فرصة تطوّع: ${title} — ${mosqueTitle(m)}`, row.objectId);
      }
    }
    return requestRow(row);
  },

  expressInterest({ requestId, note }, me) {
    const r = byId(db.requests, requestId);
    if (!r) return err(101, 'الطلب غير موجود.');
    if (r.status !== 'open_for_volunteers') return err(142, 'هذا الطلب لا يستقبل المتطوّعين حالياً.');
    if (db.interests.some((i) => i.requestId === requestId && i.volunteerId === me.objectId
      && i.status === 'active')) return err(137, 'سبق أن سجّلت اهتمامك بهذا الطلب.');
    db.interests.push({
      objectId: nextId('i'), requestId, volunteerId: me.objectId,
      status: 'active', note: note || '', createdAt: now(),
    });
    record('interest_expressed', r.mosqueId, me, { subject: r.title });
    notify(byId(db.users, r.imamId),
      `متطوّع مهتمّ بـ "${r.title}" — اختر المنفّذ من قائمة المهتمّين.`, requestId);
    return { interestId: 'ok', message: 'سُجّل اهتمامك، والقائم على المسجد يختار المنفّذ.' };
  },

  withdrawInterest({ requestId }, me) {
    const i = db.interests.find((row) => row.requestId === requestId
      && row.volunteerId === me.objectId && row.status === 'active');
    if (i) i.status = 'withdrawn';
    return { status: 'withdrawn' };
  },

  getMyInterests(_params, me) {
    return db.interests.filter((i) => i.volunteerId === me.objectId).map((i) => {
      const r = byId(db.requests, i.requestId);
      return {
        id: i.objectId, status: i.status, note: i.note, createdAt: i.createdAt,
        requestId: i.requestId, requestTitle: r ? r.title : null,
        requestStatus: r ? r.status : null,
      };
    });
  },

  getRequestInterests({ requestId }) {
    return db.interests.filter((i) => i.requestId === requestId && i.status === 'active')
      .map((i) => {
        const who = byId(db.users, i.volunteerId);
        return {
          interestId: i.objectId, volunteerId: who.objectId, fullName: who.fullName,
          skills: who.skills || [], completedJobs: who.completedJobs || 0,
          abandonedJobs: who.abandonedJobs || 0, avgRating: who.avgRating ?? null,
          note: i.note, createdAt: i.createdAt,
        };
      });
  },

  listApprovedContractors() {
    return db.users.filter((u) => u.role === 'contractor' && u.isVerifiedContractor)
      .map((u) => ({
        id: u.objectId, fullName: u.fullName, companyName: u.companyName || null,
        governorate: u.governorate || null, completedJobs: u.completedJobs || 0,
        abandonedJobs: u.abandonedJobs || 0, avgRating: u.avgRating ?? null,
      }));
  },

  assignWorker({ requestId, workerId }, me) {
    const r = byId(db.requests, requestId);
    const worker = byId(db.users, workerId);
    if (!r || !worker) return err(101, 'غير موجود.');
    r.status = 'assigned';
    r.assignedAt = now();
    if (worker.role === 'contractor') r.assignedContractorId = workerId;
    else r.assignedVolunteerId = workerId;
    for (const i of db.interests) {
      if (i.requestId === requestId && i.status === 'active'
        && i.volunteerId !== workerId) i.status = 'closed';
    }
    record('worker_assigned', r.mosqueId, me, { subject: r.title });
    notify(worker, `كُلِّفت بعمل "${r.title}" — تواصل مع القائم على المسجد.`, requestId);
    return { status: 'assigned' };
  },

  releaseAssignment({ requestId }, me) {
    const r = byId(db.requests, requestId);
    r.status = 'open_for_volunteers';
    r.assignedVolunteerId = undefined;
    r.assignedContractorId = undefined;
    record('assignment_released', r.mosqueId, me, { subject: r.title });
    countOpen(r.mosqueId);
    return { status: 'open_for_volunteers' };
  },

  startWork({ requestId }, me) {
    const r = byId(db.requests, requestId);
    r.status = 'in_progress';
    r.startedAt = now();
    record('work_started', r.mosqueId, me, { subject: r.title });
    notify(byId(db.users, r.imamId), `بدأ العمل في "${r.title}".`, requestId);
    return { status: 'in_progress' };
  },

  markWorkDone({ requestId, notes, photoUrls }, me) {
    const r = byId(db.requests, requestId);
    r.status = 'pending_imam_approval';
    r.workerNotes = notes;
    r.completionPhotos = photoUrls || [];
    record('work_done', r.mosqueId, me, { subject: r.title });
    notify(byId(db.users, r.imamId),
      `أُبلغ بإنجاز "${r.title}" — عايِن العمل واعتمده.`, requestId);
    return { status: 'pending_imam_approval' };
  },

  completeService({ requestId, rating }, me) {
    const r = byId(db.requests, requestId);
    r.status = 'completed';
    const workerId = r.assignedVolunteerId || r.assignedContractorId;
    const worker = byId(db.users, workerId);
    if (worker) {
      worker.completedJobs = (worker.completedJobs || 0) + 1;
      if (rating) {
        const before = worker.avgRating;
        worker.avgRating = before
          ? Math.round(((before + rating) / 2) * 10) / 10 : rating;
      }
      notify(worker, `اعتُمد عملُك في "${r.title}". جزاك الله خيراً.`, requestId);
    }
    record('request_completed', r.mosqueId, me, { subject: r.title });
    countOpen(r.mosqueId);
    return { status: 'completed' };
  },

  cancelServiceRequest({ requestId }, me) {
    const r = byId(db.requests, requestId);
    r.status = 'cancelled';
    record('request_cancelled', r.mosqueId, me, { subject: r.title });
    countOpen(r.mosqueId);
    return { status: 'cancelled' };
  },

  getRequestContacts({ requestIds }, me) {
    const out = {};
    for (const id of requestIds || []) {
      const r = byId(db.requests, id);
      if (!r || !['assigned', 'in_progress', 'pending_imam_approval'].includes(r.status)) continue;
      const workerId = r.assignedVolunteerId || r.assignedContractorId;
      if (me.objectId === r.imamId && workerId) {
        const w = byId(db.users, workerId);
        out[id] = { role: w.role, name: w.companyName || w.fullName, phone: w.phone };
      } else if (me.objectId === workerId) {
        const im = byId(db.users, r.imamId);
        out[id] = { role: 'imam', name: im.fullName, phone: im.phone };
      }
    }
    return out;
  },

  getMyNotifications({ limit = 50 }, me) {
    const mine = db.notifications.filter((n) => n.userId === me.objectId)
      .sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
    return {
      items: mine.map((n) => ({
        id: n.objectId, body: n.body, requestId: n.requestId,
        readAt: n.readAt, createdAt: n.createdAt,
      })),
      unread: mine.filter((n) => !n.readAt).length,
    };
  },

  markNotificationsRead(_params, me) {
    for (const n of db.notifications) if (n.userId === me.objectId) n.readAt = now();
    return { marked: true };
  },

  getMosqueAuditTrail({ mosqueId }) {
    return db.audit.filter((row) => row.mosqueId === mosqueId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((row) => ({
        action: row.action, actorRole: row.actorRole, createdAt: row.createdAt,
        subject: row.subject || null, note: row.note || null, amount: null,
        targetClass: null, targetId: null, fromStatus: null, toStatus: null,
      }));
  },

  getMyProfile(_params, me) {
    const fav = me.favoriteMosqueId ? byId(db.mosques, me.favoriteMosqueId) : null;
    return {
      id: me.objectId, fullName: me.fullName, username: me.username, role: me.role,
      phone: me.phone, governorate: me.governorate || null, skills: me.skills || [],
      companyName: me.companyName || null, crNumber: me.crNumber || null,
      isVerifiedContractor: Boolean(me.isVerifiedContractor),
      contractorStatus: me.role === 'contractor'
        ? (me.isVerifiedContractor ? 'verified' : 'pending') : null,
      completedJobs: me.completedJobs || 0, abandonedJobs: me.abandonedJobs || 0,
      avgRating: me.avgRating ?? null,
      favoriteMosqueId: fav ? fav.objectId : null,
      favoriteMosqueName: fav ? mosqueTitle(fav) : null,
    };
  },

  updateMyProfile(params, me) {
    for (const key of ['fullName', 'phone', 'governorate', 'skills', 'companyName']) {
      if (params[key] !== undefined) me[key] = params[key];
    }
    return { status: 'saved' };
  },

  setFavoriteMosque({ mosqueId }, me) {
    me.favoriteMosqueId = mosqueId;
    const m = byId(db.mosques, mosqueId);
    return { status: 'saved', mosqueName: m ? mosqueTitle(m) : null };
  },

  listPendingContractors() {
    return db.users.filter((u) => u.role === 'contractor' && !u.isVerifiedContractor)
      .map((u) => ({
        id: u.objectId, fullName: u.fullName, companyName: u.companyName,
        crNumber: u.crNumber, phone: u.phone, createdAt: u.createdAt,
        previouslyReviewed: false, reviewedAt: null,
      }));
  },

  reviewContractor({ contractorId, approve }) {
    const u = byId(db.users, contractorId);
    if (u) u.isVerifiedContractor = Boolean(approve);
    return { status: approve ? 'verified' : 'rejected' };
  },
};

/* ————— الناقل ————— */

function handleQuery(className, data) {
  if (className !== 'ServiceRequests') return { results: [] };
  const where = data.where || {};
  let rows = db.requests.slice();

  if (where.status) rows = rows.filter((r) => r.status === where.status);
  if (where.objectId) rows = rows.filter((r) => r.objectId === where.objectId);
  if (where.mosqueId) rows = rows.filter((r) => r.mosqueId === where.mosqueId.objectId);
  if (where.assignedVolunteerId) {
    rows = rows.filter((r) => r.assignedVolunteerId === where.assignedVolunteerId.objectId);
  }
  if (where.assignedContractorId) {
    rows = rows.filter((r) => r.assignedContractorId === where.assignedContractorId.objectId);
  }

  rows.sort((a, b) => b.createdAt - a.createdAt);
  return { results: rows.slice(0, data.limit || 50).map(requestRow) };
}

const controller = {
  async request(method, path, data = {}, options = {}) {
    // مهلةٌ صغيرة تُظهر حالات الانتظار كما تُرى على شبكةٍ حقيقية
    await new Promise((resolve) => { setTimeout(resolve, 120); });

    if (path === 'users' && method === 'POST') {
      if (db.users.some((u) => u.username === data.username)) {
        return err(202, 'اسم المستخدم مأخوذ، اختر غيره.');
      }
      const user = makeUser({ ...data, isActive: true });
      const token = nextId('t');
      sessions.set(token, user);
      currentToken = token;
      return userJSON(user, token);
    }

    if (path === 'login') {
      const found = db.users.find((u) => u.username === data.username
        && u.password === data.password);
      if (!found) return err(101, 'اسم المستخدم أو كلمة المرور غير صحيحة.');
      const token = nextId('t');
      sessions.set(token, found);
      currentToken = token;
      return userJSON(found, token);
    }

    if (path === 'logout') { sessions.delete(currentToken); currentToken = null; return {}; }

    if (path === 'users/me') {
      const me = whoIs(options);
      if (!me) return err(209, 'انتهت الجلسة.');
      return userJSON(me, options.sessionToken || currentToken);
    }

    if (path.startsWith('users/') && method === 'PUT') {
      const me = whoIs(options);
      Object.assign(me, data);
      return { updatedAt: new Date().toISOString() };
    }

    if (path.startsWith('functions/')) {
      const name = path.slice('functions/'.length);
      const fn = FUNCTIONS[name];
      if (!fn) return err(141, `دالّةٌ غير متاحة في العرض: ${name}`);
      const me = whoIs(options);
      if (!me && name !== 'health') return err(209, 'يجب تسجيل الدخول أولاً.');
      try {
        return { result: await fn(data || {}, me) };
      } catch (error) {
        if (error instanceof Parse.Error) throw error;
        return err(141, error.message || 'تعذّر إتمام العملية.');
      }
    }

    if (path.startsWith('classes/')) {
      return handleQuery(path.slice('classes/'.length), data);
    }

    return {};
  },
  ajax() { return Promise.resolve({ response: {}, status: 200 }); },
};

/** يُركَّب قبل أوّل نداء — ويُبدَّل الناقل وحده، فالشاشات لا تعلم. */
export function installDemoServer() {
  Parse.CoreManager.setRESTController(controller);

  // رفعُ الصور: تُحفظ في المتصفّح وتُعرض كما هي، بلا تخزينٍ خارجي
  Parse.CoreManager.setFileController({
    saveFile: () => Promise.resolve({ name: 'demo.png', url: '' }),
    saveBase64: (name, data) => Promise.resolve({
      name, url: `data:${data.type || 'image/png'};base64,${data.base64}`,
    }),
    download: () => Promise.resolve({}),
    deleteFile: () => Promise.resolve({}),
  });
}

export { db };
