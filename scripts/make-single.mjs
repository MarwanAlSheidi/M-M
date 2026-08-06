/*
 * يدمج ناتج vite.config.single في صفحة واحدة، بصيغتين لهدفين مختلفين.
 *
 * التشغيل: npm run build:single
 *
 * khutta-maliya.html — مستند كامل يُرسَل ويُفتح بالنقر عليه مباشرة. لا بدّ فيه من
 *   doctype (بدونه يدخل المتصفّح الوضع القديم فتفسد القياسات)، ومن meta charset
 *   (بدونه قد يُقرأ النصّ العربي بترميز قديم فيتشوّه)، ومن meta viewport (بدونه
 *   يُعرض على الجوال بعرض حاسوب مصغَّراً)، ومن lang/dir على الجذر.
 *
 * embed.html — مقطع محتوى بلا html/head/body، لأن منصّات النشر تغلّفه بهيكلها.
 *   إرسال هذا المقطع كملف مستقل هو الخطأ الذي أنتج صفحة بيضاء عند أول محاولة.
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

const TITLE = "خطتي المالية — الخطة الخماسية";

const styles = `<style>
html, body { margin: 0; height: 100%; }
${css}
#boot { padding: 24px; font: 14px system-ui, sans-serif; color: #1A2B48; direction: rtl; line-height: 1.7; }
#boot code { display: block; margin-top: 10px; font-size: 12px; color: #B4443A; word-break: break-all; }
</style>`;

// رسالة إقلاع داخل الجذر يمحوها React عند أول رسم. فائدتها تظهر حين لا يرسم:
// بلا هذه الرسالة يكون الفشل صفحة بيضاء صامتة لا تُشخَّص عن بُعد، ومعها يظهر سبب
// العطل على الشاشة نفسها. تُلتقط أخطاء الوعود أيضاً لأن الإقلاع غير متزامن.
// الرسالة واحدة تخدم الحالتين: التحميل الطبيعي، وبقاؤها لأن الجافاسكربت لم يعمل
// أصلاً (نوافذ معاينة الملفات على الجوال تعطّله). لذا تشرح الخطوة التالية بنفسها
// بدل noscript منفصل يكرّر المعرّف نفسه ويظهر الاثنان معاً.
const body = `<div id="root"><div id="boot">جارٍ التحميل…<br><small>إن بقيت هذه الرسالة، فالجافاسكربت غير مفعَّل — افتح الملف في متصفّح (Safari أو Chrome) بدل نافذة المعاينة.</small></div></div>
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
</script>`;

const standalone = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#1A2B48">
<title>${TITLE}</title>
${styles}
</head>
<body>
${body}
</body>
</html>
`;

const embed = `<title>${TITLE}</title>\n${styles}\n${body}\n`;

writeFileSync(join(OUT_DIR, "khutta-maliya.html"), standalone);
writeFileSync(join(OUT_DIR, "embed.html"), embed);
console.log(`مستند مستقل: ${OUT_DIR}/khutta-maliya.html — ${(standalone.length / 1024).toFixed(0)} كيلوبايت`);
console.log(`مقطع للنشر:  ${OUT_DIR}/embed.html`);
