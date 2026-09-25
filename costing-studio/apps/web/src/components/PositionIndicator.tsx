import { useTranslation } from "react-i18next";

import { Envelope, Position } from "../api/client";
import { formatMinor } from "../money";

// Status palette (reserved for state; always paired with an icon + label, never color alone).
export const STATUS: Record<Position, { color: string; tint: string; icon: string }> = {
  not_viable: { color: "#d03b3b", tint: "rgba(208,59,59,0.12)", icon: "✕" },
  too_low: { color: "#fab219", tint: "rgba(250,178,25,0.16)", icon: "▼" },
  attractive: { color: "#0ca30c", tint: "rgba(12,163,12,0.12)", icon: "✓" },
  too_high: { color: "#ec835a", tint: "rgba(236,131,90,0.14)", icon: "▲" },
};
const INK = "#0b0b0b", INK2 = "#52514e";

export function PositionChip({ position }: { position: Position }) {
  const { t } = useTranslation();
  const s = STATUS[position];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded border"
      style={{ borderColor: s.color, background: s.tint, color: INK }}>
      <span aria-hidden style={{ color: s.color }}>{s.icon}</span>{t(`pos_${position}`)}
    </span>
  );
}

/** Where the market reference sits against the envelope: four bands on one scale plus a marker. */
export function PositionIndicator({ env }: { env: Envelope }) {
  const { t } = useTranslation();
  const m = env.market;
  if (!m) return <p className="text-sm text-slate-500">{t("noMarket")}</p>;

  const fmt = (v: number) => formatMinor(v, env.currency);
  const lo = Math.min(env.unit_cost_minor * 0.85, m.market_reference_minor * 0.95);
  const hi = Math.max(env.ceiling_minor * 1.12, m.market_reference_minor * 1.05);
  const x = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const bands: { pos: Position; from: number; to: number }[] = [
    { pos: "not_viable", from: lo, to: env.unit_cost_minor },
    { pos: "too_low", from: env.unit_cost_minor, to: env.floor_minor },
    { pos: "attractive", from: env.floor_minor, to: env.ceiling_minor },
    { pos: "too_high", from: env.ceiling_minor, to: hi },
  ];
  const gaps: [string, number][] = [["floor", m.gap_to_floor], ["target", m.gap_to_target], ["ceiling", m.gap_to_ceiling]];

  return (
    <figure className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <PositionChip position={m.position} />
        <span className="text-sm">
          {t("marketRef")} <strong className="tabular-nums" dir="ltr">{fmt(m.market_reference_minor)}</strong>
          <span className="text-slate-500"> · {m.sources_used.join(", ")}</span>
        </span>
      </div>
      <div dir="ltr" className="relative pt-8">
        <div className="absolute top-0 flex flex-col items-center" style={{ left: `${x(m.market_reference_minor)}%`, transform: "translateX(-50%)" }}>
          <span className="text-[11px] whitespace-nowrap" style={{ color: INK }}>{t("market")}</span>
          <span aria-hidden className="text-xs leading-none" style={{ color: INK }}>▼</span>
        </div>
        <div className="relative h-7">
          {/* Bands share the marker's scale; 1px inset each side leaves the 2px surface gap. */}
          {bands.filter((b) => b.to > b.from).map((b) => (
            <div key={b.pos} title={`${t(`pos_${b.pos}`)}: ${fmt(Math.max(b.from, 0))} – ${fmt(b.to)}`}
              className="absolute inset-y-0 rounded"
              style={{ left: `calc(${x(b.from)}% + 1px)`, width: `calc(${x(b.to) - x(b.from)}% - 2px)`,
                       background: STATUS[b.pos].tint, boxShadow: `inset 0 -3px 0 ${STATUS[b.pos].color}` }} />
          ))}
          <div className="absolute inset-y-[-4px] w-0.5 rounded" style={{ left: `${x(m.market_reference_minor)}%`, background: INK }} />
        </div>
        {/* Floor sits on a second row so it never collides with the unit-cost label beside it. */}
        <div className="relative h-16 text-[11px]" style={{ color: INK2 }}>
          {([["unitCost", env.unit_cost_minor, 0], ["floor", env.floor_minor, 1], ["ceiling", env.ceiling_minor, 0]] as const).map(([k, v, row]) => (
            <span key={k} className="absolute text-center whitespace-nowrap leading-tight"
              style={{ left: `${x(v)}%`, top: row ? 32 : 4, transform: "translateX(-50%)" }}>
              {t(k)}<br /><span className="tabular-nums" style={{ color: INK }}>{fmt(v)}</span>
            </span>
          ))}
        </div>
      </div>
      <table className="text-sm">
        <tbody>
          {gaps.map(([k, g]) => (
            <tr key={k} className="border-t">
              <td className="py-1 pe-6 text-slate-600">{t("gapTo", { what: t(k) })}</td>
              <td className="py-1 tabular-nums text-end" dir="ltr">{g >= 0 ? "+" : "−"}{fmt(Math.abs(g))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
