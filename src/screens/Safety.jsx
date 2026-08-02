import { Card, H1, Sub, Label, Grid, Pill } from "../components/ui.jsx";
import NumberField from "../components/NumberField.jsx";
import { T } from "../theme.js";
import { money } from "../lib/format.js";

export default function Safety({ d, patch, c }) {
  const { ef } = c;
  return (
    <div>
      <H1>06 — صندوق الطوارئ</H1>
      <Sub>الوسادة المالية التي تحميك من أي صدمة دون اللجوء للدين.</Sub>

      <Grid cols={2}>
        <Card>
          <Label>رصيد صندوق الطوارئ الحالي</Label>
          <NumberField value={d.efNow || 0} onChange={(v) => patch({ efNow: v })} min={0} />

          <div style={{ height: 14 }} />

          <Label>عدد الأشهر (اتركه 0 لاستخدام الموصى به: {ef.efRec})</Label>
          <NumberField value={d.efOverride || 0} onChange={(v) => patch({ efOverride: v })} min={0} />
        </Card>

        <Card>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Row label="الأشهر الموصى بها" value={`${ef.efRec} شهراً`} />
            <Row label="الأشهر المعتمدة" value={`${ef.efMonths} شهراً`} />
            <Row label="الهدف المطلوب" value={money(ef.efTarget, d.cur)} />
            <Row label="الفجوة المتبقية" value={money(ef.efGap, d.cur)} highlight={ef.efGap > 0} />
            <Row label="شهور الأمان الحالية" value={ef.efCover.toFixed(1)} />
          </div>
          {ef.efGap === 0 ? (
            <div style={{ marginTop: 12 }}>
              <Pill tone="good">صندوق الطوارئ مكتمل</Pill>
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <Pill tone="warn">لا يزال هناك فجوة</Pill>
            </div>
          )}
        </Card>
      </Grid>
    </div>
  );
}

function Row({ label, value, highlight }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span style={{ color: T.color.textDim, fontSize: T.size.sm }}>{label}</span>
      <span
        style={{
          fontFamily: T.font.mono,
          direction: "ltr",
          fontWeight: 700,
          color: highlight ? T.color.warn : T.color.text,
        }}
      >
        {value}
      </span>
    </div>
  );
}
