import { LineSource } from "../api/client";

const COLORS: Record<LineSource, string> = {
  formula: "bg-slate-200 text-slate-800",
  manual: "bg-amber-200 text-amber-900",
  ml: "bg-indigo-200 text-indigo-900",
  ml_derived: "bg-indigo-100 text-indigo-800 italic",
};

export function ProvenanceBadge({ source }: { source: LineSource }) {
  return <span className={`text-xs px-2 py-0.5 rounded ${COLORS[source]}`}>{source}</span>;
}
