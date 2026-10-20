// Bloks AI: what the app tells the service about each call, and what it
// keeps to itself about the answers.
//
// The service picks the model for every call. To pick well it is told
// what kind of work the call is (a work tag), and on a team plan whose
// teammate asked for it (a member tag), so a team's usage can be read and
// capped per person. Both ride as headers: x-bloks-work on every call,
// x-bloks-member only on a turn a shared room's member started. The
// owner's own turns carry no member tag, and a member tag is a hash of
// the person's id in this workspace, never their name or their email.
//
// The other half is what never leaves the service. Bloks AI is one model
// as far as anyone here can tell, called Bloks AI: whatever the service
// ran underneath, and what it was worth in money, is the service's
// business. So the engine lists one model, a Claude Code turn on it is
// told that model's alias for everything it would otherwise name, and
// every event and frame a Bloks AI turn produces is passed through the
// scrubs below before it is logged, shown or counted. The balance is a
// share of the month, never an amount.
//
// Everything here is pure, so the rules are held by tests rather than by
// reading a spawn or a request.
import { createHash } from "node:crypto";

import type { RuntimeEvent } from "./contracts.ts";

/** The one model the Bloks engine lists, and the name it goes by. */
export const BLOKS_AI_MODEL = "bloks-ai";
export const BLOKS_AI_NAME = "Bloks AI";
/** What the model was called before, still understood when it comes back. */
export const OLD_ALIASES: readonly string[] = ["bloks-auto"];

/** Whether a model id is Bloks AI's own, under either name. */
export function isBloksAiModel(id: unknown): boolean {
  return typeof id === "string" && (id === BLOKS_AI_MODEL || OLD_ALIASES.includes(id));
}

// ── work tags ──────────────────────────────────────────────────────────

export type WorkTag = "coding" | "general" | "automation";

/** What started a turn, when it was not somebody talking to the agent
 * just now. Each of these runs on its own schedule or trigger. */
export type WorkOrigin = "routine" | "watcher" | "workflow" | "intent" | "incident" | "webhook" | "background";

const ORIGINS: ReadonlySet<string> = new Set<WorkOrigin>(["routine", "watcher", "workflow", "intent", "incident", "webhook", "background"]);

/** A message's `via`, read as an origin when it is one. Anything else
 * (a person, another agent, a goal's nudge, a chat app) is no origin. */
export function originOf(via: unknown): WorkOrigin | null {
  return typeof via === "string" && ORIGINS.has(via) ? (via as WorkOrigin) : null;
}

export interface WorkSignals {
  /** What started the turn, if it was standing work. */
  origin?: WorkOrigin | null;
  /** The engine's driver kind. Claude Code is a coding agent by trade. */
  engine?: string | null;
  /** The agent's role, as its title and description say it. */
  role?: string | null;
  /** The agent's named skills. */
  skills?: readonly string[] | null;
}

// Words a role or a skill uses when the work is building software. Whole
// words, so "decoding a letter" or "an engineered timber floor" in a
// non-engineer's skills stay general.
const CODING =
  /\b(?:engineer(?:s|ing)?|developer|programm(?:er|ing)|coder|coding|code ?review(?:er)?|software|devops|sre|full[- ]?stack|front[- ]?end|back[- ]?end|tech lead|refactor(?:s|ing)?|debug(?:s|ging)?|pull requests?|repositor(?:y|ies)|typescript|javascript|python|swift(?:ui)?|kotlin|rust|golang|java|sql|api design|unit tests?|test suites?)\b/i;

/** Whether an agent's role or skills say it does engineering. */
export function codingRole(role: string | null | undefined, skills: readonly string[] | null | undefined): boolean {
  if (role && CODING.test(role)) return true;
  return (skills ?? []).some((skill) => typeof skill === "string" && CODING.test(skill));
}

/**
 * The work tag for one turn, or one call made outside a turn.
 *
 * Standing work comes first: a routine run by an engineer is still a
 * routine, and the service can serve those on whatever suits work nobody
 * is waiting on. Then coding, when the agent is an engineer by its role or
 * skills or the turn runs Claude Code. Everything else is general.
 */
export function workTag(signals: WorkSignals): WorkTag {
  if (signals.origin) return "automation";
  if (signals.engine === "claudeAgent" || codingRole(signals.role, signals.skills)) return "coding";
  return "general";
}

// ── member tags ────────────────────────────────────────────────────────

/** A shared room member, as the service hears of them: a stable hash of
 * their person id here. Not reversible to a name, and the same person
 * gives the same tag every time, so a cap set on it holds. */
