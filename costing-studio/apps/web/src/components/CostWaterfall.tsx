import { CostLine } from "../api/client";
import { ProvenanceBadge } from "./ProvenanceBadge";

export function CostWaterfall({ lines }: { lines: CostLine[] }) {
  const max = Math.max(...lines.map((l) => l.amount_minor), 1);
  return (
    <div className="space-y-2">
      {lines.map((l) => (
        <div key={l.type} className="grid grid-cols-[8rem_1fr_auto_auto] gap-3 items-center">
          <div className="font-mono text-sm">{l.type}</div>
          <div className="h-3 bg-slate-100 rounded">
            <div className={l.source === "ml" ? "h-3 rounded bg-indigo-500" : l.source === "ml_derived" ? "h-3 rounded bg-indigo-300" : "h-3 rounded bg-slate-700"}
              style={{ width: `${(l.amount_minor / max) * 100}%` }} />
          </div>
          <div className="tabular-nums text-sm" dir="ltr">{l.amount_major} {l.currency}</div>
          <ProvenanceBadge source={l.source} />
        </div>
      ))}
    </div>
  );
}
