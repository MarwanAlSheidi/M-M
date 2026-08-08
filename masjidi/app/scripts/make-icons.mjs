/**
 * توليد أيقونات التطبيق بلا أي تبعية.
 *
 * لا مكتبة صور في هذا المشروع، وإضافة واحدة لأجل أربع أيقونات ثابتة مبالغة.
 * PNG بسيط: بكسلات خام + zlib (مدمج في Node) + ترويسات الأقسام.
 *
 *   node scripts/make-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const GREEN = [15, 81, 50];
const CREAM = [247, 247, 245];

/* ————— ترميز PNG ————— */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // عمق البت
  header[9] = 6; // RGBA
  // سطر لكل صف مسبوقاً ببايت المرشِّح (0 = بلا مرشِّح)
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ————— الرسم ————— */

/**
 * قبّة وصومعتان — أبسط شكل يُقرأ «مسجد» في مربّع 48 بكسل على شاشة هاتف.
 * `safe` يقلّص الرسم إلى 80% للأيقونة القابلة للقصّ (maskable)، إذ يقصّ النظام
 * أطرافها بأشكال مختلفة.
 */
function draw(size, { safe = false } = {}) {
  const pixels = Buffer.alloc(size * size * 4);
  const s = size;
  const scale = safe ? 0.72 : 0.9;
  const cx = s / 2;
  const cy = s / 2;

  const put = (x, y, [r, g, b]) => {
    const i = (y * s + x) * 4;
    pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = 255;
  };

  const domeR = 0.26 * s * scale;
  const domeCy = cy - 0.02 * s * scale;
  const baseTop = domeCy + domeR * 0.15;
  const baseBottom = cy + 0.34 * s * scale;
  const baseHalf = 0.30 * s * scale;
  const minaretHalf = 0.045 * s * scale;
  const minaretTop = cy - 0.30 * s * scale;

  for (let y = 0; y < s; y += 1) {
    for (let x = 0; x < s; x += 1) {
      put(x, y, GREEN);

      const dx = x - cx;
      const dy = y - domeCy;

      // القبّة: نصف دائرة علوية
      const inDome = dy <= 0 && dx * dx + dy * dy <= domeR * domeR;
      // جسم المسجد
      const inBase = y >= baseTop && y <= baseBottom && Math.abs(dx) <= baseHalf;
      // صومعتان على الطرفين، ولكلٍّ رأس مدبّب
      const minaretX = baseHalf + 0.055 * s * scale;
      const nearMinaret = Math.abs(Math.abs(dx) - minaretX) <= minaretHalf;
      const inMinaret = nearMinaret && y >= minaretTop && y <= baseBottom;
      const capDy = y - minaretTop;
      const inCap = capDy >= -minaretHalf * 2 && capDy <= 0
        && Math.abs(Math.abs(dx) - minaretX) <= minaretHalf + capDy / 2;

      if (inDome || inBase || inMinaret || inCap) put(x, y, CREAM);
    }
  }

  return encodePng(size, pixels);
}

mkdirSync(PUBLIC, { recursive: true });

const outputs = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { safe: true }],
  // iOS يتجاهل أيقونات الـmanifest تماماً ويقرأ هذه وحدها
  ['apple-touch-icon.png', 180, {}],
];

for (const [name, size, options] of outputs) {
  writeFileSync(join(PUBLIC, name), draw(size, options));
  console.log(`✓ ${name} (${size}×${size})`);
}

writeFileSync(join(PUBLIC, 'favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#0f5132"/>
  <path d="M32 16a12 12 0 0 0-12 12v18h24V28a12 12 0 0 0-12-12z" fill="#f7f7f5"/>
  <rect x="12" y="22" width="5" height="24" fill="#f7f7f5"/>
  <rect x="47" y="22" width="5" height="24" fill="#f7f7f5"/>
</svg>
`);
console.log('✓ favicon.svg');
