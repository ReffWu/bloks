// Pausing an engine or a model for a while (based on GitHub 305).
//
// A person whose plan is nearly spent, or who wants one model left alone
// until tomorrow, used to have two choices: move every agent to something
// else and remember to move them back, or say so in a chat and hope every
// routine, watcher and job heard it too. A pause is the third: one family
// of models (every Anthropic one), one kind of engine (every Codex), one
// configured engine, or one model, for every agent or for the ones named,
// until a time. Nothing about any agent's engine choice is changed, so
// when the pause ends there is nothing to put back.
//
// What a pause does is decided at one door: a turn about to start asks
// here whether the engine it would run on is paused for its agent. One
// that is passed over for the agent's other engine if that one may go,
// as a resting engine is; otherwise the work waits where it would have
// waited for a busy lane, and goes on its own once the pause ends. What
// is already running carries on unless the owner says otherwise.
//
// Every pause has an end. The owner's last a week at most, and an agent
// may pause only itself, for a day at most: a pause can hold up work, so
// nobody may hold it up forever, and no agent may hold up another's.
//
// The list is small and on disk (engine-pauses.json), written only when a
// pause is added or called off. With no pauses there is no file, and the
// door is one length check: nothing is read, written or recorded per turn.
//
// A file that cannot be read never stops work it does not name. The
// pauses that can be read still hold; the rest are left out, the file is
// kept aside so nothing is lost, and the owner is told.
import { randomUUID } from "node:crypto";
import { copyFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isRecord, writeFileAtomic } from "./atomic-write.ts";

/** The longest the owner may pause anything for. */
export const PAUSE_MAX_MS = 7 * 24 * 60 * 60_000;
/** The longest an agent may pause itself for. */
export const SELF_PAUSE_MAX_MS = 24 * 60 * 60_000;
/** Pauses in force at once, all of them. A list longer than this is no
 * longer something a person reads. */
export const MAX_PAUSES = 50;
/** Pauses one agent may have on itself at once. */
export const MAX_SELF_PAUSES = 5;
/** Agents one pause may name. */
export const MAX_PAUSE_AGENTS = 100;
/** A pause's note, when it has one. */
export const MAX_PAUSE_NOTE = 200;

/** What a pause covers. Every part given has to match; at least one is. */
export interface PauseTarget {
  /** Who made the model: "anthropic", "openai" (familyOf). */
  family?: string;
  /** A kind of engine: "claudeAgent", "codex", "openrouter". */
  driver?: string;
  /** One configured engine. */
  instanceId?: string;
  /** One model, by its id. */
  model?: string;
}

export interface EnginePause {
  id: string;
  what: PauseTarget;
  /** Every agent, now and later, or the ones named. */
  agents: "all" | string[];
  until: number;
  createdAt: number;
  /** "owner", or the id of the agent that paused itself. */
  by: string;
  note?: string;
}

/** The engine a turn would run on, as a pause reads it. */
export interface EngineRoute {
  instanceId: string;
  driver: string;
  /** The model as it will be asked for: the engine's default when none
   * is chosen. */
  model: string;
}

export type PauseActor = { kind: "owner" } | { kind: "agent"; id: string };

/** What a caller asks for. */
export interface PauseRequest {
  what?: unknown;
  agents?: unknown;
  until?: unknown;
  minutes?: unknown;
  note?: unknown;
}

/** A refusal with the status a route answers it with. */
export class PauseRefusal extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "PauseRefusal";
    this.status = status;
  }
}

/** Who made a model, told from its id and, failing that, from the engine
 * that serves it. Null for one nobody can tell, which a family pause
 * never covers: a pause holds what it names, not what it might mean. */
export function familyOf(driver: string, model: string): string | null {
  const id = model.toLowerCase();
  for (const [pattern, family] of BY_NAME) if (pattern.test(id)) return family;
  return BY_DRIVER[driver] ?? null;
}

/** Families by how a person would say them. */
export const FAMILY_NAMES: Readonly<Record<string, string>> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  xai: "xAI",
  meta: "Meta",
  deepseek: "DeepSeek",
  mistral: "Mistral",
  moonshot: "Moonshot",
  qwen: "Qwen",
};

