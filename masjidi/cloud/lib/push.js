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

  const location = mosque.get('location');
  let volunteers = [];

  try {
    if (location) {
      const geo = new Parse.Query(Parse.User);
      geo.equalTo('role', 'volunteer');
      geo.equalTo('isActive', true);
      geo.withinKilometers('lastKnownLocation', location, radiusKm);
      geo.limit(500);
      volunteers = await geo.find({ useMasterKey: true });
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

module.exports = { pushToUsers, pushToNearbyVolunteers };
