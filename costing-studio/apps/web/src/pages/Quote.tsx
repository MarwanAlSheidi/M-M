import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { postQuote, Quote as QuoteT, Money } from "../api/client";
import { CostWaterfall } from "../components/CostWaterfall";
import { GuardBadge } from "../components/GuardBadge";
import { SHAPTop5 } from "../components/SHAPTop5";

const fmt = (m?: Money | null) => (m ? `${m.amount_major} ${m.currency}` : "—");
const INCOTERMS = ["EXW", "FOB", "CFR", "CIF", "DAP", "DDP"];
const CURRENCIES = ["USD", "THB", "EUR", "JPY", "IDR", "VND", "OMR", "AED", "SAR"];

export default function Quote() {
  const { t, i18n } = useTranslation();
  const [req, setReq] = useState({
    product_sku: "TUNA-YF-WR", quantity: "18000", base_unit: "kg", currency: "USD", incoterm: "CFR",
    purchase_unit_price_major: "3.20", target_margin: "0.20", market_sell_per_sellable_major: "3.40",
    yield_pct: "0.55", freight_total_major: "", freight_currency: "USD", use_ml: false,
    locale: i18n.language as "en" | "ar",
  });
  const set = (k: string, v: unknown) => setReq((r) => ({ ...r, [k]: v }));
  const mut = useMutation({
    mutationFn: () => postQuote({ ...req, freight_total_major: req.freight_total_major || null }),
  });
  const q: QuoteT | undefined = mut.data;

  const text = (k: string, label: string) => (
    <label key={k} className="text-sm">
      <div className="text-slate-600">{t(label)}</div>
      <input className="border rounded p-1 w-full" dir="ltr" value={(req as Record<string, any>)[k]}
        onChange={(e) => set(k, e.target.value)} />
    </label>
  );
  const select = (k: string, label: string, opts: string[]) => (
    <label key={k} className="text-sm">
      <div className="text-slate-600">{t(label)}</div>
      <select className="border rounded p-1 w-full" value={(req as Record<string, any>)[k]}
        onChange={(e) => set(k, e.target.value)}>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">{t("newQuote")}</h1>
        <select className="border rounded p-1" value={i18n.language}
          onChange={(e) => { i18n.changeLanguage(e.target.value); set("locale", e.target.value); }}>
          <option value="en">EN</option>
          <option value="ar">AR</option>
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {text("product_sku", "sku")}
        {text("quantity", "qty")}
        {select("currency", "currency", CURRENCIES)}
        {select("incoterm", "incoterm", INCOTERMS)}
        {text("purchase_unit_price_major", "purchase")}
        {text("yield_pct", "yieldPct")}
        {text("freight_total_major", "freightTotal")}
        {select("freight_currency", "freightCurrency", CURRENCIES)}
        {text("target_margin", "margin")}
        {text("market_sell_per_sellable_major", "marketSell")}
        <label className="flex items-center gap-2 text-sm mt-5">
          <input type="checkbox" checked={req.use_ml} onChange={(e) => set("use_ml", e.target.checked)} />
          {t("useMl")}
        </label>
      </div>

      <button className="bg-slate-900 text-white px-4 py-2 rounded" onClick={() => mut.mutate()} disabled={mut.isPending}>
        {mut.isPending ? "…" : t("quote")}
      </button>
      {mut.isError && <div className="text-rose-700 text-sm">{String((mut.error as any)?.response?.data?.detail ?? mut.error)}</div>}

      {q && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <KPI label={t("landedCost")} value={fmt(q.landed_cost)} />
              <KPI label={t("perKg")} value={fmt(q.landed_cost_per_sellable_unit)} />
              <KPI label={t("buyBelow")} value={fmt(q.buy_below_threshold)} />
              <KPI label={t("sellAbove")} value={fmt(q.sell_above_threshold)} />
            </div>
            <section>
              <h2 className="font-medium mb-2">{t("provenance")}</h2>
              <CostWaterfall lines={q.lines} />
            </section>
            {q.quote_vs_forecast && (
              <section className="text-sm">
                <h2 className="font-medium mb-1">{t("anomaly")}</h2>
                <div dir="ltr" className={q.quote_vs_forecast.flag === "ok" ? "text-emerald-700" : "text-rose-700"}>
                  {q.quote_vs_forecast.quote_price} vs P50 {q.quote_vs_forecast.forecast_p50} ({q.quote_vs_forecast.pct_deviation})
                </div>
              </section>
            )}
            {q.ml_inputs.length > 0 && (
              <section>
                <h2 className="font-medium mb-2">{t("guard")}</h2>
                <table className="w-full text-sm">
                  <tbody>
                    {q.ml_inputs.map((m) => (
                      <tr key={m.field} className="border-t">
                        <td className="py-1 font-mono">{m.field}</td>
                        <td className="py-1 tabular-nums" dir="ltr">{m.predicted_value}</td>
                        <td className="py-1"><GuardBadge guard={m.guard} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
            {q.ml_skipped_reason && <p className="text-xs text-slate-500">ML: {q.ml_skipped_reason}</p>}
            <p className="text-slate-700 italic">{q.explanation}</p>
          </div>
          <aside className="space-y-4">
            <h2 className="font-medium">{t("shapTop5")}</h2>
            <SHAPTop5 items={q.shap_top5} />
          </aside>
        </div>
      )}
    </div>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg tabular-nums" dir="ltr">{value}</div>
    </div>
  );
}
