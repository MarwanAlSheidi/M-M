import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // لا manualChunks هنا عن قصد: تسمية recharts كجزء مستقل تُدخِله في رسم
    // التحميل المسبق، فيُضيف Vite وسم modulePreload له في الـ HTML ويُحمَّل عند
    // أول فتح — أي يُلغى التحميل الكسول كاملاً. تركُ التقسيم لـ Vite يجعل
    // recharts تتبع الاستيراد الديناميكي في CashflowChart.jsx وحده.
    // يحرس هذا السلوكَ فحصٌ في scripts/verify-engine.mjs يراقب الشبكة فعلياً.
  },
});
