import { Card, H1, Sub, Label, Select, Grid } from "../components/ui.jsx";
import NumberField from "../components/NumberField.jsx";
import {
  CURRENCIES,
  STAGES,
  INCOME_TYPES,
  DEPENDENTS,
  HORIZONS,
  PRIORITIES,
  DEBT_METHODS,
} from "../lib/constants.js";

const CUR_LABELS = {
  OMR: "ريال عماني (OMR)",
  AED: "درهم إماراتي (AED)",
  SAR: "ريال سعودي (SAR)",
  KWD: "دينار كويتي (KWD)",
  QAR: "ريال قطري (QAR)",
  BHD: "دينار بحريني (BHD)",
};

export default function Facts({ d, patch }) {
  return (
    <div>
      <H1>01 — الوقائع</H1>
      <Sub>معلومات أساسية عنك، تُبنى عليها كل الحسابات في الشاشات التالية.</Sub>

      <Card>
        <Grid cols={2}>
          <div>
            <Label>العمر</Label>
            <NumberField value={d.age} onChange={(v) => patch({ age: v })} min={0} />
          </div>
          <div>
            <Label>العملة</Label>
            <Select
              value={d.cur}
              onChange={(v) => patch({ cur: v })}
              options={CURRENCIES.map((c) => ({ v: c, l: CUR_LABELS[c] }))}
            />
          </div>
        </Grid>
      </Card>

      <div style={{ height: 16 }} />

      <Card>
        <Grid cols={2}>
          <div>
            <Label>مرحلتك المالية الحالية</Label>
            <Select value={d.stage} onChange={(v) => patch({ stage: v })} options={STAGES} />
          </div>
          <div>
            <Label>طبيعة دخلك</Label>
            <Select value={d.income} onChange={(v) => patch({ income: v })} options={INCOME_TYPES} />
          </div>
          <div>
            <Label>عدد المعالين</Label>
            <Select value={d.dependents} onChange={(v) => patch({ dependents: v })} options={DEPENDENTS} />
          </div>
          <div>
            <Label>أفق التخطيط</Label>
            <Select value={d.horizon} onChange={(v) => patch({ horizon: v })} options={HORIZONS} />
          </div>
          <div>
            <Label>أولويتك المالية الآن</Label>
            <Select value={d.priority} onChange={(v) => patch({ priority: v })} options={PRIORITIES} />
          </div>
          <div>
            <Label>أسلوبك المفضل في سداد الديون</Label>
            <Select value={d.debtMethod} onChange={(v) => patch({ debtMethod: v })} options={DEBT_METHODS} />
          </div>
        </Grid>
      </Card>
    </div>
  );
}
