import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import { Card, H1, Sub, Grid, Pill } from "../components/ui.jsx";
import { T } from "../theme.js";
import { money } from "../lib/format.js";

function monthLabel(i) {
  const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  const y = Math.floor(i / 12) + 1;
  return `السنة ${y} · ${MONTHS[i % 12]}`;
}

export default function Summary({ d, c }) {
  const { sim, fi, fiPlus } = c;
  const chartData = sim.capYear.map((cap, y) => ({
    name: `السنة ${y + 1}`,
    "المتاح فعلياً": Math.round(cap),
    "تكلفة الأهداف": Math.round(sim.costYear[y]),
  }));

  return (
    <div>
      <H1>07 — الملخص</H1>
      <Sub>محاكاة تدفقك النقدي على خمس سنوات، والاستقلال المالي.</Sub>

      <Card>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>المتاح فعلياً مقابل تكلفة الأهداف — سنوياً</div>
        <div style={{ width: "100%", height: 260 }}>
          <ResponsiveContainer>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={T.color.border} />
              <XAxis dataKey="name" stroke={T.color.textDim} fontSize={12} />
              <YAxis stroke={T.color.textDim} fontSize={12} />
              <Tooltip
                contentStyle={{ background: T.color.surfaceAlt, border: `1px solid ${T.color.border}`, color: T.color.text }}
              />
              <Legend />
              <Bar dataKey="المتاح فعلياً" fill={T.color.primary} radius={[4, 4, 0, 0]} />
              <Bar dataKey="تكلفة الأهداف" fill={T.color.accent} radius={[4, 4, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p style={{ fontSize: T.size.xs, color: T.color.textDim, marginTop: 6 }}>
          «المتاح فعلياً» هو الفائض بعد تخصيصه أولاً لإكمال صندوق الطوارئ — وليس الفائض الخام.
        </p>
      </Card>

      <div style={{ height: 16 }} />

      <Grid cols={2}>
        <Card>
          <Row label="اكتمال صندوق الطوارئ" value={sim.efDone === null ? "لن يكتمل خلال 5 سنوات" : monthLabel(sim.efDone)} />
          <Row
            label="أول شهر يعجز فيه الرصيد"
            value={sim.firstShort === null ? "لا يوجد عجز متوقع" : monthLabel(sim.firstShort)}
            warn={sim.firstShort !== null}
          />
          <Row label="أقصى عجز تراكمي" value={money(sim.worstShort, d.cur)} warn={sim.worstShort > 0} />
          <Row label="الرصيد بعد 5 سنوات" value={money(sim.endPot, d.cur)} warn={sim.endPot < 0} />
        </Card>

        <Card>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>الاستقلال المالي (قاعدة 4٪)</div>
          <Row label="الهدف المطلوب" value={money(fi.fiTarget, d.cur)} />
          <Row label="المستثمر حالياً" value={money(fi.invested, d.cur)} />
          <Row
            label="الزمن المتوقع بالفائض الحالي"
            value={fi.reached ? `${fi.years} سنة` : "أكثر من 60 سنة"}
          />
          <Row
            label="حساسية: +5٪ من الدخل للاستثمار"
            value={fiPlus.reached ? `${fiPlus.years} سنة` : "أكثر من 60 سنة"}
          />
          <div style={{ marginTop: 10 }}>
            <Pill tone="neutral">نطاق الأصول النامية الموصى به: {c.growthBand}</Pill>
          </div>
        </Card>
      </Grid>
    </div>
  );
}

function Row({ label, value, warn }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
      <span style={{ color: T.color.textDim, fontSize: T.size.sm }}>{label}</span>
      <span style={{ fontFamily: T.font.mono, direction: "ltr", fontWeight: 700, color: warn ? T.color.bad : T.color.text }}>
        {value}
      </span>
    </div>
  );
}
