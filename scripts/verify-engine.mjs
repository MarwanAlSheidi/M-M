/*
 * اختبار انحدار للمحرّك الحسابي.
 *
 * وثيقة التسليم (القسم 7) تنصّ: «بعد أي تعديل على المحرّك، أدخل هذا الملف وتأكد من
 * تطابق المخرجات». هذا الملف يفعل ذلك آلياً: يزرع حالة الاختبار في التخزين، يفتح
 * التطبيق في متصفّح حقيقي، ويقارن ما يُعرض فعلاً على الشاشة بالقيم المتوقّعة.
 *
 * التشغيل:  npm run verify
 *
 * لماذا عبر المتصفّح لا باستدعاء الدوال مباشرة؟ لأن المحرّك يعيش داخل المكوّن
 * (ملف واحد، كما هو مقصود)، ولأن هذا يختبر السلسلة كاملة: التخزين → الترحيل →
 * الحساب → العرض. خطأ في أي حلقة منها يظهر هنا.
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";

const PORT = 4173;
const URL = `http://localhost:${PORT}`;
const STORE_KEY = "khutta-maliya:v2";
const CLIENTS_KEY = "khutta-maliya:clients-v1";

/* ── حالة الاختبار من القسم 7 من وثيقة التسليم ────────────────────────────────
   العمر 32 · الدخل 1200 + 200 · احتياجات 920 · رغبات 235
   الأصول 800/3000/5000/12000/0/4500/0 · الالتزامات 6500/400/0/2000/0
   efNow 1500 · income "mixed" · dependents "1" · 8 أهداف بتكلفة إجمالية 24,400

   ملاحظة: الوثيقة تعطي إجمالي تكلفة الأهداف (24,400) دون توزيعها على الأشهر.
   التوزيع أدناه اجتهاد يحافظ على الإجمالي وعلى أول شهر عجز (السنة 1 · مارس).
   لذلك القيم المرتبطة بالتوزيع (أقصى عجز، الرصيد الختامي) تُقارن بما رصدناه
   من هذا التوزيع تحديداً، لا بأرقام الوثيقة — وهي موثّقة أدناه بوضوح.        */
const EXPENSES = [
  ["housing", "الإيجار / القسط السكني", "احتياج", 350],
  ["util", "الكهرباء والماء", "احتياج", 45],
  ["comm", "الاتصالات والإنترنت", "احتياج", 25],
  ["food", "التموين (البقالة)", "احتياج", 180],
  ["transp", "المواصلات / وقود", "احتياج", 90],
  ["ins", "التأمين", "احتياج", 30],
  ["debt", "أقساط القروض", "احتياج", 180],
  ["edu", "التعليم", "احتياج", 0],
  ["health", "الصحة والعلاج", "احتياج", 20],
  ["fun", "الترفيه والمطاعم", "رغبة", 120],
  ["shop", "التسوق والملابس", "رغبة", 90],
  ["subs", "الاشتراكات", "رغبة", 25],
  ["o1", "بند آخر", "رغبة", 0],
  ["o2", "بند آخر", "رغبة", 0],
];

const baseCase = () => ({
  cur: "OMR", age: 32, stage: "accum", income: "mixed", dependents: "1",
  horizon: "l", priority: "grow", debtMethod: "avalanche", ans: {},
  inflation: 0,
  goals: [
    { id: "g1", m: 2, type: "car", tier: "life", cost: 800, fund: "auto" },
    { id: "g2", m: 7, type: "travel", tier: "aspire", cost: 1200, fund: "auto" },
    { id: "g3", m: 14, type: "edu_kids", tier: "core", cost: 2500, fund: "auto" },
    { id: "g4", m: 22, type: "home_imp", tier: "aspire", cost: 3000, fund: "auto" },
    { id: "g5", m: 30, type: "hajj", tier: "life", cost: 4200, fund: "auto" },
    { id: "g6", m: 38, type: "invest", tier: "life", cost: 4300, fund: "auto" },
    { id: "g7", m: 46, type: "business", tier: "aspire", cost: 4200, fund: "auto" },
    { id: "g8", m: 54, type: "retire", tier: "core", cost: 4200, fund: "auto" },
  ],
  debts: [], debtExtra: 0,
  assets: [800, 3000, 5000, 12000, 0, 4500, 0],
  liabs: [6500, 400, 0, 2000, 0],
  exp: EXPENSES.map(([key, label, type, cost]) => ({ key, label, type, cost })),
  inc: [
    { label: "الراتب الأساسي", amount: 1200 },
    { label: "دخل إضافي / عمل حر", amount: 200 },
    { label: "عوائد استثمارات", amount: 0 },
    { label: "مصدر آخر", amount: 0 },
  ],
  efNow: 1500, efOverride: 0,
  zakat: {
    flags: { cash: true, save: true, inv: true, ret: false, prop: false, car: false, other: false },
    nisab: 0, hawl: true,
  },
});

