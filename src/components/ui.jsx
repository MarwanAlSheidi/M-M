import { T } from "../theme.js";

export function Card({ children, style }) {
  return (
    <div
      style={{
        background: T.color.surface,
        border: `1px solid ${T.color.border}`,
        borderRadius: T.radius.lg,
        padding: 18,
        boxShadow: T.shadow.sm,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function H1({ children }) {
  return (
    <h1 style={{ fontSize: T.size.xxl, fontWeight: 700, color: T.color.text, margin: "0 0 6px" }}>
      {children}
    </h1>
  );
}

export function Sub({ children }) {
  return (
    <p style={{ fontSize: T.size.md, color: T.color.textDim, margin: "0 0 20px" }}>{children}</p>
  );
}

export function Label({ children }) {
  return (
    <label style={{ display: "block", fontSize: T.size.sm, color: T.color.textDim, marginBottom: 6 }}>
      {children}
    </label>
  );
}

export function Select({ value, onChange, options, style }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%",
        background: T.color.surfaceAlt,
        color: T.color.text,
        border: `1px solid ${T.color.border}`,
        borderRadius: T.radius.sm,
        padding: "8px 10px",
        fontSize: T.size.md,
        fontFamily: T.font.sans,
        ...style,
      }}
    >
      {options.map((o) => (
        <option key={o.v} value={o.v}>
          {o.l}
        </option>
      ))}
    </select>
  );
}

export function Button({ children, onClick, variant = "primary", style, disabled }) {
  const variants = {
    primary: { background: T.color.primary, color: "#04211f", border: "none" },
    ghost: {
      background: "transparent",
      color: T.color.text,
      border: `1px solid ${T.color.border}`,
    },
    danger: { background: T.color.bad, color: "#2a0906", border: "none" },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        fontFamily: T.font.sans,
        fontWeight: 600,
        fontSize: T.size.md,
        borderRadius: T.radius.md,
        padding: "10px 18px",
        ...variants[variant],
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function Grid({ cols = 2, gap = 14, children, style }) {
  return (
    <div
      className="grid"
      style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap, ...style }}
    >
      {children}
    </div>
  );
}

export function Pill({ children, tone = "neutral" }) {
  const tones = {
    neutral: { background: T.color.surfaceAlt, color: T.color.textDim },
    good: { background: "#14361f", color: T.color.good },
    warn: { background: "#3a2d10", color: T.color.warn },
    bad: { background: "#3a1512", color: T.color.bad },
  };
  return (
    <span
      style={{
        display: "inline-block",
        borderRadius: T.radius.pill,
        padding: "3px 10px",
        fontSize: T.size.xs,
        fontWeight: 600,
        ...tones[tone],
      }}
    >
      {children}
    </span>
  );
}
