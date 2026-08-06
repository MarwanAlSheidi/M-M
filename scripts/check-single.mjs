/*
 * يفحص المستند المستقل كما يفتحه المستخدم فعلاً: الملف نفسه بالنقر عليه، بلا أي
 * تغليف يضيف ما ينقصه — فالتغليف في الفحص هو ما أخفى سابقاً أن الملف المُرسَل كان
 * مقطعاً ناقصاً لا مستنداً. ويُفحص مقطع النشر منفصلاً في اختبار الإطار.
 *
 * التشغيل: npm run verify:single
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FILE = resolve("dist-single/khutta-maliya.html");
const standalone = readFileSync(FILE, "utf8");
const content = readFileSync("dist-single/embed.html", "utf8");

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

await page.goto(`file://${FILE}`);

// ما ينقص المقطع ويلزم المستند: بلا doctype يدخل وضع quirks، وبلا charset قد
// يُقرأ العربي بترميز خاطئ، وبلا viewport يُعرض بعرض حاسوب على الجوال.
console.log("\n══ مستند كامل لا مقطع ══");
expect("يبدأ بـdoctype", /^<!doctype html>/i.test(standalone.trim()), true);
expect("ترميز الحروف utf-8", await page.evaluate(() => document.characterSet.toLowerCase()), "utf-8");
expect("إعداد عرض الجوال موجود", await page.locator('meta[name=viewport]').count() > 0, true);
expect("لغة المستند عربية", await page.evaluate(() => document.documentElement.lang), "ar");
expect("اتجاه المستند rtl", await page.evaluate(() => document.documentElement.dir), "rtl");
expect("ليس في وضع quirks", await page.evaluate(() => document.compatMode), "CSS1Compat");

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

// نوافذ معاينة الملفات على الجوال تعطّل الجافاسكربت أحياناً. الواجب أن تُشرح
// الحالة للمستخدم لا أن تُترك الشاشة بيضاء بلا سبب ظاهر.
console.log("\n══ والجافاسكربت معطَّل (نافذة المعاينة) ══");
{
  const noJs = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
  const p = await noJs.newPage();
  await p.goto(`file://${FILE}`);
  const shown = (await p.locator("#boot").first().innerText().catch(() => "")).trim();
  expect("تظهر رسالة مفهومة لا صفحة بيضاء", shown.length > 20, true);
  expect("الرسالة ترشد لفتح الملف في متصفّح", /متصفّح/.test(shown), true);
  await noJs.close();
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
  await p.goto(`file://${FILE}`);
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