/* ── حصّالة النتائج ───────────────────────────────────────────────────────── */
let passed = 0;
const failures = [];

function expect(label, actual, expected) {
  const ok = String(actual).trim() === String(expected).trim();
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failures.push({ label, actual, expected }); console.log(`  ✗ ${label}\n      المتوقّع: ${expected}\n      الفعلي:   ${actual}`); }
}

function expectContains(label, haystack, needle) {
  const ok = String(haystack).includes(needle);
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failures.push({ label, actual: "(غير موجود)", expected: needle }); console.log(`  ✗ ${label} — لم يُعثر على: ${needle}`); }
}

/* ── تشغيل خادم المعاينة ──────────────────────────────────────────────────── */
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  stdio: "ignore", detached: false,
});
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

/* ── التشغيل ──────────────────────────────────────────────────────────────── */
await waitForServer();

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ["--no-sandbox"],
});
// عامل الخدمة يُخزّن كل الأصول مسبقاً — بما فيها حزمة الرسم — فيُفسد فحص
// التحميل الكسول الذي يقيس ما يطلبه *التطبيق نفسه*. يُعطَّل هنا، ويُفحص سلوك
// PWA كاملاً في scripts/check-pwa.mjs بسياق منفصل.
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e)));

// الخطوط تُحمَّل من شبكة خارجية؛ فشلها لا يعني خطأً في المحرّك.
// ERR_CERT_* لا يمكن أن يصدر إلا عن مورد خارجي (الخادم المحلي http بلا شهادة أصلاً)،
// وغالباً يظهر بلا اسم النطاق حين تعترض بيئة الاختبار الشبكة بوسيط TLS خاص بها.
const isFontNoise = (t) => /fonts\.(googleapis|gstatic)|ERR_CONNECTION|ERR_CERT_|404/.test(t);
page.on("console", (m) => { if (m.type() === "error" && !isFontNoise(m.text())) consoleErrors.push(m.text()); });

await page.goto(URL);

/** يزرع خطة ويعيد تحميل الصفحة، ثم ينتقل إلى شاشة بعينها ويعيد نصّها. */
async function loadPlan(plan, screenLabel) {
  await page.evaluate(([key, clientsKey, data]) => {
    localStorage.clear();
    // خطة واحدة بالمفتاح القديم → يرحّلها التطبيق إلى العميل الأول تلقائياً
    localStorage.setItem(key, JSON.stringify(data));
    localStorage.removeItem(clientsKey);
  }, [STORE_KEY, CLIENTS_KEY, plan]);
  // domcontentloaded لا networkidle: الخطوط تُحمَّل من شبكة خارجية وقد لا تصل،
  // فانتظار سكون الشبكة يضيّع وقتاً طويلاً بلا فائدة. waitForSelector يكفي.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=العميل");
  await page.locator("button", { hasText: screenLabel }).first().click();
  await page.waitForTimeout(250);
  return page.locator("main").innerText();
}

