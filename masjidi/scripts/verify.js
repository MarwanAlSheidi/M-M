#!/usr/bin/env node
/**
 * تحقّقٌ واحد قبل النشر — ويرفض أن يُقرأ التخطّي نجاحاً.
 *
 * **لماذا:** الطبقات أربع (وحدة، فحص، تكامل، متصفّح، وفحص التثبيت)، وطبقتان
 * منها **تتخطّيان نفسيهما بلا فشل** إن غابت أدواتهما — وهو تصميمٌ مقصود كي لا
 * يُكسَر جهازُ من لا يملك PostgreSQL أو Chromium. لكنّ ثمنه أن مخرجاتها
 * **تُشبه النجاح**: لا سطر أحمر، ولا رمز خروجٍ غير صفر.
 *
 * وقد كُتب في `docs/DEPLOY.md`: «غيابهما يعني أنك لم تختبر شيئاً — تحقّق من
 * أنهما عملا فعلاً». **وتحقّقٌ متروكٌ لانتباه إنسانٍ عند كل نشر ليس تحقّقاً.**
 *
 * فهنا: تُشغَّل الطبقات كلُّها، ويُقرأ عدد المتخطَّى من كل واحدة، ويُعدّ
 * **التخطّي سقوطاً** لا نجاحاً. يخرج بصفرٍ إن اختُبر كلُّ شيء فعلاً.
 *
 *   node scripts/verify.js          # الطبقات كلُّها
 *   node scripts/verify.js --quick  # الوحدة والفحص وحدهما (أثناء التطوير)
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const quick = process.argv.includes('--quick');

/**
 * الطبقات بترتيب الرخص: ما يسقط سريعاً يسقط أوّلاً.
 *
 * `skippable` تعني أن الطبقة تتخطّى نفسها بلا فشل حين تغيب أدواتها — وهي
 * التي يلزم قراءةُ عدد المتخطَّى فيها.
 */
const LAYERS = [
  { name: 'الفحص (lint)', argv: ['run', 'lint'], quick: true },
  { name: 'اختبارات الوحدة', argv: ['test'], quick: true, skippable: true },
  { name: 'اختبارات التكامل', argv: ['run', 'test:integration'], skippable: true },
  { name: 'اختبارات المتصفّح', argv: ['run', 'test:e2e'], skippable: true },
  // فحص التثبيت يعيش في `app/` لا في الجذر: الواجهة مشروع npm مستقلّ
  { name: 'فحص التثبيت (PWA)', argv: ['run', 'verify:pwa'], cwd: 'app' },
];

/** يقرأ ملخّص `node --test` من مخرجاته. */
function summarize(output) {
  const read = (label) => {
    const hit = output.match(new RegExp(`^# ${label} (\\d+)`, 'm'));
    return hit ? Number(hit[1]) : null;
  };
  return { tests: read('tests'), pass: read('pass'), fail: read('fail'), skipped: read('skipped') };
}

function run(layer) {
  const result = spawnSync('npm', layer.argv, {
    cwd: layer.cwd ? path.join(ROOT, layer.cwd) : ROOT,
    encoding: 'utf8',
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const counts = summarize(output);

  if (result.status !== 0) {
    return { ...layer, ok: false, counts, why: `خرج برمز ${result.status}`, output };
  }
  // التخطّي الصامت: رمز الخروج صفر، ولم يُختبَر شيء
  if (layer.skippable && counts.skipped > 0) {
    return {
      ...layer,
      ok: false,
      counts,
      why: `تُخطّيت ${counts.skipped} حالة — الأدوات غائبة، فلم تُختبر هذه الطبقة`,
      output,
    };
  }
  return { ...layer, ok: true, counts, output };
}

const results = [];
for (const layer of LAYERS) {
  if (quick && !layer.quick) continue;
  process.stdout.write(`… ${layer.name}\r`);
  const result = run(layer);
  results.push(result);

  const tally = result.counts.tests == null ? '' : ` — ${result.counts.pass}/${result.counts.tests}`;
  console.log(`${result.ok ? '✓' : '✗'} ${layer.name}${tally}`);
  if (!result.ok) console.log(`    ${result.why}`);
}

const broken = results.filter((row) => !row.ok);
if (broken.length === 0) {
  console.log(quick
    ? '\n✓ الطبقتان السريعتان نظيفتان — والتكامل والمتصفّح لم يُشغَّلا.'
    : '\n✓ اختُبرت الطبقات كلُّها فعلاً، ولم تُتخطَّ واحدة.');
  process.exit(0);
}

console.error(`\n✗ ${broken.length} طبقة لم تجتز: ${broken.map((row) => row.name).join('، ')}`);
// مخرجاتُ أوّل ساقطة: من يقرأ «سقط» يحتاج أن يعرف أين
const first = broken[0];
console.error(`\n— مخرجات «${first.name}» —`);
console.error(first.output.split('\n').filter((line) => /not ok|error|✗|Error/.test(line))
  .slice(0, 25).join('\n') || first.output.slice(-1500));
process.exit(1);
