import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const en = {
  products: "Products", product: "Product", importBom: "Import BOM", signIn: "Sign in", signOut: "Sign out",
  email: "Email", password: "Password", badLogin: "Wrong email or password.",
  name: "Name", category: "Category", base_unit: "Base unit", perUnit: "per {{unit}}", create: "Create",
  newProduct: "New product", noProducts: "No products yet.", productNotFound: "Product not found.",
  floor: "Floor", target: "Target", ceiling: "Ceiling", market: "Market", position: "Position",
  unitCost: "Unit cost", envelope: "Envelope", positionVsMarket: "Position vs market",
  envelopeCaption: "Cost per {{unit}} ({{ccy}}) by element, with the floor, target and ceiling prices",
  ceilingMirror: "No max margin set: ceiling = target + (target − floor).",
  marketRef: "Market reference", gapTo: "Gap to {{what}}", noMarket: "No fresh market prices.",
  noMarketShort: "no market data", notComputed: "not computed",
  notComputedHint: "Envelope not computed yet — press Recompute.",
  notConfiguredHint: "Add cost elements and a margin config (Edit envelope) to compute an envelope.",
  pos_attractive: "Attractive", pos_too_high: "Too high", pos_too_low: "Too low", pos_not_viable: "Not viable",
  recompute: "Recompute", editEnvelope: "Edit envelope", computeAndView: "Compute envelope",
  computedAt: "Computed {{at}} (as of {{as_of}})",
  marketPrices: "Market prices", ingestCsv: "Ingest market prices (CSV)", upload: "Upload",
  ingested: "Ingested {{n}} of {{of}} rows.",
  forecast: "Market forecast (ML)", forecastUnavailable: "Not available",
  forecastAdvisory: "Advisory only: shows where the ceiling may move; it never changes the envelope.",
  shapTop5: "Top drivers (SHAP)",
  editorHint: "Rates are per element unit; qty per {{unit}} says how much of it one {{unit}} uses. Saving a new rate or margin closes the current one from its valid-from date.",
  costElements: "Cost elements", addOrVersionElement: "Add an element, or a new rate for an existing one",
  rate: "Rate", elementUnit: "Element unit", currency: "Currency", qtyPerUnit: "Qty per {{unit}}",
  perProductUnit: "Per {{unit}}", validFrom: "Valid from", validTo: "Valid to", save: "Save",
  marginConfig: "Margin", marginHint: "Margin on price: price = unit cost ÷ (1 − margin). Leave max empty to mirror the floor.",
  minPct: "Min %", targetPct: "Target %", maxPct: "Max %", optional: "optional",
  importBomHint: "One row per cost element: product, element, unit, rate, currency, and optionally qty per product unit and valid-from date.",
  stage: "Stage", confirm: "Confirm", bomApplied: "Applied {{n}} cost elements.",
};
const ar = {
  products: "المنتجات", product: "المنتج", importBom: "استيراد قائمة المكونات", signIn: "تسجيل الدخول",
  signOut: "تسجيل الخروج", email: "البريد الإلكتروني", password: "كلمة المرور",
  badLogin: "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
  name: "الاسم", category: "الفئة", base_unit: "وحدة البيع", perUnit: "لكل {{unit}}", create: "إنشاء",
  newProduct: "منتج جديد", noProducts: "لا توجد منتجات بعد.", productNotFound: "المنتج غير موجود.",
  floor: "الحد الأدنى", target: "المستهدف", ceiling: "السقف", market: "السوق", position: "الموقع",
  unitCost: "تكلفة الوحدة", envelope: "نطاق السعر", positionVsMarket: "الموقع مقابل السوق",
  envelopeCaption: "التكلفة لكل {{unit}} ({{ccy}}) حسب العنصر، مع أسعار الحد الأدنى والمستهدف والسقف",
  ceilingMirror: "لا يوجد هامش أقصى: السقف = المستهدف + (المستهدف − الحد الأدنى).",
  marketRef: "سعر السوق المرجعي", gapTo: "الفرق عن {{what}}", noMarket: "لا توجد أسعار سوق حديثة.",
  noMarketShort: "لا بيانات سوق", notComputed: "لم يُحسب",
  notComputedHint: "لم يُحسب النطاق بعد — اضغط «إعادة الحساب».",
  notConfiguredHint: "أضف عناصر التكلفة وإعدادات الهامش (تعديل النطاق) لحساب النطاق.",
  pos_attractive: "جذّاب", pos_too_high: "مرتفع جداً", pos_too_low: "منخفض جداً", pos_not_viable: "غير مجدٍ",
  recompute: "إعادة الحساب", editEnvelope: "تعديل النطاق", computeAndView: "احسب النطاق",
  computedAt: "حُسب {{at}} (بتاريخ {{as_of}})",
  marketPrices: "أسعار السوق", ingestCsv: "إدخال أسعار السوق (CSV)", upload: "رفع",
  ingested: "أُدخل {{n}} من {{of}} صفاً.",
  forecast: "توقع السوق (تعلم آلي)", forecastUnavailable: "غير متاح",
  forecastAdvisory: "استرشادي فقط: يبيّن اتجاه السقف المحتمل ولا يغيّر النطاق.",
  shapTop5: "أهم العوامل (SHAP)",
  editorHint: "السعر لكل وحدة من العنصر، والكمية لكل {{unit}} تحدد ما تستهلكه الوحدة منه. حفظ سعر أو هامش جديد يُغلق الحالي من تاريخ السريان.",
  costElements: "عناصر التكلفة", addOrVersionElement: "أضف عنصراً، أو سعراً جديداً لعنصر موجود",
  rate: "السعر", elementUnit: "وحدة العنصر", currency: "العملة", qtyPerUnit: "الكمية لكل {{unit}}",
  perProductUnit: "لكل {{unit}}", validFrom: "ساري من", validTo: "ساري حتى", save: "حفظ",
  marginConfig: "الهامش", marginHint: "الهامش من سعر البيع: السعر = تكلفة الوحدة ÷ (1 − الهامش). اترك الأقصى فارغاً ليكون مماثلاً للحد الأدنى.",
  minPct: "الأدنى %", targetPct: "المستهدف %", maxPct: "الأقصى %", optional: "اختياري",
  importBomHint: "صف لكل عنصر تكلفة: المنتج، العنصر، الوحدة، السعر، العملة، واختيارياً الكمية لكل وحدة وتاريخ السريان.",
  stage: "تجهيز", confirm: "تأكيد", bomApplied: "طُبّق {{n}} عنصر تكلفة.",
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
