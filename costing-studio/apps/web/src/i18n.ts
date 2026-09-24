import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const en = {
  deals: "Deals", newQuote: "New quote", importDeals: "Import deals",
  landedCost: "Landed cost", perKg: "Per sellable kg", buyBelow: "Buy below", sellAbove: "Sell above",
  provenance: "Provenance", guard: "Guard", shapTop5: "Top drivers (SHAP)", quote: "Quote",
  sku: "SKU", qty: "Quantity", currency: "Currency", incoterm: "Incoterm",
  purchase: "Purchase price / unit", margin: "Target margin", marketSell: "Market sell / sellable unit",
  yieldPct: "Yield", freightTotal: "Freight total", freightCurrency: "Freight currency", useMl: "Use ML",
  anomaly: "Quote vs forecast",
};
const ar = {
  deals: "الصفقات", newQuote: "تسعيرة جديدة", importDeals: "استيراد الصفقات",
  landedCost: "التكلفة الإجمالية", perKg: "لكل كيلوغرام قابل للبيع", buyBelow: "شراء بأقل من",
  sellAbove: "بيع بأعلى من", provenance: "المصدر", guard: "الحماية", shapTop5: "أهم العوامل (SHAP)",
  quote: "احسب", sku: "رمز المنتج", qty: "الكمية", currency: "العملة", incoterm: "شرط التسليم",
  purchase: "سعر الشراء للوحدة", margin: "الهامش المستهدف", marketSell: "سعر البيع في السوق",
  yieldPct: "نسبة المردود", freightTotal: "إجمالي الشحن", freightCurrency: "عملة الشحن",
  useMl: "استخدام التعلم الآلي", anomaly: "السعر مقابل التوقع",
};

let initial = "en";
try { initial = localStorage.getItem("locale") ?? "en"; } catch { /* storage unavailable */ }

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng: initial, fallbackLng: "en", interpolation: { escapeValue: false },
});

const applyDir = () => {
  document.documentElement.dir = i18n.language === "ar" ? "rtl" : "ltr";
  document.documentElement.lang = i18n.language;
  try { localStorage.setItem("locale", i18n.language); } catch { /* ignore */ }
};
i18n.on("languageChanged", applyDir);
applyDir();

export default i18n;
