/**
 * فحص ما يُنسى فيُكسر التثبيت والعمل بلا إنترنت.
 *
 * كل شرط هنا يُفشل التثبيت أو التخزين المسبق صامتاً لو اختلّ، ولا يظهر في
 * `npm run build` لأنه بناء ناجح بمخرَج ناقص.
 *
 *   node scripts/check-pwa.mjs   (بعد vite build)
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const failures = [];

const check = (ok, message) => {
  console.log(`${ok ? '✓' : '✗'} ${message}`);
  if (!ok) failures.push(message);
};

if (!existsSync(DIST)) {
  console.error('✗ لا يوجد dist — شغّل `npm run build` أولاً.');
  process.exit(1);
}

const files = readdirSync(DIST);
const manifestName = files.find((name) => /^manifest.*\.webmanifest$/.test(name));

check(Boolean(manifestName), 'ملف manifest مولَّد');
check(files.includes('sw.js'), 'عامل الخدمة مولَّد (sw.js)');
check(files.includes('apple-touch-icon.png'), 'apple-touch-icon موجود — iOS لا يقرأ سواه');

if (manifestName) {
  const manifest = JSON.parse(readFileSync(join(DIST, manifestName), 'utf8'));

  check(manifest.dir === 'rtl' && manifest.lang === 'ar', 'الاتجاه واللغة عربيّان');
  check(manifest.display === 'standalone', 'يفتح بلا شريط متصفّح');
  check(manifest.start_url === './' && manifest.scope === './',
    'start_url و scope نسبيّان — المطلق يكسر التثبيت من مجلّد فرعي');

  const sizes = (manifest.icons || []).map((icon) => icon.sizes);
  check(sizes.includes('192x192') && sizes.includes('512x512'), 'مقاسا 192 و512 موجودان');
  check((manifest.icons || []).some((icon) => icon.purpose === 'maskable'),
    'أيقونة قابلة للقصّ — بدونها يقصّ أندرويد الأيقونة عشوائياً');

  for (const icon of manifest.icons || []) {
    check(existsSync(join(DIST, icon.src)), `الأيقونة موجودة فعلاً: ${icon.src}`);
  }
}

if (files.includes('sw.js')) {
  const sw = readFileSync(join(DIST, 'sw.js'), 'utf8');
  const precached = (sw.match(/"revision"/g) || []).length
    || (sw.match(/revision:/g) || []).length;
  check(precached > 0 || /precache/i.test(sw), 'عامل الخدمة يحوي قائمة تخزين مسبق');

  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  check(/registerSW|serviceWorker/.test(html) || files.some((f) => /registerSW/.test(f)),
    'الصفحة تسجّل عامل الخدمة');
}

console.log(failures.length === 0
  ? '\n✓ التثبيت والعمل بلا إنترنت مهيّآن'
  : `\n✗ ${failures.length} فحصاً فشل`);
process.exit(failures.length === 0 ? 0 : 1);
