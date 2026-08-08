/**
 * الطبقة الوحيدة التي تلمس Parse.
 *
 * قاعدة المستودع: كل كتابة تمرّ بدوال السحابة. لذلك لا `save()` هنا على أي فئة
 * — القراءات المسموحة (`ServiceRequests`) وحدها استعلامات مباشرة، وما عداها
 * `Parse.Cloud.run`. ولا وجود لـ Master Key في هذا الملف ولا في أي كود عميل.
 */

import Parse from 'parse/dist/parse.min.js';

const APP_ID = import.meta.env.VITE_PARSE_APP_ID || 'masjidi-live';
const JS_KEY = import.meta.env.VITE_PARSE_JS_KEY || 'js-live';
const SERVER_URL = import.meta.env.VITE_PARSE_SERVER_URL || 'http://127.0.0.1:41337/parse';

Parse.initialize(APP_ID, JS_KEY);
Parse.serverURL = SERVER_URL;

export const ROLES = {
  imam: 'إمام مسجد',
  volunteer: 'متطوّع',
  donor: 'متبرّع',
  contractor: 'شركة خدمات',
};

export const STATUS_LABEL = {
  pending_funding: 'بانتظار التمويل',
  open_for_volunteers: 'مفتوح للتطوّع',
  funded: 'مموّل',
  assigned: 'مُسنَد',
  in_progress: 'قيد التنفيذ',
  pending_imam_approval: 'بانتظار اعتماد الإمام',
  completed: 'منجَز',
  cancelled: 'ملغى',
};

export const CATEGORIES = {
  electrical: 'كهرباء',
  plumbing: 'سباكة',
  ac: 'تكييف',
  paint: 'دهان',
  cleaning: 'نظافة',
  carpet: 'سجاد',
  other: 'أخرى',
};

const run = (name, params) => Parse.Cloud.run(name, params);

/* ————— الجلسة ————— */

export const currentUser = () => Parse.User.current();

export async function signUp({ username, password, fullName, phone, role }) {
  const user = new Parse.User();
  user.set('username', username.trim());
  user.set('password', password);
  user.set('role', role);
  if (fullName) user.set('fullName', fullName.trim());
  if (phone) user.set('phone', phone.trim());
  await user.signUp();
  return user;
}

export const logIn = (username, password) => Parse.User.logIn(username.trim(), password);
export const logOut = () => Parse.User.logOut();

/* ————— المساجد ————— */

export const nearbyMosques = (lat, lng, radius = 5) =>
  run('getNearbyMosques', { lat, lng, radius });

export const nearbyOpportunities = (lat, lng, radius = 15) =>
  run('getNearbyOpportunities', { lat, lng, radius });

export const updateMyLocation = (lat, lng) => run('updateMyLocation', { lat, lng });

export const searchMosques = (term, governorate) =>
  run('searchMosques', { term, governorate, limit: 30 });

export const claimMosque = (mosqueId, evidenceNote) =>
  run('claimMosque', { mosqueId, evidenceNote });

export const getMyClaims = () => run('getMyClaims');

export const getMosqueAuditTrail = (mosqueId) => run('getMosqueAuditTrail', { mosqueId });

/* ————— الطلبات ————— */

/** `ServiceRequests` مقروءة للمصادَقين، فالقراءة استعلام مباشر لا دالة سحابة. */
async function listRequests(build) {
  const query = new Parse.Query('ServiceRequests');
  query.include('mosqueId');
  query.descending('createdAt');
  query.limit(50);
  build(query);

  const rows = await query.find();
  return rows.map((row) => {
    const mosque = row.get('mosqueId');
    return {
      id: row.id,
      title: row.get('title'),
      description: row.get('description'),
      category: row.get('category'),
      urgency: row.get('urgency'),
      status: row.get('status'),
      estimatedCost: row.get('estimatedCost'),
      createdAt: row.get('createdAt'),
      mosqueId: mosque ? mosque.id : null,
      mosqueName: mosque ? mosque.get('name') : null,
      wilayat: mosque ? mosque.get('wilayat') : null,
    };
  });
}

export const openOpportunities = () =>
  listRequests((query) => query.equalTo('status', 'open_for_volunteers'));

export const requestsForMosque = (mosqueId) =>
  listRequests((query) => {
    const mosque = new Parse.Object('Mosques');
    mosque.id = mosqueId;
    query.equalTo('mosqueId', mosque);
  });

export const assignedToMe = () =>
  listRequests((query) => query.equalTo('assignedVolunteerId', Parse.User.current()));

export const createServiceRequest = (payload) => run('createServiceRequest', payload);
export const cancelServiceRequest = (requestId) => run('cancelServiceRequest', { requestId });

/* ————— التطوّع ————— */

export const expressInterest = (requestId, note) => run('expressInterest', { requestId, note });
export const withdrawInterest = (requestId) => run('withdrawInterest', { requestId });
export const getMyInterests = () => run('getMyInterests');
export const getRequestInterests = (requestId) => run('getRequestInterests', { requestId });
export const assignWorker = (requestId, workerId) => run('assignWorker', { requestId, workerId });
export const startWork = (requestId) => run('startWork', { requestId });
export const markWorkDone = (requestId, notes) => run('markWorkDone', { requestId, notes });
export const completeService = (requestId, rating, volunteerHours) =>
  run('completeService', { requestId, rating, volunteerHours });

/* ————— الحساب ————— */

export const getMyProfile = () => run('getMyProfile');
export const setFavoriteMosque = (mosqueId) => run('setFavoriteMosque', { mosqueId });

/**
 * موقع الجهاز.
 *
 * يُرفض بلا HTTPS (عدا localhost) وقد يرفضه المستخدم — والحالتان متوقّعتان، فلا
 * تُعامَلان كخطأ في النظام بل تُشرحان له.
 */
export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('جهازك لا يدعم تحديد الموقع.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }),
      (error) => reject(new Error(
        error.code === 1 ? 'لم تُسمح للتطبيق بمعرفة موقعك — فعّل الإذن لترى ما حولك.'
          : 'تعذّر تحديد موقعك، حاول في مكان مكشوف.',
      )),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}

/** «٤٥٠ متراً» أوضح من «0.45 كم». */
export const formatDistance = (km) =>
  (km < 1 ? `${Math.round(km * 1000)} متراً` : `${km.toFixed(1)} كم`);

/** رابط خرائط يفتح بتطبيق الجهاز — بلا تضمين خرائط خارجية في الصفحة. */
export const mapsLink = (lat, lng, label) =>
  `https://www.google.com/maps/search/?api=1&query=${lat},${lng}${label ? `&query_place_id=${encodeURIComponent(label)}` : ''}`;

/* ————— الإدارة ————— */

export const listPendingContractors = () => run('listPendingContractors');
export const reviewContractor = (contractorId, approve) =>
  run('reviewContractor', { contractorId, approve });
export const listPendingClaims = () => run('listPendingClaims');
export const reviewMosqueClaim = (claimId, approve) =>
  run('reviewMosqueClaim', { claimId, approve });

/** رسالة الخطأ العربية القادمة من `lib/errors.js`، لا نصّ Parse الإنجليزي. */
export const messageOf = (error) =>
  (error && error.message) || 'تعذّر إتمام العملية، حاول مرة أخرى.';
