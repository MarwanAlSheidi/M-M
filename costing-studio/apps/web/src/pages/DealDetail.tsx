import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { CostLine, getDeal, getThresholds, Money } from "../api/client";
import { CostWaterfall } from "../components/CostWaterfall";
import { ThresholdChart } from "../components/ThresholdChart";
import { exponentOf, formatMinor } from "../money";

const fmt = (m?: Money | null) => (m ? formatMinor(m.amount_minor, m.currency) : "—");
const MARGINS = ["0.10", "0.15", "0.20", "0.25", "0.30"];

export default function DealDetail() {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
  const [margin, setMargin] = useState("0.20");
  const deal = useQuery({ queryKey: ["deal", id], queryFn: () => getDeal(id) });
  const th = useQuery({ queryKey: ["thresholds", id, margin], queryFn: () => getThresholds(id, margin),
                        placeholderData: (prev) => prev });

  if (deal.isLoading) return <div className="p-6 text-slate-500">…</div>;
  if (deal.isError || !deal.data) {
    const status = (deal.error as any)?.response?.status;
    return <div className="p-6 text-rose-700">{status === 404 ? t("dealNotFound") : String(deal.error)}</div>;
  }
  const d = deal.data;
  const lines: CostLine[] = d.lines.map((l) => ({
    ...l, note: l.note ?? undefined,
    amount_major: (l.amount_minor / 10 ** exponentOf(l.currency)).toFixed(exponentOf(l.currency)),
  }));

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <Link to="/deals" className="text-sm underline text-slate-600">← {t("deals")}</Link>
        <h1 className="text-2xl font-semibold mt-1 flex items-center gap-3">
          <span className="font-mono">{d.deal_ref}</span>
          {d.is_golden && <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-900">★ {t("golden")}</span>}
        </h1>
        <div className="text-sm text-slate-600 mt-1">
          {i18n.language === "ar" ? d.name_ar : d.name_en} · <span dir="ltr">{d.deal_date}</span> ·{" "}
          <span dir="ltr">{Number(d.quantity).toLocaleString("en-US")} {d.base_unit}</span> · {d.incoterm} ·{" "}
          <span dir="ltr">{d.origin_country} → {d.dest_country}</span> · HS {d.hs_code}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI label={t("landedCost")} value={formatMinor(d.actual_landed_cost_minor, d.base_currency)} />
        <KPI label={t("perKg")} value={fmt(th.data?.landed_per_sellable)} />
        <KPI label={t("sellAbove")} value={fmt(th.data?.sell_above_threshold)} />
        <KPI label={`${t("buyBelow")} (${Math.round(Number(margin) * 100)}%)`} value={fmt(th.data?.buy_below_threshold)} />
      </div>

      <section className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-medium">{t("thresholds")}</h2>
          <label className="text-sm flex items-center gap-2">
            <span className="text-slate-600">{t("margin")}</span>
            <select className="border rounded p-1" value={margin} onChange={(e) => setMargin(e.target.value)}>
              {MARGINS.map((m) => <option key={m} value={m}>{Math.round(Number(m) * 100)}%</option>)}
            </select>
          </label>
        </div>
        {th.isError && <div className="text-rose-700 text-sm">{String((th.error as any)?.response?.data?.detail ?? th.error)}</div>}
        {th.data && (
          <div className={th.isFetching ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <ThresholdChart data={th.data} />
          </div>
        )}
      </section>

      <section>
        <h2 className="font-medium mb-2">{t("provenance")}</h2>
        <CostWaterfall lines={lines} />
      </section>

      {d.predictions.length > 0 && (
        <section>
          <h2 className="font-medium mb-2">{t("predictions")}</h2>
          <table className="text-sm">
            <tbody>
              {d.predictions.map((p, i) => (
                <tr key={i} className="border-t">
                  <td className="py-1 pe-4 font-mono">{p.target}</td>
                  <td className="py-1 pe-4 text-slate-500">{p.model_version}</td>
                  <td className="py-1 tabular-nums" dir="ltr">{p.value_minor} ({p.p10_minor ?? "—"} – {p.p90_minor ?? "—"})</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg" dir="ltr">{value}</div>
    </div>
  );
}
