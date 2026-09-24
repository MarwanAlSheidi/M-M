import { GuardOut } from "../api/client";

export function GuardBadge({ guard }: { guard: GuardOut }) {
  return (
    <span title={guard.reason}
      className={`text-xs px-2 py-0.5 rounded ${guard.accepted ? "bg-emerald-200 text-emerald-900" : "bg-rose-200 text-rose-900"}`}>
      {guard.accepted ? "guarded ✓" : "clamped"}
    </span>
  );
}