console.log("\n══ حالة الاختبار من القسم 7 (بلا تضخّم) ══");
{
  const wealth = await loadPlan(baseCase(), "صافي الثروة");
  expectContains("صافي الثروة = 16,400", wealth, "16,400 ر.ع.");
  expectContains("المتوقّع (ستانلي ودانكو) = 53,760", wealth, "53,760 ر.ع.");
  expectContains("التصنيف: دون المتوقّع", wealth, "دون المتوقّع لعمرك ودخلك");

  const budget = await loadPlan(baseCase(), "الميزانية");
  expectContains("الفائض الشهري = 245", budget, "245 ر.ع.");
  expectContains("الاحتياجات = 65.7٪", budget, "65.7%");
  expectContains("الرغبات = 16.8٪", budget, "16.8%");
  expectContains("الادخار = 17.5٪", budget, "17.5%");
  expectContains("السكن + الأقساط = 37.9٪ (يتجاوز 36٪)", budget, "37.9%");

  const safety = await loadPlan(baseCase(), "الكرامة المالية");
  expectContains("أشهر الطوارئ الموصى بها = 7", safety, "الموصى به لملفك — 7 أشهر");
  expectContains("هدف الطوارئ = 6,440", safety, "6,440 ر.ع.");
  expectContains("فجوة الطوارئ = 4,940", safety, "4,940 ر.ع.");

  const summary = await loadPlan(baseCase(), "القراءة");
  expectContains("اكتمال الطوارئ = السنة 2 · سبتمبر", summary, "السنة 2 · سبتمبر");
  expectContains("أول شهر يعجز = السنة 1 · مارس", summary, "السنة 1 · مارس");
  // مرتبطتان بتوزيع الأهداف المُفترَض أعلاه لا بأرقام الوثيقة (انظر التعليق أعلاه)
  expectContains("أقصى عجز تراكمي = 15,865", summary, "15,865 ر.ع.");
  expectContains("الرصيد بعد 5 سنوات = -14,640", summary, "-14,640 ر.ع.");

  // الفخّ الموصوف في الوثيقة: السنة الأولى يجب أن تكون صفراً لا «ضمن الفائض»،
  // لأن الفائض يُخصَّص أولاً لإغلاق فجوة الطوارئ قبل تمويل أي هدف.
  expectContains("«المتاح فعلياً» يُحتسب بعد خصم الطوارئ (الفخّ)", summary, "بعد خصم ما ذهب لصندوق الطوارئ");

  // الرسم يُحمَّل كسولاً؛ لو انكسر الاستيراد الديناميكي لبقي البديل «جارٍ التحميل»
  // معروضاً إلى الأبد بينما تنجح كل الفحوصات النصّية أعلاه. نتأكد أنه رُسم فعلاً.
  const chartAppeared = await page.locator("main svg.recharts-surface").first()
    .waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false);
  expect("الرسم البياني (المحمَّل كسولاً) ظهر فعلاً", chartAppeared, true);
}

console.log("\n══ تعديل التضخّم ══");
{
  const zero = await loadPlan({ ...baseCase(), inflation: 0 }, "القراءة");
  expectContains("بلا تضخّم: الاسمي = الحقيقي (24,400)", zero, "24,400 ر.ع. مقابل 24,400 ر.ع. اسمياً");

  const three = await loadPlan({ ...baseCase(), inflation: 3 }, "القراءة");
  expectContains("تضخّم 3٪: الاسمي = 26,525.078", three, "24,400 ر.ع. مقابل 26,525.078 ر.ع. اسمياً");
  expectContains("تضخّم 3٪ يوسّع العجز إلى 17,990.078", three, "17,990.078 ر.ع.");
  expectContains("تضخّم 3٪ يخفض الرصيد الختامي إلى -16,765.078", three, "-16,765.078 ر.ع.");
}

console.log("\n══ حاسبة الزكاة ══");
{
  // الأصول الزكوية = نقد 800 + توفير 3000 + استثمارات 5000 = 8,800
  const belowNisab = await loadPlan(
    { ...baseCase(), zakat: { ...baseCase().zakat, nisab: 20000 } }, "صافي الثروة");
  expectContains("إجمالي الأصول الزكوية = 8,800", belowNisab, "8,800 ر.ع.");
  expectContains("دون النصاب ⇒ لا زكاة", belowNisab, "لا");

  const aboveNisab = await loadPlan(
    { ...baseCase(), zakat: { ...baseCase().zakat, nisab: 2000 } }, "صافي الثروة");
  expectContains("فوق النصاب ⇒ 2.5٪ من 8,800 = 220", aboveNisab, "220 ر.ع.");

  // بلغ النصاب لكن الحول لم يكتمل ⇒ الزكاة صفر مع تفسير. الشاشة والتقرير
  // يصوغانها بعبارتين مختلفتين، فيُفحص كلٌّ بصياغته.
  const noHawlPlan = { ...baseCase(), zakat: { ...baseCase().zakat, nisab: 2000, hawl: false } };
  const noHawl = await loadPlan(noHawlPlan, "صافي الثروة");
  expectContains("لم يكتمل الحول ⇒ الزكاة صفر", noHawl, "0 ر.ع.");
  expectContains("لم يكتمل الحول ⇒ تفسير في الشاشة", noHawl, "الحول لم يكتمل بعد");

  const noHawlReport = await loadPlan(noHawlPlan, "تقرير الكوتش");
  expectContains("لم يكتمل الحول ⇒ صفّ التقرير", noHawlReport, "لم يكتمل الحول");
}

