/*
 * يدمج ناتج vite.config.single في صفحة واحدة قابلة للنشر كرابط مستقل.
 *
 * التشغيل: npm run build:single
 *
 * الناتج مقطع محتوى (لا مستند كامل): عنوان + أنماط + جذر + سكربت — لأن منصّات
 * النشر تغلّفه بـ<html>/<head>/<body> خاصّة بها. الاتجاه rtl مضبوط داخل التطبيق
 * نفسه (على جذر الواجهة) فلا يعتمد على وسم <html>.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = "dist-single";
const assets = readdirSync(join(OUT_DIR, "assets"));
const jsFile = assets.find((f) => f.endsWith(".js"));
const cssFile = assets.find((f) => f.endsWith(".css"));
if (!jsFile) throw new Error("لم يُعثر على حزمة جافاسكربت — هل نُفّذ البناء أولاً؟");

const css = cssFile ? readFileSync(join(OUT_DIR, "assets", cssFile), "utf8") : "";
// «</script» داخل نصوص الحزمة يُنهي وسم السكربت مبكّراً؛ الشرطة المائلة المهرَّبة
// تعني الشيء نفسه في نصوص جافاسكربت وتعابيرها النمطية، فالمعنى لا يتغيّر.
const js = readFileSync(join(OUT_DIR, "assets", jsFile), "utf8").replace(/<\/script/gi, "<\\/script");

const page = `<title>خطتي المالية — الخطة الخماسية</title>
<style>
html, body { margin: 0; height: 100%; }
${css}
</style>
<div id="root"></div>
<script type="module">
${js}
</script>
`;

writeFileSync(join(OUT_DIR, "khutta-maliya.html"), page);
console.log(`الصفحة جاهزة: ${OUT_DIR}/khutta-maliya.html — ${(page.length / 1024).toFixed(0)} كيلوبايت`);
