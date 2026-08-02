import { useEffect, useRef, useState } from "react";
import { T } from "../theme.js";

// يحتفظ بنص داخلي أثناء التركيز فقط — التحويل المباشر إلى رقم يكسر كتابة
// قيم وسيطة مثل "12." أو "-" قبل إكمالها. لا تبسّطه إلى value={n}.
export default function NumberField({ value, onChange, style, placeholder, min, ...rest }) {
  const [text, setText] = useState(String(value ?? 0));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(String(value ?? 0));
  }, [value]);

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      dir="ltr"
      placeholder={placeholder}
      value={text}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => {
        const t = e.target.value;
        if (t === "" || /^-?\d*\.?\d*$/.test(t)) setText(t);
      }}
      onBlur={() => {
        focused.current = false;
        const n = parseFloat(text);
        const safe = Number.isFinite(n) ? (min !== undefined ? Math.max(min, n) : n) : 0;
        setText(String(safe));
        onChange(safe);
      }}
      style={{
        fontFamily: T.font.mono,
        direction: "ltr",
        textAlign: "left",
        background: T.color.surfaceAlt,
        color: T.color.text,
        border: `1px solid ${T.color.border}`,
        borderRadius: T.radius.sm,
        padding: "8px 10px",
        fontSize: T.size.md,
        ...style,
      }}
    />
  );
}
