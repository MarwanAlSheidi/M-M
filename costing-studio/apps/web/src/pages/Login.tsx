import { FormEvent, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { login } from "../api/client";

export default function Login() {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const user = await login(email, password);
      if (user.locale && user.locale !== i18n.language) i18n.changeLanguage(user.locale);
      const next = params.get("next");
      nav(next && next.startsWith("/") && !next.startsWith("//") ? next : "/deals", { replace: true });
    } catch (err: any) {
      setError(err?.response?.status === 401 ? t("badLogin") : String(err?.response?.data?.detail ?? err));
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm border rounded p-6 space-y-4">
        <h1 className="text-xl font-semibold">{t("signIn")}</h1>
        <label className="block text-sm">
          <div className="text-slate-600">{t("email")}</div>
          <input className="border rounded p-2 w-full" dir="ltr" type="email" autoComplete="username" required
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block text-sm">
          <div className="text-slate-600">{t("password")}</div>
          <input className="border rounded p-2 w-full" dir="ltr" type="password" autoComplete="current-password" required
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div role="alert" className="text-rose-700 text-sm">{error}</div>}
        <button className="bg-slate-900 text-white px-4 py-2 rounded w-full disabled:opacity-60" disabled={busy}>
          {busy ? "…" : t("signIn")}
        </button>
      </form>
    </div>
  );
}
