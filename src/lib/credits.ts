// What the app says about Bloks AI, kept apart from the screens so it can
// be held to what the server sends (server/credits.ts, server/bloks-ai.ts).
//
// Nothing here prices anything, and nothing here names a model. What is
// left is a share of the month, as the service says it; the engine is
// called Bloks AI and has one model of the same name. This file only
// says those, and says whether an agent's runs are on Bloks AI, which is
// what decides whether a refusal for a used-up allowance is this agent's
// business. Bloks AI is its own engine, and Claude Code runs on the
// person's own Claude plan or key. (The engine id and the routes still say
// credits, which is what it was called first.)

import { formatDate, formatNumber, inEnglish, t } from "./i18n.ts";

export const CREDITS_ENGINE = "bloks";
export const BLOKS_AI_NAME = "Bloks AI";

interface EngineLike {
  instanceId: string;
  driverKind: string;
}

interface AgentLike {
  modelSelection?: { instanceId: string } | null;
}

/** Whether this agent's runs are on Bloks AI: the Bloks engine, and
 * nothing else. */
export function runsOnCredits(bot: AgentLike, instances: EngineLike[]): boolean {
  const id = bot.modelSelection?.instanceId;
  if (!id) return false;
  return id === CREDITS_ENGINE || instances.find((i) => i.instanceId === id)?.driverKind === CREDITS_ENGINE;
}

export interface CreditsRefusal {
  at: number;
  message: string;
}

/**
 * The refusal to show in this agent's composer, or null: one standing,
 * on an agent on Bloks AI, and not one the person already put away. A
 * later refusal is a new one and shows again.
 */
export function refusalToShow(
  refused: CreditsRefusal | null | undefined,
  onCredits: boolean,
  dismissedAt: number | null,
): CreditsRefusal | null {
  if (!refused || !onCredits) return null;
  if (dismissedAt !== null && dismissedAt >= refused.at) return null;
  return refused;
}

// ── what is left ──────────────────────────────────────────────────────

/** GET /api/credits, as the server says it. */
export interface BloksAiStatus {
  offered: boolean;
  background: boolean;
  refused: CreditsRefusal | null;
  checkoutUrl: string;
  team: boolean | null;
  fromEnvironment: boolean;
  needsKey: boolean;
  connected: boolean;
  plan: string | null;
  usedPercent: number | null;
  leftPercent: number | null;
  monthlyLeftPercent: number | null;
  topUps: number | null;
  renewsAt: number | null;
  /** Of the month, the share used today, and a day's limit as a share
   * of the month (it can be set above the whole month). A server from
   * before the daily limit leaves them out. */
  usedTodayPercent?: number | null;
  dailyLimitPercent?: number | null;
  dailyResetsAt?: number | null;
  low: boolean;
  members: Array<{ member: string; name: string | null; usedPercent: number; dailyCapPercent: number | null }> | null;
  teamSignInWarning: string | null;
  readAt: number | null;
  problem: string | null;
}

/** A share, as a whole percent unless it is under one. */
export function percentText(value: number): string {
  const v = Math.max(0, Math.min(100, value));
  if (v > 0 && v < 1) return t("credits.underPercent", { percent: formatNumber(0.01, { style: "percent" }) });
  return formatNumber(Math.round(v) / 100, { style: "percent" });
}

/** The meter's share: this month's, or all that is left when the service
 * does not split them. */
export function meterShare(status: Pick<BloksAiStatus, "monthlyLeftPercent" | "leftPercent">): number {
  return Math.max(0, Math.min(100, status.monthlyLeftPercent ?? status.leftPercent ?? 0));
}

/** The meter's words: "62% of this month left". */
export function meterLine(status: Pick<BloksAiStatus, "monthlyLeftPercent" | "leftPercent">): string {
  const share = meterShare(status);
  return share <= 0 ? t("credits.nothingLeft") : t("credits.leftThisMonth", { percent: percentText(share) });
}

/** Top-ups still to spend, in months' worth: "plus 1 top-up", or with
 * `start` "Plus 1 top-up", for a line that opens with it. The capital is its
 * own sentence rather than code upper-casing the first letter, which is
 * not what every language does at the start of a line. */
