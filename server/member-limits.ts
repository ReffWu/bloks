// What each member of the workspace may spend, and on what.
//
// Every turn a member starts runs on the owner's computer with the
// owner's engines and keys, so it is the owner's bill. The owner and the
// admins set, per member: a monthly limit on what API keys cost, a share
// of Bloks AI's monthly allowance, how many solo agents they may make
// (three unless changed), and which engines those agents may use.
//
// A member at their limit is stopped, and only them: their own messages
// and the turns they start are refused with words saying why and who can
// raise it. Nobody else in the workspace notices anything.
//
// What a member has spent is counted here, per calendar month, from the
// cost each of their turns settles with. Bloks AI is not counted here:
// its service already reports each member's share (by the same hashed
// tag the turns carry), and that share is what the percent is held to.
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR } from "./config.ts";
import { readSaved, isRecord, writeFileAtomic } from "./atomic-write.ts";

export interface MemberLimit {
  /** API key cost a month, in dollars. Null is no limit. */
  monthlyUsd: number | null;
  /** Share of Bloks AI's monthly allowance, in percent. Null is no limit. */
  aiPercent: number | null;
  /** Solo agents they may make. */
  maxSolo: number;
  /** Engines (instance ids) their solo agents may run on. Null is any. */
  engines: string[] | null;
}

export const DEFAULT_LIMIT: MemberLimit = { monthlyUsd: null, aiPercent: null, maxSolo: 3, engines: null };
const MAX_SOLO_CAP = 50;
const MAX_USD = 100_000;

interface LimitsFile {
  limits: Record<string, Partial<MemberLimit>>;
  spend: Record<string, { month: string; usd: number }>;
}

/** The calendar month a spend belongs to, local time: "2026-10". */
export function monthOf(at: Date = new Date()): string {
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}`;
}

export class MemberLimits {
  private data: LimitsFile;
  private readonly file: string;

  constructor(file: string = join(DATA_DIR, "member-limits.json")) {
    this.file = file;
    const raw = readSaved<Partial<LimitsFile>>(file, {}, isRecord);
    this.data = {
      limits: isRecord(raw.limits) ? (raw.limits as LimitsFile["limits"]) : {},
      spend: isRecord(raw.spend) ? (raw.spend as LimitsFile["spend"]) : {},
    };
  }

  private save() {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    writeFileAtomic(this.file, JSON.stringify(this.data, null, 2), 0o600);
  }

  limitOf(personId: string): MemberLimit {
    return { ...DEFAULT_LIMIT, ...(this.data.limits[personId] ?? {}) };
  }

  /**
   * Changes some of a member's limits. Each field is checked on its own
   * and the whole change is refused when one is wrong, so a typo never
   * half applies. Returns the limits as they now stand, or why not.
   */
  setLimit(personId: string, patch: Record<string, unknown>, knownEngines?: readonly string[]): MemberLimit | { error: string } {
    const next: Partial<MemberLimit> = { ...(this.data.limits[personId] ?? {}) };
    if ("monthlyUsd" in patch) {
      const v = patch.monthlyUsd;
      if (v === null) next.monthlyUsd = null;
      else if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_USD) next.monthlyUsd = Math.round(v * 100) / 100;
      else return { error: "monthlyUsd is a number of dollars, or null for no limit" };
    }
    if ("aiPercent" in patch) {
      const v = patch.aiPercent;
      if (v === null) next.aiPercent = null;
      else if (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 100) next.aiPercent = Math.round(v * 10) / 10;
      else return { error: "aiPercent is a share above 0 and at most 100, or null for no limit" };
    }
    if ("maxSolo" in patch) {
      const v = patch.maxSolo;
      if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_SOLO_CAP) next.maxSolo = v;
      else return { error: `maxSolo is a whole number from 0 to ${MAX_SOLO_CAP}` };
    }
    if ("engines" in patch) {
      const v = patch.engines;
      if (v === null) next.engines = null;
      else if (Array.isArray(v) && v.every((e) => typeof e === "string" && /^[\w.:-]{1,80}$/.test(e))) {
        const list = [...new Set(v as string[])];
        if (knownEngines && list.some((e) => !knownEngines.includes(e))) return { error: "one of those engines is not set up here" };
        next.engines = list;
      } else return { error: "engines is a list of engine ids, or null for any" };
    }
    this.data.limits[personId] = next;
    this.save();
    return this.limitOf(personId);
  }

  /** A settled turn's cost, on the member who started it. */
  recordSpend(personId: string, usd: number, at: Date = new Date()) {
    if (!(usd > 0) || !Number.isFinite(usd)) return;
    const month = monthOf(at);
    const current = this.data.spend[personId];
    const base = current?.month === month ? current.usd : 0;
    this.data.spend[personId] = { month, usd: Math.round((base + usd) * 1_000_000) / 1_000_000 };
    try {
      this.save();
    } catch {
      /* the count is a guard, not a ledger: a turn never fails over it */
    }
  }

  /** What they have spent on API keys this month. */
  spentThisMonth(personId: string, at: Date = new Date()): number {
    const current = this.data.spend[personId];
    return current?.month === monthOf(at) ? current.usd : 0;
  }

  /**
   * Why this member cannot start anything more right now, in words for
   * them, or null when they can. `aiUsedPercent` is their Bloks AI share
   * as the service last reported it, when it did.
   */
  refusal(personId: string, input: { workspace: string; owner: string; aiUsedPercent?: number | null }, at: Date = new Date()): string | null {
    const limit = this.limitOf(personId);
    if (limit.monthlyUsd !== null && this.spentThisMonth(personId, at) >= limit.monthlyUsd) {
      return `You have reached your monthly limit of ${dollars(limit.monthlyUsd)} in ${input.workspace}. It starts again next month, or ${input.owner} or an admin can raise it.`;
    }
    if (limit.aiPercent !== null && typeof input.aiUsedPercent === "number" && input.aiUsedPercent >= limit.aiPercent) {
      return `You have used your ${limit.aiPercent}% share of Bloks AI in ${input.workspace} this month. ${input.owner} or an admin can raise it.`;
    }
    return null;
  }

  /** Why they cannot make another solo agent, or null. */
  soloRefusal(personId: string, soloCount: number): string | null {
    const { maxSolo } = this.limitOf(personId);
    if (soloCount < maxSolo) return null;
    return maxSolo === 0
      ? "Solo agents are not on for you in this workspace. Ask the owner or an admin."
      : `You have ${soloCount} solo agent${soloCount === 1 ? "" : "s"}, as many as you may make here. Ask the owner or an admin for more.`;
  }

  /** Whether their solo agents may run on this engine. */
  engineAllowed(personId: string, instanceId: string): boolean {
    const { engines } = this.limitOf(personId);
    return engines === null || engines.includes(instanceId);
  }

  /** Gone with them when they leave the workspace. */
  forget(personId: string) {
    delete this.data.limits[personId];
    delete this.data.spend[personId];
    try {
      this.save();
    } catch {
      /* nothing reads a removed member's limits */
    }
  }
}

function dollars(n: number): string {
  return `$${n % 1 === 0 ? n : n.toFixed(2)}`;
}
