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

// رسالة إقلاع داخل الجذر يمحوها React عند أول رسم. فائدتها تظهر حين لا يرسم:
// بلا هذه الرسالة يكون الفشل صفحة بيضاء صامتة لا تُشخَّص عن بُعد، ومعها يظهر سبب
// العطل على الشاشة نفسها. تُلتقط أخطاء الوعود أيضاً لأن الإقلاع غير متزامن.
const page = `<title>خطتي المالية — الخطة الخماسية</title>
<style>
html, body { margin: 0; height: 100%; }
${css}
#boot { padding: 24px; font: 14px system-ui, sans-serif; color: #1A2B48; direction: rtl; }
#boot code { display: block; margin-top: 10px; font-size: 12px; color: #B4443A; word-break: break-all; }
</style>
<div id="root"><div id="boot">جارٍ التحميل…</div></div>
<script>
(function () {
  var show = function (msg) {
    var b = document.getElementById("boot");
    if (b) b.innerHTML = "تعذّر تشغيل التطبيق على هذا المتصفّح.<code></code>",
           b.querySelector("code").textContent = String(msg);
  };
  addEventListener("error", function (e) { show(e.message || e.error); });
  addEventListener("unhandledrejection", function (e) { show(e.reason); });
})();
</script>
<script type="module">
${js}
</script>
`;

writeFileSync(join(OUT_DIR, "khutta-maliya.html"), page);
console.log(`الصفحة جاهزة: ${OUT_DIR}/khutta-maliya.html — ${(page.length / 1024).toFixed(0)} كيلوبايت`);
