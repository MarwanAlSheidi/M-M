/*
 * توليد أيقونات التطبيق. العلامة: خمسة أعمدة صاعدة — سنوات الخطة الخمس،
 * وآخرها بالأخضر (النمو). هندسية بحتة بلا نصّ: أي حرف عربي داخل أيقونة يعتمد
 * على خط مثبَّت في جهاز التوليد، فيختلف شكله أو يسقط إلى خط بديل.
 *
 * التشغيل: node scripts/make-icons.mjs
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const NAVY = "#1A2B48";
const BARS = ["#4E5F7E", "#63799B", "#7A93B8", "#93AFD4", "#10B981"];
const OUT = "public";

/** inset: نسبة الهامش حول العلامة — الأيقونة القابلة للقصّ تحتاج منطقة آمنة */
const svg = (size, inset) => {
  const pad = size * inset;
  const w = size - pad * 2;
  const gap = w * 0.07;
  const barW = (w - gap * 4) / 5;
  const maxH = w * 0.82;
  const bars = BARS.map((fill, i) => {
    const h = maxH * (0.34 + (i * 0.66) / 4);
    const x = pad + i * (barW + gap);
    const y = pad + (w - h) + (size - pad * 2 - w) / 2;
    const r = Math.min(barW / 2, size * 0.02);
    return `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="${r}" fill="${fill}"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="${NAVY}"/>${bars}</svg>`;
};

const targets = [
  ["icon-192.png", 192, 0.14],
  ["icon-512.png", 512, 0.14],
  ["icon-maskable-512.png", 512, 0.24], // منطقة آمنة أوسع: أندرويد يقصّ الحواف
  ["apple-touch-icon.png", 180, 0.14],  // iOS يطبّق تدويره الخاص؛ بلا شفافية
];

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ["--no-sandbox"],
});
for (const [name, size, inset] of targets) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<body style="margin:0">${svg(size, inset)}</body>`,
    { waitUntil: "domcontentloaded" });
  await page.screenshot({ path: path.join(OUT, name), omitBackground: false });
  await page.close();
  console.log(`✓ ${name} (${size}×${size})`);
}
await browser.close();

fs.writeFileSync(path.join(OUT, "favicon.svg"), svg(64, 0.12));
console.log("✓ favicon.svg");
