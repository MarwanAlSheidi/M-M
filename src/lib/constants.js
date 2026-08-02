export const STORAGE_KEY = "khutta-maliya:v2";
export const SAVE_DEBOUNCE_MS = 700;

export const CURRENCIES = ["OMR", "AED", "SAR", "KWD", "QAR", "BHD"];

export const CUR_META = {
  OMR: { sym: "ر.ع.", dec: 3 },
  AED: { sym: "د.إ.", dec: 2 },
  SAR: { sym: "ر.س.", dec: 2 },
  KWD: { sym: "د.ك.", dec: 3 },
  QAR: { sym: "ر.ق.", dec: 2 },
  BHD: { sym: "د.ب.", dec: 3 },
};

// ترتيب ثابت — لا تُعِد ترتيبه. assets[2]=استثمارات، assets[3]=تقاعد (يدخلان حساب الاستقلال المالي)
export const ASSETS = [
  { key: "cash", label: "نقد وسيولة" },
  { key: "savings", label: "حسابات توفير وودائع" },
  { key: "invest", label: "استثمارات" },
  { key: "retire", label: "تقاعد وتأمين ادخاري" },
  { key: "realestate", label: "عقار" },
  { key: "vehicle", label: "مركبات" },
  { key: "other", label: "أصول أخرى" },
];

export const LIABS = [
  { key: "personal", label: "قروض شخصية" },
  { key: "cards", label: "بطاقات ائتمان" },
  { key: "car", label: "قرض مركبة" },
  { key: "mortgage", label: "قرض عقاري" },
  { key: "otherDebt", label: "التزامات أخرى" },
];

// exp تُقرأ بالمفتاح لا بالفهرس لأن التسميات قابلة للتحرير من قبل المستخدم
export const DEFAULT_EXPENSES = [
  { key: "housing", label: "سكن", type: "احتياج", cost: 0 },
  { key: "utilities", label: "كهرباء وماء", type: "احتياج", cost: 0 },
  { key: "telecom", label: "اتصالات وإنترنت", type: "احتياج", cost: 0 },
  { key: "groceries", label: "تموين ومقاضي", type: "احتياج", cost: 0 },
  { key: "transport", label: "مواصلات ووقود", type: "احتياج", cost: 0 },
  { key: "insurance", label: "تأمين", type: "احتياج", cost: 0 },
  { key: "debt", label: "أقساط والتزامات", type: "احتياج", cost: 0 },
  { key: "health", label: "صحة وعلاج", type: "احتياج", cost: 0 },
  { key: "education", label: "تعليم الأبناء", type: "احتياج", cost: 0 },
  { key: "entertainment", label: "ترفيه وخروجات", type: "رغبة", cost: 0 },
  { key: "shopping", label: "تسوق وملابس", type: "رغبة", cost: 0 },
  { key: "subscriptions", label: "اشتراكات", type: "رغبة", cost: 0 },
  { key: "dining", label: "مطاعم وكافيهات", type: "رغبة", cost: 0 },
  { key: "travel", label: "سفر وسياحة", type: "رغبة", cost: 0 },
];

export const DEFAULT_INCOME = [
  { label: "الدخل الأساسي", amount: 0 },
  { label: "دخل إضافي / عمل حر", amount: 0 },
  { label: "إيجارات وعوائد استثمار", amount: 0 },
  { label: "مصادر أخرى", amount: 0 },
];

export const STAGES = [
  { v: "build", l: "بناء الأساس (بداية المسار المهني)" },
  { v: "accum", l: "تراكم وبناء ثروة" },
  { v: "consol", l: "تركيز واستقرار قبل التقاعد" },
  { v: "spend", l: "صرف واستمتاع بعد التقاعد" },
  { v: "legacy", l: "إرث وتوريث" },
];

export const INCOME_TYPES = [
  { v: "fixed", l: "ثابت (راتب شهري منتظم)" },
  { v: "mixed", l: "مختلط (راتب + دخل إضافي)" },
  { v: "var", l: "متغيّر (عمل حر / عمولات)" },
  { v: "season", l: "موسمي (يتركز في أشهر معينة)" },
];

export const DEPENDENTS = [
  { v: "0", l: "بلا معالين" },
  { v: "1", l: "معال واحد" },
  { v: "2", l: "معالان" },
  { v: "3", l: "ثلاثة معالين أو أكثر" },
];

export const HORIZONS = [
  { v: "s", l: "قصير (أقل من سنتين)" },
  { v: "m", l: "متوسط (2-5 سنوات)" },
  { v: "l", l: "طويل (5-15 سنة)" },
  { v: "xl", l: "طويل جداً (أكثر من 15 سنة)" },
];

export const PRIORITIES = [
  { v: "cover", l: "تغطية الالتزامات الحالية" },
  { v: "ef", l: "بناء صندوق الطوارئ" },
  { v: "debt", l: "التخلص من الديون" },
  { v: "ret", l: "الاستعداد للتقاعد" },
  { v: "grow", l: "نمو الثروة والاستثمار" },
  { v: "legacy", l: "الإرث والعطاء" },
];

export const DEBT_METHODS = [
  { v: "avalanche", l: "الانهيار الجليدي (الأعلى فائدة أولاً)" },
  { v: "snowball", l: "كرة الثلج (الأصغر رصيداً أولاً)" },
  { v: "none", l: "لا ديون بفائدة حالياً" },
];

export const GOAL_TYPES = ["سكن", "تعليم", "زواج", "سفر", "مركبة", "طوارئ كبرى", "أعمال", "أخرى"];
export const GOAL_TIERS = ["أساسي", "مريح", "طموح"];

export const BANDS = ["0–20٪", "20–40٪", "40–60٪", "60–75٪", "75–90٪"];
