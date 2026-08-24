/**
 * بناءُ نسخة العرض — بلا PWA ولا عاملِ خدمة.
 *
 * صفحةٌ معزولة لا تُثبَّت ولا تعمل بلا إنترنت (هي أصلاً بلا شبكة)، وتسجيلُ
 * عاملِ خدمةٍ داخل إطارٍ معزول يفشل بلا فائدة. وكلُّ شيءٍ يُضمَّن في ملفٍّ
 * واحد: الخطوط والصور والشيفرة — فالصفحة تُنشر وحدها.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'demo',
  plugins: [react()],
  // ملفُّ postcss خارج المستودع يُلتقط بالبحث الصاعد ويُسقط البناء — والعرض
  // لا يحتاج معالجةً لاحقة أصلاً
  css: { postcss: {} },
  build: {
    outDir: '../demo-dist',
    emptyOutDir: true,
    assetsInlineLimit: 4 * 1024 * 1024, // يُضمَّن كلُّ خطٍّ وصورة
    cssCodeSplit: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
