// How long an agent's cloud computer stays awake with nothing to do
// (server/index.ts, "cloud computers sleep"). It bills while awake; asleep
// its files stay and it wakes before the next turn that needs it.
import { useEffect, useState } from "react";
import { api } from "@/state/store";

const CHOICES: Array<[number, string]> = [
  [10, "10 minutes"],
  [20, "20 minutes"],
  [60, "1 hour"],
  [240, "4 hours"],
  [0, "Never"],
];

export function BoxSleep() {
  const [minutes, setMinutes] = useState<number | null>(null);
  useEffect(() => {
    api("/api/box/settings")
      .then((r) => setMinutes(r.sleepAfter))
      .catch(() => setMinutes(null));
  }, []);
  if (minutes === null) return null;
  return (
    <label className="flex items-center justify-between gap-3 text-body text-muted-foreground">
      <span>Sleep idle cloud computers after</span>
      <select
        value={minutes}
        onChange={(e) => {
          const next = Number(e.target.value);
          setMinutes(next);
          void api("/api/box/settings", { method: "PATCH", body: JSON.stringify({ sleepAfter: next }) }).catch(() => {});
        }}
        className="rounded-md border bg-background px-2 py-1 text-body text-foreground"
      >
        {CHOICES.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}
