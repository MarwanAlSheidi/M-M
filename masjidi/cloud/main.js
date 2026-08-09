/**
 * مسجدي — نقطة دخول Cloud Code
 *
 * Back4app / Parse Server يُحمّل هذا الملف عند النشر.
 * الترتيب مهم: triggers أولاً ثم الدوال.
 */

require('./triggers');
require('./functions/mosques');
require('./functions/requests');
require('./functions/donations');
require('./functions/users');
require('./functions/notifications');
require('./functions/maintenance');
require('./functions/preflight');

/**
 * نبضٌ رخيص: يُثبت أن الكود حُمّل، ولا يُثبت شيئاً غيره.
 *
 * يُنادى من مراقبٍ خارجيّ كلَّ دقيقة، فلا يلمس القاعدة. **وما يُفحص قبل
 * الإطلاق ليس هذا** — بل `preflight`: تُشغّل الاستعلامات على القاعدة الحيّة
 * وتقول ما لا تفحصه. لا تخلط بينهما.
 */
Parse.Cloud.define('health', async () => ({
  ok: true,
  version: '1.0.0',
  serverTime: new Date().toISOString(),
  paymentsConfigured: require('./lib/payments').isConfigured(),
}));
