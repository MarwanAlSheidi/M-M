import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { errText, exportSimulationPdf, getProduct, listProducts, SimRequest, simulate, Verdict } from "../api/client";
import { PositionChip, STATUS } from "../components/PositionIndicator";
import { formatMinor } from "../money";

const SKIPJACK = "Frozen whole skipjack tuna";
const DEFAULT_PRODUCT = "Canned Light Tuna in Sunflower Oil";
const today = () => new Date().toISOString().slice(0, 10);

// Verdict chips reuse the status palette + an icon, never color alone.
const VERDICT: Record<Verdict, { color: string; tint: string; icon: string }> = {
  sellable_comfortable: STATUS.attractive,
  sellable_marginal: STATUS.too_low,
  not_sellable: STATUS.not_viable,
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "product";

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [JSON.stringify(value), ms]);
  return v;
}

/** What-if simulator: every input change re-runs the envelope + channel comparison on the server (read-only). */
export default function Simulate() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const products = useQuery({ queryKey: ["products"], queryFn: listProducts });

  const productId = useMemo(() => {
    const fromUrl = params.get("product");
    const items = products.data ?? [];
    if (fromUrl && items.some((p) => p.id === fromUrl)) return fromUrl;
    return (items.find((p) => p.name === DEFAULT_PRODUCT) ?? items[0])?.id ?? "";
  }, [params, products.data]);
  const product = useQuery({ queryKey: ["product", productId], queryFn: () => getProduct(productId),
                             enabled: !!productId });
  const hasSkipjack = !!product.data?.cost_elements.some((c) => c.name === SKIPJACK && c.current);

  const [skipjack, setSkipjack] = useState("1.40");
  const [floorPct, setFloorPct] = useState("15");
  const [targetPct, setTargetPct] = useState("30");
  const [asOf, setAsOf] = useState(today());
  // null = let the server apply its defaults (retail + import channels excluded by type); the first
  // toggle turns the ticks the user is looking at into an explicit list, which then wins as given.
  const [excluded, setExcluded] = useState<string[] | null>(null);
  useEffect(() => setExcluded(null), [productId]);

  const req: SimRequest | null = productId ? {
    product_id: productId, skipjack_usd: hasSkipjack && skipjack.trim() ? skipjack : null,
    margin_floor_pct: floorPct, margin_target_pct: targetPct, as_of: asOf,
    ...(excluded !== null ? { exclude_channels: excluded } : {}),
  } : null;
  const debounced = useDebounced(req, 300);
  const result = useQuery({
    queryKey: ["simulate", debounced], queryFn: () => simulate(debounced!), enabled: !!debounced?.product_id,
    placeholderData: (prev) => prev, retry: false,
  });
  const r = result.data;
  // the PDF is the same read-only simulation, for the inputs on screen now (not the debounced ones)
  const pdf = useMutation({
    mutationFn: () => exportSimulationPdf(req!),
    onSuccess: (blob) => saveBlob(blob, `costing-${slug(product.data?.name ?? "")}-${today()}.pdf`),
  });
  const fmt = (m: number) => (r ? formatMinor(m, r.currency) : "—");
  const field = (label: string, value: string, set: (v: string) => void, props: Record<string, unknown> = {}) => (
    <label className="text-sm block">
      <div className="text-slate-600">{label}</div>
      <input className="border rounded p-1 w-full disabled:bg-slate-100 disabled:text-slate-400" value={value}
        onChange={(e) => set(e.target.value)} {...props} />
    </label>
  );

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("simulate")}</h1>
          <p className="text-sm text-slate-600">{t("simulateHint")}</p>
        </div>
        <div className="text-end">
          <button type="button" className="border rounded px-3 py-2 text-sm disabled:opacity-50"
            disabled={!req || !r || pdf.isPending} onClick={() => pdf.mutate()}>
            {pdf.isPending ? "…" : t("downloadPdf")}
          </button>
          {pdf.isError && <div className="text-rose-700 text-xs mt-1">{errText(pdf.error)}</div>}
        </div>
      </div>
      <div className="grid md:grid-cols-[18rem_1fr] gap-8">
        <form className="space-y-3 min-w-0" onSubmit={(e) => e.preventDefault()}>
          <label className="text-sm block">
            <div className="text-slate-600">{t("product")}</div>
            <select className="border rounded p-1 w-full" value={productId}
              onChange={(e) => setParams({ product: e.target.value }, { replace: true })}>
              {products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {field(t("skipjackPrice"), skipjack, setSkipjack,
            { inputMode: "decimal", dir: "ltr", type: "number", step: "0.01", min: "0", disabled: !hasSkipjack,
              title: hasSkipjack ? "" : t("noSkipjack") })}
          {!hasSkipjack && product.data && <p className="text-xs text-slate-500">{t("noSkipjack")}</p>}
          {field(t("marginFloorPct"), floorPct, setFloorPct, { inputMode: "decimal", dir: "ltr", type: "number", step: "1", min: "0" })}
          {field(t("targetMarginPct"), targetPct, setTargetPct, { inputMode: "decimal", dir: "ltr", type: "number", step: "1", min: "0" })}
          {field(t("marketDate"), asOf, setAsOf, { type: "date" })}
          {r && r.channels.length > 0 && (
            <fieldset className="text-sm">
              <legend className="text-slate-600">{t("channelsIncluded")}</legend>
              {r.channels.map((c) => (
                <label key={c.channel} className="flex items-center gap-2">
                  {/* local state once the user has toggled (instant feedback); server defaults before that */}
                  <input type="checkbox" checked={excluded === null ? !c.excluded : !excluded.includes(c.channel)}
                    onChange={(e) => {
                      const current = excluded ?? r.channels.filter((x) => x.excluded).map((x) => x.channel);
                      setExcluded(e.target.checked ? current.filter((y) => y !== c.channel) : [...current, c.channel]);
                    }} />
                  {c.channel} <span className="text-xs text-slate-500">({t(`ct_${c.channel_type}`)})</span>
                </label>
              ))}
              {r.inputs.exclusion === "default_by_type" && (
                <p className="text-xs text-slate-500 mt-1">{t("defaultExclusionHint")}</p>
              )}
            </fieldset>
          )}
        </form>

        <section className={`space-y-6 min-w-0 transition-opacity ${result.isFetching ? "opacity-60" : ""}`} aria-live="polite">
          {result.isError && <div className="text-rose-700 text-sm">{errText(result.error)}</div>}
          {r && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {([["unitCost", r.envelope.unit_cost_minor], ["floor", r.envelope.floor_minor],
                   ["target", r.envelope.target_minor], ["ceiling", r.envelope.ceiling_minor]] as const).map(([k, v]) => (
                  <div key={k} className="border rounded p-3">
                    <div className="text-xs text-slate-500">{t(k)}</div>
                    <div className="text-lg" dir="ltr">{fmt(v)}</div>
                  </div>
                ))}
              </div>
              <p className="text-sm">
                {t("floorPriceLine")} <strong dir="ltr">{fmt(r.last_viable_sell_minor)}</strong>
                <span className="text-slate-500"> / {r.unit} · {t("sameForAllChannels")}</span>
              </p>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-slate-500">
                    <tr>{["channel", "marketRefShort", "headroom", "position", "verdict"].map((k) => (
                      <th key={k} className="py-1 pe-4 font-normal text-start">{t(k)}</th>))}</tr>
                  </thead>
                  <tbody>
                    {r.channels.map((c) => {
                      const v = VERDICT[c.verdict];
                      return (
                        <tr key={c.channel} className={`border-t ${c.excluded ? "text-slate-400" : ""}`}>
                          <td className="py-1 pe-4">{c.channel}{c.excluded && ` (${t("excluded")})`}</td>
                          <td className="py-1 pe-4 tabular-nums" dir="ltr">{fmt(c.market_ref_minor)}</td>
                          <td className="py-1 pe-4 tabular-nums" dir="ltr">{c.headroom_pct >= 0 ? "+" : ""}{c.headroom_pct.toFixed(1)}%</td>
                          <td className="py-1 pe-4"><PositionChip position={c.position} /></td>
                          <td className="py-1">
                            <span className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded border"
                              style={{ borderColor: v.color, background: v.tint }}>
                              <span aria-hidden style={{ color: v.color }}>{v.icon}</span>{t(`v_${c.verdict}`)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="border rounded p-3 text-sm">
                <div className="text-slate-500 text-xs">{t("recommendedChannel")}</div>
                <div className="text-lg">{r.recommendation ?? t("noRecommendation")}</div>
                <p className="text-xs text-slate-500 mt-1">{t("recommendationRule")}</p>
              </div>
              <p className="text-xs text-slate-500">
                {t("simAsOf", { as_of: r.as_of })}{r.inputs.margin_max_pct && ` · ${t("maxMarginFromProduct", { pct: Number(r.inputs.margin_max_pct).toFixed(0) })}`}
                {" · "}<Link className="underline" to={`/products/${r.product_id}`}>{r.product_name}</Link>
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
