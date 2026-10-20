// A monthly spending limit on the person's own API keys.
//
// An engine on somebody's own key used to run until the provider said
// no, which on a key with no cap of its own can be a long way past what
// anybody meant to spend. A limit is the person's own line, per engine:
// so many dollars in a calendar month, local time, after which Bloks
// starts no new turn on that engine until the month turns or the line
// is raised. A turn already running finishes; stopping one halfway would
// waste what it had already spent.
//
// It counts what the engine priced and, for an engine that reports
// tokens and no price, those tokens at the providers' list price or at
// the person's own price for it (server/model-prices.ts), kept as an
// estimate and said as one. A model nobody has a price for is never
// guessed at: guessing would be inventing the number a limit exists to
// be honest about, so its turns count nothing and the page says so.
// Bloks AI is never limited here: it is an allowance with its own shares
// and its own daily cap, and has no price.
//
// The limits live in config.json (spendLimits, by engine instance),
// beside the keys they are about, since a key is per engine. Everything
// below is pure.

import { localDate, type UsageBucket } from "./usage.ts";
import type { UsageLevel, UsageNotice } from "./contracts.ts";

/** The highest limit anybody may set, which is past what a typo could
 * mean and short of a number that stops being a limit at all. */
export const MAX_LIMIT_USD = 100_000;

/** Past this share the limit is close, as a plan window is. */
const NEAR = 0.8;
/** A month this new has not been used long enough to say much about pace. */
const PACE_AFTER = 0.1;
/** Under this share nobody needs telling, however fast it went. */
const PACE_FROM = 0.25;

/** A calendar month as YYYY-MM, in local time. */
export function monthKey(at: Date = new Date()): string {
  return localDate(at).slice(0, 7);
}

/** When this month began and when the next one begins, local midnight on
 * each first, in epoch milliseconds. */
export function monthBounds(at: Date = new Date()): { start: number; end: number } {
  return {
    start: new Date(at.getFullYear(), at.getMonth(), 1).getTime(),
    end: new Date(at.getFullYear(), at.getMonth() + 1, 1).getTime(),
  };
}

/** A limit as asked for: dollars above nothing and at most MAX_LIMIT_USD,
 * to the cent, or null to take it off. Undefined is neither, and is
 * refused. */
export function readLimit(value: unknown): number | null | undefined {
  if (value === null) return null;
  const n = typeof value === "string" ? Number(value.trim().replace(/^\$/, "")) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  const cents = Math.round(n * 100) / 100;
  return cents > 0 && cents <= MAX_LIMIT_USD ? cents : undefined;
}

/** What one engine has spent in a month, from the buckets of that month,
 * whether it priced anything at all, and whether any of it is an
 * estimate from tokens, which makes the whole figure one. */
export function monthSpend(
  buckets: Iterable<UsageBucket>,
  instanceId: string,
  month: string,
): { spent: number; priced: boolean; estimated: boolean } {
  let spent = 0;
  let priced = false;
  let estimated = false;
  for (const b of buckets) {
    if (b.provider !== instanceId || !b.date.startsWith(`${month}-`) || !b.costKnown) continue;
    spent += b.cost;
    priced = true;
    if ((b.estimated ?? 0) > 0) estimated = true;
  }
  return { spent, priced, estimated };
}

export interface SpendStatus {
  limit: number;
  spent: number;
  /** A whole percent, 0 to 100, for a bar and a notice. */
  usedPercent: number;
  /** At the limit or past it: no new turn starts. */
  reached: boolean;
  /** What the composer should say, if anything. */
  level: UsageLevel | null;
  /** When the month turns, epoch milliseconds. */
  resetsAt: number;
  month: string;
}

/**
 * Where one engine stands against its limit. At the limit is a stop;
 * past four fifths is near it; on pace is a share used ahead of the
 * share of the month gone by, by the same rule as a plan's windows
 * (server/plan-usage.ts): once a tenth of the month has passed and a
 * quarter is used, so the first busy morning of a month does not read as
 * a run on it.
 */
export function spendStatus(limit: number, spent: number, now = Date.now()): SpendStatus {
  const at = new Date(now);
  const { start, end } = monthBounds(at);
  const used = limit > 0 ? Math.max(0, spent) / limit : 0;
  const reached = limit > 0 && spent >= limit;
  // the share as it is shown, so a card that reads "80% used" also warns:
  // 79.6% is shown as 80%, and a warning held back for the 0.4 would be
  // the page disagreeing with itself. Short of the line it never reads
  // 100%, which would say turns had stopped when they have not.
  const usedPercent = reached ? 100 : Math.min(99, Math.max(0, Math.round(used * 100)));
  let level: UsageLevel | null = null;
  if (reached) level = "stop";
  else if (usedPercent >= NEAR * 100) level = "warn";
  else {
    const elapsed = (now - start) / (end - start);
    if (elapsed >= PACE_AFTER && used >= PACE_FROM && used / elapsed > 1) level = "info";
  }
  return {
    limit,
    spent,
    usedPercent,
    reached,
    level,
    resetsAt: end,
    month: monthKey(at),
  };
}

/**
 * What one engine's limit should say in the composer: nothing, or one
 * notice, in the words the plan notices use with "spending" in them. A
 * share and a date, never an amount, which is all a notice ever carries.
 * The id carries the level and the month, so a notice put away comes
 * back at a worse level or in a new month, and not before.
 */
export function spendNotices(instanceId: string, limit: number | null | undefined, spent: number, now = Date.now()): UsageNotice[] {
  if (!limit || !(limit > 0)) return [];
  const status = spendStatus(limit, spent, now);
  if (!status.level) return [];
  return [
    {
      id: `${instanceId}:spend:${status.level}:${status.month}`,
      source: instanceId,
      level: status.level,
      title: status.level === "stop" ? "Spending limit reached" : "Approaching spending limit",
      usedPercent: status.usedPercent,
      resetsAt: status.resetsAt,
      kind: "spend",
    },
  ];
}

/**
 * The provider's own refusal for money (an empty balance, a billing cap
 * set on its side), said the way a limit of Bloks' own is. Nobody knows
 * when the provider will take a turn again, so it gives no reset; the id
 * carries when the refusal started, so a new one after a top-up that ran
 * out again is news.
 */
export function providerCreditNotice(instanceId: string, since: number): UsageNotice {
  return {
    id: `${instanceId}:credit:stop:${since}`,
    source: instanceId,
    level: "stop",
    title: "Spending limit reached",
    usedPercent: 100,
    resetsAt: null,
  };
}

/** Dollars to the cent, the way a limit is set. */
export function dollarsExact(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/** Why a turn did not start: whose limit, how much, and the two ways on. */
export function spendRefusal(engine: string, limit: number, resetsAt: number, locale?: string): string {
  const month = new Date(resetsAt - 1).toLocaleDateString(locale ?? "en-US", { month: "long" });
  const next = new Date(resetsAt).toLocaleDateString(locale ?? "en-US", { month: "long", day: "numeric" });
  return `${engine} has reached its ${dollarsExact(limit)} spending limit for ${month}, so new turns on it are paused. Raise the limit on the Usage page to carry on, or it starts again on ${next}.`;
}
