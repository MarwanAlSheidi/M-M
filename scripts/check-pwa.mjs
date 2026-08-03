/*
 * فحص PWA — التثبيت على الشاشة الرئيسية والعمل بلا إنترنت.
 *
 * التشغيل: npm run verify:pwa   (يشغّل خادم المعاينة بنفسه)
 *
 * يُفحص هنا بسياق مستقل لأن verify-engine يعطّل عامل الخدمة عمداً: تخزينه المسبق
 * يجلب كل الأصول فيُفسد قياس التحميل الكسول هناك.
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";

const PORT = 4174;
const ORIGIN = `http://localhost:${PORT}`;

const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
const stopServer = () => { try { server.kill("SIGTERM"); } catch {} };
process.on("exit", stopServer);

async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(ORIGIN); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("خادم المعاينة لم يستجب — هل نُفّذ `npm run build` أولاً؟");
}

let passed = 0; const failures = [];
const expect = (label, actual, expected) => {
  const ok = String(actual).trim() === String(expected).trim();
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failures.push(label); console.log(`  ✗ ${label}\n      المتوقّع: ${expected}\n      الفعلي:   ${actual}`); }
};

await waitForServer();
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ["--no-sandbox"],
});
const ctx = await browser.newContext();
const page = await ctx.newPage();

console.log("\n══ بيان التطبيق (manifest) ══");
{
  const href = await (await page.goto(ORIGIN), page.getAttribute("link[rel=manifest]", "href"));
  expect("وسم manifest موجود", !!href, true);
  const m = await (await ctx.request.get(new URL(href, ORIGIN).href)).json();
  expect("الاسم", m.name, "خطتي المالية — الخطة الخماسية");
  expect("اللغة عربية", m.lang, "ar");
  expect("الاتجاه rtl", m.dir, "rtl");
  expect("يفتح بلا شريط متصفّح", m.display, "standalone");
  // نسبيّان كي يعمل التثبيت من مجلّد فرعي لا من جذر النطاق وحده
  expect("start_url نسبي", m.start_url, "./");
  expect("scope نسبي", m.scope, "./");
  expect("أيقونة 192 موجودة", m.icons.some((i) => i.sizes === "192x192"), true);
  expect("أيقونة 512 موجودة", m.icons.some((i) => i.sizes === "512x512"), true);
  // أندرويد يقصّ الأيقونة دائرياً؛ بلا maskable تُقصّ الحواف من التصميم
  expect("أيقونة maskable موجودة", m.icons.some((i) => (i.purpose || "").includes("maskable")), true);
}

console.log("\n══ وسوم iOS ══");
{
  // iOS يتجاهل أيقونات الـmanifest ويقرأ apple-touch-icon وحدها
  const touch = await page.getAttribute('link[rel="apple-touch-icon"]', "href");
  expect("apple-touch-icon موجود", !!touch, true);
  const r = await ctx.request.get(new URL(touch, ORIGIN).href);
  expect("apple-touch-icon يُحمَّل فعلاً", r.status(), 200);
  expect("يفتح بلا شريط متصفّح على iOS",
    await page.getAttribute('meta[name="apple-mobile-web-app-capable"]', "content"), "yes");
  expect("لون الشريط العلوي مضبوط",
    await page.getAttribute('meta[name="theme-color"]', "content"), "#1A2B48");
}

console.log("\n══ الأيقونات تُحمَّل بأبعادها ══");
for (const [file, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
  const dim = await page.evaluate((src) => new Promise((res) => {
    const im = new Image();
    im.onload = () => res(`${im.naturalWidth}x${im.naturalHeight}`);
    im.onerror = () => res("فشل التحميل");
    im.src = src;
  }), new URL(file, ORIGIN).href);
  expect(`${file} بأبعاد ${size}×${size}`, dim, `${size}x${size}`);
}

console.log("\n══ العمل بلا إنترنت ══");
{
  await page.goto(ORIGIN);
  await page.waitForSelector("text=العميل");
  // ننتظر تفعيل عامل الخدمة واكتمال التخزين المسبق
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => null));
  await page.waitForTimeout(2500);
  expect("عامل الخدمة مُسجَّل", await page.evaluate(() => !!navigator.serviceWorker.controller), true);

  await ctx.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  const aliveOffline = await page.locator("text=العميل").count().catch(() => 0);
  expect("التطبيق يعمل بلا شبكة بعد إعادة التحميل", aliveOffline > 0, true);

  // شاشة «القراءة» تحمّل حزمة الرسوم كسولاً — أخطر موضع على الانقطاع
  await page.locator("button", { hasText: "القراءة" }).first().click();
  const chartOffline = await page.locator("main svg.recharts-surface").first()
    .waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false);
  expect("الرسم البياني يظهر بلا شبكة (الحزمة الكسولة مخزّنة مسبقاً)", chartOffline, true);
  await ctx.setOffline(false);
}

await browser.close();
stopServer();

console.log("\n" + "─".repeat(60));
if (failures.length) {
  console.log(`فشل ${failures.length} فحصاً من ${passed + failures.length}:`);
  failures.forEach((f) => console.log(`  • ${f}`));
  process.exit(1);
}
console.log(`نجحت كل فحوصات PWA (${passed}).`);
process.exit(0);
