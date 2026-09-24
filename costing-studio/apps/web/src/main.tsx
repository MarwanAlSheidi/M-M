import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import "./i18n";
import "./index.css";
import ImportWizard from "./pages/ImportWizard";
import Quote from "./pages/Quote";

const qc = new QueryClient();

function Shell() {
  const { t } = useTranslation();
  return (
    <BrowserRouter>
      <nav className="p-3 border-b flex gap-4 text-sm">
        <Link to="/">{t("newQuote")}</Link>
        <Link to="/import">{t("importDeals")}</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Quote />} />
        <Route path="/import" element={<ImportWizard />} />
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}><Shell /></QueryClientProvider>
  </React.StrictMode>,
);
