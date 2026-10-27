// How long an agent's cloud computer stays awake with nothing to do
// (server/index.ts, "cloud computers sleep"). It bills while awake; asleep
// its files stay and it wakes before the next turn that needs it.
import { useEffect, useState } from "react";
import { api } from "@/state/store";
import { SettingRow, SettingsSelect } from "./SettingsLayout";
import { t } from "@/lib/i18n";

const CHOICES = [10, 20, 60, 240, 0];

// read at render, so the choices follow a change of language
function choiceLabel(minutes: number): string {
  if (minutes === 0) return t("boxSleep.never");
  return minutes % 60 === 0 ? t("boxSleep.hours", { count: minutes / 60 }) : t("boxSleep.minutes", { count: minutes });
}

export function BoxSleep() {
  const [minutes, setMinutes] = useState<number | null>(null);
  useEffect(() => {
    api("/api/box/settings")
      .then((r) => setMinutes(r.sleepAfter))
      .catch(() => setMinutes(null));
  }, []);
  if (minutes === null) return null;
  return (
    <SettingRow
      label={t("boxSleep.sleepIdleCloudComputersAfter")}
      description={t("boxSleep.itBillsWhileAwakeAsleep")}
      control={
        <SettingsSelect
          aria-label={t("boxSleep.sleepIdleCloudComputersAfter")}
          value={minutes}
          onChange={(e) => {
            const next = Number(e.target.value);
            setMinutes(next);
            void api("/api/box/settings", { method: "PATCH", body: JSON.stringify({ sleepAfter: next }) }).catch(() => {});
          }}
          className="w-[150px]"
        >
          {CHOICES.map((value) => (
            <option key={value} value={value}>
              {choiceLabel(value)}
            </option>
          ))}
        </SettingsSelect>
      }
    />
  );
}
