/*
 * يجمع حزمة تصدير واحدة تُسلَّم كما هي: تطبيق يعمل بالنقر، ونسخة للاستضافة،
 * والشيفرة المصدرية، والتوثيق.
 *
 * التشغيل: npm run export   (يبني النسختين أولاً)
 *
 * تُستثنى node_modules و.git عمداً: الأولى تُعاد بـnpm install والثانية تاريخ
 * لا يلزم المستلم، وإدراجهما يضخّم الحزمة أضعافاً بلا فائدة.
 */
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const OUT = "dist-export/خطتي-المالية";
rmSync("dist-export", { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// ١) التطبيق جاهزاً للنقر عليه
cpSync("dist-single/khutta-maliya.html", join(OUT, "التطبيق-اضغط-هنا.html"));

// ٢) نسخة الاستضافة (تُثبَّت على الجوال وتعمل بلا إنترنت)
cpSync("dist", join(OUT, "نسخة-الاستضافة"), { recursive: true });

// ٣) الشيفرة المصدرية للمطوّر
for (const f of ["src", "scripts", "public", "index.html", "package.json",
                 "vite.config.js", "vite.config.single.js", "tailwind.config.js",
                 "postcss.config.js", ".gitignore"]) {
  try { cpSync(f, join(OUT, "الشيفرة-المصدرية", f), { recursive: true }); } catch {}
}

// ٤) التوثيق
cpSync("HANDOFF.md", join(OUT, "وثيقة-التسليم.md"));
cpSync("README.md", join(OUT, "الشيفرة-المصدرية", "README.md"));

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
writeFileSync(join(OUT, "ابدأ-من-هنا.txt"), `خطتي المالية — حزمة التصدير (إصدار ${version})
تاريخ التوليد: ${new Date().toISOString().slice(0, 10)}

محتويات الحزمة
──────────────

١) التطبيق-اضغط-هنا.html
   التطبيق كاملاً في ملف واحد. انقر عليه فيفتح في المتصفّح ويعمل فوراً:
   بلا إنترنت، بلا تثبيت، بلا حساب. هذا ما تُرسله لمن يريد التجربة.
   ملاحظة: على الجوال افتحه في متصفّح لا في نافذة المعاينة، فبعضها يعطّل
   الجافاسكربت. وهذه النسخة لا تُثبَّت على الشاشة الرئيسية ولا تعمل بلا
   إنترنت بعد الإغلاق — لذلك وُجدت النسخة التالية.

٢) نسخة-الاستضافة/
   ارفع محتويات هذا المجلّد على أي استضافة ملفات ثابتة (GitHub Pages أو
   Netlify أو غيرهما). تعطي رابطاً يفتحه أي شخص، ويُثبَّت على شاشة iPhone
   الرئيسية عبر «مشاركة ← إضافة إلى الشاشة الرئيسية»، ويعمل بلا إنترنت
   بعد أول فتح. يتطلّب HTTPS — لن يعمل التثبيت على http عادي.

٣) الشيفرة-المصدرية/
   المشروع كاملاً للتعديل. للتشغيل:
       npm install
       npm run dev        تشغيل للتطوير
       npm run build      بناء نسخة الاستضافة
       npm run verify     كل الفحوصات الآلية
   التفاصيل في الشيفرة-المصدرية/README.md

٤) وثيقة-التسليم.md
   شرح المعادلات المالية والبنية والقرارات — لمن يكمل التطوير.

حدود يجب ذكرها للمستخدمين
─────────────────────────
- البيانات تُحفظ داخل متصفّح كل شخص وحده. لا خادم ولا حساب ولا مزامنة
  بين الأجهزة، وبيانات أحد لا تصل إلى أحد.
- مسح بيانات المتصفّح يمحو الخطة. يوجد تصدير واستيراد بصيغة JSON داخل
  التطبيق — استخدمه كنسخة احتياطية.
- بطاقات القرار أداة حوار مع الكوتش لا تشخيصاً نفسياً مُتحقَّقاً منه.
`);

execFileSync("zip", ["-qr", "خطتي-المالية.zip", "خطتي-المالية"], { cwd: "dist-export" });
console.log("حزمة التصدير: dist-export/خطتي-المالية.zip");
