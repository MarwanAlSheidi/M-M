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
// بقاؤها يعني أن React لم يرسم — وهي بديل الصفحة البيضاء الصامتة
expect("رسالة الإقلاع اختفت بعد أول رسم", await page.locator("#boot").count(), 0);
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

// منصّات المشاركة تعرض الصفحة داخل إطار يبدأ بارتفاع صفر ويكبر بحجم محتواه.
// أي قاعدة height:100% هنا تجعل المحتوى ينتظر الإطار والإطار ينتظر المحتوى:
// النتيجة صفحة بيضاء لا خطأ فيها — لذا يُقاس الارتفاع لا وجود العناصر.
console.log("\n══ داخل إطار يقيس ارتفاعه من المحتوى ══");
{
  const framed = await ctx.newPage();
  // srcdoc لا src: إطار من file:// يصير مصدراً مختلفاً فيُحجب contentDocument،
  // فيفشل القياس لا الصفحة.
  await framed.setContent(`<iframe id="f" style="width:390px;height:0;border:0"></iframe>`);
  await framed.evaluate((html) => { document.getElementById("f").srcdoc = html; }, content);
  const h = await framed.waitForFunction(() => {
    const doc = document.getElementById("f").contentDocument;
    const grown = doc && doc.documentElement.scrollHeight;
    return grown > 400 ? grown : false;
  }, null, { timeout: 15000 }).then((r) => r.jsonValue()).catch(() => 0);
  expect("المحتوى يمدّ الإطار (لا صفحة بيضاء)", h > 400, true);
  await framed.close();
}

// سفاري يمنع التخزين عن الصفحات المضمَّنة، فيرمي مجرّد قراءة localStorage.
// لو لم يُلتقط الاعتراض ماتت الواجهة قبل أول رسم وظهرت صفحة بيضاء.
console.log("\n══ والتخزين ممنوع (سفاري داخل إطار) ══");
{
  const blocked = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await blocked.addInitScript(() => {
    const boom = () => { throw new DOMException("blocked", "SecurityError"); };
    Object.defineProperty(window, "localStorage", { get: boom, configurable: true });
  });
  const p = await blocked.newPage();
  await p.goto(`file://${wrapped}`);
  const alive = await p.locator("text=العميل").first()
    .waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false);
  expect("التطبيق يظهر رغم منع التخزين", alive, true);
  await blocked.close();
}

await browser.close();

console.log("\n" + "─".repeat(60));
if (failures.length) {
  console.log(`فشل ${failures.length} فحصاً من ${passed + failures.length}:`);
  failures.forEach((f) => console.log(`  • ${f}`));
  process.exit(1);
}
console.log(`النسخة أحادية الملف سليمة (${passed}).`);
