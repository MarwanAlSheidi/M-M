#!/usr/bin/env node
/**
 * `npm run deploy` — أوّلُ نشرٍ على Back4app في أمرٍ واحد.
 *
 * **لماذا يوجد:** `docs/DEPLOY.md` تسعُ خطواتٍ في ٣٩٩ سطراً، وأوّلُ نشرٍ يقع
 * مرّةً واحدة — فمن يقرؤه يقرؤه وهو مستعجل. وثلاثٌ من خطواته لها **رمزُ خروجٍ
 * يجب أن يُقرأ ولا يُقرأ**: `apply_schema` يخرج بغير صفر وقد سقط صنفٌ كامل،
 * فيمضي المُشغّل إلى ما بعده وصنفٌ غائبٌ **يُنشئه أوّلُ من يكتب فيه بصلاحياتٍ
 * مفتوحة**.
 *
 * فهذا يمشي الترتيب، **ويقف عند أوّل سقوط**، ويقول ما الذي لم يقم.
 *
 * **وما لا يفعله — قصداً:**
 * - لا يُنشئ حساباً ولا تطبيقاً: ذلك في لوحة Back4app بيد صاحبه.
 * - لا يرفع كود السحابة: الرفع بالـCLI أو باللصق، وكلاهما خارج هذا.
 * - لا يستورد البيانات كاملةً: `--all` يُطلب باسمه في `seed_mosques` وحده،
 *   وهذا يقف عند محافظةٍ واحدة رخيصة.
 * - **ولا يُنشئ الفهرس الفريد**: مخطط Parse لا يعبّر عن التفرّد، فيُضاف من
 *   اللوحة. ولا يُقال «تمّ» عمّا لم يُفعل — يُقال إنه باقٍ، ويُتركُ `preflight`
 *   يكشفه أحمرَ.
 */

require('dotenv').config();

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { announceTarget } = require('./lib/target');

const ROOT = path.join(__dirname, '..');
const REQUIRED = ['PARSE_APP_ID', 'PARSE_MASTER_KEY', 'PARSE_JS_KEY', 'PARSE_SERVER_URL'];

/** يقف ويقول لماذا — ولا يمضي إلى ما بعده. */
function stop(why, hint) {
  console.error(`\n✗ ${why}`);
  if (hint) console.error(`  ${hint}`);
  process.exitCode = 1;
}

/** يشغّل خطوةً ويقرأ رمز خروجها — لا آخر سطرٍ من مخرجاتها. */
function step(title, file, argv = []) {
  console.log(`\n${'─'.repeat(60)}\n▸ ${title}\n${'─'.repeat(60)}`);
  try {
    execFileSync(process.execPath, [path.join(__dirname, file), ...argv],
      { stdio: 'inherit', cwd: ROOT });
    return true;
  } catch (error) {
    console.error(`\n✗ «${title}» خرجت برمز ${error.status ?? '؟'} — وقفتُ هنا.`);
    return false;
  }
}

function main() {
  const argv = process.argv.slice(2);
  const governorate = (() => {
    const at = argv.indexOf('--governorate');
    return at >= 0 ? argv[at + 1] : 'musandam';
  })();

  console.log('مسجدي — أوّل نشر\n');

  /* ————— ١. المفاتيح ————— */

  /*
   * **الشرطُ على القيم لا على الملفّ.**
   *
   * كان الفحصُ على وجود `.env`، فمن صدّرها في بيئته — أو شغّلها من CI — يُردّ
   * وهو يملك المفاتيح كاملة. وأسوأ من ذلك أنّ السكربت **يصير غيرَ قابلٍ
   * للقياس**: لا يُشغَّل بمفاتيح مزيَّفة، فلا حارسَ عليه. وكشف ذلك الحارسُ
   * نفسه ساعةَ كُتب.
   */
  const missing = REQUIRED.filter((key) => !String(process.env[key] || '').trim());
  if (missing.length) {
    const known = fs.existsSync(path.join(ROOT, '.env'));
    return stop(`مفاتيحُ ناقصة — ${missing.join('، ')}`,
      known
        ? 'املأها في `.env` من لوحة Back4app: App Settings → Security & Keys.'
        : 'انسخ `.env.example` إلى `.env` واملأه من App Settings → Security & Keys.');
  }

  // **والوجهة تُقال قبل الفعل**: تطبيقٌ تجريبيٌّ وآخرُ حقيقيّ هو الحال
  // المتوقَّعة، والفرق بينهما سطرٌ في `.env` يُبدَّل باليد.
  announceTarget('سيُنشَر', process.env);

  /* ————— ٢. المخطط ————— */

  if (!step('المخطط والصلاحيات والفهارس', 'apply_schema.js')) {
    return stop('لم يُطبَّق المخطط كما هو مكتوب.',
      'صنفٌ غائبٌ لا صلاحيات له، ويُنشئه أوّلُ من يكتب فيه بصلاحياتٍ مفتوحة. '
      + 'صحّح السبب وأعد التشغيل — الأمر لا يحذف شيئاً.');
  }

  /* ————— ٣. بياناتٌ رخيصة ————— */

  if (!step(`مساجد محافظة ${governorate}`, 'seed_mosques.js', ['--governorate', governorate])) {
    return stop('لم يكتمل الاستيراد.', 'راقب عدّاد الطلبات في اللوحة قبل إعادة المحاولة.');
  }

  /* ————— ٤. ما يبقى بيدك ————— */

  console.log(`\n${'─'.repeat(60)}\n▸ خطوتان لا يفعلهما هذا الأمر\n${'─'.repeat(60)}`);
  console.log('  ١. الصق `cloud/main.bundle.js` في لوحة Cloud Code (أو ارفع `cloud/` بالـCLI).');
  console.log('  ٢. أضف فهرساً **فريداً** على `Mosques.externalId` من Database → Indexes.');
  console.log('     مخطط Parse لا يعبّر عن التفرّد، وهو الحماية الوحيدة قبل وقوع التكرار.');
  console.log('\n  ثم أنشئ حسابك من التطبيق، وارفعه مشرفاً:');
  console.log('     npm run admin -- --username <اسمك>');
  console.log('\n  ثم — وهذا ما يُقاس به كلُّ ما سبق:');
  console.log('     npm run preflight');
  console.log('\n  و`preflight` يبقى **أحمر** حتى يُضاف الفهرس الفريد. فذلك مقصود:');
  console.log('  خطوةٌ يدويةٌ تُفحص بأثرها لا يُوثق بها.');

  console.log('\n✓ ما يُنفَّذ من هنا تمّ. والباقي أعلاه.');
  return undefined;
}

main();
