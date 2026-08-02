import { money, pct } from "./format.js";
import { TYPES } from "../data/types.js";

// أي عتبة جديدة تُضاف بـ add(lvl, title, detail) — الترتيب هو ترتيب الإضافة في الكود، لا فرز لاحق.
export function buildReport(d, c) {
  const flags = [];
  const add = (lvl, title, detail) => flags.push({ lvl, title, detail });

  if (c.needsRatio > 0.5) {
    add("med", "الاحتياجات تتجاوز 50٪ من الدخل", `الاحتياجات تشكّل ${pct(c.needsRatio)} من الدخل، أعلى من حد قاعدة 50/30/20.`);
  }
  if (c.wantsRatio > 0.3) {
    add("low", "الرغبات تتجاوز 30٪ من الدخل", `الرغبات تشكّل ${pct(c.wantsRatio)} من الدخل.`);
  }
  if (c.savingsRate < 0.2) {
    add("med", "معدل الادخار دون 20٪", `الفائض الحالي ${pct(c.savingsRate)} من الدخل فقط.`);
  }
  if (c.housingDebtRatio > 0.36) {
    add("high", "السكن والأقساط يتجاوزان 36٪ من الدخل", `النسبة الحالية ${pct(c.housingDebtRatio)}، وهذا يتجاوز حد قاعدة الاكتتاب العقاري 28/36.`);
  }
  if (c.ef.efGap > 0) {
    add(
      c.ef.efCover < 1 ? "high" : "med",
      "صندوق الطوارئ غير مكتمل",
      `الفجوة المتبقية ${money(c.ef.efGap, d.cur)} للوصول إلى ${c.ef.efMonths} أشهر من الاحتياجات.`
    );
  }
  if (c.stanley.netAlertActive && c.stanley.netClass === "أقل من المتوقع") {
    add("med", "صافي الثروة أقل من المتوقع لعمرك ودخلك", `النسبة الحالية ${c.stanley.netRatio.toFixed(2)} مقارنة بمعيار ستانلي ودانكو.`);
  }
  if (c.sim.firstShort !== null) {
    add("high", "التدفق النقدي يدخل في عجز خلال الخطة", `أول عجز متوقع خلال محاكاة الخمس سنوات، بأقصى عجز تراكمي ${money(c.sim.worstShort, d.cur)}.`);
  }
  if (c.identity.ready && c.identity.incons) {
    add("low", "تناقض سلوكي بين القرارات المتشابهة", "إجاباتك في بطاقات القرار تغيّرت حسب صياغة السؤال لا حسب جوهره.");
  }

  const profile = c.identity.ready ? (c.identity.incons ? TYPES.SPLIT : TYPES[c.identity.top]) : null;

  const actions = [];
  if (c.ef.efGap > 0) actions.push(`أكمل صندوق الطوارئ — الهدف ${money(c.ef.efGap, d.cur)} خلال الأشهر القادمة`);
  if (c.housingDebtRatio > 0.36) actions.push("راجع بند السكن أو أقساط الديون — النسبة الحالية تتجاوز الحد الآمن");
  if (c.sim.firstShort !== null) actions.push("أعد جدولة أحد الأهداف القريبة لتفادي العجز المتوقع في التدفق النقدي");
  if (profile) actions.push(...profile.acts.slice(0, 2));
  if (actions.length < 4) actions.push("راجع خطتك مع الكوتش كل ستة أشهر على الأقل");

  return { flags, actions: actions.slice(0, 5), profile };
}
