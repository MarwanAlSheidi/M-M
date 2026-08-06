/*
 * يفحص النسخة أحادية الملف كما تُعرض بعد النشر: تُغلَّف بمستند بسيط بلا أي
 * مورد خارجي (الخطوط تسقط إلى خطّ النظام)، ثم تُفتح فعلياً ويُتنقَّل بين الشاشات.
 *
 * التشغيل: npm run verify:single
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const content = readFileSync("dist-single/khutta-maliya.html", "utf8");
const wrapped = join(tmpdir(), "khutta-single-check.html");
writeFileSync(wrapped, `<!doctype html><html><head><meta charset="utf-8"></head><body>${content}</body></html>`);

let passed = 0; const failures = [];
const expect = (label, actual, expected) => {
  if (String(actual).trim() === String(expected).trim()) { passed++; console.log(`  ✓ ${label}`); }
  else { failures.push(label); console.log(`  ✗ ${label}\n      المتوقّع: ${expected}\n      الفعلي:   ${actual}`); }
};

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ["--no-sandbox"],
});
// مقاس جوال: النسخة المشتركة تُفتح على الهاتف غالباً
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
// لا مورد خارجي إطلاقاً: النشر يمنع الاتصال بأي نطاق آخر
const external = [];
page.on("request", (r) => { if (!r.url().startsWith("file:")) external.push(r.url()); });

await page.goto(`file://${wrapped}`);

console.log("\n══ النسخة أحادية الملف ══");
await page.waitForSelector("text=العميل", { timeout: 15000 });
expect("التطبيق يُقلع بلا خادم (ملف واحد)", true, true);
expect("لا طلبات لموارد خارجية", external.length ? external.join(" | ") : "لا شيء", "لا شيء");
expect("الاتجاه من اليمين لليسار",
  await page.locator("div[dir=rtl]").first().count() > 0, true);

for (const screen of ["الوقائع", "الميزانية", "القراءة", "تقرير الكوتش"]) {
  await page.locator("button", { hasText: screen }).first().click();
  const alive = await page.locator("main, body").first().isVisible();
  expect(`شاشة «${screen}» تفتح`, alive, true);
}

// «القراءة» تحوي الرسم البياني — أثقل جزء وأكثره عرضة للكسر بعد الدمج
await page.locator("button", { hasText: "القراءة" }).first().click();
const chart = await page.locator("svg.recharts-surface").first()
  .waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false);
expect("الرسم البياني يظهر", chart, true);

const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
expect("لا تجاوز أفقي على 390px", overflow <= 1, true);
expect("لا أخطاء في الطرفية", errors.length ? errors.join(" | ") : "لا شيء", "لا شيء");

await browser.close();

console.log("\n" + "─".repeat(60));
if (failures.length) {
  console.log(`فشل ${failures.length} فحصاً من ${passed + failures.length}:`);
  failures.forEach((f) => console.log(`  • ${f}`));
  process.exit(1);
}
console.log(`النسخة أحادية الملف سليمة (${passed}).`);
