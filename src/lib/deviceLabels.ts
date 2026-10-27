// How the paired devices list tells one phone from another.
//
// Phones name themselves, and since iOS 16 almost every one of them says
// "iPhone". A list of two rows both reading "iPhone" with a bin beside
// each is a guess about which one to throw out. So each row says what is
// actually known: when it paired, when it was last heard from, and the
// Bloks build it runs. Two of the same name paired on the same day get the
// time as well, and only when even that says nothing new is a number added.

import { formatDate, t } from "./i18n.ts";

export interface DeviceFacts {
  id: string;
  name: string;
  pairedAt: number;
  /** Last request since this computer started, when there was one. */
  lastSeen?: number;
  client?: string;
}

export interface DeviceLabel {
  name: string;
  detail: string;
}

// a locale given is used as it is (the tests pin one); otherwise the reader's
const DAY = { month: "short", day: "numeric" } as const;
const TIME = { hour: "numeric", minute: "2-digit" } as const;
const day = (at: number, locale?: string) => (locale ? new Date(at).toLocaleDateString(locale, DAY) : formatDate(at, DAY));
const time = (at: number, locale?: string) => (locale ? new Date(at).toLocaleTimeString(locale, TIME) : formatDate(at, TIME));

/** "Seen just now", "Seen 5 min ago", "Seen 3 h ago", or a date. */
export function seenLabel(at: number, now: number, locale?: string): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return t("deviceLabels.seenJustNow");
  if (minutes < 60) return t("deviceLabels.seenMinutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("deviceLabels.seenHours", { count: hours });
  return t("deviceLabels.seenOn", { date: day(at, locale) });
}

export function deviceLabels(devices: readonly DeviceFacts[], now: number, locale?: string): Map<string, DeviceLabel> {
  const out = new Map<string, DeviceLabel>();
  const byName = new Map<string, DeviceFacts[]>();
  for (const d of devices) byName.set(d.name, [...(byName.get(d.name) ?? []), d]);

  for (const group of byName.values()) {
    const sorted = [...group].sort((a, b) => a.pairedAt - b.pairedAt);
    const details = sorted.map((d) => {
      const sameDay = sorted.some((o) => o !== d && day(o.pairedAt, locale) === day(d.pairedAt, locale));
      const parts = [
        sameDay
          ? t("deviceLabels.pairedAt", { date: day(d.pairedAt, locale), time: time(d.pairedAt, locale) })
          : t("deviceLabels.pairedOn", { date: day(d.pairedAt, locale) }),
      ];
      if (d.lastSeen) parts.push(seenLabel(d.lastSeen, now, locale));
      if (d.client) parts.push(d.client);
      return parts.join(" · ");
    });
    sorted.forEach((d, i) => {
      const twin = details.some((other, j) => j !== i && other === details[i]);
      // by pairing order, so the first one keeps its plain name
      out.set(d.id, { name: twin && i > 0 ? `${d.name} ${i + 1}` : d.name, detail: details[i]! });
    });
  }
  return out;
}
