// Minor-unit exponents, mirroring packages/costing/src/costing/currencies.py (default 2).
const EXP: Record<string, number> = { OMR: 3, KWD: 3, BHD: 3, JOD: 3, TND: 3, LYD: 3, VND: 0, JPY: 0, KRW: 0 };
export const exponentOf = (ccy: string) => EXP[ccy] ?? 2;

export function formatMinor(minor: number | null | undefined, ccy: string): string {
  if (minor === null || minor === undefined) return "—";
  const e = exponentOf(ccy);
  const v = minor / 10 ** e;
  return `${v.toLocaleString("en-US", { minimumFractionDigits: e, maximumFractionDigits: e })} ${ccy}`;
}
