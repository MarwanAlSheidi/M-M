import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'مسجدي — صيانة المساجد بأيدي أهلها',
        short_name: 'مسجدي',
        description: 'يربط أئمة المساجد في سلطنة عُمان بالمتطوّعين لصيانة بيوت الله.',
        lang: 'ar',
        dir: 'rtl',
        theme_color: '#0f5132',
        background_color: '#f7f7f5',
        display: 'standalone',
        orientation: 'portrait',
        // نسبيّان مثل `base`، وإلا فشل التثبيت عند الرفع إلى مجلّد فرعي
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
        // خرائط جوجل تُحمَّل من نطاق خارجي: تُخزَّن عند أول استعمال ولا تدخل
        // التخزين المسبق — وغيابها لا يمنع القائمة من العمل.
        runtimeCaching: [{
          urlPattern: /^https:\/\/maps\.googleapis\.com\//,
          handler: 'NetworkFirst',
          options: { cacheName: 'google-maps', expiration: { maxEntries: 40 } },
        }],
      },
    }),
  ],
  // مسارات نسبية: الرفع إلى مجلّد فرعي لا يكسر تحميل الأصول
  base: './',
  css: {
    // إعداد فارغ صريح يمنع Vite من الصعود بحثاً عن postcss.config.js — المستودع
    // يضمّ مشروعاً آخر في جذره بإعداد Tailwind، وكان البناء يلتقطه ويفشل.
    postcss: {},
  },
});