const BY_NAME: ReadonlyArray<readonly [RegExp, string]> = [
  [/claude|anthropic|\bopus\b|\bsonnet\b|\bhaiku\b/, "anthropic"],
  [/gpt|openai|codex|chatgpt|(^|\/)o\d/, "openai"],
  [/gemini|gemma|google/, "google"],
  [/grok|x-ai|xai/, "xai"],
  [/llama/, "meta"],
  [/deepseek/, "deepseek"],
  [/mistral|mixtral|codestral|devstral|magistral/, "mistral"],
  [/kimi|moonshot/, "moonshot"],
  [/qwen/, "qwen"],
];

const BY_DRIVER: Readonly<Record<string, string>> = {
  claudeAgent: "anthropic",
  codex: "openai",
  gemini: "google",
  geminiCli: "google",
  grok: "xai",
  grokCli: "xai",
  llama: "meta",
  deepseek: "deepseek",
  mistral: "mistral",
  kimi: "moonshot",
};

/** Whether a pause covers this agent on this engine. */
export function covers(pause: EnginePause, agentId: string, route: EngineRoute): boolean {
  if (pause.agents !== "all" && !pause.agents.includes(agentId)) return false;
  const { family, driver, instanceId, model } = pause.what;
  if (instanceId !== undefined && route.instanceId !== instanceId) return false;
  if (driver !== undefined && route.driver !== driver) return false;
  if (model !== undefined && route.model !== model) return false;
  if (family !== undefined && familyOf(route.driver, route.model) !== family) return false;
  return true;
}

/** An id, a model or a kind: something printable without spaces, as
 * engines and their catalogs name things. */
const NAME = /^[^\s\u0000-\u001f\u007f]{1,200}$/;
const ID = /^[\w.-]{1,64}$/;

function target(raw: unknown): PauseTarget | null {
  if (!isRecord(raw)) return null;
  const out: PauseTarget = {};
  for (const key of Object.keys(raw)) {
    if (key !== "family" && key !== "driver" && key !== "instanceId" && key !== "model") return null;
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || !NAME.test(value)) return null;
    out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

function agentList(raw: unknown): "all" | string[] | null {
  if (raw === "all") return "all";
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_PAUSE_AGENTS) return null;
  if (!raw.every((id) => typeof id === "string" && ID.test(id))) return null;
  return [...new Set(raw as string[])].sort();
}

/** A saved pause as it was written, or null for anything else. */
function saved(raw: unknown): EnginePause | null {
  if (!isRecord(raw)) return null;
  const what = target(raw.what);
  const agents = agentList(raw.agents);
  const { id, until, createdAt, by, note } = raw;
  if (typeof id !== "string" || !ID.test(id) || !what || !agents) return null;
  if (typeof until !== "number" || !Number.isFinite(until)) return null;
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) return null;
  if (typeof by !== "string" || !(by === "owner" || ID.test(by))) return null;
  if (note !== undefined && (typeof note !== "string" || note.length > MAX_PAUSE_NOTE)) return null;
  return { id, what, agents, until, createdAt, by, ...(note ? { note } : {}) };
}

/** Where a file is, as a person would find it. */
function shown(file: string): string {
  const home = homedir();
  return home && file.startsWith(`${home}/`) ? `~${file.slice(home.length)}` : file;
}

export class EnginePauses {
  private pauses: EnginePause[] = [];
  /** What went wrong reading the saved list, for the owner, or null. */
  fault: string | null = null;
  /** False when the saved file is there but could not be read at all:
   * writing over it would lose whatever it held. */
  private writable = true;
  private readonly file: string | null;
  private readonly now: () => number;

  constructor(file: string | null, now: () => number = Date.now) {
    this.file = file;
    this.now = now;
    if (file) this.load(file);
  }