export function topUpsLine(topUps: number | null | undefined, start = false): string | null {
  if (!topUps || !(topUps > 0)) return null;
  const n = Math.round(topUps * 10) / 10;
  if (n === 0) return t(start ? "credits.plusPartOfTopUpStart" : "credits.plusPartOfTopUp");
  return t(start ? "credits.plusTopUpsStart" : "credits.plusTopUps", { count: n });
}

/** When the month starts again: "renews Nov 19", or with `start`
 * "Renews Nov 19". */
export function renewsLine(renewsAt: number | null | undefined, locale?: string, start = false): string | null {
  if (!renewsAt) return null;
  const at = new Date(renewsAt);
  if (Number.isNaN(at.getTime())) return null;
  const options = { month: "short", day: "numeric" } as const;
  return t(start ? "credits.renewsStart" : "credits.renews", { date: locale ? at.toLocaleDateString(locale, options) : formatDate(at, options) });
}

/** The line under the meter, joined: "Plus 1 top-up · renews Nov 19". */
export function allowanceNote(status: Pick<BloksAiStatus, "topUps" | "renewsAt" | "low">, locale?: string): string | null {
  const topUps = topUpsLine(status.topUps, true);
  const parts = [topUps, renewsLine(status.renewsAt, locale, !topUps)].filter(Boolean) as string[];
  if (!parts.length) return status.low ? t("credits.runningLow") : null;
  return parts.join(" · ");
}

/** What Top up buys, said without an amount, in the reader's language. */
export function topUpWords(): string {
  return t("credits.topUpWords");
}

/** The same in English, for a caller that has not moved to topUpWords(). */
export const TOP_UP_WORDS = inEnglish("credits.topUpWords");

// ── a team ────────────────────────────────────────────────────────────

/** One teammate's row: their name here when this workspace knows them,
 * what they have used, and their cap. */
export interface MemberRow {
  member: string;
  name: string;
  used: string;
  cap: string;
  capPercent: number | null;
}

export function memberRows(members: BloksAiStatus["members"]): MemberRow[] {
  return (members ?? []).map((m) => ({
    member: m.member,
    name: m.name ?? t("credits.someoneGone"),
    used: t("credits.usedThisMonth", { percent: percentText(m.usedPercent) }),
    cap: m.dailyCapPercent === null ? t("credits.noDailyCap") : t("credits.upToADay", { percent: percentText(m.dailyCapPercent) }),
    capPercent: m.dailyCapPercent,
  }));
}

/** A cap as typed: a share of the month above nothing and at most all of
 * it, or null for none (an empty field). Undefined is not a cap. */
export function parseCap(text: string): number | null | undefined {
  const typed = text.trim().replace(/%$/, "").trim();
  if (!typed) return null;
  const n = Number(typed);
  if (!Number.isFinite(n) || n <= 0 || n > 100) return undefined;
  return Math.round(n * 10) / 10;
}

// ── a team on personal sign-ins ───────────────────────────────────────

/** The warning in English; teamSignInWarning() says it in the reader's language. */
export const TEAM_SIGN_IN_WARNING = inEnglish("credits.teamSignInWarning");

/** Whether an agent runs on somebody's personal sign-in: Claude Code on
 * its own login, or Codex on its ChatGPT one (server/bloks-ai.ts). */
export function onPersonalSignIn(bot: AgentLike, instances: EngineLike[]): boolean {
  const kind = instances.find((i) => i.instanceId === bot.modelSelection?.instanceId)?.driverKind;
  return kind === "claudeAgent" || kind === "codex";
}

/** The warning on a hosted team workspace, for these agents, or null. */
export function teamSignInWarning(opts: { hosted: boolean; team: boolean | null | undefined; agents: AgentLike[]; instances: EngineLike[] }): string | null {
  if (!opts.hosted || opts.team !== true) return null;
  return opts.agents.some((a) => onPersonalSignIn(a, opts.instances)) ? t("credits.teamSignInWarning") : null;
}

/** Where a dismissed warning is remembered on this computer. */
export const TEAM_WARNING_KEY = "bloks.teamSignInWarning.dismissed";
