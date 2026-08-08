/**
 * تشغيل `parse-server` حقيقي فوق PostgreSQL مؤقّت، بكود السحابة كما هو.
 *
 * لماذا يلزم رغم وجود البديل في الذاكرة: البديل يرصد أخطاء المنطق لا أخطاء
 * المنصّة. أول تشغيل حقيقي كشف خللين كانا يمنعان الإطلاق والاختبارات خضراء —
 * قيمة المخطط الافتراضية التي تُعلّم الحقل مُعدَّلاً فتمنع كل تسجيل، وفشلُ
 * استعلام جغرافي يُسقط إنشاء الطلب. راجع «جولة رابعة» في `docs/REVIEW.md`.
 *
 * يتخطّى نفسه بلا فشل إن غابت أدوات PostgreSQL أو حزم التطوير، فلا يكسر
 * `npm test` على جهاز لا يملكها.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const { planIndexes, splitByKind } = require('../../scripts/lib/index-plan');
const { tokenize } = require('../../scripts/lib/tokenize');

const CLOUD_MAIN = path.join(__dirname, '..', '..', 'cloud', 'main.js');

const APP_ID = 'masjidi-integration';
const MASTER_KEY = 'integration-master-key';
const JS_KEY = 'integration-js-key';

/** يعثر على أدوات PostgreSQL: من PATH أو من مسار التوزيعة المعتاد. */
function findPostgresBin() {
  try {
    const dir = path.dirname(execFileSync('which', ['pg_ctl'], { encoding: 'utf8' }).trim());
    if (dir) return dir;
  } catch {
    // ليست في PATH — نبحث في مسارات التوزيعة
  }

  for (const base of ['/usr/lib/postgresql', '/usr/local/pgsql', '/opt/homebrew/opt']) {
    if (!fs.existsSync(base)) continue;
    for (const entry of fs.readdirSync(base).sort().reverse()) {
      const candidate = path.join(base, entry, 'bin');
      if (fs.existsSync(path.join(candidate, 'pg_ctl'))) return candidate;
    }
  }
  return null;
}

