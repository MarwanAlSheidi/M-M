import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // مسارات نسبية: البناء يعمل في أي مجلّد فرعي لا في جذر النطاق وحده.
  // بالمسار المطلق الافتراضي (/assets/…) يفشل تحميل الأصول فور رفعه إلى
  // مسار مثل example.com/khutta/ — وهي أشيع طريقة ينكسر بها نشر أول مرة.
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "خطتي المالية — الخطة الخماسية",
        short_name: "خطتي المالية",
        description: "تطبيق تخطيط مالي عربي: ميزانية، أهداف، صندوق طوارئ، ديون، وزكاة.",
        lang: "ar",
        dir: "rtl",
        theme_color: "#1A2B48",
        background_color: "#F8F9FB",
        display: "standalone",
        orientation: "portrait",
        // نسبيّان كي يعمل التثبيت من مجلّد فرعي أيضاً
        start_url: "./",
        scope: "./",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // يُخزَّن كل شيء مسبقاً — بما فيه حزمة الرسوم. التطبيق يُملأ على الجوال
        // وقد يُفتح بلا شبكة، فبقاء شاشة «القراءة» معطّلة لأن حزمتها لم تُحمَّل
        // أسوأ من تنزيل 103ك مرة واحدة في الخلفية بعد أول فتح (لا يعطّل الرسم).
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
        cleanupOutdatedCaches: true,
        // الخطوط من نطاق خارجي فلا تدخل التخزين المسبق؛ تُخزَّن عند أول استعمال
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts-stylesheets" },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  build: {
    // لا manualChunks هنا عن قصد: تسمية recharts كجزء مستقل تُدخِله في رسم
    // التحميل المسبق، فيُضيف Vite وسم modulePreload له في الـ HTML ويُحمَّل عند
    // أول فتح — أي يُلغى التحميل الكسول كاملاً. تركُ التقسيم لـ Vite يجعل
    // recharts تتبع الاستيراد الديناميكي في CashflowChart.jsx وحده.
    // يحرس هذا السلوكَ فحصٌ في scripts/verify-engine.mjs يراقب الشبكة فعلياً.
  },
});
