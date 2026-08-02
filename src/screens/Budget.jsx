import { Card, H1, Sub, Label, Grid, Pill } from "../components/ui.jsx";
import NumberField from "../components/NumberField.jsx";
import { T } from "../theme.js";
import { money, pct } from "../lib/format.js";

function RuleBar({ label, value, limit, mode = "max" }) {
  const ok = mode === "max" ? value <= limit : value >= limit;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: T.size.sm, marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ fontFamily: T.font.mono, direction: "ltr" }}>
          {pct(value)} / {mode === "max" ? "≤" : "≥"} {pct(limit, 0)}
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: T.color.surfaceAlt, overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${Math.min(100, value * 100)}%`,
            background: ok ? T.color.good : T.color.bad,
          }}
        />
      </div>
    </div>
  );
}

export default function Budget({ d, patch, c }) {
  function setExp(i, field, v) {
    patch((prev) => {
      const exp = [...prev.exp];
      exp[i] = { ...exp[i], [field]: v };
      return { exp };
    });
  }
  function setInc(i, v) {
    patch((prev) => {
      const inc = [...prev.inc];
      inc[i] = { ...inc[i], amount: v };
      return { inc };
    });
  }

  const needsItems = d.exp.filter((e) => e.type === "احتياج");
  const wantsItems = d.exp.filter((e) => e.type === "رغبة");

  return (
    <div>
      <H1>05 — الميزانية</H1>
      <Sub>مصاريفك الشهرية ومصادر دخلك.</Sub>

      <Grid cols={2} style={{ alignItems: "start" }}>
        <Card>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>احتياجات</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {d.exp.map((e, i) =>
              e.type === "احتياج" ? (
                <div key={e.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    value={e.label}
                    onChange={(ev) => setExp(i, "label", ev.target.value)}
                    style={{
                      flex: 1,
                      background: "transparent",
                      color: T.color.text,
                      border: "none",
                      fontSize: T.size.sm,
                    }}
                  />
                  <NumberField value={e.cost} onChange={(v) => setExp(i, "cost", v)} min={0} style={{ width: 100 }} />
                </div>
              ) : null
            )}
          </div>

          <div style={{ fontWeight: 700, margin: "18px 0 4px" }}>رغبات</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {d.exp.map((e, i) =>
              e.type === "رغبة" ? (
                <div key={e.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    value={e.label}
                    onChange={(ev) => setExp(i, "label", ev.target.value)}
                    style={{
                      flex: 1,
                      background: "transparent",
                      color: T.color.text,
                      border: "none",
                      fontSize: T.size.sm,
                    }}
                  />
                  <NumberField value={e.cost} onChange={(v) => setExp(i, "cost", v)} min={0} style={{ width: 100 }} />
                </div>
              ) : null
            )}
          </div>
        </Card>

        <div>
          <Card>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>مصادر الدخل</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {d.inc.map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, fontSize: T.size.sm }}>{s.label}</div>
                  <NumberField value={s.amount} onChange={(v) => setInc(i, v)} min={0} style={{ width: 100 }} />
                </div>
              ))}
            </div>
          </Card>

          <div style={{ height: 16 }} />

          <Card>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>قاعدة 50/30/20</div>
            <RuleBar label="الاحتياجات" value={c.needsRatio} limit={0.5} mode="max" />
            <RuleBar label="الرغبات" value={c.wantsRatio} limit={0.3} mode="max" />
            <RuleBar label="الفائض (الادخار)" value={c.savingsRate} limit={0.2} mode="min" />

            <div style={{ height: 10 }} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: T.size.sm }}>
              <span>السكن + الأقساط / الدخل</span>
              <span style={{ fontFamily: T.font.mono, direction: "ltr" }}>{pct(c.housingDebtRatio)}</span>
            </div>
            {c.housingDebtRatio > 0.36 && (
              <div style={{ marginTop: 6 }}>
                <Pill tone="warn">يتجاوز حد 36٪ لقاعدة الاكتتاب العقاري</Pill>
              </div>
            )}

            <div style={{ height: 14 }} />
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
              <span>الفائض الشهري</span>
              <span style={{ fontFamily: T.font.mono, direction: "ltr" }}>{money(c.surplus, d.cur)}</span>
            </div>
          </Card>
        </div>
      </Grid>
    </div>
  );
}
