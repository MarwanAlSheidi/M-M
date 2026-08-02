import { Card, H1, Sub, Pill } from "../components/ui.jsx";
import { T } from "../theme.js";
import { TYPES } from "../data/types.js";

export default function Identity({ d, patch, c, cards }) {
  const { identity } = c;
  const profile = identity.incons ? TYPES.SPLIT : TYPES[identity.top];

  function choose(cardId, optIdx) {
    patch((prev) => ({ ans: { ...prev.ans, [cardId]: optIdx } }));
  }

  return (
    <div>
      <H1>02 — الهوية المالية</H1>
      <Sub>
        16 موقفاً يومياً، اختر الأقرب لتصرفك الفعلي لا لما تتمنى أنك تسويه. أجب عن {identity.ready ? "10 على الأقل" : `${identity.answeredCount} من 10 على الأقل`} لتظهر النتيجة.
      </Sub>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {cards.map((card) => {
          const chosen = d.ans[card.id];
          return (
            <Card key={card.id}>
              <div style={{ fontWeight: 600, marginBottom: 12 }}>{card.q}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {card.options.map((opt, i) => (
                  <button
                    key={i}
                    onClick={() => choose(card.id, i)}
                    style={{
                      textAlign: "right",
                      cursor: "pointer",
                      borderRadius: T.radius.sm,
                      padding: "10px 14px",
                      fontFamily: T.font.sans,
                      fontSize: T.size.sm,
                      border: `1px solid ${chosen === i ? T.color.primary : T.color.border}`,
                      background: chosen === i ? T.color.primaryDim : T.color.surfaceAlt,
                      color: T.color.text,
                    }}
                  >
                    {opt.t}
                  </button>
                ))}
              </div>
            </Card>
          );
        })}
      </div>

      <div style={{ height: 20 }} />

      <Card style={{ borderColor: T.color.primary }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <Pill tone={identity.ready ? "good" : "neutral"}>
            {identity.answeredCount} / 16 مجاب
          </Pill>
          {identity.ready && identity.incons && <Pill tone="warn">تناقض سلوكي مكتشَف</Pill>}
        </div>
        {identity.ready ? (
          <>
            <div style={{ fontSize: T.size.xl, fontWeight: 700, marginBottom: 4 }}>{profile.name}</div>
            <div style={{ color: T.color.textDim, marginBottom: 10 }}>{profile.sub}</div>
            <p style={{ margin: "0 0 10px" }}>{profile.d}</p>
            <p style={{ margin: "0 0 6px" }}>
              <b style={{ color: T.color.good }}>قوتك: </b>
              {profile.good}
            </p>
            <p style={{ margin: 0 }}>
              <b style={{ color: T.color.warn }}>فخّك: </b>
              {profile.trap}
            </p>
          </>
        ) : (
          <p style={{ color: T.color.textDim, margin: 0 }}>
            أكمل الإجابة على المزيد من البطاقات أعلاه لتظهر نتيجتك.
          </p>
        )}
      </Card>
    </div>
  );
}
