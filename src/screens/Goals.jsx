import { useState } from "react";
import { Card, H1, Sub, Label, Select, Grid, Button } from "../components/ui.jsx";
import NumberField from "../components/NumberField.jsx";
import { T } from "../theme.js";
import { money } from "../lib/format.js";
import { GOAL_TYPES, GOAL_TIERS } from "../lib/constants.js";

const MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

function monthLabel(m) {
  const y = Math.floor(m / 12) + 1;
  const mm = m % 12;
  return `السنة ${y} · ${MONTHS[mm]}`;
}

export default function Goals({ d, patch, c }) {
  const [draft, setDraft] = useState({
    type: GOAL_TYPES[0],
    tier: GOAL_TIERS[0],
    year: 1,
    month: 0,
    cost: 0,
    fund: 0,
  });

  function addGoal() {
    if (!draft.cost) return;
    const m = (draft.year - 1) * 12 + draft.month;
    const goal = {
      id: `g-${Date.now()}`,
      m,
      type: draft.type,
      tier: draft.tier,
      cost: draft.cost,
      fund: draft.fund,
    };
    patch((prev) => ({ goals: [...prev.goals, goal] }));
    setDraft({ ...draft, cost: 0, fund: 0 });
  }

  function removeGoal(id) {
    patch((prev) => ({ goals: prev.goals.filter((g) => g.id !== id) }));
  }

  const totalCost = d.goals.reduce((s, g) => s + (g.cost || 0), 0);

  return (
    <div>
      <H1>03 — الأهداف</H1>
      <Sub>أضف أهدافك المالية على أفق السنوات الخمس القادمة. لا صفوف فارغة — أضف فقط ما تخطط له فعلاً.</Sub>

      <Card>
        <Grid cols={2}>
          <div>
            <Label>نوع الهدف</Label>
            <Select
              value={draft.type}
              onChange={(v) => setDraft({ ...draft, type: v })}
              options={GOAL_TYPES.map((t) => ({ v: t, l: t }))}
            />
          </div>
          <div>
            <Label>مستوى الهدف</Label>
            <Select
              value={draft.tier}
              onChange={(v) => setDraft({ ...draft, tier: v })}
              options={GOAL_TIERS.map((t) => ({ v: t, l: t }))}
            />
          </div>
          <div>
            <Label>السنة (1-5)</Label>
            <Select
              value={String(draft.year)}
              onChange={(v) => setDraft({ ...draft, year: Number(v) })}
              options={[1, 2, 3, 4, 5].map((y) => ({ v: String(y), l: `السنة ${y}` }))}
            />
          </div>
          <div>
            <Label>الشهر</Label>
            <Select
              value={String(draft.month)}
              onChange={(v) => setDraft({ ...draft, month: Number(v) })}
              options={MONTHS.map((m, i) => ({ v: String(i), l: m }))}
            />
          </div>
          <div>
            <Label>التكلفة الإجمالية</Label>
            <NumberField value={draft.cost} onChange={(v) => setDraft({ ...draft, cost: v })} min={0} />
          </div>
          <div>
            <Label>ممول مسبقاً (اختياري)</Label>
            <NumberField value={draft.fund} onChange={(v) => setDraft({ ...draft, fund: v })} min={0} />
          </div>
        </Grid>
        <div style={{ marginTop: 14 }}>
          <Button onClick={addGoal} disabled={!draft.cost}>+ أضف الهدف</Button>
        </div>
      </Card>

      <div style={{ height: 20 }} />

      {d.goals.length === 0 ? (
        <p style={{ color: T.color.textDim }}>لم تُضف أهداف بعد.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[...d.goals]
            .sort((a, b) => a.m - b.m)
            .map((g) => (
              <Card key={g.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {g.type} <span style={{ color: T.color.textDim, fontWeight: 400 }}>· {g.tier}</span>
                  </div>
                  <div style={{ fontSize: T.size.sm, color: T.color.textDim }}>{monthLabel(g.m)}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ fontFamily: T.font.mono, direction: "ltr" }}>{money(g.cost, d.cur)}</div>
                  <Button variant="ghost" onClick={() => removeGoal(g.id)}>حذف</Button>
                </div>
              </Card>
            ))}
          <div style={{ textAlign: "left", fontFamily: T.font.mono, direction: "ltr", color: T.color.textDim }}>
            الإجمالي: {money(totalCost, d.cur)}
          </div>
        </div>
      )}
    </div>
  );
}
