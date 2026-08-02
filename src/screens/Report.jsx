import { Card, H1, Sub, Button, Pill } from "../components/ui.jsx";
import { T } from "../theme.js";
import { money } from "../lib/format.js";
import { buildReport } from "../lib/report.js";
import { exportHtml } from "../lib/exportHtml.js";

const LVL_TONE = { high: "bad", med: "warn", low: "neutral" };
const LVL_LABEL = { high: "عاجل", med: "متوسط", low: "للمتابعة" };

export default function Report({ d, c }) {
  const report = buildReport(d, c);

  return (
    <div>
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <H1>08 — تقرير الكوتش</H1>
          <Sub>جاهز للطباعة أو المشاركة قبل جلستك القادمة.</Sub>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Button variant="ghost" onClick={() => window.print()}>طباعة</Button>
          <Button onClick={() => exportHtml(d, c, report)}>تصدير HTML مستقل</Button>
        </div>
      </div>

      <Card>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>لمحة سريعة</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
          <Stat label="صافي الثروة" value={money(c.net, d.cur)} />
          <Stat label="الدخل الشهري" value={money(c.income, d.cur)} />
          <Stat label="الفائض الشهري" value={money(c.surplus, d.cur)} />
          <Stat label="فجوة صندوق الطوارئ" value={money(c.ef.efGap, d.cur)} />
        </div>
      </Card>

      <div style={{ height: 16 }} />

      <div style={{ fontWeight: 700, marginBottom: 10 }}>التنبيهات</div>
      {report.flags.length === 0 ? (
        <p style={{ color: T.color.textDim }}>لا توجد تنبيهات حالياً.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
          {report.flags.map((f, i) => (
            <Card key={i} style={{ borderInlineStart: `4px solid ${T.color[f.lvl === "high" ? "bad" : f.lvl === "med" ? "warn" : "textDim"]}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <div style={{ fontWeight: 700 }}>{f.title}</div>
                <Pill tone={LVL_TONE[f.lvl]}>{LVL_LABEL[f.lvl]}</Pill>
              </div>
              <div style={{ color: T.color.textDim, fontSize: T.size.sm }}>{f.detail}</div>
            </Card>
          ))}
        </div>
      )}

      <div style={{ fontWeight: 700, marginBottom: 10 }}>الخطوات التالية</div>
      <Card>
        <ol style={{ margin: 0, paddingInlineStart: 20 }}>
          {report.actions.map((a, i) => (
            <li key={i} style={{ marginBottom: 8 }}>
              {a}
            </li>
          ))}
        </ol>
      </Card>

      {report.profile && (
        <>
          <div style={{ height: 16 }} />
          <Card>
            <div style={{ fontSize: T.size.xl, fontWeight: 700 }}>{report.profile.name}</div>
            <div style={{ color: T.color.textDim, marginBottom: 8 }}>{report.profile.sub}</div>
            <p style={{ margin: 0 }}>{report.profile.d}</p>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div style={{ color: T.color.textDim, fontSize: T.size.sm }}>{label}</div>
      <div style={{ fontFamily: T.font.mono, direction: "ltr", fontWeight: 700, fontSize: T.size.lg }}>{value}</div>
    </div>
  );
}