/** سبب التخطّي، أو `null` إن كانت البيئة صالحة. */
function unavailableReason() {
  if (!findPostgresBin()) return 'أدوات PostgreSQL غير متوفّرة';
  try {
    require.resolve('parse-server');
    require.resolve('parse/node');
    require.resolve('@parse/fs-files-adapter');
  } catch {
    return 'حزم التطوير غير مثبّتة — شغّل `npm install`';
  }
  return null;
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * `initdb` يرفض العمل بصلاحيات الجذر. في الحاويات التي تعمل كجذر نُسند العملية
 * إلى مستخدم `postgres` إن وُجد — وهو ما يفرض وضع الدليل في مكانٍ يصله.
 */
function rootFallbackUser() {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return null;
  try {
    execFileSync('id', ['-u', 'postgres'], { stdio: 'ignore' });
    return 'postgres';
  } catch {
    return null;
  }
}

function makeRunner(binDir, asUser) {
  return (tool, args) => {
    const command = `${path.join(binDir, tool)} ${args.map((a) => `'${a}'`).join(' ')}`;
    if (asUser) {
      return execFileSync('su', [asUser, '-c', command], { encoding: 'utf8', stdio: 'pipe' });
    }
    return execFileSync(path.join(binDir, tool), args, { encoding: 'utf8', stdio: 'pipe' });
  };
}

/**
 * يُشغّل قاعدة بيانات وخادماً، ويعيد `{ serverURL, stop }`.
 * الاستدعاء يفترض أن `unavailableReason()` أعادت `null`.
 */
async function startStack() {
  const binDir = findPostgresBin();
  const asUser = rootFallbackUser();

  // مستخدم postgres لا يصل إلى دليل مؤقّت مملوك للجذر، فنضع العنقود في بيته
  const root = asUser
    ? fs.mkdtempSync('/var/lib/postgresql/masjidi-it-')
    : fs.mkdtempSync(path.join(os.tmpdir(), 'masjidi-it-'));
  if (asUser) execFileSync('chown', ['-R', `${asUser}:${asUser}`, root]);

  const dataDir = path.join(root, 'data');
  const run = makeRunner(binDir, asUser);
  const pgPort = await freePort();

  run('initdb', ['-D', dataDir, '-U', 'postgres', '--auth=trust', '-E', 'UTF8']);
  run('pg_ctl', ['-D', dataDir, '-o', `-p ${pgPort} -c listen_addresses=127.0.0.1`,
    '-l', path.join(root, 'pg.log'), '-w', 'start']);
  run('createdb', ['-h', '127.0.0.1', '-p', String(pgPort), '-U', 'postgres', 'masjidi']);

  const { ParseServer } = require('parse-server');
  const express = require('express');
  const apiPort = await freePort();
  const serverURL = `http://127.0.0.1:${apiPort}/parse`;

  // المحوّل الافتراضي للملفات GridFS ويلزمه MongoDB. ملفّاتٌ على القرص تكفي
  // هنا، وبدونها يبقى مسار صور الإنجاز — وهو دليل الإمام على أن العمل وقع —
  // خارج أي تحقّق آليّ.
  //
  // `filesSubDirectory` يُضمّ إلى «files» **نسبةً إلى مجلّد التشغيل** لا إلى
  // جذر مطلق: تمريرُ مسارٍ مطلق يُنشئ `files/<المسار كاملاً>` داخل المستودع.
  // فنمرّر اسماً نسبياً ونحذفه عند الإيقاف.
  const FSFilesAdapter = require('@parse/fs-files-adapter');
  const filesSubDirectory = path.basename(root);
  const filesRoot = path.join(process.cwd(), 'files');

  const parseServer = new ParseServer({
    databaseURI: `postgres://postgres@127.0.0.1:${pgPort}/masjidi`,
    filesAdapter: new FSFilesAdapter({ filesSubDirectory }),
    fileUpload: { enableForAuthenticatedUser: true },
    cloud: CLOUD_MAIN,
    appId: APP_ID,
    masterKey: MASTER_KEY,
    javascriptKey: JS_KEY,
    serverURL,
    allowClientClassCreation: false,
    directAccess: true,
    silent: true,
  });

  await parseServer.start();
  const app = express();
  app.use('/parse', parseServer.app);
  const http = await new Promise((resolve) => {
    const listener = app.listen(apiPort, '127.0.0.1', () => resolve(listener));
  });

  const Parse = require('parse/node');
  Parse.initialize(APP_ID, JS_KEY, MASTER_KEY);
  Parse.serverURL = serverURL;

  async function stop() {
    await new Promise((resolve) => http.close(resolve));
    try { await parseServer.handleShutdown(); } catch { /* الخادم مُغلق أصلاً */ }
    try { run('pg_ctl', ['-D', dataDir, '-m', 'immediate', '-w', 'stop']); } catch { /* توقّف */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(path.join(filesRoot, filesSubDirectory), { recursive: true, force: true });
    // `files` نفسه يُحذف إن خلا — ولا يُحذف إن كان فيه شيء لغيرنا
    try { fs.rmdirSync(filesRoot); } catch { /* غير فارغ أو غير موجود */ }
  }

  return { Parse, serverURL, appId: APP_ID, masterKey: MASTER_KEY, stop };
}

/**
 * تطبيق `cloud/schema.json` كما يفعل `scripts/apply_schema.js`.
 *
 * الفهارس تمرّ بـ`index-plan` نفسه الذي يستعمله السكربت: كانت هذه الدالة نسخةً
 * مستقلّة فانحرفت — طبّقت الحقول والصلاحيات وأسقطت كتلة `indexes` كلّها، فكان
 * اختبار التكامل يشهد لبيئةٍ ليست هي التي تُنشر.
 * @returns {number} عدد الفهارس غير المكانية المطبَّقة
 */
async function applySchema(Parse) {
  const schema = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'cloud', 'schema.json'), 'utf8'));
  let indexed = 0;

  for (const definition of schema.classes) {
    const parseSchema = new Parse.Schema(definition.className);
    let existing = null;
    try { existing = await parseSchema.get(); } catch { /* فئة جديدة */ }

    const existingFields = existing ? existing.fields : {};
    for (const [name, spec] of Object.entries(definition.fields || {})) {
      if (existingFields[name]) continue;
      const options = {};
      if (spec.required) options.required = true;
      if (spec.defaultValue !== undefined) options.defaultValue = spec.defaultValue;

      if (spec.type === 'Pointer') parseSchema.addPointer(name, spec.targetClass, options);
      else parseSchema[`add${spec.type}`](name, options);
    }

    const { plain } = splitByKind(
      planIndexes(definition.indexes, existing && existing.indexes));
    for (const { name, spec } of plain) parseSchema.addIndex(name, spec);
    indexed += plain.length;

    if (definition.classLevelPermissions) parseSchema.setCLP(definition.classLevelPermissions);
    existing ? await parseSchema.update() : await parseSchema.save();
    // المكانيّ يُترك: يحتاج PostGIS، والقرب يعمل بدونه على `geo_box`
  }

  return indexed;
}

/**
 * استيراد مساجد حقيقية من بيانات الوزارة — لا مساجد مخترَعة.
 *
 * أسماء المساجد العُمانية لها بنيتها: «مصلى التدريب بعيدم»، «جامع السلطان
 * قابوس». اختبارُ بحثٍ على «مسجد ١» و«مسجد ٢» يشهد لنفسه ولا يشهد للبحث.
 */
async function seedMosques(Parse, limit = 300) {
  const file = path.join(__dirname, '..', '..', 'data', 'mosques.json');
  const rows = JSON.parse(fs.readFileSync(file, 'utf8')).slice(0, limit);
  const Mosque = Parse.Object.extend('Mosques');

  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100).map((row) => {
      const mosque = new Mosque();
      mosque.set('externalId', row.externalId);
      mosque.set('name', row.name);
      mosque.set('nameNormalized', row.nameNormalized);
      mosque.set('nameTokens', tokenize(row.nameNormalized, row.village));
      mosque.set('governorate', row.governorate);
      mosque.set('wilayat', row.wilayat);
      mosque.set('village', row.village);
      mosque.set('hasLocation', row.hasLocation);
      if (row.location) {
        mosque.set('lat', row.location.latitude);
        mosque.set('lng', row.location.longitude);
      }
      return mosque;
    });
    await Parse.Object.saveAll(batch, { useMasterKey: true });
  }

  return rows.length;
}

module.exports = {
  startStack, applySchema, seedMosques, unavailableReason, APP_ID, MASTER_KEY, JS_KEY,
};
