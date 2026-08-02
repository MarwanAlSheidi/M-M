import { money, pct } from "./format.js";

const LVL_COLOR = { high: "#b91c1c", med: "#b45309", low: "#3f6212" };
const LVL_LABEL = { high: "عاجل", med: "متوسط", low: "للمتابعة" };

// يبني مستنداً HTML مستقلاً بتنسيقه الخاص وينزّله — المسار الاحتياطي الوحيد للطباعة
// حين يكون window.print() محجوباً (كما هو الحال داخل إطار Artifacts المُقيَّد).
export function exportHtml(d, c, report) {
  const flagsHtml = report.flags
    .map(
      (f) => `
      <div style="border-inline-start:4px solid ${LVL_COLOR[f.lvl]};padding:10px 14px;margin-bottom:10px;background:#f8f8f6;border-radius:4px">
        <div style="font-weight:700;color:${LVL_COLOR[f.lvl]};font-size:12px">${LVL_LABEL[f.lvl]}</div>
        <div style="font-weight:700;margin:2px 0">${f.title}</div>
        <div style="color:#555;font-size:14px">${f.detail}</div>
      </div>`
    )
    .join("");

  const actionsHtml = report.actions.map((a) => `<li style="margin-bottom:8px">${a}</li>`).join("");

  const profileHtml = report.profile
    ? `<div style="margin-top:20px;padding:16px;background:#f0f4f3;border-radius:8px">
        <div style="font-size:20px;font-weight:700">${report.profile.name}</div>
        <div style="color:#666;margin-bottom:8px">${report.profile.sub}</div>
        <div>${report.profile.d}</div>
      </div>`
    : "";

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>تقرير الكوتش المالي</title>
<style>
  body { font-family: 'Segoe UI', Tahoma, sans-serif; color:#1a1a1a; max-width:800px; margin:40px auto; padding:0 20px; }
  h1 { font-size:26px; margin-bottom:4px; }
  .num { font-family: 'Courier New', monospace; direction:ltr; display:inline-block; }
  table { width:100%; border-collapse:collapse; margin:12px 0; }
  td { padding:6px 0; border-bottom:1px solid #e5e5e5; }
  @media print { .no-print { display:none !important; } }
</style>
</head>
<body>
  <h1>تقرير الكوتش المالي</h1>
  <p style="color:#666">تاريخ الإعداد: ${new Date().toLocaleDateString("ar")}</p>

  <h2>لمحة سريعة</h2>
  <table>
    <tr><td>صافي الثروة</td><td class="num">${money(c.net, d.cur)}</td></tr>
    <tr><td>الدخل الشهري</td><td class="num">${money(c.income, d.cur)}</td></tr>
    <tr><td>الفائض الشهري</td><td class="num">${money(c.surplus, d.cur)} (${pct(c.savingsRate)})</td></tr>
    <tr><td>فجوة صندوق الطوارئ</td><td class="num">${money(c.ef.efGap, d.cur)}</td></tr>
  </table>

  <h2>التنبيهات</h2>
  ${flagsHtml || "<p>لا توجد تنبيهات حالياً.</p>"}

  <h2>الخطوات التالية</h2>
  <ol>${actionsHtml}</ol>

  ${profileHtml}
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `تقرير-الكوتش-${new Date().toISOString().slice(0, 10)}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
