/*
 * فحص العرض على الجوال (390px) — المقاس الفعلي للاستخدام: العميل يملأ خطته على
 * هاتفه، ونظام تصميم Stitch نفسه مرسوم على 390px.
 *
 * يرصد أمرين:
 *   1. التمدّد الأفقي: المحتوى العريض يتمرّر داخل حاويته، أما جسم الصفحة فلا
 *      يتمرّر أفقياً أبداً.
 *   2. بتر الحقول: خانة تعرض «50» بدل «5000» أو اسماً مبتوراً — الأخطر، لأنه
 *      لا يسبّب تمدّداً فيمرّ صامتاً.
 *
 * التشغيل: npm run verify:mobile   (يشغّل خادم المعاينة بنفسه)
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";

const PORT = 4173;
const URL = `http://localhost:${PORT}`;

const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
const stopServer = () => { try { server.kill("SIGTERM"); } catch {} };
process.on("exit", stopServer);

async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(URL); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("خادم المعاينة لم يستجب — هل نُفّذ `npm run build` أولاً؟");
}
const SCREENS = [
  ["الوقائع", "facts"], ["بطاقات القرار", "identity"], ["الأهداف", "goals"],
  ["صافي الثروة", "wealth"], ["الميزانية", "budget"], ["الكرامة المالية", "safety"],
  ["القراءة", "summary"], ["تقرير الكوتش", "report"],
];

const seed = {
  cur: "OMR", age: 32, stage: "accum", income: "mixed", dependents: "1",
  horizon: "l", priority: "grow", debtMethod: "avalanche", ans: {}, inflation: 2.5,
  goals: [
    { id: "g1", m: 2, type: "car", tier: "life", cost: 800, fund: "auto" },
    { id: "g2", m: 14, type: "edu_kids", tier: "core", cost: 2500, fund: "bonus" },
  ],
  debts: [
    { id: "d1", label: "بطاقة ائتمان", balance: 5000, apr: 24, min: 150 },
    { id: "d2", label: "قرض شخصي", balance: 2000, apr: 5, min: 80 },
  ],
  debtExtra: 200,
  assets: [800, 3000, 5000, 12000, 0, 4500, 0],
  liabs: [6500, 400, 0, 2000, 0],
  exp: [
    ["housing", "الإيجار / القسط السكني", "احتياج", 350], ["util", "الكهرباء والماء", "احتياج", 45],
    ["comm", "الاتصالات والإنترنت", "احتياج", 25], ["food", "التموين (البقالة)", "احتياج", 180],
    ["transp", "المواصلات / وقود", "احتياج", 90], ["ins", "التأمين", "احتياج", 30],
    ["debt", "أقساط القروض", "احتياج", 180], ["edu", "التعليم", "احتياج", 0],
    ["health", "الصحة والعلاج", "احتياج", 20], ["fun", "الترفيه والمطاعم", "رغبة", 120],
    ["shop", "التسوق والملابس", "رغبة", 90], ["subs", "الاشتراكات", "رغبة", 25],
    ["o1", "بند آخر", "رغبة", 0], ["o2", "بند آخر", "رغبة", 0],
  ].map(([key, label, type, cost]) => ({ key, label, type, cost })),
  inc: [
    { label: "الراتب الأساسي", amount: 1200 }, { label: "دخل إضافي / عمل حر", amount: 200 },
    { label: "عوائد استثمارات", amount: 0 }, { label: "مصدر آخر", amount: 0 },
  ],
  efNow: 1500, efOverride: 0,
  zakat: { flags: { cash: true, save: true, inv: true, ret: false, prop: false, car: false, other: false }, nisab: 2000, hawl: true },
};

await waitForServer();

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

await page.goto(URL);
await page.evaluate((d) => {
  localStorage.clear();
  localStorage.setItem("khutta-maliya:v2", JSON.stringify(d));
}, seed);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("text=العميل");

let problems = 0;
for (const [label, slug] of SCREENS) {
  await page.locator("button", { hasText: label }).first().click();
  await page.waitForTimeout(400);

  const diag = await page.evaluate(() => {
    const de = document.documentElement;
    const overflow = de.scrollWidth - de.clientWidth;
    // أي عنصر يتجاوز عرض النافذة ويسبّب التمدّد
    const guilty = [];
    for (const el of document.querySelectorAll("main *")) {
      const r = el.getBoundingClientRect();
      if (r.width > de.clientWidth + 1 && el.scrollWidth <= el.clientWidth + 1) {
        guilty.push(`${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).slice(0, 24) : ""} w=${Math.round(r.width)}`);
      }
    }
    return { overflow, guilty: [...new Set(guilty)].slice(0, 6) };
  });

  // بتر الحقول: حقل نصّي محتواه أعرض من إطاره يعرض جزءاً من القيمة فقط
  // («50» بدل «5000»). لا يسبّب تمدّداً، فيمرّ صامتاً لو لم يُفحَص صراحةً.
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll("main input")]
      .filter((el) => el.value && el.scrollWidth > el.clientWidth + 2)
      .map((el) => `${el.getAttribute("placeholder") || "حقل"}="${el.value}" (${el.clientWidth}px)`)
      .slice(0, 6));

  const bad = diag.overflow > 1 || clipped.length > 0;
  if (bad) problems++;
  const notes = [];
  if (diag.overflow > 1) notes.push(`تمدّد أفقي ${diag.overflow}px`);
  if (clipped.length) notes.push(`${clipped.length} حقل مبتور`);
  console.log(`${bad ? "✗" : "✓"} ${label.padEnd(16)} ${notes.join(" · ") || "سليم"}`);
  if (diag.overflow > 1) diag.guilty.forEach((g) => console.log(`      ← ${g}`));
  clipped.forEach((c) => console.log(`      ← مبتور: ${c}`));

  await page.screenshot({ path: `/tmp/mobile-${slug}.png`, fullPage: true });
}

console.log(problems ? `\n${problems} شاشة فيها خلل على الجوال.` : "\nكل الشاشات سليمة على 390px.");
await browser.close();
process.exit(problems ? 1 : 0);
