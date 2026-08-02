// المحرك الحسابي — كل معادلة موثّقة في وثيقة التسليم، القسم 4.
// يعتمد فقط على (d, horizon, id) تماماً كما في الأصل (useMemo باسم c).

const EF_BASE = { fixed: 3, mixed: 6, var: 9, season: 12 };
export const CATEGORIES = ["plan", "safe", "grow", "now", "face", "give", "hide"];

function sum(arr, get) {
  return arr.reduce((s, x) => s + (Number(get ? get(x) : x) || 0), 0);
}

export function calcIdentity(ans, cards) {
  const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
  const P = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  let answeredCount = 0;
  for (const id in ans) {
    const card = byId[id];
    const optIdx = ans[id];
    const cat = card && card.options[optIdx] && card.options[optIdx].cat;
    if (cat) {
      P[cat] += 1;
      answeredCount += 1;
    }
  }
  for (const c of CATEGORIES) {
    P[c] = answeredCount ? Math.round((P[c] / answeredCount) * 100) : 0;
  }
  const ready = answeredCount >= 10;
  const top = CATEGORIES.reduce((best, c) => (P[c] > P[best] ? c : best), CATEGORIES[0]);

  const present = ans.t1 !== undefined && ans.t2 !== undefined && ans.t1 > ans.t2;
  const frame = ans.t3 !== undefined && ans.t4 !== undefined && ans.t3 !== ans.t4;
  const incons = present || frame;

  return { P, answeredCount, ready, top, incons, present, frame };
}

export function calc(d, horizon, cards) {
  const assets = d.assets || [];
  const liabs = d.liabs || [];
  const exp = d.exp || [];
  const inc = d.inc || [];
  const goals = d.goals || [];

  const totalAssets = sum(assets);
  const totalLiabs = sum(liabs);
  const net = totalAssets - totalLiabs;

  const needs = sum(exp.filter((e) => e.type === "احتياج"), (e) => e.cost);
  const wants = sum(exp.filter((e) => e.type === "رغبة"), (e) => e.cost);
  const totalExp = needs + wants;
  const income = sum(inc, (i) => i.amount);
  const surplus = income - totalExp;
  const savingsRate = income ? surplus / income : 0;

  const needsRatio = income ? needs / income : 0;
  const wantsRatio = income ? wants / income : 0;

  const housing = sum(exp.filter((e) => e.key === "housing"), (e) => e.cost);
  const debtExp = sum(exp.filter((e) => e.key === "debt"), (e) => e.cost);
  const housingRatio = income ? housing / income : 0;
  const housingDebtRatio = income ? (housing + debtExp) / income : 0;

  // صندوق الطوارئ
  const dependentsIndex = Number(d.dependents) || 0;
  const identity = calcIdentity(d.ans || {}, cards || []);
  const behav = identity.incons || (identity.P.now || 0) >= 25 ? 1 : 0;
  const base = EF_BASE[d.income] ?? EF_BASE.mixed;
  const efRec = Math.min(12, base + dependentsIndex + behav);
  const efMonths = d.efOverride || efRec;
  const efNow = d.efNow || 0;
  const efTarget = needs * efMonths;
  const efGap = Math.max(efTarget - efNow, 0);
  const efCover = needs ? efNow / needs : 0;

  // صافي الثروة المتوقع — ستانلي ودانكو
  const age = d.age || 0;
  const expectedNet = (age * (income * 12)) / 10;
  const netRatio = expectedNet ? net / expectedNet : 0;
  const netClass = netRatio >= 2 ? "متميز" : netRatio >= 0.5 ? "متوسط" : "أقل من المتوقع";
  const netAlertActive = age >= 35;

  // الاستقلال المالي — قاعدة 4٪
  const invested = (assets[2] || 0) + (assets[3] || 0);
  const fiTarget = totalExp * 12 * 25;
  const yearsToFi = (annualContribution) => {
    let b = invested;
    let years = 0;
    while (b < fiTarget && years < 60) {
      b = b * 1.04 + annualContribution;
      years += 1;
    }
    return { years, reached: b >= fiTarget };
  };
  const fi = yearsToFi(surplus * 12);
  const fiPlus = yearsToFi(surplus * 12 + income * 12 * 0.05);

  // نطاق الأصول النامية
  const P = identity.P;
  const hs = { s: 0, m: 1, l: 2, xl: 3 }[horizon] ?? 1;
  const tilt =
    P.grow >= P.safe + 20 ? 3 : P.grow >= P.safe ? 2 : P.safe >= P.grow + 20 ? 0 : 1;
  const bandIdx = Math.min(4, Math.max(0, Math.round((hs + tilt) * 0.72)));
  const growthBand = ["0–20٪", "20–40٪", "40–60٪", "60–75٪", "75–90٪"][bandIdx];

  // محاكاة التدفق النقدي — 60 شهراً
  const dueBy = new Array(60).fill(0);
  for (const g of goals) {
    const m = Math.min(59, Math.max(0, g.m | 0));
    const due = Math.max(0, (g.cost || 0) - (g.fund || 0));
    dueBy[m] += due;
  }

  let ef = efGap;
  let pot = 0;
  let worst = 0;
  let worstShort = 0;
  let firstShort = null;
  let efDone = ef === 0 ? 0 : null;
  const capYear = [0, 0, 0, 0, 0];
  const costYear = [0, 0, 0, 0, 0];

  for (let i = 0; i < 60; i++) {
    const y = Math.floor(i / 12);
    let s = surplus;
    if (ef > 0 && s > 0) {
      const put = Math.min(ef, s);
      ef -= put;
      s -= put;
      if (ef === 0 && efDone === null) efDone = i;
    }
    pot += s;
    capYear[y] += s;
    const due = dueBy[i] || 0;
    if (due) {
      costYear[y] += due;
      pot -= due;
      if (pot < 0 && firstShort === null) firstShort = i;
    }
    if (pot < worst) worst = pot;
  }
  worstShort = Math.abs(Math.min(worst, 0));
  const endPot = pot;

  return {
    totalAssets,
    totalLiabs,
    net,
    needs,
    wants,
    totalExp,
    income,
    surplus,
    savingsRate,
    needsRatio,
    wantsRatio,
    housingRatio,
    housingDebtRatio,
    ef: { base, dependentsIndex, behav, efRec, efMonths, efTarget, efGap, efCover, efNow },
    stanley: { expectedNet, netRatio, netClass, netAlertActive },
    fi: { fiTarget, invested, ...fi },
    fiPlus: { fiTarget, invested, ...fiPlus },
    growthBand,
    identity,
    sim: {
      dueBy,
      efDone,
      firstShort,
      worstShort,
      endPot,
      capYear,
      costYear,
    },
  };
}
