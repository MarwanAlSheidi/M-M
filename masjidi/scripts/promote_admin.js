#!/usr/bin/env node
/**
 * ترقية حسابٍ قائم إلى `admin`.
 *
 * **بدون هذا لا تعمل المنصّة أصلاً على خادمٍ جديد:** الأئمة يسجّلون ويطلبون
 * ملكية مساجدهم، وطلباتهم تبقى `pending` إلى الأبد لأن اعتمادها يحتاج مشرفاً
 * ولا مشرف. و`beforeSave` يمنع أي مستخدم من ترقية نفسه — بحقّ — فالطريق الوحيد
 * هو Master Key من خارج التطبيق، وهو ما يفعله هذا السكربت.
 *
 * يُشغّل من جهاز المسؤول لا من الخادم، ولا يُنشئ حساباً: يرقّي حساباً سجّل
 * صاحبه بنفسه من التطبيق، فتبقى كلمة المرور عنده وحده.
 *
 *   node scripts/promote_admin.js --username abu_salim
 *   node scripts/promote_admin.js --username abu_salim --demote   # إلغاء الترقية
 *   node scripts/promote_admin.js --list                          # من هم المشرفون
 */

require('dotenv').config();
const Parse = require('parse/node');

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? null : (args[at + 1] || '').trim();
};
const has = (name) => args.includes(`--${name}`);

function initParse() {
  const { PARSE_APP_ID, PARSE_MASTER_KEY, PARSE_JS_KEY, PARSE_SERVER_URL } = process.env;
  if (!PARSE_APP_ID || !PARSE_MASTER_KEY || !PARSE_SERVER_URL) {
    console.error('✗ متغيرات البيئة ناقصة. انسخ .env.example إلى .env واملأه.');
    process.exit(1);
  }
  Parse.initialize(PARSE_APP_ID, PARSE_JS_KEY || '', PARSE_MASTER_KEY);
  Parse.serverURL = PARSE_SERVER_URL;
}

async function listAdmins() {
  const admins = await new Parse.Query(Parse.User)
    .equalTo('role', 'admin').limit(100).find({ useMasterKey: true });

  if (admins.length === 0) {
    console.log('لا مشرف على هذا الخادم — طلبات ملكية المساجد لن تُعتمد.');
    return;
  }
  console.log(`المشرفون (${admins.length}):`);
  for (const admin of admins) {
    console.log(`  ${admin.get('username')}  ${admin.get('fullName') || ''}`);
  }
}

async function main() {
  initParse();

  if (has('list')) {
    await listAdmins();
    return;
  }

  const username = flag('username');
  if (!username) {
    console.error('✗ استعمل --username <اسم المستخدم>، أو --list لعرض المشرفين.');
    process.exit(1);
  }

  const user = await new Parse.Query(Parse.User)
    .equalTo('username', username).first({ useMasterKey: true });

  if (!user) {
    console.error(`✗ لا حساب باسم «${username}». على صاحبه أن يسجّل من التطبيق أولاً.`);
    process.exit(1);
  }

  const demote = has('demote');
  const current = user.get('role');

  if (!demote && current === 'admin') {
    console.log(`✓ «${username}» مشرف أصلاً — لا تغيير.`);
    return;
  }
  if (demote && current !== 'admin') {
    console.log(`✓ «${username}» ليس مشرفاً (${current}) — لا تغيير.`);
    return;
  }

  // العودة إلى `donor` عند الإلغاء: أضيق الأدوار صلاحيةً، والمالك يرقّيه بعدها
  // إلى ما يناسبه. إعادته إلى دوره القديم تحتاج حفظه، ولا نحفظه.
  user.set('role', demote ? 'donor' : 'admin');
  await user.save(null, { useMasterKey: true });

  console.log(demote
    ? `✓ أُلغيت الترقية عن «${username}» وصار donor.`
    : `✓ «${username}» صار مشرفاً — يستطيع اعتماد طلبات الملكية والشركات.`);
}

main().catch((error) => {
  console.error('\n✗ فشل:', error.message);
  process.exit(1);
});
