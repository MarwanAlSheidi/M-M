import { CUR_META } from "./constants.js";

export function money(n, cur) {
  const meta = CUR_META[cur] || CUR_META.OMR;
  const v = Number.isFinite(n) ? n : 0;
  const formatted = v.toLocaleString("en-US", {
    minimumFractionDigits: meta.dec,
    maximumFractionDigits: meta.dec,
  });
  return `${formatted} ${meta.sym}`;
}

export function pct(n, digits = 1) {
  if (!Number.isFinite(n)) return "0٪";
  return `${(n * 100).toFixed(digits)}٪`;
}
