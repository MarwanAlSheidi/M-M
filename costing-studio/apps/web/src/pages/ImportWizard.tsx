import { Fragment, useState } from "react";
import { api } from "../api/client";

const CANONICAL: { key: string; required: boolean }[] = [
  { key: "sku", required: true }, { key: "quantity", required: true },
  { key: "deal_date", required: true }, { key: "purchase_unit_price_major", required: true },
  { key: "currency", required: false }, { key: "base_unit", required: false },
  { key: "incoterm", required: false }, { key: "origin_country", required: false },
  { key: "dest_country", required: false }, { key: "supplier_name", required: false },
  { key: "buyer_name", required: false }, { key: "freight_total_major", required: false },
  { key: "freight_currency", required: false }, { key: "actual_landed_cost_major", required: false },
  { key: "actual_sell_price_major", required: false }, { key: "recorded_currency", required: false },
  { key: "recorded_freight_major", required: false }, { key: "recorded_duty_major", required: false },
  { key: "yield_pct", required: false }, { key: "hs_code", required: false },
];

type Row = { row_index: number; status: string; diff_pct: string | null; diff_json: any;
             accepted: boolean; is_golden_approved: boolean };

export default function ImportWizard() {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [batchId, setBatchId] = useState<string>("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [colMap, setColMap] = useState<Record<string, string>>({});
  const [fmt, setFmt] = useState({ date_format: "%Y-%m-%d", dayfirst: false, decimal_sep: "." });
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<any>(null);

  const guard = async (fn: () => Promise<void>) => {
    setError("");
    try { await fn(); } catch (e: any) { setError(String(e?.response?.data?.detail ?? e)); }
  };
  const refresh = async (id = batchId) => setRows((await api.get(`/api/v1/imports/${id}/rows`)).data.items);

  const upload = (f: File) => guard(async () => {
    const fd = new FormData();
    fd.append("kind", "deals");
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
  const updateRow = (i: number, patch: Record<string, boolean>) => guard(async () => {
    await api.patch(`/api/v1/imports/${batchId}/rows/${i}`, patch); await refresh();
  });
  const confirm = () => guard(async () => {
    setResult((await api.post(`/api/v1/imports/${batchId}/confirm`)).data); setStep(4);
  });

  const missing = CANONICAL.filter((c) => c.required && !colMap[c.key]);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6" dir="ltr">
      <h1 className="text-2xl font-semibold">Import deals</h1>
      {error && <div className="text-rose-700 text-sm">{error}</div>}

      {step === 1 && <input type="file" accept=".xlsx,.csv" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />}

      {step === 2 && (
        <div className="space-y-3">
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
          <div className="flex gap-4 text-sm">
            <label>Date format <input className="border rounded p-1 w-32" value={fmt.date_format}
              onChange={(e) => setFmt({ ...fmt, date_format: e.target.value })} /></label>
            <label><input type="checkbox" checked={fmt.dayfirst}
              onChange={(e) => setFmt({ ...fmt, dayfirst: e.target.checked })} /> Day first</label>
            <label>Decimal <select className="border rounded p-1" value={fmt.decimal_sep}
              onChange={(e) => setFmt({ ...fmt, decimal_sep: e.target.value })}>
              <option value=".">.</option><option value=",">,</option></select></label>
          </div>
          <button disabled={missing.length > 0} onClick={stage}
            className="bg-slate-900 text-white px-4 py-2 rounded disabled:opacity-50">Stage</button>
          {missing.length > 0 && <div className="text-rose-700 text-sm">Missing required: {missing.map((c) => c.key).join(", ")}</div>}
        </div>
      )}

      {step === 3 && counts && (
        <div className="space-y-3">
          <div className="flex gap-4 text-sm">
            <span>ok: {counts.ok}</span><span>unverified: {counts.ok_unverified}</span>
            <span className="text-amber-700">flagged: {counts.flagged}</span>
            <span className="text-rose-700">rejected: {counts.rejected}</span>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-500"><th>#</th><th>Status</th><th>Diff %</th><th>Actions</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.row_index}>
                  <tr className="border-t">
                    <td>{r.row_index}</td>
                    <td>{r.status}{r.diff_json?.error ? ` — ${r.diff_json.error}` : ""}</td>
                    <td>{r.diff_pct ?? "—"}</td>
                    <td className="space-x-3">
                      {r.status === "flagged" && (
                        <label className="text-xs"><input type="checkbox" checked={r.accepted}
                          onChange={(e) => updateRow(r.row_index, { accepted: e.target.checked })} /> accept</label>
                      )}
                      {r.status === "ok" && (
                        <label className="text-xs"><input type="checkbox" checked={r.is_golden_approved}
                          onChange={(e) => updateRow(r.row_index, { is_golden_approved: e.target.checked })} /> golden</label>
                      )}
                      <button className="text-slate-600 text-xs"
                        onClick={() => setExpanded(expanded === r.row_index ? null : r.row_index)}>diff</button>
                    </td>
                  </tr>
                  {expanded === r.row_index && r.diff_json?.lines && (
                    <tr className="bg-slate-50"><td colSpan={4}>
                      <table className="w-full text-xs">
                        <thead><tr className="text-left text-slate-500"><th>Line</th><th>Computed</th><th>Recorded</th><th>In scope</th></tr></thead>
                        <tbody>
                          {r.diff_json.lines.map((l: any) => (
                            <tr key={l.type} className={l.in_scope ? "font-medium" : "text-slate-500"}>
                              <td className="font-mono">{l.type}</td><td>{l.amount_minor}</td>
                              <td>{l.recorded_minor ?? "—"}</td><td>{l.in_scope ? "yes" : "no"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="text-xs mt-1">recorded {r.diff_json.recorded_minor} vs computed (scoped) {r.diff_json.computed_scoped_minor}</div>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          <button onClick={confirm} className="bg-slate-900 text-white px-4 py-2 rounded">Confirm</button>
        </div>
      )}

      {step === 4 && <div>Imported {result?.inserted} deals, {result?.golden_created} golden.</div>}
    </div>
  );
}