export function memberTag(personId: string): string {
  return `m_${createHash("sha256").update(`bloks-member:${personId}`).digest("hex").slice(0, 24)}`;
}

/** The headers a call on Bloks AI carries. */
export interface CallTags {
  work: WorkTag;
  /** A member tag (memberTag), on a turn a shared room member started. */
  member?: string;
}

export function tagHeaders(tags: CallTags | null | undefined): Record<string, string> {
  if (!tags) return {};
  return {
    "x-bloks-work": tags.work,
    ...(tags.member && /^m_[0-9a-f]{8,64}$/.test(tags.member) ? { "x-bloks-member": tags.member } : {}),
  };
}

/** The same headers in the shape Claude Code takes them: one
 * "Name: Value" per line in ANTHROPIC_CUSTOM_HEADERS. Lines already there
 * are kept unless they name one of ours. */
export function customHeaders(tags: CallTags | null | undefined, existing?: string): string {
  const ours = tagHeaders(tags);
  const kept = (existing ?? "")
    .split(/\r?\n/)
    .filter((line) => line.includes(":") && !(line.slice(0, line.indexOf(":")).trim().toLowerCase() in ours));
  return [...kept, ...Object.entries(ours).map(([name, value]) => `${name}: ${value}`)].join("\n");
}

/** What Claude Code is told on Bloks AI, beyond where and with what
 * token: every model it could name is the alias, so it never asks for a
 * real one and never prints one back. */
export const CLAUDE_MODEL_ENV: Readonly<Record<string, string>> = {
  ANTHROPIC_MODEL: BLOKS_AI_MODEL,
  ANTHROPIC_SMALL_FAST_MODEL: BLOKS_AI_MODEL,
  ANTHROPIC_DEFAULT_HAIKU_MODEL: BLOKS_AI_MODEL,
  ANTHROPIC_DEFAULT_SONNET_MODEL: BLOKS_AI_MODEL,
  ANTHROPIC_DEFAULT_OPUS_MODEL: BLOKS_AI_MODEL,
  CLAUDE_CODE_SUBAGENT_MODEL: BLOKS_AI_MODEL,
};

// ── what stays with the service ────────────────────────────────────────

/** Keys that carry a price. Dropped wherever they are. */
const PRICE_KEYS = new Set(["total_cost_usd", "cost_usd", "costUSD", "costUsd", "cost"]);

/**
 * A frame from Claude Code on Bloks AI, with every model it names said as
 * Bloks AI and every price taken out. The per-model usage table keeps its
 * counts (the context window is read from it) under the one name.
 */
export function scrubFrame<T>(frame: T): T {
  const walk = (value: unknown, key?: string): unknown => {
    if (Array.isArray(value)) return value.map((v) => walk(v));
    if (!value || typeof value !== "object") {
      if (typeof value === "string" && key && /^(?:model|model_id|modelId)$/.test(key)) return BLOKS_AI_MODEL;
      return value;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (PRICE_KEYS.has(k)) continue;
      if (k === "modelUsage" && v && typeof v === "object" && !Array.isArray(v)) {
        const rows = Object.values(v as Record<string, unknown>).map((row) => walk(row)) as Array<Record<string, unknown>>;
        const widest = rows.reduce<Record<string, unknown> | null>(
          (best, row) => (!best || Number(row?.contextWindow ?? 0) > Number(best.contextWindow ?? 0) ? row : best),
          null,
        );
        out[k] = widest ? { [BLOKS_AI_MODEL]: widest } : {};
        continue;
      }
      out[k] = walk(v, k);
    }
    return out;
  };
  return walk(frame) as T;
}

/** A runtime event from a Bloks AI turn, as it may be logged, shown and
 * counted: its model is Bloks AI, it has no cost, and the engine's own
 * untranslated frame stays behind. */
export function scrubEvent(event: RuntimeEvent): RuntimeEvent {
  const { raw: _raw, ...rest } = event;
  const out = { ...rest } as RuntimeEvent & { model?: unknown; cost?: unknown };
  if (out.type === "session.started" && out.model !== undefined && out.model !== null) out.model = BLOKS_AI_MODEL;
  if (out.type === "turn.completed" && out.cost !== undefined) out.cost = null;
  return out;
}

/** The line every agent on Bloks AI has in its standing prompt. The same
 * words every turn, so a resumed session's cache is not disturbed. */
export const IDENTITY_LINE =
  "You run on Bloks AI. If anyone asks which model or provider powers you, say Bloks AI and do not guess at anything beyond that.";