console.log("\n══ جدول سداد الديون ══");
{
  // بطاقة 5000 بفائدة 24٪ + قرض 2000 بفائدة 5٪، دفعة إضافية 200.
  // الانهيار الجليدي يهاجم الفائدة الأعلى أولاً ⇒ فائدة إجمالية أقل من كرة الثلج.
  const withDebts = await loadPlan({
    ...baseCase(), debtExtra: 200,
    debts: [
      { id: "d1", label: "بطاقة ائتمان", balance: 5000, apr: 24, min: 150 },
      { id: "d2", label: "قرض شخصي", balance: 2000, apr: 5, min: 80 },
    ],
  }, "صافي الثروة");
  expectContains("الانهيار الجليدي: فائدة 1,052.928", withDebts, "1,052.928 ر.ع.");
  expectContains("كرة الثلج: فائدة 1,514.602", withDebts, "1,514.602 ر.ع.");
  expectContains("الانهيار الجليدي أقل كلفة بـ 461.674", withDebts, "461.674 ر.ع.");
}

console.log("\n══ اتجاه الخانات الرقمية (bidi) ══");
{
  // خانة فيها عدّة مقاطع رقمية مفصولة بمحايدات («65.7% / 16.8% / 17.5%») تنقلب
  // بصرياً إن لم يُفرَض عليها ltr، فيقرأ الكوتش الاحتياجات ادخاراً والعكس.
  // لا يكشفه فحصٌ نصّي: textContent يعيد الترتيب المنطقي مهما كان العرض. لذا
  // يُفحص الاتجاه المحسوب نفسه.
  await loadPlan(baseCase(), "تقرير الكوتش");
  const row = await page.evaluate(() => {
    const key = "توزيع 50/30/20";
    for (const el of document.querySelectorAll("main div")) {
      if (el.children.length === 2 && el.children[0].textContent.trim() === key) {
        const v = el.children[1];
        return { dir: getComputedStyle(v).direction, text: v.textContent.trim() };
      }
    }
    return null;
  });
  expect("صفّ «توزيع 50/30/20» موجود في التقرير", !!row, true);
  expect("اتجاهه ltr (وإلا انقلب ترتيب النسب بصرياً)", row && row.dir, "ltr");
  expect("ترتيبه المنطقي احتياجات/رغبات/ادخار", row && row.text, "65.7% / 16.8% / 17.5%");
}

