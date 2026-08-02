import { useEffect, useMemo, useRef, useState } from "react";
import { T } from "./theme.js";
import { storage } from "./lib/storage.js";
import { STORAGE_KEY, SAVE_DEBOUNCE_MS } from "./lib/constants.js";
import { migrate } from "./lib/migrate.js";
import { calc } from "./lib/calc.js";
import { CARDS } from "./data/cards.js";

import Facts from "./screens/Facts.jsx";
import Identity from "./screens/Identity.jsx";
import Goals from "./screens/Goals.jsx";
import Wealth from "./screens/Wealth.jsx";
import Budget from "./screens/Budget.jsx";
import Safety from "./screens/Safety.jsx";
import Summary from "./screens/Summary.jsx";
import Report from "./screens/Report.jsx";

const SCREENS = [
  { key: "facts", label: "الوقائع", n: "01" },
  { key: "identity", label: "الهوية", n: "02" },
  { key: "goals", label: "الأهداف", n: "03" },
  { key: "wealth", label: "الثروة", n: "04" },
  { key: "budget", label: "الميزانية", n: "05" },
  { key: "safety", label: "الأمان", n: "06" },
  { key: "summary", label: "الملخص", n: "07" },
  { key: "report", label: "التقرير", n: "08" },
];

export default function App() {
  const [d, setD] = useState(null);
  const [screen, setScreen] = useState("facts");
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef(null);

  useEffect(() => {
    let cancelled = false;
    storage
      .get(STORAGE_KEY)
      .then((r) => {
        if (cancelled) return;
        setD(migrate(JSON.parse(r.value)));
      })
      .catch(() => {
        if (!cancelled) setD(migrate(null));
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loaded || !d) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      storage.set(STORAGE_KEY, JSON.stringify(d));
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(saveTimer.current);
  }, [d, loaded]);

  const c = useMemo(() => (d ? calc(d, d.horizon, CARDS) : null), [d, d && d.horizon]);

  function patch(partial) {
    setD((prev) => ({ ...prev, ...(typeof partial === "function" ? partial(prev) : partial) }));
  }

  if (!d || !c) {
    return (
      <div
        dir="rtl"
        style={{
          minHeight: "100vh",
          background: T.color.bg,
          color: T.color.text,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: T.font.sans,
        }}
      >
        جارٍ التحميل…
      </div>
    );
  }

  const idx = SCREENS.findIndex((s) => s.key === screen);
  const next = SCREENS[idx + 1];

  const screenProps = { d, patch, c, cards: CARDS };

  return (
    <div
      dir="rtl"
      style={{
        minHeight: "100vh",
        background: T.color.bg,
        color: T.color.text,
        fontFamily: T.font.sans,
      }}
    >
      <nav
        className="no-print"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          display: "flex",
          overflowX: "auto",
          gap: 4,
          padding: "10px 16px",
          background: T.color.surface,
          borderBottom: `1px solid ${T.color.border}`,
        }}
      >
        {SCREENS.map((s) => (
          <button
            key={s.key}
            onClick={() => setScreen(s.key)}
            style={{
              flexShrink: 0,
              cursor: "pointer",
              border: "none",
              borderRadius: T.radius.pill,
              padding: "6px 14px",
              fontSize: T.size.sm,
              fontFamily: T.font.sans,
              fontWeight: s.key === screen ? 700 : 500,
              background: s.key === screen ? T.color.primary : "transparent",
              color: s.key === screen ? "#04211f" : T.color.textDim,
            }}
          >
            <span style={{ fontFamily: T.font.mono, direction: "ltr", display: "inline-block", marginInlineEnd: 6 }}>
              {s.n}
            </span>
            {s.label}
          </button>
        ))}
      </nav>

      <main style={{ maxWidth: 880, margin: "0 auto", padding: "28px 18px 60px" }}>
        {screen === "facts" && <Facts {...screenProps} />}
        {screen === "identity" && <Identity {...screenProps} />}
        {screen === "goals" && <Goals {...screenProps} />}
        {screen === "wealth" && <Wealth {...screenProps} />}
        {screen === "budget" && <Budget {...screenProps} />}
        {screen === "safety" && <Safety {...screenProps} />}
        {screen === "summary" && <Summary {...screenProps} />}
        {screen === "report" && <Report {...screenProps} />}

        {next && (
          <div className="no-print" style={{ marginTop: 28, display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={() => setScreen(next.key)}
              style={{
                cursor: "pointer",
                border: "none",
                borderRadius: T.radius.md,
                padding: "12px 28px",
                fontSize: T.size.md,
                fontWeight: 700,
                fontFamily: T.font.sans,
                background: T.color.primary,
                color: "#04211f",
              }}
            >
              التالي — {next.label} ←
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
