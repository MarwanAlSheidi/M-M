// يتحقق من محرك الحساب مقابل حالة الاختبار في وثيقة التسليم، القسم 7.
// شغّله بـ: node scripts/verify-test-case.mjs
import { calc } from "../src/lib/calc.js";
import { CARDS } from "../src/data/cards.js";

const exp = [
  { key: "housing", label: "سكن", type: "احتياج", cost: 350 },
  { key: "utilities", label: "كهرباء", type: "احتياج", cost: 45 },
  { key: "telecom", label: "اتصالات", type: "احتياج", cost: 25 },
  { key: "groceries", label: "تموين", type: "احتياج", cost: 180 },
  { key: "transport", label: "مواصلات", type: "احتياج", cost: 90 },
  { key: "insurance", label: "تأمين", type: "احتياج", cost: 30 },
  { key: "debt", label: "أقساط", type: "احتياج", cost: 180 },
  { key: "health", label: "صحة", type: "احتياج", cost: 20 },
  { key: "entertainment", label: "ترفيه", type: "رغبة", cost: 120 },
  { key: "shopping", label: "تسوق", type: "رغبة", cost: 90 },
  { key: "subscriptions", label: "اشتراكات", type: "رغبة", cost: 25 },
];

// 8 أهداف على 5 سنوات بتكلفة إجمالية 24,400 — توزيع تقريبي يضع أول استحقاق في مارس السنة الأولى (i=2)
const goals = [
  { id: "g1", m: 2, cost: 800, fund: 0 },
  { id: "g2", m: 7, cost: 1200, fund: 0 },
  { id: "g3", m: 14, cost: 2500, fund: 0 },
  { id: "g4", m: 22, cost: 3000, fund: 0 },
  { id: "g5", m: 30, cost: 4200, fund: 0 },
  { id: "g6", m: 38, cost: 4300, fund: 0 },
  { id: "g7", m: 46, cost: 4200, fund: 0 },
  { id: "g8", m: 54, cost: 4200, fund: 0 },
];
const totalGoalCost = goals.reduce((s, g) => s + g.cost, 0);

const d = {
  cur: "OMR",
  age: 32,
  income: "mixed",
  dependents: "1",
  ans: {},
  assets: [800, 3000, 5000, 12000, 0, 4500, 0],
  liabs: [6500, 400, 0, 2000, 0],
  exp,
  inc: [{ label: "دخل أساسي", amount: 1200 }, { label: "دخل إضافي", amount: 200 }],
  efNow: 1500,
  efOverride: 0,
  goals,
};

const c = calc(d, "l", CARDS);

let failed = 0;
function check(label, actual, expected, tolerance = 0) {
  const ok = typeof expected === "number" ? Math.abs(actual - expected) <= tolerance : actual === expected;
  console.log(`${ok ? "✓" : "✗"} ${label}: ${actual} ${ok ? "" : `(متوقع ${expected})`}`);
  if (!ok) failed++;
}

console.log(`(ملاحظة: توزيع الأهداف الثمانية الفعلي غير متوفر في وثيقة التسليم، إجمالي التكلفة هنا ${totalGoalCost})`);
console.log("");

check("صافي الثروة", c.net, 16400);
check("المتوقع (ستانلي)", c.stanley.expectedNet, 53760);
check("نسبة ستانلي", Number(c.stanley.netRatio.toFixed(2)), 0.31);
check("الفائض", c.surplus, 245);
check("معدل الادخار", Number((c.savingsRate * 100).toFixed(1)), 17.5);
check("احتياجات/دخل", Number((c.needsRatio * 100).toFixed(1)), 65.7);
check("رغبات/دخل", Number((c.wantsRatio * 100).toFixed(1)), 16.8);
check("فائض/دخل (٪)", Number((c.savingsRate * 100).toFixed(1)), 17.5);
check("سكن+أقساط/دخل", Number((c.housingDebtRatio * 100).toFixed(1)), 37.9);
check("أشهر الطوارئ الموصى بها", c.ef.efMonths, 7);
check("فجوة الطوارئ", c.ef.efGap, 4940);
check("اكتمال الطوارئ (شهر i)", c.sim.efDone, 20);
check("توفر السنة الأولى (الفخ!)", c.sim.capYear[0], 0);
check("توفر السنة الثانية", c.sim.capYear[1], 940);
check("توفر السنة الثالثة", c.sim.capYear[2], 2940);
check("توفر السنة الرابعة", c.sim.capYear[3], 2940);
check("توفر السنة الخامسة", c.sim.capYear[4], 2940);
check("أول شهر يعجز (i)", c.sim.firstShort, 2);

console.log("");
console.log(`أقصى عجز تراكمي (يعتمد على توزيع الأهداف الفعلي غير المتوفر): ${c.sim.worstShort}`);
console.log(`الرصيد بعد 5 سنوات (يعتمد على توزيع الأهداف الفعلي غير المتوفر): ${c.sim.endPot}`);

if (failed > 0) {
  console.error(`\n${failed} فحصاً فشل من الفحوصات المستقلة عن توزيع الأهداف.`);
  process.exit(1);
} else {
  console.log("\nكل الفحوصات المستقلة عن توزيع الأهداف الفعلي مطابقة.");
}
