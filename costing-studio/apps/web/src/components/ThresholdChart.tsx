import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { DealThresholds } from "../api/client";
import { exponentOf, formatMinor } from "../money";

// Chart tokens (light surface). One series; reference lines are solid ink hairlines, labelled
// directly, so they never read as gridlines and never rely on color.
const C = {
  surface: "#fcfcfb", grid: "#e1e0d9", axis: "#c3c2b7", muted: "#898781",
  ink2: "#52514e", ink: "#0b0b0b", series: "#2a78d6",
};
const M = { top: 24, right: 12, bottom: 40, left: 52 };

function niceTicks(lo: number, hi: number, n = 5): number[] {
  const step0 = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

interface Ref { key: string; label: string; minor: number }

export function ThresholdChart({ data }: { data: DealThresholds }) {
  const { t, i18n } = useTranslation();
  const rtl = i18n.dir() === "rtl";
  // Numbers stay left-to-right inside Arabic text (Unicode isolate).
  const iso = (v: string) => `\u2066${v}\u2069`;
  const endText = { direction: rtl ? "rtl" : "ltr", textAnchor: rtl ? "start" : "end" } as const;
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  // Draw at the container's real pixel width so text stays 11px on phones too.
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = W < 560 ? 260 : 320;
  const PW = W - M.left - M.right, PH = H - M.top - M.bottom;
  const base = data.base_currency, ccy = data.currency;
  const yDiv = 10 ** exponentOf(base);

  const pts = data.curve.map((p) => ({ x: Number(p.purchase_unit_price_major), y: p.landed_per_sellable_minor / yDiv }));
  const margin = Number(data.target_margin);
  const refs: Ref[] = [{ key: "sellAbove", label: t("sellAbove"), minor: data.sell_above_threshold.amount_minor }];
  if (data.actual_sell_per_sellable) {
    refs.push({ key: "actualSell", label: t("actualSell"), minor: data.actual_sell_per_sellable.amount_minor });
    refs.push({ key: "targetLanded", label: t("targetLanded", { pct: Math.round(margin * 100) }),
                minor: Math.round(data.actual_sell_per_sellable.amount_minor * (1 - margin)) });
  }

  const { sx, sy, xTicks, yTicks } = useMemo(() => {
    const xs = pts.map((p) => p.x), ys = [...pts.map((p) => p.y), ...refs.map((r) => r.minor / yDiv)];
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const pad = (Math.max(...ys) - Math.min(...ys)) * 0.08 || 1;
    const y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
    return {
      sx: (x: number) => M.left + ((x - x0) / (x1 - x0)) * PW,
      sy: (y: number) => M.top + (1 - (y - y0) / (y1 - y0)) * PH,
      xTicks: niceTicks(x0, x1, W < 560 ? 4 : 6), yTicks: niceTicks(y0, y1, 5),
    };
  }, [data, W]);

  const path = pts.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join("");
  const deal = { x: Number(data.purchase_unit_price_major), y: data.landed_per_sellable.amount_minor / yDiv };
  const buyBelow = data.buy_below_threshold ? Number(data.buy_below_threshold.amount_major) : null;
  const inRange = (x: number) => x >= pts[0].x && x <= pts[pts.length - 1].x;

  // Reference labels ride just above their line at the right edge; if two lines are closer
  // than a label's height, the lower label drops below its line instead of stacking.
  const refY = refs.map((r) => sy(r.minor / yDiv));
  const below = refY.map((y, i) => refY.some((o, j) => j !== i && o < y && y - o < 16));

  const onMove = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    pts.forEach((p, i) => { if (Math.abs(sx(p.x) - px) < Math.abs(sx(pts[best].x) - px)) best = i; });
    setHover(best);
  };
  const h = hover !== null ? pts[hover] : null;
  const dealIdx = pts.findIndex((p) => Math.abs(p.x - deal.x) < 1e-9);
  const marginAt = (landed: number) => data.actual_sell_per_sellable
    ? 1 - landed / (data.actual_sell_per_sellable.amount_minor / yDiv) : null;

  return (
    <figure className="space-y-2">
      <figcaption className="text-sm text-slate-600">
        {t("thresholdCaption", { base, ccy })}
      </figcaption>
      <div className="relative" dir="ltr" ref={boxRef}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block select-none touch-pan-y" role="img"
          aria-label={t("thresholdCaption", { base, ccy })} style={{ background: C.surface }}
          onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {yTicks.map((v) => (
            <g key={`y${v}`}>
              <line x1={M.left} x2={M.left + PW} y1={sy(v)} y2={sy(v)} stroke={C.grid} strokeWidth={1} />
              <text x={M.left - 8} y={sy(v)} dy="0.32em" textAnchor="end" fontSize={11} fill={C.muted}
                style={{ fontVariantNumeric: "tabular-nums" }}>{v.toFixed(exponentOf(base))}</text>
            </g>
          ))}
          {xTicks.map((v) => (
            <text key={`x${v}`} x={sx(v)} y={M.top + PH + 18} textAnchor="middle" fontSize={11} fill={C.muted}
              style={{ fontVariantNumeric: "tabular-nums" }}>{v.toFixed(2)}</text>
          ))}
          <line x1={M.left} x2={M.left + PW} y1={M.top + PH} y2={M.top + PH} stroke={C.axis} strokeWidth={1} />
          <text x={M.left + PW / 2} y={H - 4} textAnchor="middle" fontSize={11} fill={C.ink2}>
            {t("purchase")} ({ccy}/kg)
          </text>

          {refs.map((r, i) => (
            <g key={r.key}>
              <line x1={M.left} x2={M.left + PW} y1={sy(r.minor / yDiv)} y2={sy(r.minor / yDiv)}
                stroke={C.ink2} strokeWidth={1} />
              <text x={M.left + PW - 4} y={refY[i]} dy={below[i] ? "1.1em" : "-0.4em"} {...endText} fontSize={11}
                fill={C.ink2} stroke={C.surface} strokeWidth={3} paintOrder="stroke"
                style={{ fontVariantNumeric: "tabular-nums" }}>
                {r.label} <tspan fill={C.ink}>{iso(formatMinor(r.minor, base))}</tspan>
              </text>
            </g>
          ))}

          <path d={path} fill="none" stroke={C.series} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

          {buyBelow !== null && inRange(buyBelow) && (
            <g>
              <line x1={sx(buyBelow)} x2={sx(buyBelow)} y1={M.top - 4} y2={M.top + PH} stroke={C.ink2} strokeWidth={1} />
              <text x={sx(buyBelow) + 4} y={M.top - 8} fontSize={11} fill={C.ink2} direction={rtl ? "rtl" : "ltr"}
                textAnchor={rtl ? "end" : "start"}>
                {t("buyBelow")} {iso(`${buyBelow.toFixed(2)} ${ccy}`)}
              </text>
            </g>
          )}
          <circle cx={sx(deal.x)} cy={sy(deal.y)} r={5} fill={C.series} stroke={C.surface} strokeWidth={2} />
          {W >= 560 && (
            <text x={sx(deal.x) + 8} y={sy(deal.y) + 4} dy="0.8em" fontSize={11} fill={C.ink}
              stroke={C.surface} strokeWidth={3} paintOrder="stroke">{t("thisDeal")}</text>
          )}

          {h && (
            <g pointerEvents="none">
              <line x1={sx(h.x)} x2={sx(h.x)} y1={M.top} y2={M.top + PH} stroke={C.muted} strokeWidth={1} />
              <circle cx={sx(h.x)} cy={sy(h.y)} r={4} fill={C.series} stroke={C.surface} strokeWidth={2} />
            </g>
          )}
        </svg>
        {h && (
          <div dir={rtl ? "rtl" : "ltr"} className="absolute pointer-events-none bg-white border border-slate-200 rounded shadow-sm px-2 py-1 text-xs"
            style={{ left: `${(sx(h.x) / W) * 100}%`, top: 0, transform: sx(h.x) > W / 2 ? "translateX(calc(-100% - 8px))" : "translateX(8px)" }}>
            <div className="flex items-center gap-2">
              <span className="inline-block w-3 h-0.5" style={{ background: C.series }} />
              <strong className="tabular-nums" dir="ltr">{h.y.toFixed(exponentOf(base))} {base}</strong>
              {hover === dealIdx && <span className="text-slate-500">· {t("thisDeal")}</span>}
            </div>
            <div className="text-slate-500">{t("purchase")}: <span dir="ltr">{h.x.toFixed(2)} {ccy}</span></div>
            {marginAt(h.y) !== null && (
              <div className="text-slate-500">{t("marginAtActual")}: <span dir="ltr">{(marginAt(h.y)! * 100).toFixed(1)}%</span></div>
            )}
          </div>
        )}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-slate-600">{t("showTable")}</summary>
        <table className="mt-2 text-xs tabular-nums" dir="ltr">
          <thead><tr className="text-slate-500"><th className="pr-6 text-left">{t("purchase")} ({ccy})</th>
            <th className="text-left">{t("perKg")} ({base})</th></tr></thead>
          <tbody>
            {pts.map((p) => (
              <tr key={p.x} className="border-t"><td className="pr-6">{p.x.toFixed(4)}</td><td>{p.y.toFixed(exponentOf(base))}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
