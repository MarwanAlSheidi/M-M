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

module.exports = {
  distanceKm, boundingBox, withinBox, sortByDistance, validCoordinates,
};
