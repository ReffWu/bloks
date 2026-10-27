// Check-ins in the app: how the routine editor reads an interval, where a
// check-in sits on the calendar, and when a routine being written will
// next run, so the editor can draw its week before it exists.
//
// The words here are the catalogue's, one whole phrase per shape, so a
// language that says "toutes les 2 heures" says it the same way.
//
// The schedule itself is the server's (server/routines.ts, checkInsOn);
// these only have to agree with it. A check-in's slots start where its
// active hours begin and step by its interval to where they end, so a
// day column can draw them without asking the server for every one.
import { t } from "./i18n.ts";

/** The same bounds the server keeps, so the editor says no before the
 * server has to. */
export const MIN_EVERY = 15;
export const MAX_EVERY = 1440;

/** "HH:MM" to minutes past midnight, or null. */
function minutesOf(value: string | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? "");
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Minutes from what the editor holds: a count and its unit. Null for a
 * count that is not a number at all. */
export function everyMinutes(count: string, unit: "min" | "hour"): number | null {
  if (!count.trim()) return null;
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(unit === "hour" ? n * 60 : n);
}

/** Why the editor cannot file this check-in yet, in a few words under
 * the field, or null when it can. */
export function checkInProblem(every: number | null, hours: { from: string; to: string } | null): string | null {
  if (every === null || every < MIN_EVERY || every > MAX_EVERY) return t("checkIns.problem.range");
  if (hours) {
    const from = minutesOf(hours.from);
    const to = minutesOf(hours.to);
    if (from === null || to === null || from >= to) return t("checkIns.problem.endAfterStart");
  }
  return null;
}

/** A routine's history with each stretch of quiet runs as one row, so a
 * check-in's twenty most recent runs read as what happened rather than as
 * twenty lines saying nothing did. Newest first, like the history. */
export function foldQuietRuns<R extends { quiet?: boolean }>(runs: readonly R[]): Array<{ run: R } | { quiet: R[] }> {
  const out: Array<{ run: R } | { quiet: R[] }> = [];
  for (const run of runs) {
    const last = out[out.length - 1];
    if (run.quiet && last && "quiet" in last) last.quiet.push(run);
    else out.push(run.quiet ? { quiet: [run] } : { run });
  }
  return out;
}

/** "30m", "2h": a check-in's interval where there is no room for words. */
export function intervalShort(every: number): string {
  return every % 60 === 0 ? t("checkIns.short.hours", { n: every / 60 }) : t("checkIns.short.minutes", { n: every });
}

/** The intervals the editor's slider stops at. Every one is inside the
 * server's bounds, so a slider can never ask for what it will refuse.
 * Once a day is left to a routine at a time of day, which can be just as
 * quiet and says when; six stops also leave each name room on a phone. */
export const CHECK_IN_EVERY = [15, 30, 60, 120, 240, 480].filter((m) => m >= MIN_EVERY && m <= MAX_EVERY);

/** "15 min", "1 hr", "1 day": short enough to sit under a slider's dot. */
export function intervalLabel(every: number): string {
  if (every >= 1440 && every % 1440 === 0) return t("checkIns.label.days", { count: every / 1440 });
  if (every >= 60 && every % 60 === 0) return t("checkIns.label.hours", { count: every / 60 });
  return t("checkIns.label.minutes", { count: every });
}

/** "every 30 min", "every hour", "once a day": an interval inside a sentence. */
export function intervalPhrase(every: number): string {
  if (every === 1440) return t("checkIns.phrase.onceADay");
  if (every === 60) return t("checkIns.phrase.everyHour");
  if (every % 60 === 0) return t("checkIns.phrase.everyHours", { count: every / 60 });
  return t("checkIns.phrase.everyMinutes", { count: every });
}

/** What the editor knows about a schedule, before it is a routine. */
export interface DraftSchedule {
  every?: number;
  activeHours?: { from: string; to: string };
  days: number[];
  time: string;
  repeat?: "weekly" | "once";
  /** "YYYY-MM-DD", for a once. */
  date?: string;
}

/** Minutes past midnight this schedule runs at on `day`, in order. The
 * same slots the server keeps (server/routines.ts, checkInsOn and
 * nextScheduledAfter), so the editor's preview is the calendar to come. */
export function runsOnDay(schedule: DraftSchedule, day: Date): number[] {
  if (schedule.every) {
    if (schedule.days.length > 0 && !schedule.days.includes(day.getDay())) return [];
    const from = minutesOf(schedule.activeHours?.from) ?? 0;
    const to = minutesOf(schedule.activeHours?.to) ?? 24 * 60 - 1;
    const out: number[] = [];
    for (let at = from; at <= to; at += schedule.every) out.push(at);
    return out;
  }
  const at = minutesOf(schedule.time);
  if (at === null) return [];
  if (schedule.repeat === "once") return schedule.date === dateKey(day) ? [at] : [];
  return schedule.days.length === 0 || schedule.days.includes(day.getDay()) ? [at] : [];
}

/** The next `count` runs after `now`: as many weeks ahead as it takes for
 * one a week, and a once as far as its date. Empty when it would never
 * run again. */
export function nextRuns(schedule: DraftSchedule, now: Date, count: number): Date[] {
  const out: Date[] = [];
  const reach = schedule.repeat === "once" && !schedule.every ? onceReach(schedule.date, now) : 7 * count + 1;
  for (let ahead = 0; ahead <= reach && out.length < count; ahead++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ahead);
    for (const minutes of runsOnDay(schedule, day)) {
      const at = new Date(day);
      at.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
      if (at.getTime() > now.getTime()) out.push(at);
      if (out.length === count) break;
    }
  }
  return out;
}

/** Local "YYYY-MM-DD", the shape a routine's date is kept in. */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** How many days ahead a once's date is, so the search reaches it. */
function onceReach(date: string | undefined, now: Date): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? "");
  if (!match) return -1;
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((day.getTime() - today.getTime()) / 86_400_000);
}

/**
 * Where a check-in sits in a day column drawn from `startHour` to
 * `endHour`, in minutes from the column's top: one band over its hours,
 * and a tick for each check-in inside what is drawn. Null when none of
 * its hours are on the column. One band, not a card per check-in, so a
 * check-in every quarter of an hour does not bury the week.
 */
export function checkInBand(
  routine: { every?: number; activeHours?: { from: string; to: string } },
  startHour: number,
  endHour: number,
): { top: number; height: number; ticks: number[] } | null {
  if (!routine.every) return null;
  const from = minutesOf(routine.activeHours?.from) ?? 0;
  const to = minutesOf(routine.activeHours?.to) ?? 24 * 60 - 1;
  const drawnFrom = startHour * 60;
  const drawnTo = endHour * 60;
  const top = Math.max(from, drawnFrom);
  const bottom = Math.min(to, drawnTo);
  if (bottom <= top) return null;
  const ticks: number[] = [];
  for (let at = from; at <= to; at += routine.every) {
    if (at >= drawnFrom && at <= drawnTo) ticks.push(at - top);
  }
  return { top: top - drawnFrom, height: bottom - top, ticks };
}
