import { Card, H1, Sub, Label, Grid, Pill } from "../components/ui.jsx";
import NumberField from "../components/NumberField.jsx";
import { T } from "../theme.js";
import { money } from "../lib/format.js";
import { ASSETS, LIABS } from "../lib/constants.js";

export default function Wealth({ d, patch, c }) {
  function setAsset(i, v) {
    patch((prev) => {
      const assets = [...prev.assets];
      assets[i] = v;
      return { assets };
    });
  }
  function setLiab(i, v) {
    patch((prev) => {
      const liabs = [...prev.liabs];
      liabs[i] = v;
      return { liabs };
    });
  }

  return (
    <div>
      <H1>04 — الثروة</H1>
      <Sub>أصولك والتزاماتك الحالية. صافي ثروتك هو الفرق بينهما.</Sub>

      <Grid cols={2} style={{ alignItems: "start" }}>
        <Card>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>الأصول</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {ASSETS.map((a, i) => (
              <div key={a.key}>
                <Label>{a.label}</Label>
                <NumberField value={d.assets[i] || 0} onChange={(v) => setAsset(i, v)} min={0} />
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>الالتزامات</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {LIABS.map((l, i) => (
              <div key={l.key}>
                <Label>{l.label}</Label>
                <NumberField value={d.liabs[i] || 0} onChange={(v) => setLiab(i, v)} min={0} />
              </div>
            ))}
          </div>
        </Card>
      </Grid>

      <div style={{ height: 20 }} />

      <Card style={{ borderColor: T.color.primary }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ color: T.color.textDim, fontSize: T.size.sm }}>صافي الثروة</div>
            <div style={{ fontFamily: T.font.mono, direction: "ltr", fontSize: T.size.xxl, fontWeight: 700 }}>
              {money(c.net, d.cur)}
            </div>
          </div>
          <Pill tone={c.stanley.netClass === "متميز" ? "good" : c.stanley.netClass === "متوسط" ? "neutral" : "warn"}>
            {c.stanley.netClass}
          </Pill>
        </div>
        {c.stanley.netAlertActive && (
          <p style={{ marginTop: 10, marginBottom: 0, fontSize: T.size.sm, color: T.color.textDim }}>
            مقارنة بصافي الثروة المتوقع لعمرك ودخلك ({money(c.stanley.expectedNet, d.cur)})، نسبتك{" "}
            <span style={{ fontFamily: T.font.mono, direction: "ltr", display: "inline-block" }}>
              {c.stanley.netRatio.toFixed(2)}
            </span>
            .
          </p>
        )}
      </Card>
    </div>
  );
}
