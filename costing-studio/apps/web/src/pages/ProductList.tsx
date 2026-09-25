import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { createProduct, currentUser, errText, listProducts } from "../api/client";
import { PositionChip } from "../components/PositionIndicator";
import { formatMinor } from "../money";

export default function ProductList() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const isAdmin = ["admin", "platform_admin"].includes(currentUser()?.role ?? "");
  const products = useQuery({ queryKey: ["products"], queryFn: listProducts });
  const [form, setForm] = useState({ name: "", category: "", base_unit: "" });
  const create = useMutation({
    mutationFn: () => createProduct(form),
    onSuccess: (p) => nav(`/products/${p.id}/edit`),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate(); };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">{t("products")}</h1>
      {products.isError && <div className="text-rose-700 text-sm">{errText(products.error)}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-slate-500">
            <tr>{["product", "category", "floor", "target", "ceiling", "market", "position"].map((k) => (
              <th key={k} className="py-2 pe-4 font-normal text-start">{t(k)}</th>))}</tr>
          </thead>
          <tbody>
            {products.data?.map((p) => (
              <tr key={p.id} className="border-t hover:bg-slate-50">
                <td className="py-2 pe-4">
                  <Link className="underline" to={`/products/${p.id}`}>{p.name}</Link>
                  <div className="text-xs text-slate-500">{t("perUnit", { unit: p.base_unit })}</div>
                </td>
                <td className="py-2 pe-4">{p.category}</td>
                {[p.floor_minor, p.target_minor, p.ceiling_minor, p.market_reference_minor].map((v, i) => (
                  <td key={i} className="py-2 pe-4 tabular-nums" dir="ltr">{p.currency ? formatMinor(v, p.currency) : "—"}</td>
                ))}
                <td className="py-2">{p.position ? <PositionChip position={p.position} /> :
                  <span className="text-xs text-slate-500">{p.computed_at ? t("noMarketShort") : t("notComputed")}</span>}</td>
              </tr>
            ))}
            {products.data?.length === 0 && (
              <tr><td colSpan={7} className="py-6 text-center text-slate-500">{t("noProducts")}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {isAdmin && (
        <form onSubmit={submit} className="border rounded p-4 space-y-3 max-w-xl">
          <h2 className="font-medium">{t("newProduct")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(["name", "category", "base_unit"] as const).map((k) => (
              <label key={k} className="text-sm">
                <div className="text-slate-600">{t(k)}</div>
                <input required className="border rounded p-1 w-full" value={form[k]}
                  placeholder={k === "base_unit" ? "bag, kg, loaf…" : ""}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
              </label>
            ))}
          </div>
          {create.isError && <div className="text-rose-700 text-sm">{errText(create.error)}</div>}
          <button className="bg-slate-900 text-white px-4 py-2 rounded disabled:opacity-60" disabled={create.isPending}>
            {t("create")}
          </button>
        </form>
      )}
    </div>
  );
}
