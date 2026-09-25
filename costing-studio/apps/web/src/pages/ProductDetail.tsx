import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import {
  computeEnvelope, currentUser, errText, getForecast, getProduct, ingestMarketCsv, latestEnvelope,
} from "../api/client";
import { EnvelopeBar } from "../components/EnvelopeBar";
import { PositionIndicator } from "../components/PositionIndicator";
import { SHAPTop5 } from "../components/SHAPTop5";
import { formatMinor } from "../money";

export default function ProductDetail() {
  const { id = "" } = useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const isAdmin = ["admin", "platform_admin"].includes(currentUser()?.role ?? "");
  const product = useQuery({ queryKey: ["product", id], queryFn: () => getProduct(id) });
  const env = useQuery({ queryKey: ["envelope", id], queryFn: () => latestEnvelope(id) });
  const forecast = useQuery({ queryKey: ["forecast", id], queryFn: () => getForecast(id) });
  const recompute = useMutation({
    mutationFn: () => computeEnvelope(id),
    onSuccess: (e) => { qc.setQueryData(["envelope", id], e); qc.invalidateQueries({ queryKey: ["products"] }); },
  });
  const [source, setSource] = useState("manual");
  const [file, setFile] = useState<File | null>(null);
  const upload = useMutation({
    mutationFn: () => ingestMarketCsv(id, source, file!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["product", id] }); recompute.mutate(); },
  });

  if (product.isLoading) return <div className="p-6 text-slate-500">…</div>;
  if (product.isError || !product.data) {
    const status = (product.error as any)?.response?.status;
    return <div className="p-6 text-rose-700">{status === 404 ? t("productNotFound") : errText(product.error)}</div>;
  }
  const p = product.data;
  const e = recompute.data ?? env.data;
  const current = p.cost_elements.filter((c) => c.current);
  const margin = p.margin_configs.find((m) => m.current);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/products" className="text-sm underline text-slate-600">← {t("products")}</Link>
          <h1 className="text-2xl font-semibold mt-1">{p.name}</h1>
          <div className="text-sm text-slate-600">
            {p.category} · {t("perUnit", { unit: p.base_unit })}
            {Object.entries(p.attributes).map(([k, v]) => <span key={k}> · {k}: {String(v)}</span>)}
          </div>
        </div>
        <div className="flex gap-2">
          <Link to={`/simulate?product=${id}`} className="border rounded px-3 py-2 text-sm">{t("simulate")}</Link>
          {isAdmin && <Link to={`/products/${id}/edit`} className="border rounded px-3 py-2 text-sm">{t("editEnvelope")}</Link>}
          <button className="bg-slate-900 text-white px-3 py-2 rounded text-sm disabled:opacity-60"
            disabled={recompute.isPending} onClick={() => recompute.mutate()}>
            {recompute.isPending ? "…" : t("recompute")}
          </button>
        </div>
      </div>

      {recompute.isError && <div className="text-rose-700 text-sm">{errText(recompute.error)}</div>}
      {!e && !env.isLoading && (
        <p className="text-sm text-slate-600">
          {current.length && margin ? t("notComputedHint") : t("notConfiguredHint")}
        </p>
      )}

      {e && (
        <>
          <section className="space-y-2">
            <h2 className="font-medium">{t("envelope")}</h2>
            <EnvelopeBar env={e} />
          </section>
          <section className="space-y-2">
            <h2 className="font-medium">{t("positionVsMarket")}</h2>
            <PositionIndicator env={e} />
            <p className="text-sm text-slate-700 italic">{e.explanation}</p>
            <p className="text-xs text-slate-500">
              {t("computedAt", { at: new Date(e.computed_at).toLocaleString(), as_of: e.as_of })}
              {e.computed_by ? ` · ${e.computed_by}` : ""}
            </p>
          </section>
        </>
      )}

      <section className="grid md:grid-cols-2 gap-8">
        <div className="space-y-2">
          <h2 className="font-medium">{t("marketPrices")}</h2>
          {p.market_prices.length === 0 ? <p className="text-sm text-slate-500">{t("noMarket")}</p> : (
            <table className="text-sm w-full">
              <tbody>
                {p.market_prices.slice(0, 10).map((m) => (
                  <tr key={`${m.source}-${m.observed_at}`} className="border-t">
                    <td className="py-1 pe-3 tabular-nums" dir="ltr">{m.observed_at}</td>
                    <td className="py-1 pe-3">{m.source}</td>
                    <td className="py-1 text-end tabular-nums" dir="ltr">{formatMinor(m.price_minor, m.currency)} / {m.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {isAdmin && (
            <div className="border rounded p-3 space-y-2 text-sm">
              <div className="font-medium">{t("ingestCsv")}</div>
              <div className="text-xs text-slate-500" dir="ltr">observed_at,price,currency,unit</div>
              <div className="flex flex-wrap gap-2 items-center">
                <select className="border rounded p-1" value={source} onChange={(ev) => setSource(ev.target.value)}>
                  <option value="manual">manual</option>
                  {p.market_sources.map((s) => <option key={s.id} value={s.source}>{s.source}</option>)}
                </select>
                <input type="file" accept=".csv" onChange={(ev) => setFile(ev.target.files?.[0] ?? null)} />
                <button className="border rounded px-3 py-1 disabled:opacity-50" disabled={!file || upload.isPending}
                  onClick={() => upload.mutate()}>{t("upload")}</button>
              </div>
              {upload.isError && <div className="text-rose-700">{errText(upload.error)}</div>}
              {upload.data && <div className="text-slate-600">{t("ingested", { n: upload.data.rows, of: upload.data.received })}</div>}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <h2 className="font-medium">{t("forecast")}</h2>
          {forecast.data?.available ? (
            <>
              <div className="text-sm tabular-nums" dir="ltr">
                P10 {Number(forecast.data.p10).toFixed(3)} · <strong>P50 {Number(forecast.data.p50).toFixed(3)}</strong> ·
                P90 {Number(forecast.data.p90).toFixed(3)} {forecast.data.target_currency}/{forecast.data.target_unit}
              </div>
              <p className="text-xs text-slate-500">{t("forecastAdvisory")}</p>
              <h3 className="text-sm font-medium mt-2">{t("shapTop5")}</h3>
              <SHAPTop5 items={forecast.data.shap_top5} />
            </>
          ) : (
            <p className="text-sm text-slate-500">{t("forecastUnavailable")}: {forecast.data?.reason ?? "…"}</p>
          )}
        </div>
      </section>
    </div>
  );
}
