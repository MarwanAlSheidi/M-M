#!/usr/bin/env node
/**
 * `npm run demo` — نسخةُ العرض في **ملفٍّ واحد**.
 *
 * الصفحةُ تُفتح داخل إطارٍ معزول بلا شبكة، فلا تصلها ملفّاتٌ جانبية: حزمةٌ
 * بملفّاتٍ متفرّقة تُقلع من خادمٍ ولا تُقلع من ملفّ (نصوصُ الوحدات على
 * `file://` تُردّ بأصلٍ معتِم). فيُضمّ كلُّ شيء — الشيفرة والنمط والخطوط — في
 * صفحةٍ واحدة.
 *
 * وكان هذا الضمُّ يجري بيدي خارج المستودع، **فلا يُعاد ولا يُفحص**. وهو الآن
 * أمرٌ يُشغَّل، ويقيسه `tests/e2e/demo.test.js` على ناتجه هذا لا على غيره.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', 'app');
const OUT_DIR = path.join(APP, 'demo-dist');
const PAGE = path.join(OUT_DIR, 'masjidi-demo.html');

function build() {
  execFileSync('npx', ['vite', 'build', '--config', 'vite.demo.config.js'],
    { cwd: APP, stdio: 'pipe' });

  const shell = fs.readFileSync(path.join(OUT_DIR, 'index.html'), 'utf8');
  const asset = (pattern) => {
    const hit = pattern.exec(shell);
    if (!hit) throw new Error(`لم يُعثر على أصلٍ في الحزمة: ${pattern}`);
    return fs.readFileSync(path.join(OUT_DIR, hit[1].replace(/^\.?\//, '')), 'utf8');
  };

  const css = asset(/href="([^"]+\.css)"/);
  const js = asset(/src="([^"]+\.js)"/);

  /*
   * بلا `<html>` ولا `<head>`: النشرُ يلفّ المحتوى بهيكله. و`direction: rtl`
   * على الجذر لأن المضيف لا يعرف لغة الصفحة.
   */
  const page = `<title>مسجدي</title>\n<style>\n${css}</style>\n`
    + '<div id="root"></div>\n'
    + `<script type="module">\n${js}\n</script>\n`;

  fs.writeFileSync(PAGE, page);
  return page.length;
}

if (require.main === module) {
  const size = build();
  console.log(`✓ ${path.relative(path.join(__dirname, '..'), PAGE)} — ${Math.round(size / 1024)} ك.ب`);
}

module.exports = { build, PAGE };
