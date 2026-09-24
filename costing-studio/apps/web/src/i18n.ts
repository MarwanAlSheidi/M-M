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
  signIn: "Sign in", signOut: "Sign out", email: "Email", password: "Password",
  badLogin: "Wrong email or password.", search: "Search", golden: "Golden", all: "All",
  goldenOnly: "Golden only", notGolden: "Not golden", dealRef: "Deal", date: "Date",
  actualSellTotal: "Actual sell", noDeals: "No deals yet.", dealNotFound: "Deal not found.",
  thresholds: "Price thresholds", predictions: "Predictions", showTable: "Show as table",
  actualSell: "Actual sell / kg", targetLanded: "Max landed for {{pct}}%", thisDeal: "This deal",
  marginAtActual: "Margin at actual sell",
  thresholdCaption: "Landed cost per sellable kg ({{base}}) at other purchase prices ({{ccy}}/kg), from the deal's stored inputs",
};
const ar = {
  deals: "الصفقات", newQuote: "تسعيرة جديدة", importDeals: "استيراد الصفقات",
  landedCost: "التكلفة الإجمالية", perKg: "لكل كيلوغرام قابل للبيع", buyBelow: "شراء بأقل من",
  sellAbove: "بيع بأعلى من", provenance: "المصدر", guard: "الحماية", shapTop5: "أهم العوامل (SHAP)",
  quote: "احسب", sku: "رمز المنتج", qty: "الكمية", currency: "العملة", incoterm: "شرط التسليم",
  purchase: "سعر الشراء للوحدة", margin: "الهامش المستهدف", marketSell: "سعر البيع في السوق",
  yieldPct: "نسبة المردود", freightTotal: "إجمالي الشحن", freightCurrency: "عملة الشحن",
  useMl: "استخدام التعلم الآلي", anomaly: "السعر مقابل التوقع",
  signIn: "تسجيل الدخول", signOut: "تسجيل الخروج", email: "البريد الإلكتروني", password: "كلمة المرور",
  badLogin: "البريد الإلكتروني أو كلمة المرور غير صحيحة.", search: "بحث", golden: "مرجعية", all: "الكل",
  goldenOnly: "المرجعية فقط", notGolden: "غير المرجعية", dealRef: "الصفقة", date: "التاريخ",
  actualSellTotal: "البيع الفعلي", noDeals: "لا توجد صفقات بعد.", dealNotFound: "الصفقة غير موجودة.",
  thresholds: "حدود السعر", predictions: "التوقعات", showTable: "عرض كجدول",
  actualSell: "البيع الفعلي / كغ", targetLanded: "أقصى تكلفة لهامش {{pct}}%", thisDeal: "هذه الصفقة",
  marginAtActual: "الهامش عند سعر البيع الفعلي",
  thresholdCaption: "التكلفة الواصلة لكل كغ قابل للبيع ({{base}}) عند أسعار شراء أخرى ({{ccy}}/كغ)، من مدخلات الصفقة المحفوظة",
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