console.log("\n══ التقرير المصدَّر (الملف الذي يصل العميل) ══");
{
  // الفحص السابق يغطّي الشاشة فقط. التقرير المصدَّر مستند مستقل بتنسيقه الخاص،
  // وهو ما يُطبع ويُشارَك فعلاً — فانقلاب اتجاه فيه أخطر، ولا يكشفه فحص الشاشة.
  await loadPlan(baseCase(), "تقرير الكوتش");
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("button", { hasText: "تنزيل التقرير" }).click(),
  ]);
  // الامتداد .html ضروري: بدونه يعرض المتصفّح الملف نصّاً خاماً فلا يوجد DOM يُقاس.
  const out = "/tmp/khutta-exported-report.html";
  fs.copyFileSync(await dl.path(), out);

  const p2 = await context.newPage();
  await p2.goto("file://" + out);
  await p2.waitForSelector("table");
  const measured = await p2.evaluate(() => {
    const res = {};
    for (const tr of document.querySelectorAll("tr")) {
      const k = tr.children[0] && tr.children[0].textContent.trim();
      if (k !== "توزيع 50/30/20" && k !== "الدخل / المصروف") continue;
      const v = tr.children[1], node = v.firstChild, r = document.createRange(), parts = [];
      for (const m of node.textContent.matchAll(/[\d.,]+%?/g)) {
        if (!/\d/.test(m[0])) continue;
        r.setStart(node, m.index); r.setEnd(node, m.index + m[0].length);
        parts.push({ t:m[0], x:r.getBoundingClientRect().left });
      }
      parts.sort((a, b) => a.x - b.x);
      res[k] = { dir:getComputedStyle(v).direction, visual:parts.map((z) => z.t).join(" | ") };
    }
    return res;
  });
  await p2.close();

  const dist = measured["توزيع 50/30/20"];
  const inc = measured["الدخل / المصروف"];
  expect("صفّ 50/30/20 موجود في الملف المصدَّر", !!dist, true);
  expect("اتجاهه ltr داخل مستند rtl", dist && dist.dir, "ltr");
  // القياس بمواضع البكسل لا بالنصّ: textContent يعيد الترتيب المنطقي دائماً
  // فينجح الفحص النصّي حتى لو ظهر مقلوباً على الورق.
  expect("ترتيبه البصري احتياجات→رغبات→ادخار", dist && dist.visual, "65.7% | 16.8% | 17.5%");
  expect("صفّ الدخل/المصروف: الدخل يسبق المصروف بصرياً", inc && inc.visual, "1,400 | 1,155");
}

console.log("\n══ التحميل الكسول لحزمة الرسم ══");
{
  // الادعاء: recharts (نحو 103ك مضغوطة) لا تُحمَّل إلا عند بلوغ شاشة «القراءة».
  // يُفحص على الشبكة مباشرة، وبعدّ الحزم لا بأسمائها: اسم الجزء يتغيّر بتغيّر
  // إعدادات التقسيم، وفحصٌ مربوط باسم يمرّ صامتاً حين يتغيّر الاسم.
  const requested = [];
  const onRequest = (r) => requested.push(r.url());
  const jsChunkCount = () =>
    new Set(requested.filter((u) => /\/assets\/[^/]+\.js(\?|$)/.test(u))).size;
  page.on("request", onRequest);

  await loadPlan(baseCase(), "الوقائع"); // شاشة بلا رسم
  const atOpen = jsChunkCount();
  expect("عند الفتح: حزمة جافاسكربت واحدة (بلا حزمة الرسم)", atOpen, 1);

  await page.locator("button", { hasText: "القراءة" }).first().click();
  const drew = await page.locator("main svg.recharts-surface").first()
    .waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false);
  expect("الرسم ظهر بعد الانتقال لشاشة القراءة", drew, true);
  expect("عند القراءة: حُمِّلت حزمة إضافية (حزمة الرسم)", jsChunkCount() > atOpen, true);

  page.off("request", onRequest);
}

console.log("\n══ الاستقلال المالي: من بلغه فعلاً ══");
{
  // حلقة الحساب تبدأ من y=1 فلا تختبر الرصيد الابتدائي، وكان شرط «الفائض موجب»
  // يسبق فحص البلوغ — فمتقاعد بمحفظة تفوق هدفه وفائض سالب (وهي بالضبط حال
  // مرحلة «الإنفاق» التي يعرضها التطبيق) يُقال له «لا فائض حالياً».
  const retiree = {
    ...baseCase(), age:62, stage:"spend", goals:[], debts:[],
    assets:[0, 0, 200000, 200000, 0, 0, 0], liabs:[0, 0, 0, 0, 0],
    exp:[{ key:"housing", label:"سكن", type:"احتياج", cost:500 },
         { key:"food", label:"تموين", type:"احتياج", cost:500 }],
    inc:[{ label:"معاش", amount:600 }], efNow:9000,
  };
  const t = await loadPlan(retiree, "القراءة"); // الهدف 300,000 والمحفظة 400,000
  expect("محفظة تغطي الهدف وفائض سالب ⇒ «تحقّق بالفعل»", /تحقّق بالفعل/.test(t), true);
  expect("ولا تظهر «لا فائض حالياً»", /لا فائض حالياً/.test(t), false);
}