  private load(file: string) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return;
      // Nothing it holds can be read, so nothing it holds can stop work.
      // New pauses wait until it can be, rather than replace it unread.
      this.writable = false;
      this.fault = `${shown(file)} could not be read (${typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? code : "IO_ERROR"}), so no saved pause is in force and new ones cannot be saved until it can be. Make sure Bloks can read and write it.`;
      console.warn(`[bloks] ${this.fault}`);
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      raw = undefined;
    }
    const entries = isRecord(raw) && Array.isArray(raw.pauses) ? raw.pauses : null;
    const now = this.now();
    const read = (entries ?? []).map(saved);
    const kept = read.filter((p): p is EnginePause => p !== null);
    const lost = entries ? read.length - kept.length : 1;
    // A deadline further off than anyone may set came from somewhere
    // other than here. It still holds, for as long as one may.
    this.pauses = kept
      .filter((p) => p.until > now)
      .map((p) => (p.until - now > PAUSE_MAX_MS ? { ...p, until: now + PAUSE_MAX_MS } : p))
      .slice(0, MAX_PAUSES);
    if (lost > 0) {
      const aside = `${file}.corrupt-${new Date(now).toISOString().replace(/[:.]/g, "-")}`;
      let kept = "";
      try {
        copyFileSync(file, aside);
        kept = ` The file was kept as ${shown(aside)}.`;
      } catch {
        /* the fault still says what was left out */
      }
      this.fault = entries
        ? `${lost === 1 ? "One saved engine pause" : `${lost} saved engine pauses`} could not be read and ${lost === 1 ? "is" : "are"} not in force; the others are.${kept}`
        : `The saved engine pauses could not be read, so none of them is in force.${kept}`;
      console.warn(`[bloks] ${this.fault}`);
    }
  }

  /** Whether any pause is on the list, in force or not yet tidied away.
   * The whole cost of the door when nothing is paused. */
  any(): boolean {
    return this.pauses.length > 0;
  }

  /** The pause holding this agent on this engine, or null. Of several,
   * the one that ends last, since that is when the engine is free. */
  holding(agentId: string, route: EngineRoute): EnginePause | null {
    if (!this.pauses.length) return null;
    const now = this.now();
    let found: EnginePause | null = null;
    for (const pause of this.pauses) {
      if (pause.until <= now || !covers(pause, agentId, route)) continue;
      if (!found || pause.until > found.until) found = pause;
    }
    return found;
  }

  /** Pauses in force, for whoever is asking: everything for the owner;
   * for an agent, only those that cover it, naming no other agent. */
  visibleTo(actor: PauseActor): EnginePause[] {
    const now = this.now();
    const live = this.pauses.filter((p) => p.until > now);
    if (actor.kind === "owner") return live.map((p) => structuredClone(p));
    return live
      .filter((p) => p.agents === "all" || p.agents.includes(actor.id))
      .map((p) => ({ ...structuredClone(p), agents: p.agents === "all" ? ("all" as const) : [actor.id] }));
  }

  get(id: string): EnginePause | null {
    const found = this.pauses.find((p) => p.id === id && p.until > this.now());
    return found ? structuredClone(found) : null;
  }

  /** When the next pause in force ends, or null with none. */
  nextEnd(): number | null {
    const now = this.now();
    let next: number | null = null;
    for (const p of this.pauses) if (p.until > now && (next === null || p.until < next)) next = p.until;
    return next;
  }

  /** Forgets pauses that have ended. True when there were any. Not
   * saved: an ended pause on disk holds nothing, and goes with the next
   * change anyone makes. */
  prune(): boolean {
    const now = this.now();
    const before = this.pauses.length;
    this.pauses = this.pauses.filter((p) => p.until > now);
    return this.pauses.length !== before;
  }

  /** Adds a pause, saved before it is in force. `known` says whether an
   * agent id names an agent. */
  add(actor: PauseActor, input: PauseRequest, known: (agentId: string) => boolean = () => true): EnginePause {
    const now = this.now();
    const what = target(input.what);
    if (!what) throw new PauseRefusal("Say what to pause: a family, a kind of engine, an engine or a model.");
    let agents: "all" | string[] | null;
    if (actor.kind === "agent") {
      // An agent pauses itself and nobody else: holding up another
      // agent's work is the owner's call.
      if (input.agents !== undefined && !(Array.isArray(input.agents) && input.agents.length === 1 && input.agents[0] === actor.id)) {
        throw new PauseRefusal("An agent may pause an engine only for itself. Ask the person to pause it for others.", 403);
      }
      agents = [actor.id];
    } else {
      agents = agentList(input.agents ?? "all");
      if (!agents) throw new PauseRefusal(`Name the agents a pause is for, up to ${MAX_PAUSE_AGENTS}, or "all".`);
      const unknown = agents === "all" ? [] : agents.filter((id) => !known(id));
      if (unknown.length) throw new PauseRefusal(`No agent with the id ${unknown[0]}.`);
    }
    const longest = actor.kind === "owner" ? PAUSE_MAX_MS : SELF_PAUSE_MAX_MS;
    const until =
      typeof input.until === "number" ? input.until
      : typeof input.minutes === "number" ? now + input.minutes * 60_000
      : NaN;
    if (!Number.isFinite(until)) throw new PauseRefusal("A pause needs an end: `until` as a time, or `minutes` from now.");
    if (until <= now + 30_000) throw new PauseRefusal("A pause has to end later than now.");
    if (until - now > longest + 60_000) {
      throw new PauseRefusal(actor.kind === "owner"
        ? "A pause lasts a week at most. Pause again when it ends if it is still needed."
        : "An agent may pause itself for a day at most.");
    }
    const note = input.note === undefined || input.note === "" ? undefined : input.note;
    if (note !== undefined && (typeof note !== "string" || note.length > MAX_PAUSE_NOTE)) {
      throw new PauseRefusal(`A pause's note is up to ${MAX_PAUSE_NOTE} characters.`);
    }
    this.prune();
    if (this.pauses.length >= MAX_PAUSES) throw new PauseRefusal(`There are ${MAX_PAUSES} pauses already. Call one off first.`, 409);
    if (actor.kind === "agent" && this.pauses.filter((p) => p.by === actor.id).length >= MAX_SELF_PAUSES) {
      throw new PauseRefusal(`An agent may have ${MAX_SELF_PAUSES} pauses on itself at once. Call one off first.`, 409);
    }
    const pause: EnginePause = {
      id: randomUUID(),
      what,
      agents,
      until: Math.min(until, now + longest),
      createdAt: now,
      by: actor.kind === "owner" ? "owner" : actor.id,
      ...(note ? { note: note as string } : {}),
    };
    this.save([...this.pauses, pause]);
    this.pauses.push(pause);
    return structuredClone(pause);
  }

  /** Calls a pause off. The owner may call off any; an agent only one it
   * made. Off in memory even when the save fails, since a pause that
   * ends early holds up nothing; the error says it may come back. */
  cancel(actor: PauseActor, id: string): EnginePause {
    const found = this.pauses.find((p) => p.id === id && p.until > this.now());
    if (!found || (actor.kind === "agent" && found.by !== actor.id)) {
      throw new PauseRefusal(actor.kind === "agent" ? "No pause of yours with that id." : "No pause with that id.", 404);
    }
    this.pauses = this.pauses.filter((p) => p !== found);
    this.prune();
    this.save(this.pauses, true);
    return structuredClone(found);
  }

  private save(pauses: EnginePause[], calledOff = false) {
    if (!this.file) return;
    if (!this.writable) {
      throw new PauseRefusal(`${calledOff ? "The pause is off until Bloks restarts, but this could not be saved: " : ""}${this.fault}`, 503);
    }
    const now = this.now();
    try {
      writeFileAtomic(this.file, JSON.stringify({ version: 1, pauses: pauses.filter((p) => p.until > now) }, null, 2), 0o600);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      throw new PauseRefusal(
        calledOff
          ? `The pause is off now, but saving that failed (${code ?? "IO_ERROR"}), so it may be back after a restart.`
          : `The pause could not be saved (${code ?? "IO_ERROR"}), so it is not in force.`,
        503,
      );
    }
  }
}
