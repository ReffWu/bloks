// The Usage page in words and numbers: what each figure says, how it is
// written, what a filter remembers. The server decides what was spent
// and what counts as a price (server/usage.ts, server/spend-limits.ts);
// this decides how to say it, and when the honest thing to say is that
// nobody reported a price.
//
// Kept apart from the components so the wording and the arithmetic can
// be tested without a DOM.

import { shortTokens } from "./contextCard.ts";

export type UsageRange = "7d" | "30d" | "90d" | "month";
export type UsageMetric = "cost" | "tokens" | "turns";
export type BreakdownTab = "agent" | "engine" | "day";

/** One span's tally, as GET /api/usage/report sends it. */
export interface UsageTotals {
  turns: number;
  input: number;
  output: number;
  /** Dollars, from engines that priced their turns only. */
  cost: number;
  unmeasured: number;
}

export interface UsageRow extends UsageTotals {
  id: string;
  priced: boolean;
}

export interface UsageDay extends UsageTotals {
  date: string;
  byEngine: Record<string, UsageTotals>;
}

/** GET /api/usage/report. */
export interface UsageReport {
  range: UsageRange;
  from: string;
  to: string;
  days: number;
  daily: UsageDay[];
  byAgent: UsageRow[];
  byEngine: UsageRow[];
  total: UsageTotals;
  previous: UsageTotals;
  priced: boolean;
  unpricedTurns: number;
  bloksAiTurns: number;
  agents: string[];
  engines: string[];
}

/** One engine on the person's own key, as GET /api/spend-limits says. */
export interface SpendLimitRow {
  instanceId: string;
  name: string;
  driverKind: string;
  limit: number | null;
  spent: number;
  priced: boolean;
  reportsPrice: boolean;
  usedPercent: number | null;
  reached: boolean;
  level: "info" | "warn" | "stop" | null;
  resetsAt: number;
}

export const RANGES: Array<{ value: UsageRange; label: string }> = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "month", label: "This month" },
];

export const METRICS: Array<{ value: UsageMetric; label: string }> = [
  { value: "cost", label: "Cost" },
  { value: "tokens", label: "Tokens" },
  { value: "turns", label: "Turns" },
];

/** The Bloks engine's id, whose turns are never priced here. */
export const BLOKS_AI_ENGINE = "bloks";

// ── what the person chose, kept on this device ─────────────────────────

export interface UsageView {
  range: UsageRange;
  metric: UsageMetric;
  bot: string | null;
  engine: string | null;
  tab: BreakdownTab;
}

export const DEFAULT_VIEW: UsageView = { range: "30d", metric: "cost", bot: null, engine: null, tab: "agent" };

const VIEW_KEY = "bloks-usage-view";

/** The last choices on this device, each one checked, so an old or
 * damaged value falls back to the default rather than breaking the page. */
export function readView(storage: Pick<Storage, "getItem"> | null = safeStorage()): UsageView {
  try {
    const saved = JSON.parse(storage?.getItem(VIEW_KEY) ?? "{}") as Partial<UsageView>;
    const one = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
      allowed.includes(value as T) ? (value as T) : fallback;
    const id = (value: unknown) => (typeof value === "string" && value ? value : null);
    return {
      range: one(saved.range, RANGES.map((r) => r.value), DEFAULT_VIEW.range),
      metric: one(saved.metric, METRICS.map((m) => m.value), DEFAULT_VIEW.metric),
      bot: id(saved.bot),
      engine: id(saved.engine),
      tab: one(saved.tab, ["agent", "engine", "day"] as const, DEFAULT_VIEW.tab),
    };
  } catch {
    return DEFAULT_VIEW;
  }
}