console.log("\n══ استيراد نسخة (الاستعادة بعد فقد البيانات) ══");
{
  // التخزين كلّه في localStorage، فالتصدير بلا استيراد نسخةٌ لا تُستعاد.
  await loadPlan(baseCase(), "الوقائع");
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("button", { hasText: "تصدير نسخة" }).click(),
  ]);
  const backup = "/tmp/khutta-verify-backup.json";
  fs.copyFileSync(await dl.path(), backup);

  await page.evaluate(() => localStorage.clear()); // المتصفّح مسح التخزين
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=العميل");

  await page.locator("input[type=file]").setInputFiles(backup);
  await page.waitForTimeout(1500);
  const restored = await page.evaluate(() => {
    const id = JSON.parse(localStorage.getItem("khutta-maliya:active-v1"));
    return JSON.parse(localStorage.getItem("khutta-maliya:plan:" + id));
  });
  expect("الأصول تُستعاد كما هي", JSON.stringify(restored && restored.assets), JSON.stringify(baseCase().assets));
  expect("رصيد الطوارئ يُستعاد", restored && restored.efNow, 1500);
  expect("الأهداف الثمانية تُستعاد", restored && restored.goals.length, 8);

  // JSON صالح لكنه ليس خطة: migrate تملأ الفراغات فيصير خطة فارغة تبدو سليمة
  const junk = "/tmp/khutta-verify-junk.json";
  fs.writeFileSync(junk, JSON.stringify({ hello: "world" }));
  const before = await page.locator("select").first().locator("option").count();
  await page.locator("input[type=file]").setInputFiles(junk);
  await page.waitForTimeout(800);
  const after = await page.locator("select").first().locator("option").count();
  expect("ملف ليس خطة يُرفض بلا إنشاء عميل", after, before);
}

console.log("\n══ ملفات مشوّهة لا تعطب التطبيق ══");
{
  // ملف يحمل مفتاح خطة لكن بأنواع خاطئة يجتاز فحص الشكل ويصل migrate. وانهيار
  // هنا دائم لا عابر: الخطة تُحفَظ فتُقرأ عند كل إقلاع وتنهار من جديد، فلا مخرج
  // إلا مسح تخزين المتصفّح يدوياً. لذا يُفحص البقاء بعد إعادة التحميل أيضاً.
  const malformed = [
    ["exp = null", { exp:null, assets:[0,0,0,0,0,0,0] }],
    ["assets نصّ لا مصفوفة", { exp:[], assets:"hello" }],
    ["goals كائن لا مصفوفة", { exp:[], goals:{} }],
    ["ans بفهرس خارج مدى الخيارات", { exp:[], ans:{ c1:99 } }],
    ["inc رقم لا مصفوفة", { exp:[], inc:5 }],
    ["أرقام نصّية وسالبة", { exp:[], assets:["-5","x",null], efNow:"-900", age:"abc" }],
    ["debts فيها null", { exp:[], debts:[null, { balance:"abc", apr:"-3" }] }],
  ];
  const f = "/tmp/khutta-verify-malformed.json";
  for (const [label, payload] of malformed) {
    fs.writeFileSync(f, JSON.stringify(payload));
    await page.locator("input[type=file]").setInputFiles(f);
    await page.waitForTimeout(600);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    const alive = await page.locator("text=العميل").count().catch(() => 0);
    expect(`يبقى التطبيق حيّاً بعد إعادة التحميل — ${label}`, alive > 0, true);
  }
  // تنظيف: الخطط المشوّهة تراكمت كعملاء
  await page.evaluate(() => localStorage.clear());
}

console.log("\n══ أخطاء المتصفّح ══");
expect("لا أخطاء في الطرفية", consoleErrors.length ? consoleErrors.join(" | ") : "لا شيء", "لا شيء");

await browser.close();
stopServer();

/* ── الخلاصة ──────────────────────────────────────────────────────────────── */
console.log("\n" + "─".repeat(60));
if (failures.length) {
  console.log(`فشل ${failures.length} فحصاً من ${passed + failures.length}:`);
  for (const f of failures) console.log(`  • ${f.label}`);
  console.log("\nالمحرّك لا يطابق حالة الاختبار المرجعية. راجع القسم 4 و7 من وثيقة التسليم.");
  process.exit(1);
}
console.log(`نجحت كل الفحوصات (${passed}).`);
process.exit(0);
