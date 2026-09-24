import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { listDeals } from "../api/client";
import { formatMinor } from "../money";

export default function Deals() {
  const { t, i18n } = useTranslation();
  const [q, setQ] = useState("");
  const [golden, setGolden] = useState<"" | "true" | "false">("");
  const params = { q: q.trim() || undefined, golden: golden === "" ? undefined : golden === "true" };
  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ["deals", params], queryFn: () => listDeals(params), placeholderData: (prev) => prev,
  });

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold">{t("deals")}</h1>
      <div className="flex flex-wrap gap-3 items-end text-sm">
        <label>
          <div className="text-slate-600">{t("search")}</div>
          <input className="border rounded p-1 w-56" dir="ltr" value={q} placeholder="IMP-… / SKU"
            onChange={(e) => setQ(e.target.value)} />
        </label>
        <label>
          <div className="text-slate-600">{t("golden")}</div>
          <select className="border rounded p-1" value={golden} onChange={(e) => setGolden(e.target.value as any)}>
            <option value="">{t("all")}</option>
            <option value="true">{t("goldenOnly")}</option>
            <option value="false">{t("notGolden")}</option>
          </select>
        </label>
      </div>
      {isError && <div className="text-rose-700 text-sm">{String((error as any)?.response?.data?.detail ?? error)}</div>}
      {isLoading ? <div className="text-slate-500 text-sm">…</div> : (
        <div className={`overflow-x-auto transition-opacity ${isFetching ? "opacity-60" : ""}`}>
          <table className="w-full text-sm">
            <thead className="text-slate-500 text-start">
              <tr>
                {["dealRef", "date", "sku", "qty", "incoterm", "landedCost", "actualSellTotal", ""].map((k) => (
                  <th key={k} className="py-2 pe-4 font-normal text-start">{k && t(k)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.map((d) => (
                <tr key={d.id} className="border-t hover:bg-slate-50">
                  <td className="py-2 pe-4 font-mono"><Link className="underline" to={`/deals/${d.id}`}>{d.deal_ref}</Link></td>
                  <td className="py-2 pe-4 tabular-nums" dir="ltr">{d.deal_date}</td>
                  <td className="py-2 pe-4">
                    <div className="font-mono">{d.sku}</div>
                    <div className="text-xs text-slate-500">{i18n.language === "ar" ? d.name_ar : d.name_en}</div>
                  </td>
                  <td className="py-2 pe-4 tabular-nums" dir="ltr">{Number(d.quantity).toLocaleString("en-US")} {d.base_unit}</td>
                  <td className="py-2 pe-4">{d.incoterm}</td>
                  <td className="py-2 pe-4 tabular-nums" dir="ltr">{formatMinor(d.actual_landed_cost_minor, d.base_currency)}</td>
                  <td className="py-2 pe-4 tabular-nums" dir="ltr">{formatMinor(d.actual_sell_price_minor, d.base_currency)}</td>
                  <td className="py-2">{d.is_golden && <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-900">★ {t("golden")}</span>}</td>
                </tr>
              ))}
              {data?.length === 0 && (
                <tr><td colSpan={8} className="py-6 text-center text-slate-500">
                  {t("noDeals")} <Link className="underline" to="/import">{t("importDeals")}</Link>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