export function saveView(view: UsageView, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(VIEW_KEY, JSON.stringify(view));
  } catch {
    /* holds for this visit */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

// ── figures ────────────────────────────────────────────────────────────

/** A tally's number in one metric. */
export function valueOf(totals: UsageTotals, metric: UsageMetric): number {
  if (metric === "cost") return totals.cost;
  if (metric === "tokens") return totals.input + totals.output;
  return totals.turns;
}

/** Dollars the way a bill writes them: "$12.40", "$1,204.18", and
 * "under $0.01" for a price too small to write in cents, which a bare
 * "$0.00" would show as free. */
export function money(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0.00";
  if (usd < 0.01) return "under $0.01";
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Dollars on an axis, as short as they can be and still be read. */
export function axisMoney(usd: number): string {
  if (usd === 0) return "$0";
  if (usd >= 1_000) return `$${shortTokens(usd)}`;
  if (usd >= 10) return `$${Math.round(usd)}`;
  return `$${usd.toFixed(usd < 1 ? 2 : 1).replace(/\.0$/, "")}`;
}

/** "1 turn", "12 turns", with the thousands grouped. */
export function turnsText(n: number): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? "turn" : "turns"}`;
}

/** A metric's figure in full, for the headline and a tooltip. */
export function figure(value: number, metric: UsageMetric): string {
  if (metric === "cost") return money(value);
  if (metric === "tokens") return shortTokens(value);
  return value.toLocaleString("en-US");
}

/** A metric's figure on an axis. */
export function axisFigure(value: number, metric: UsageMetric): string {
  if (metric === "cost") return axisMoney(value);
  return value === 0 ? "0" : shortTokens(value);
}

/** A share of a whole, as a percent: "42%", and "under 1%" for a sliver
 * a rounded 0% would hide. */
export function shareText(part: number, whole: number): string {
  if (!(whole > 0) || !(part > 0)) return "0%";
  const share = (part / whole) * 100;
  if (share < 1) return "under 1%";
  return `${Math.round(share)}%`;
}

/**
 * Against the span before: "12% more than the 30 days before", or null
 * when there is nothing to compare with, since growth from nothing is no
 * percent at all. Within half a percent either way is about the same.
 */
export function deltaLine(now: number, before: number, days: number): { text: string; direction: "up" | "down" | "flat" } | null {
  if (!(before > 0) || !Number.isFinite(now)) return null;
  const change = ((now - before) / before) * 100;
  const span = `the ${days} ${days === 1 ? "day" : "days"} before`;
  if (Math.abs(change) < 0.5) return { text: `About the same as ${span}`, direction: "flat" };
  // past ten times, a percent stops meaning anything to anybody
  if (change >= 900) return { text: `${Math.round(now / before)} times ${span}`, direction: "up" };
  return { text: `${Math.round(Math.abs(change))}% ${change > 0 ? "more" : "less"} than ${span}`, direction: change > 0 ? "up" : "down" };
}

/**
 * The quiet line under the headline: how many turns, and whatever the
 * figure leaves out. A cost is an estimate from what the engines said, in
 * US dollars; turns on an engine that names no price are not in it, and
 * Bloks AI never is.
 */
export function headlineNotes(report: Pick<UsageReport, "total" | "unpricedTurns" | "bloksAiTurns" | "priced">, metric: UsageMetric): string[] {
  const notes = [turnsText(report.total.turns)];
  if (metric === "cost" && report.priced) {
    notes.push("estimate from what engines report", "USD");
    if (report.unpricedTurns > 0) notes.push(`${turnsText(report.unpricedTurns)} with no price reported`);
  }
  if (metric === "cost" && report.bloksAiTurns > 0) notes.push(`${turnsText(report.bloksAiTurns)} on Bloks AI, never priced`);
  if (report.total.unmeasured > 0) notes.push(`${turnsText(report.total.unmeasured)} unmeasured`);
  return notes;
}

// ── dates ──────────────────────────────────────────────────────────────

/** A local YYYY-MM-DD as a Date at noon, where no change of clocks lands. */
export function dayOf(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}

/** "Oct 3", for an axis or a row. */
export function shortDay(date: string, locale?: string): string {
  return dayOf(date).toLocaleDateString(locale ?? "en-US", { month: "short", day: "numeric" });
}

/** "Fri, Oct 3", for a tooltip. */
export function longDay(date: string, locale?: string): string {
  return dayOf(date).toLocaleDateString(locale ?? "en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** "Tops up Nov 1": when a spending limit's month starts again, in the
 * words the composer's notice uses for it. */
export function topsUpLine(at: number, locale?: string): string {
  return `Tops up ${new Date(at).toLocaleDateString(locale ?? "en-US", { month: "short", day: "numeric" })}`;
}

// ── the chart's scale ──────────────────────────────────────────────────

/** Round numbers from zero to past the highest value, three or four of
 * them, so the gridlines fall on figures a person would say. */
export function niceTicks(max: number): number[] {
  if (!(max > 0)) return [0];
  const raw = max / 3;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

// ── the breakdown ──────────────────────────────────────────────────────

export type SortKey = "name" | "value" | "share" | "tokens";

/**
 * Rows in the order asked for. Value and share sort alike (a share is a
 * value over one total); the day tab's names are dates, which sort as
 * text. Ties keep the busiest first, so the order never jumps between
 * two clicks on the same header.
 */
export function sortRows<T extends UsageTotals>(rows: T[], key: SortKey, descending: boolean, metric: UsageMetric, name: (row: T) => string): T[] {
  const by = (row: T): number | string =>
    key === "name" ? name(row).toLowerCase() : key === "tokens" ? row.input + row.output : valueOf(row, metric);
  return [...rows].sort((a, b) => {
    const x = by(a);
    const y = by(b);
    const order = typeof x === "string" ? x.localeCompare(y as string) : x - (y as number);
    return (descending ? -order : order) || b.input + b.output - (a.input + a.output);
  });
}
