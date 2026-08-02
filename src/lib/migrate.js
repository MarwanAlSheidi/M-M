import { ASSETS, LIABS, DEFAULT_EXPENSES, DEFAULT_INCOME } from "./constants.js";

export function defaultData() {
  return {
    cur: "OMR",
    age: 30,
    stage: "accum",
    income: "mixed",
    dependents: "0",
    horizon: "l",
    priority: "grow",
    debtMethod: "avalanche",
    ans: {},
    goals: [],
    assets: ASSETS.map(() => 0),
    liabs: LIABS.map(() => 0),
    exp: DEFAULT_EXPENSES.map((e) => ({ ...e })),
    inc: DEFAULT_INCOME.map((i) => ({ ...i })),
    efNow: 0,
    efOverride: 0,
  };
}

// يحوّل نسخة قديمة ذات months[60] إلى goals[]، ويحذف lik/ch/risk من نسخ سابقة.
// لا تكسرها — فيها بيانات مستخدمين حقيقيين.
export function migrate(raw) {
  const base = defaultData();
  if (!raw || typeof raw !== "object") return base;

  const d = { ...base, ...raw };

  if (Array.isArray(raw.months) && !Array.isArray(raw.goals)) {
    const goals = [];
    raw.months.forEach((cost, m) => {
      const c = Number(cost) || 0;
      if (c > 0) {
        goals.push({
          id: `mig-${m}`,
          m,
          type: "أخرى",
          tier: "أساسي",
          cost: c,
          fund: 0,
        });
      }
    });
    d.goals = goals;
  }

  delete d.lik;
  delete d.ch;
  delete d.risk;
  delete d.months;

  if (!Array.isArray(d.assets) || d.assets.length !== ASSETS.length) {
    d.assets = ASSETS.map((_, i) => Number(d.assets && d.assets[i]) || 0);
  }
  if (!Array.isArray(d.liabs) || d.liabs.length !== LIABS.length) {
    d.liabs = LIABS.map((_, i) => Number(d.liabs && d.liabs[i]) || 0);
  }
  if (!Array.isArray(d.exp) || !d.exp.length) d.exp = base.exp;
  if (!Array.isArray(d.inc) || !d.inc.length) d.inc = base.inc;
  if (!Array.isArray(d.goals)) d.goals = [];
  if (!d.ans || typeof d.ans !== "object") d.ans = {};

  return d;
}
