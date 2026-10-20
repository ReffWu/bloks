// Which plan the owner of this workspace is on, as far as letting other
// people in goes.
//
// The room door has always asked the relay (currentPlan in index.ts),
// which only knows once this workspace is online. Members do not need the
// workspace online: somebody on the owner's own network joins without
// Bloks Cloud at all. So this asks whoever can say: the relay when this
// workspace has a space there, else the licence the app keeps for every
// workspace, checked with bloks.dev. Either answer is the licence's.
//
// A plan that cannot be asked right now is not a plan that lapsed. A
// network blip must not throw everybody out of the workspace, so the last
// answer anyone gave is kept on disk and stands until a real one replaces
// it. Only a real answer moves it: "cloud", "team", or no licence at all.
import { isRecord, readSaved, writeFileAtomic } from "./atomic-write.ts";
import type { Plan } from "./plan-limits.ts";

export interface OwnerPlanSources {
  /** The relay's word, when this workspace is online; null when it is not
   * online or could not be asked. */
  relay(): Promise<Plan | null>;
  /** Whether the relay is there to ask at all. */
  online(): boolean;
  /** The licence this workspace holds or was handed, null for none, or
   * undefined while it may still be on its way from the app. */
  licence(): string | null | undefined;
  /** Whether a licence is a team's, from bloks.dev; null when unknown. */
  team(licence: string): Promise<boolean | null>;
}

const FRESH_MS = 10 * 60_000;

export class OwnerPlan {
  private known: Plan | null;
  private askedAt = 0;
  private asking: Promise<Plan | null> | null = null;

  private readonly file: string;
  private readonly sources: OwnerPlanSources;
  private readonly onChange: (plan: Plan | null, was: Plan | null) => void;
  private readonly now: () => number;

  constructor(
    file: string,
    sources: OwnerPlanSources,
    onChange: (plan: Plan | null, was: Plan | null) => void = () => {},
    now: () => number = Date.now,
  ) {
    this.file = file;
    this.sources = sources;
    this.onChange = onChange;
    this.now = now;
    const saved = readSaved<{ plan?: unknown }>(file, {}, isRecord);
    this.known = saved.plan === "team" || saved.plan === "cloud" ? saved.plan : null;
  }

  /** The last answer, without asking: what a frame filter can afford. */
  current(): Plan | null {
    return this.known;
  }

  /** The plan, asked again once the last answer is ten minutes old, or
   * now when `fresh`. */
  async get(fresh = false): Promise<Plan | null> {
    if (!fresh && this.askedAt && this.now() - this.askedAt < FRESH_MS) return this.known;
    if (!this.asking) {
      this.asking = this.ask().finally(() => {
        this.asking = null;
      });
    }
    return this.asking;
  }

  private async ask(): Promise<Plan | null> {
    let said: Plan | null | undefined;
    if (this.sources.online()) said = (await this.sources.relay().catch(() => null)) ?? undefined;
    if (said === undefined) {
      const licence = this.sources.licence();
      if (licence === undefined) said = undefined;
      else if (!licence) said = this.sources.online() ? undefined : null;
      else {
        const team = await this.sources.team(licence).catch(() => null);
        said = team === null ? undefined : team ? "team" : "cloud";
      }
    }
    this.askedAt = this.now();
    // nothing could be asked: what was known stands
    if (said === undefined) return this.known;
    this.set(said);
    return said;
  }

  /** Keeps a real answer, on disk too, and says when it changed. */
  set(plan: Plan | null) {
    const was = this.known;
    this.known = plan;
    this.askedAt = this.now();
    if (plan === was) return;
    try {
      writeFileAtomic(this.file, JSON.stringify({ plan, at: this.now() }), 0o600);
    } catch {
      /* kept in memory for this run */
    }
    this.onChange(plan, was);
  }
}
