import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import "./i18n";
import "./index.css";
import { clearSession, currentUser } from "./api/client";
import EnvelopeEditor from "./pages/EnvelopeEditor";
import ImportWizard from "./pages/ImportWizard";
import Login from "./pages/Login";
import ProductDetail from "./pages/ProductDetail";
import ProductList from "./pages/ProductList";

const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

function RequireAuth({ children }: { children: JSX.Element }) {
  const loc = useLocation();
  if (!currentUser()) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  return children;
}

function LangSwitch() {
  const { i18n } = useTranslation();
  return (
    <select aria-label="Language" className="border rounded p-1 text-sm" value={i18n.language}
      onChange={(e) => i18n.changeLanguage(e.target.value)}>
      <option value="en">EN</option>
      <option value="ar">عربي</option>
    </select>
  );
}

function Nav() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const user = currentUser();
  const link = ({ isActive }: { isActive: boolean }) => (isActive ? "font-semibold" : "text-slate-600");
  return (
    <nav className="p-3 border-b flex flex-wrap gap-4 items-center text-sm">
      <span className="font-semibold">Costing Studio</span>
      {user && (
        <>
          <NavLink to="/products" className={link}>{t("products")}</NavLink>
          <NavLink to="/import" className={link}>{t("importBom")}</NavLink>
        </>
      )}
      <span className="ms-auto flex items-center gap-3">
        {user && <span className="text-slate-500" dir="ltr">{user.email}</span>}
        <LangSwitch />
        {user && (
          <button className="underline" onClick={() => { clearSession(); qc.clear(); nav("/login"); }}>
            {t("signOut")}
          </button>
        )}
      </span>
    </nav>
  );
}

function Shell() {
  return (
    <BrowserRouter>
      <Nav />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/products" element={<RequireAuth><ProductList /></RequireAuth>} />
        <Route path="/products/:id" element={<RequireAuth><ProductDetail /></RequireAuth>} />
        <Route path="/products/:id/edit" element={<RequireAuth><EnvelopeEditor /></RequireAuth>} />
        <Route path="/import" element={<RequireAuth><ImportWizard /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/products" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}><Shell /></QueryClientProvider>
  </React.StrictMode>,
);
