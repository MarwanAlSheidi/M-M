const E = require('../lib/errors');
const { requireUser } = require('../lib/auth');

/**
 * صندوق الوارد.
 *
 * `Notifications` مقفلة على Master Key كسجل التدقيق: القراءة تمرّ من هنا وحدها
 * فلا يصل أحدٌ إلى وارد غيره ولو خمّن معرّفه.
 */

const MAX_PAGE = 50;

/** إشعارات المستخدم المستدعي، ومعها عدد غير المقروء. */
Parse.Cloud.define('getMyNotifications', async (request) => {
  const user = requireUser(request);
  const cap = Math.min(Number(request.params.limit) || 30, MAX_PAGE);

  const query = new Parse.Query('Notifications');
  query.equalTo('userId', user);
  query.descending('createdAt');
  query.limit(cap);
  const rows = await query.find({ useMasterKey: true });

  // `doesNotExist` لا `equalTo(null)`: الحقل غائب على غير المقروء لا مضبوط بـnull
  const unreadQuery = new Parse.Query('Notifications');
  unreadQuery.equalTo('userId', user);
  unreadQuery.doesNotExist('readAt');
  const unread = await unreadQuery.count({ useMasterKey: true });

  return {
    unread,
    items: rows.map((row) => ({
      id: row.id,
      body: row.get('body'),
      /*
       * و`kind` كان يُرسَل هنا ولا يُكتب في موضعٍ واحد: قِيس فلم يمرّره أيُّ
       * مستدعٍ لـ`pushToUsers` قطّ. فحقلٌ لا كاتبَ له ولا قارئ ليس تصنيفاً
       * مؤجّلاً بل حمولةٌ فارغة على كل إشعار — وتصنيفُ الأخبار حين يُطلب
       * ثلاثةُ أسطر. والعمود يبقى في المخطط موسوماً بأنه محجوز.
       */
      requestId: row.get('requestId') || null,
      readAt: row.get('readAt') || null,
      createdAt: row.get('createdAt'),
    })),
  };
});

/**
 * تعليم الوارد مقروءاً. بلا `ids` يُعلَّم كل غير المقروء.
 *
 * الاستعلام مقيَّد بالمستخدم دائماً حتى مع `ids`: لولا ذلك لعلّم أحدهم وارد
 * غيره مقروءاً بتمرير معرّفات ليست له، فيُخفي عنه إشعاراً لم يره.
 */
Parse.Cloud.define('markNotificationsRead', async (request) => {
  const user = requireUser(request);
  const { ids } = request.params;

  const query = new Parse.Query('Notifications');
  query.equalTo('userId', user);
  query.doesNotExist('readAt');
  if (Array.isArray(ids) && ids.length > 0) {
    if (ids.length > MAX_PAGE) E.invalid(`لا تتجاوز ${MAX_PAGE} إشعاراً في المرّة.`);
    query.containedIn('objectId', ids.map(String));
  }
  query.limit(MAX_PAGE);

  const rows = await query.find({ useMasterKey: true });
  const now = new Date();
  for (const row of rows) row.set('readAt', now);
  if (rows.length > 0) await Parse.Object.saveAll(rows, { useMasterKey: true });

  return { marked: rows.length };
});
