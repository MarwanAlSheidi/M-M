import { SHAPFeature } from "../api/client";

export function SHAPTop5({ items }: { items: SHAPFeature[] }) {
  if (!items.length) return <div className="text-sm text-slate-500">—</div>;
  const max = Math.max(...items.map((i) => Math.abs(i.contribution)), 1e-9);
  return (
    <div className="space-y-1">
      {items.map((f) => (
        <div key={f.feature} className="grid grid-cols-[9rem_1fr_4rem] gap-2 items-center">
          <div className="font-mono text-xs truncate">{f.feature}</div>
          <div className="h-2 bg-slate-100 rounded">
            <div className={f.contribution >= 0 ? "h-2 rounded bg-emerald-500" : "h-2 rounded bg-rose-500"}
              style={{ width: `${(Math.abs(f.contribution) / max) * 100}%` }} />
          </div>
          <div className="tabular-nums text-xs text-right" dir="ltr">{f.contribution.toFixed(3)}</div>
        </div>
      ))}
    </div>
  );
}
