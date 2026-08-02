// هوية بصرية مؤقتة (placeholder) — إلى أن تصل رموز التصميم من Stitch.
// كل طبقة العرض تقرأ الألوان والخطوط من هنا فقط، فاستبدال القيم هنا يكفي لتبديل الهوية كاملة.
export const T = {
  color: {
    bg: "#0b1220",
    surface: "#111a2e",
    surfaceAlt: "#16213a",
    border: "#233150",
    text: "#eef2fb",
    textDim: "#9fb0cc",
    primary: "#3ba7a0",
    primaryDim: "#245f5b",
    accent: "#d9a441",
    good: "#4caf82",
    warn: "#e0a83e",
    bad: "#e2685a",
  },
  font: {
    sans: "'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, sans-serif",
    mono: "'IBM Plex Mono', 'Courier New', monospace",
  },
  size: {
    xs: 12,
    sm: 13,
    md: 15,
    lg: 18,
    xl: 22,
    xxl: 28,
  },
  radius: {
    sm: 6,
    md: 10,
    lg: 16,
    pill: 999,
  },
  shadow: {
    sm: "0 1px 2px rgba(0,0,0,.25)",
    md: "0 4px 14px rgba(0,0,0,.35)",
  },
};
