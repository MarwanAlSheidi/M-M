import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // مسارات نسبية: الرفع إلى مجلّد فرعي لا يكسر تحميل الأصول
  base: './',
  css: {
    // إعداد فارغ صريح يمنع Vite من الصعود بحثاً عن postcss.config.js — المستودع
    // يضمّ مشروعاً آخر في جذره بإعداد Tailwind، وكان البناء يلتقطه ويفشل.
    postcss: {},
  },
});
