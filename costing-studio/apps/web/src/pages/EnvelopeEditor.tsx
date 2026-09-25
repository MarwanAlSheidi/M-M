import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { addCostElement, computeEnvelope, errText, getProduct, patchProduct, setMarginConfig } from "../api/client";
import { formatMinor } from "../money";

const today = () => new Date().toISOString().slice(0, 10);
const pctToFrac = (v: string) => (Number(v) / 100).toFixed(4);
const CURRENCIES = ["OMR", "USD", "AED", "SAR", "QAR", "BHD", "KWD", "EUR", "GBP", "INR", "CNY"];

/** Admin editor for everything that shapes an envelope: product fields, cost elements, margins.
 * Rates and margins are versioned: saving a new one closes the current row at its valid-from date. */
export default function EnvelopeEditor() {
  const { id = "" } = useParams();
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const product = useQuery({ queryKey: ["product", id], queryFn: () => getProduct(id) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["product", id] });

  const [info, setInfo] = useState({ name: "", category: "", base_unit: "" });
  useEffect(() => {
    if (product.data) setInfo({ name: product.data.name, category: product.data.category, base_unit: product.data.base_unit });
  }, [product.data]);
  const saveInfo = useMutation({ mutationFn: () => patchProduct(id, info), onSuccess: refresh });

  const [el, setEl] = useState({ name: "", unit: "", rate: "", currency: "OMR", qty_per_unit: "", valid_from: today() });
  const saveEl = useMutation({
    mutationFn: () => addCostElement(id, { ...el, qty_per_unit: el.qty_per_unit || null }),
    onSuccess: () => { refresh(); setEl({ ...el, name: "", unit: "", rate: "", qty_per_unit: "" }); },
  });

  const [mg, setMg] = useState({ min: "15", target: "30", max: "45", valid_from: today() });
  const saveMg = useMutation({
    mutationFn: () => setMarginConfig(id, {
      min_pct: pctToFrac(mg.min), target_pct: pctToFrac(mg.target),
      max_pct: mg.max.trim() ? pctToFrac(mg.max) : null, valid_from: mg.valid_from }),
    onSuccess: refresh,
  });
  const compute = useMutation({
    mutationFn: () => computeEnvelope(id),
    onSuccess: (e) => { qc.setQueryData(["envelope", id], e); nav(`/products/${id}`); },
  });

  if (product.isLoading) return <div className="p-6 text-slate-500">…</div>;
  if (!product.data) return <div className="p-6 text-rose-700">{errText(product.error)}</div>;
  const p = product.data;
  const field = (label: string, value: string, set: (v: string) => void, props: Record<string, unknown> = {}) => (
    <label className="text-sm">
      <div className="text-slate-600">{label}</div>
      <input className="border rounded p-1 w-full" value={value} onChange={(e) => set(e.target.value)} {...props} />
    </label>
  );
  const onSubmit = (m: { mutate: () => void }) => (e: FormEvent) => { e.preventDefault(); m.mutate(); };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <div>
        <Link to={`/products/${id}`} className="text-sm underline text-slate-600">← {p.name}</Link>
        <h1 className="text-2xl font-semibold mt-1">{t("editEnvelope")}</h1>
        <p className="text-sm text-slate-600">{t("editorHint", { unit: p.base_unit })}</p>
      </div>

      <form onSubmit={onSubmit(saveInfo)} className="space-y-3">
        <h2 className="font-medium">{t("product")}</h2>
        <div className="grid sm:grid-cols-3 gap-3">
          {field(t("name"), info.name, (v) => setInfo({ ...info, name: v }), { required: true })}
          {field(t("category"), info.category, (v) => setInfo({ ...info, category: v }), { required: true })}
          {field(t("base_unit"), info.base_unit, (v) => setInfo({ ...info, base_unit: v }), { required: true })}
        </div>
        {saveInfo.isError && <div className="text-rose-700 text-sm">{errText(saveInfo.error)}</div>}
        <button className="border rounded px-3 py-1 text-sm">{t("save")}</button>
      </form>

      <section className="space-y-3">
        <h2 className="font-medium">{t("costElements")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-slate-500"><tr>
              {["name", "rate", "qtyPerUnit", "perProductUnit", "validFrom", "validTo"].map((k) => (
                <th key={k} className="py-1 pe-4 font-normal text-start">{t(k, { unit: p.base_unit })}</th>))}
            </tr></thead>
            <tbody>
              {p.cost_elements.map((c) => (
                <tr key={c.id} className={`border-t ${c.current ? "" : "text-slate-400"}`}>
                  <td className="py-1 pe-4">{c.name}</td>
                  <td className="py-1 pe-4 tabular-nums" dir="ltr">{formatMinor(c.rate_minor, c.currency)} / {c.unit}</td>
                  <td className="py-1 pe-4 tabular-nums" dir="ltr">{c.qty_per_unit ?? 1}</td>
                  <td className="py-1 pe-4 tabular-nums" dir="ltr">
                    {formatMinor(Math.round(c.rate_minor * Number(c.qty_per_unit ?? 1)), c.currency)}</td>
                  <td className="py-1 pe-4 tabular-nums" dir="ltr">{c.valid_from}</td>
                  <td className="py-1 pe-4 tabular-nums" dir="ltr">{c.valid_to ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form onSubmit={onSubmit(saveEl)} className="border rounded p-3 space-y-3">
          <div className="text-sm font-medium">{t("addOrVersionElement")}</div>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
            {field(t("name"), el.name, (v) => setEl({ ...el, name: v }), { required: true, list: "element-names" })}
            {field(t("elementUnit"), el.unit, (v) => setEl({ ...el, unit: v }), { required: true, placeholder: "kg, kWh…" })}
            {field(t("rate", { unit: "" }), el.rate, (v) => setEl({ ...el, rate: v }), { required: true, inputMode: "decimal", dir: "ltr" })}
            <label className="text-sm">
              <div className="text-slate-600">{t("currency")}</div>
              <select className="border rounded p-1 w-full" value={el.currency} onChange={(e) => setEl({ ...el, currency: e.target.value })}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            {field(t("qtyPerUnit", { unit: p.base_unit }), el.qty_per_unit, (v) => setEl({ ...el, qty_per_unit: v }),
              { inputMode: "decimal", dir: "ltr", placeholder: "1" })}
            {field(t("validFrom"), el.valid_from, (v) => setEl({ ...el, valid_from: v }), { type: "date", required: true })}
          </div>
          <datalist id="element-names">{[...new Set(p.cost_elements.map((c) => c.name))].map((n) => <option key={n} value={n} />)}</datalist>
          {saveEl.isError && <div className="text-rose-700 text-sm">{errText(saveEl.error)}</div>}
          <button className="bg-slate-900 text-white px-3 py-1 rounded text-sm">{t("save")}</button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">{t("marginConfig")}</h2>
        <p className="text-sm text-slate-600">{t("marginHint")}</p>
        <table className="text-sm">
          <tbody>
            {p.margin_configs.map((m) => (
              <tr key={m.id} className={`border-t ${m.current ? "" : "text-slate-400"}`}>
                <td className="py-1 pe-4 tabular-nums" dir="ltr">
                  {(m.min_pct * 100).toFixed(1)}% / {(m.target_pct * 100).toFixed(1)}% / {m.max_pct === null ? "—" : `${(m.max_pct * 100).toFixed(1)}%`}
                </td>
                <td className="py-1 pe-4 tabular-nums" dir="ltr">{m.valid_from} → {m.valid_to ?? "…"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <form onSubmit={onSubmit(saveMg)} className="border rounded p-3 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {field(t("minPct"), mg.min, (v) => setMg({ ...mg, min: v }), { required: true, inputMode: "decimal", dir: "ltr" })}
            {field(t("targetPct"), mg.target, (v) => setMg({ ...mg, target: v }), { required: true, inputMode: "decimal", dir: "ltr" })}
            {field(t("maxPct"), mg.max, (v) => setMg({ ...mg, max: v }), { inputMode: "decimal", dir: "ltr", placeholder: t("optional") })}
            {field(t("validFrom"), mg.valid_from, (v) => setMg({ ...mg, valid_from: v }), { type: "date", required: true })}
          </div>
          {saveMg.isError && <div className="text-rose-700 text-sm">{errText(saveMg.error)}</div>}
          <button className="bg-slate-900 text-white px-3 py-1 rounded text-sm">{t("save")}</button>
        </form>
      </section>

      <div className="flex items-center gap-3">
        <button className="bg-slate-900 text-white px-4 py-2 rounded disabled:opacity-60" disabled={compute.isPending}
          onClick={() => compute.mutate()}>{t("computeAndView")}</button>
        {compute.isError && <span className="text-rose-700 text-sm">{errText(compute.error)}</span>}
      </div>
    </div>
  );
}
