import { useState } from "react";
import { useTranslation } from "react-i18next";

import { api, errText } from "../api/client";
import { formatMinor } from "../money";

// BOM import: one row per cost element of a product (the product must already exist).
const CANONICAL: { key: string; required: boolean }[] = [
  { key: "product", required: true }, { key: "element", required: true }, { key: "unit", required: true },
  { key: "rate", required: true }, { key: "currency", required: true },
  { key: "qty_per_unit", required: false }, { key: "valid_from", required: false },
];

type Row = { row_index: number; status: string; normalized: Record<string, string>; diff_json: any;
             cost_element_id: string | null };

export default function ImportWizard() {
  const { t } = useTranslation();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [batchId, setBatchId] = useState<string>("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [colMap, setColMap] = useState<Record<string, string>>({});
  const [fmt, setFmt] = useState({ date_format: "%Y-%m-%d", dayfirst: false, decimal_sep: "." });
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ applied: number; failed: { row_index: number; error: string }[] } | null>(null);

  const guard = async (fn: () => Promise<void>) => {
    setError("");
    try { await fn(); } catch (e) { setError(errText(e)); }
  };
  const refresh = async (id = batchId) => setRows((await api.get(`/api/v1/imports/${id}/rows`)).data.items);

  const upload = (f: File) => guard(async () => {
    const fd = new FormData();
    fd.append("kind", "bom");
    fd.append("file", f);
    const d = (await api.post("/api/v1/imports", fd)).data;
    if (d.duplicate) throw new Error(`This file was already imported (batch ${d.batch_id}).`);
    setBatchId(d.batch_id); setHeaders(d.headers); setColMap(d.suggested_mapping); setStep(2);
  });
  const stage = () => guard(async () => {
    await api.post(`/api/v1/imports/${batchId}/map`, { column_map: colMap, ...fmt });
    setCounts((await api.post(`/api/v1/imports/${batchId}/stage`)).data.counts);
    await refresh(); setStep(3);
  });
  const confirm = () => guard(async () => {
    setResult((await api.post(`/api/v1/imports/${batchId}/confirm`)).data); setStep(4);
  });

  const missing = CANONICAL.filter((c) => c.required && !colMap[c.key]);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">{t("importBom")}</h1>
      <p className="text-sm text-slate-600">{t("importBomHint")}</p>
      {error && <div className="text-rose-700 text-sm">{error}</div>}

      {step === 1 && <input type="file" accept=".xlsx,.csv" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />}

      {step === 2 && (
        <div className="space-y-3" dir="ltr">
          {CANONICAL.map((c) => (
            <div key={c.key} className="grid grid-cols-2 gap-3 items-center">
              <div className="font-mono text-sm">{c.key}{c.required && <span className="text-rose-600">*</span>}</div>
              <select className="border rounded p-1" value={colMap[c.key] ?? ""}
                onChange={(e) => setColMap({ ...colMap, [c.key]: e.target.value })}>
                <option value="">—</option>
                {headers.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          ))}
          <div className="flex flex-wrap gap-4 text-sm">
            <label>Date format <input className="border rounded p-1 w-32" value={fmt.date_format}
              onChange={(e) => setFmt({ ...fmt, date_format: e.target.value })} /></label>
            <label><input type="checkbox" checked={fmt.dayfirst}
              onChange={(e) => setFmt({ ...fmt, dayfirst: e.target.checked })} /> Day first</label>
            <label>Decimal <select className="border rounded p-1" value={fmt.decimal_sep}
              onChange={(e) => setFmt({ ...fmt, decimal_sep: e.target.value })}>
              <option value=".">.</option><option value=",">,</option></select></label>
          </div>
          <button disabled={missing.length > 0} onClick={stage}
            className="bg-slate-900 text-white px-4 py-2 rounded disabled:opacity-50">{t("stage")}</button>
          {missing.length > 0 && <div className="text-rose-700 text-sm">Missing required: {missing.map((c) => c.key).join(", ")}</div>}
        </div>
      )}

      {step === 3 && counts && (
        <div className="space-y-3">
          <div className="flex gap-4 text-sm">
            <span>ok: {counts.ok}</span><span className="text-rose-700">rejected: {counts.rejected}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" dir="ltr">
              <thead><tr className="text-left text-slate-500">
                <th className="pe-3">#</th><th className="pe-3">product</th><th className="pe-3">element</th>
                <th className="pe-3">rate</th><th className="pe-3">qty</th><th>status</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const n = r.normalized || {};
                  const rep = r.diff_json?.replaces;
                  return (
                    <tr key={r.row_index} className="border-t">
                      <td className="pe-3">{r.row_index}</td>
                      <td className="pe-3">{n.product ?? "—"}</td>
                      <td className="pe-3">{n.element ?? "—"}</td>
                      <td className="pe-3 tabular-nums">{n.rate ? `${n.rate} ${n.currency}/${n.unit}` : "—"}</td>
                      <td className="pe-3 tabular-nums">{n.qty_per_unit ?? "1"}</td>
                      <td className={r.status === "rejected" ? "text-rose-700" : ""}>
                        {r.status}{r.diff_json?.error ? ` — ${r.diff_json.error}` : ""}
                        {rep && <span className="text-slate-500"> (replaces {formatMinor(rep.rate_minor, rep.currency)})</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button onClick={confirm} disabled={!counts.ok} className="bg-slate-900 text-white px-4 py-2 rounded disabled:opacity-50">
            {t("confirm")}</button>
        </div>
      )}

      {step === 4 && result && (
        <div className="space-y-2 text-sm">
          <div>{t("bomApplied", { n: result.applied })}</div>
          {result.failed.map((f) => <div key={f.row_index} className="text-rose-700">#{f.row_index}: {f.error}</div>)}
        </div>
      )}
    </div>
  );
}
