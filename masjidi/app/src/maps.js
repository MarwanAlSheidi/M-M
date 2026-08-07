/**
 * تحميل Google Maps JavaScript API عند الحاجة فقط.
 *
 * لماذا JavaScript API لا Embed API: الثانية تُضمَّن بـ`iframe` بلا مفتاح في
 * الكود، لكنها تعرض موقعاً واحداً — ونحن نعرض عشرات المساجد حول المستخدم بعلامة
 * لكل واحد. تعدّد العلامات يلزمه JavaScript API.
 *
 * والمفتاح يخصّ صاحب المشروع: يُوضع في `VITE_GOOGLE_MAPS_API_KEY` ويُقيَّد
 * بنطاق الموقع من لوحة Google Cloud. وبلا مفتاح لا يسقط التطبيق — تبقى القائمة
 * بالمسافات، وهي المسار الافتراضي في المرحلة الأولى.
 *
 * ملاحظة: `google.maps.Marker` أُعلن قِدَمها لصالح `AdvancedMarkerElement`،
 * والأخيرة تفرض `mapId` مُنشأً من لوحة Google Cloud. أُبقيت الكلاسيكية لأنها
 * تعمل بلا إعداد إضافي؛ الانتقال يلزم عند إنشاء `mapId`.
 */

export const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

const CALLBACK = '__masjidiMapsReady';
let pending = null;

/** يعيد `google.maps` أو يرمي رسالة عربية مفهومة. */
export function loadGoogleMaps() {
  if (window.google && window.google.maps) return Promise.resolve(window.google.maps);

  if (!MAPS_KEY) {
    return Promise.reject(new Error(
      'الخريطة غير مهيأة — أضف VITE_GOOGLE_MAPS_API_KEY لعرضها.',
    ));
  }

  // طلب واحد مهما تعدّدت الشاشات التي تطلبه في اللحظة نفسها
  if (pending) return pending;

  pending = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const params = new URLSearchParams({
      key: MAPS_KEY,
      language: 'ar',
      region: 'OM',
      loading: 'async',
      callback: CALLBACK,
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;

    window[CALLBACK] = () => resolve(window.google.maps);
    script.onerror = () => {
      pending = null;
      reject(new Error('تعذّر تحميل الخريطة — تحقّق من الاتصال أو من صلاحية المفتاح.'));
    };

    document.head.appendChild(script);
  });

  return pending;
}

/** عرض الخريطة: مسطّح أو قمر صناعي (أقرب ما يقابل «جوجل إيرث» داخل صفحة). */
export const VIEWS = {
  roadmap: 'خريطة',
  hybrid: 'قمر صناعي',
};
