/*
 * بناء نسخة بملف واحد — لمشاركتها كرابط مستقل يُفتح في المتصفّح مباشرة.
 * لا يشمل عامل الخدمة: النسخة أحادية الملف لا تُثبَّت ولا تعمل بلا إنترنت،
 * وهي للعرض والتجربة السريعة فقط. النسخة الكاملة تُبنى بـ vite.config.js.
 *
 * التشغيل: npm run build:single
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist-single",
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    // حزمة واحدة: التحميل الكسول للرسوم يُلغى هنا عمداً كي يبقى كل شيء في ملف واحد
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
