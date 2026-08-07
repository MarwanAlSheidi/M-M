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
require('./functions/maintenance');

Parse.Cloud.define('health', async () => ({
  ok: true,
  version: '1.0.0',
  serverTime: new Date().toISOString(),
  paymentsConfigured: require('./lib/payments').isConfigured(),
}));
