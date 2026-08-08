/**
 * تشغيل الواجهة في متصفّح حقيقي فوق خادم Parse حقيقي.
 *
 * لماذا يلزم رغم اختبار التكامل: التكامل يستدعي دوال السحابة مباشرةً، فلا يرى
 * ما بين الدالة والمستخدم — زرٌّ لا يظهر في حالةٍ ما، أو حقلٌ بلا `htmlFor` لا
 * يصله قارئ الشاشة، أو شاشةٌ تُخفي مساراً كاملاً. كلّها وقعت في هذا المستودع.
 *
 * يتخطّى نفسه بلا فشل إن غاب المتصفّح أو حزمة Playwright أو بناء الواجهة، فلا
 * يكسر المستودع على جهازٍ لا يملكها.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const APP_DIR = path.join(__dirname, '..', '..', 'app');
const DIST = path.join(APP_DIR, 'dist');

/** أنواع الملفات التي يقدّمها الخادم الساكن — لا حاجة إلى مكتبة لهذا. */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
};

/** سبب التخطّي، أو `null` إن كانت البيئة صالحة. */
function unavailableReason() {
  try {
    require.resolve('playwright');
  } catch {
    return 'Playwright غير مثبّت — شغّل `npm install`';
  }
  if (!fs.existsSync(path.join(APP_DIR, 'node_modules'))) {
    return 'حزم الواجهة غير مثبّتة — شغّل `npm install` داخل app/';
  }
  try {
    require('playwright').chromium.executablePath();
  } catch {
    return 'متصفّح Chromium غير متوفّر';
  }
  return null;
}

/**
 * مسار المتصفّح.
 *
 * `executablePath()` يشير إلى نسخةٍ تُطابق إصدار Playwright بالرقم، وقد تكون
 * البيئة تحمل نسخةً أخرى مثبّتة مسبقاً. نقبل الموجود بدل تنزيل غيره.
 */
function browserPath() {
  const { chromium } = require('playwright');
  const preferred = chromium.executablePath();
  if (fs.existsSync(preferred)) return preferred;

  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  for (const candidate of [
    root && path.join(root, 'chromium', 'chrome-linux', 'chrome'),
    root && path.join(root, 'chromium'),
  ].filter(Boolean)) {
    if (fs.existsSync(candidate)) {
      return fs.statSync(candidate).isDirectory()
        ? path.join(candidate, 'chrome-linux', 'chrome')
        : candidate;
    }
  }
  return preferred;
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
 * بناء الواجهة موجَّهةً إلى خادم الاختبار.
 *
 * البناء لازم لأن Vite يُثبّت عنوان الخادم في الحزمة وقت البناء لا وقت التشغيل،
 * ومنفذ خادم الاختبار يُختار عشوائياً في كل تشغيل.
 */
function buildApp(serverURL, appId, jsKey) {
  execFileSync('npm', ['run', 'build'], {
    cwd: APP_DIR,
    stdio: 'pipe',
    env: {
      ...process.env,
      VITE_PARSE_SERVER_URL: serverURL,
      VITE_PARSE_APP_ID: appId,
      VITE_PARSE_JS_KEY: jsKey,
      VITE_GOOGLE_MAPS_API_KEY: '', // الخريطة تحتاج شبكة — والتطبيق يعمل بدونها
    },
  });
}

/** خادم ساكن لمجلّد `dist`، بارتداد إلى `index.html` كما تفعل الاستضافة. */
async function serveDist() {
  const port = await freePort();
  const server = http.createServer((request, response) => {
    const url = decodeURIComponent(request.url.split('?')[0]);
    let file = path.join(DIST, url === '/' ? 'index.html' : url.replace(/^\/+/, ''));
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(DIST, 'index.html');
    }
    response.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(response);
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${port}/`,
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * متصفّح جاهز. كل مستخدم في سياقٍ مستقلّ: سياقٌ مشترك يحمل جلسة أوّلهم إلى
 * صفحة الآخر، فيبدو الاختبار ناجحاً وهو يقود مستخدماً واحداً طوال الوقت.
 */
async function openBrowser() {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({
    executablePath: browserPath(),
    args: ['--no-sandbox'], // الحاويات تعمل كجذر، والحماية الرملية ترفض
  });

  const contexts = [];
  async function newUserPage() {
    const context = await browser.newContext({
      viewport: { width: 420, height: 880 },
      locale: 'ar',
    });
    contexts.push(context);
    const page = await context.newPage();
    // المهلة الافتراضية ثلاثون ثانية: انتظارٌ فاشل واحد يبتلع سُدس مهلة الملفّ
    // كلّه، فلا يظهر إلا أوّل الأعطال. وتبقى فوق مهلة تحديد الموقع (عشر ثوانٍ)
    // حتى لا تلتقط لقطةُ العطل الشاشةَ وهي ما تزال تنتظره.
    page.setDefaultTimeout(15000);
    return page;
  }

  return { browser, newUserPage, close: () => browser.close() };
}

module.exports = { unavailableReason, buildApp, serveDist, openBrowser, APP_DIR, DIST };
