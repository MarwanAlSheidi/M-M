import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Envelope } from "../api/client";
import { formatMinor } from "../money";

// Validated categorical order (dataviz reference palette, slots 1-6); a 7th+ element folds into "other".
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"];
const OTHER = "#b8b6ae";
const INK = "#0b0b0b", INK2 = "#52514e", MUTED = "#898781", TRACK = "#f0efec";
const LABEL_H = 34, BAR_H = 24;

type Seg = { name: string; minor: number; color: string };

function segments(lines: Envelope["lines"]): Seg[] {
  const sorted = [...lines].sort((a, b) => b.amount_minor - a.amount_minor);
  const head = sorted.slice(0, SERIES.length).map((l, i) => ({ name: l.name, minor: l.amount_minor, color: SERIES[i] }));
  const rest = sorted.slice(SERIES.length);
  if (rest.length) head.push({ name: `other (${rest.length})`, minor: rest.reduce((s, l) => s + l.amount_minor, 0), color: OTHER });
  return head;
}

/** Cost composition (stacked, per product unit) with the envelope's floor / target / ceiling as three marks. */
export function EnvelopeBar({ env }: { env: Envelope }) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<string | null>(null);
  const segs = segments(env.lines);
  const max = env.ceiling_minor * 1.08;
  const pct = (m: number) => `${(m / max) * 100}%`;
  const marks = [
    { key: "floor", minor: env.floor_minor, label: t("floor") },
    { key: "target", minor: env.target_minor, label: t("target") },
    { key: "ceiling", minor: env.ceiling_minor, label: t("ceiling") },
  ];
  const fmt = (m: number) => formatMinor(m, env.currency);
  const hovered = segs.find((s) => s.name === hover);

  return (
    <figure className="space-y-3">
      <figcaption className="text-sm text-slate-600">{t("envelopeCaption", { unit: env.unit, ccy: env.currency })}</figcaption>
      {/* Floor and ceiling are labelled above the bar, target below, so neighbours never collide. */}
      <div dir="ltr" className="relative" style={{ paddingTop: LABEL_H, paddingBottom: LABEL_H }}>
        {marks.map((m) => {
          const above = m.key !== "target";
          return (
            <div key={m.key} className={`absolute flex items-center ${above ? "flex-col" : "flex-col-reverse"}`}
              style={{ left: pct(m.minor), transform: "translateX(-50%)", top: above ? 0 : LABEL_H - 4,
                       height: LABEL_H + BAR_H + 4 }}>
              <div className="text-[11px] leading-tight text-center whitespace-nowrap" style={{ color: INK2 }}>
                {m.label}<br /><span className="tabular-nums" style={{ color: INK }}>{fmt(m.minor)}</span>
              </div>
              <div className="flex-1 w-0.5 rounded" style={{ background: INK }} />
            </div>
          );
        })}
        <div className="relative rounded" style={{ height: BAR_H, background: TRACK }}>
          <div className="absolute inset-y-0 left-0 flex gap-[2px]" style={{ width: pct(env.unit_cost_minor) }}>
            {segs.map((s, i) => (
              <div key={s.name} tabIndex={0} aria-label={`${s.name} ${fmt(s.minor)}`}
                onPointerEnter={() => setHover(s.name)} onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(s.name)} onBlur={() => setHover(null)}
                className={`h-full outline-none ${i === 0 ? "rounded-l" : ""} ${i === segs.length - 1 ? "rounded-r" : ""}`}
                style={{ flexGrow: s.minor, flexBasis: 0, background: s.color, opacity: hover && hover !== s.name ? 0.55 : 1 }} />
            ))}
          </div>
        </div>
      </div>
      <div>
        <div className="mt-1 text-[11px]" style={{ color: MUTED }}>
          {t("unitCost")} <span className="tabular-nums" style={{ color: INK }}>{fmt(env.unit_cost_minor)}</span>
          {hovered && <span className="ms-3"><strong className="tabular-nums" style={{ color: INK }}>{fmt(hovered.minor)}</strong> · {hovered.name}</span>}
        </div>
      </div>
      {/* Legend doubles as the table view: every value is readable without hovering. */}
      <table className="text-sm w-full max-w-md">
        <tbody>
          {segs.map((s) => (
            <tr key={s.name} className="border-t">
              <td className="py-1 pe-2 w-4"><span className="inline-block w-3 h-3 rounded-sm align-middle" style={{ background: s.color }} /></td>
              <td className="py-1 pe-4">{s.name}</td>
              <td className="py-1 text-end tabular-nums" dir="ltr">{fmt(s.minor)}</td>
              <td className="py-1 ps-3 text-end tabular-nums text-slate-500" dir="ltr">{((s.minor / env.unit_cost_minor) * 100).toFixed(1)}%</td>
            </tr>
          ))}
          <tr className="border-t font-medium">
            <td /><td className="py-1">{t("unitCost")}</td>
            <td className="py-1 text-end tabular-nums" dir="ltr">{fmt(env.unit_cost_minor)}</td><td />
          </tr>
        </tbody>
      </table>
      {env.ceiling_source === "mirror" && <p className="text-xs text-slate-500">{t("ceilingMirror")}</p>}
    </figure>
  );
}