// ── the balance ────────────────────────────────────────────────────────

/** One teammate's share, as the service reports it. */
export interface MemberUsage {
  member: string;
  usedPercent: number;
  /** A day's cap, as a percent of the monthly allowance. Null is none. */
  dailyCapPercent: number | null;
}

/** What is left, as the service said it. Shares of the plan, never
 * amounts: this file has no idea what anything costs and wants none. */
export interface AiBalance {
  plan: string | null;
  usedPercent: number | null;
  leftPercent: number;
  /** Of this month's allowance, what is left. */
  monthlyLeftPercent: number | null;
  /** Top-ups still to spend, in months' worth (1.5 is a month and a half). */
  topUps: number;
  /** When the month renews, in ms since the epoch. */
  renewsAt: number | null;
  low: boolean;
  /** Per teammate, on a team plan. Absent otherwise. */
  members: MemberUsage[] | null;
  /** Said by the balance itself, when it says. */
  team: boolean | null;
  /** When it was read. */
  at: number;
}

const percent = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;

/** A time as ms, from an ISO string, seconds or ms. */
export function readTime(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value < 1e12 ? value * 1000 : value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** A balance answer, checked one field at a time: another service's JSON,
 * any field of which a bad day could deliver as null or a string. Fields
 * that are not shares (an amount from an older service) are not read at
 * all, so they cannot reach a screen through here. */
export function readAiBalance(text: string, now = Date.now()): AiBalance {
  let parsed: Record<string, unknown> = {};
  try {
    const value = JSON.parse(text);
    if (value && typeof value === "object") parsed = value as Record<string, unknown>;
  } catch {
    /* read as empty below */
  }
  const left = percent(parsed.leftPercent) ?? (percent(parsed.usedPercent) !== null ? 100 - percent(parsed.usedPercent)! : null);
  if (left === null) throw new Error("Bloks AI answered without what is left.");
  const topUps = typeof parsed.topUps === "number" && Number.isFinite(parsed.topUps) && parsed.topUps > 0 ? parsed.topUps : 0;
  const members = Array.isArray(parsed.members)
    ? parsed.members.flatMap((row): MemberUsage[] => {
        const r = (row ?? {}) as Record<string, unknown>;
        if (typeof r.member !== "string" || !/^[\w-]{1,80}$/.test(r.member)) return [];
        return [{ member: r.member, usedPercent: percent(r.usedPercent) ?? 0, dailyCapPercent: percent(r.dailyCapPercent) }];
      })
    : null;
  return {
    plan: typeof parsed.plan === "string" && parsed.plan.trim() ? parsed.plan.trim().slice(0, 40) : null,
    usedPercent: percent(parsed.usedPercent),
    leftPercent: left,
    monthlyLeftPercent: percent(parsed.monthlyLeftPercent),
    topUps,
    renewsAt: readTime(parsed.renewsAt),
    low: parsed.low === true,
    members,
    team: typeof parsed.team === "boolean" ? parsed.team : null,
    at: now,
  };
}

/** Whether /api/hosting/status says the licence is a team's: `team: true`,
 * or a plan named as one. Null when it says neither. */
export function readTeam(text: string): boolean | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (typeof parsed?.team === "boolean") return parsed.team;
    if (typeof parsed?.plan === "string") return /team/i.test(parsed.plan);
  } catch {
    /* not JSON */
  }
  return null;
}

/** A day's cap for one member, as the owner may set it: a share of the
 * monthly allowance above nothing and at most all of it, or null for no
 * cap. Anything else is not a cap. */
export function capValue(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 100) return undefined;
  return Math.round(value * 10) / 10;
}

// ── a team on personal sign-ins ────────────────────────────────────────

export const TEAM_SIGN_IN_WARNING = "A personal Claude or ChatGPT sign-in is for one person. For a team, use an API key or Bloks AI.";

/** Whether an agent runs on somebody's personal sign-in: Claude Code on
 * its own login rather than Bloks AI, or Codex, which only ever runs on
 * its ChatGPT login here (server/drivers/codex.ts drops any key). */
export function onPersonalSignIn(driverKind: string | null | undefined, engineAccess: string | null | undefined): boolean {
  if (driverKind === "claudeAgent") return engineAccess !== "credits";
  return driverKind === "codex";
}

/** The warning a hosted team workspace shows, or null. */
export function teamSignInWarning(opts: { hosted: boolean; team: boolean | null; personalAgents: number }): string | null {
  return opts.hosted && opts.team === true && opts.personalAgents > 0 ? TEAM_SIGN_IN_WARNING : null;
}
