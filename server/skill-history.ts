// Every version of every skill, and who made it.
//
// A skill is standing instructions: whatever it says, every agent that
// has it does, on every turn. While a person was the only one who ever
// changed one, the file on disk was the whole story. Now a skill can also
// change because an agent asked for it, or because a conversation was
// read back and something was suggested, and "what did this say last
// week, and who changed it" has to be answerable rather than guessed at.
//
// So each change is kept whole, not as a patch. Three decisions follow.
//
//   A version is the full text, with who made it, when, and why in one
//   line. A diff is worked out when somebody asks for one; storing whole
//   texts means restoring version 3 is copying version 3, with nothing to
//   replay and nothing to get wrong.
//
//   The skill's own file stays where it was and stays the truth. This is
//   a record beside it, in its own folder, so a hand edit in a text
//   editor still works. It is noticed the next time anyone looks, and
//   kept as a version "changed outside Bloks", so nothing is ever lost
//   by writing over a file this record had not seen.
//
//   Numbers never move. Version 4 is version 4 for as long as the skill
//   exists, which is what lets an agent say "I read version 4" and be
//   refused when it is no longer 4.
//
// Built-in skills ship with the app and are not versioned: they are the
// same text on every install. A built-in counts as version 0, and the
// first change to one makes it the person's own copy, which starts with
// the text as it shipped so the two can be compared.
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { isRecord, readSaved, writeFileAtomic } from "./atomic-write.ts";

/** What made a change. */
export type AuthorKind =
  /** the person, in the app */
  | "person"
  /** an agent asked for it, and the person kept it */
  | "agent"
  /** a conversation was read back, and the person kept the suggestion */
  | "proposal"
  /** installed or updated from the catalog */
  | "catalog"
  /** brought in with an agent file or from another tool */
  | "import"
  /** the file was edited outside Bloks */
  | "file"
  /** how it stood when versions began */
  | "migration"
  /** a built-in skill as it ships, at the start of the person's copy */
  | "builtin";

export interface Author {
  kind: AuthorKind;
  /** Who, as a person reads it: an agent's name, the catalog. */
  name?: string;
  botId?: string;
  proposalId?: string;
}

export interface SkillText {
  name: string;
  description: string;
  body: string;
}

export interface Revision extends SkillText {
  /** 1, 2, 3: never reused, never renumbered. */
  n: number;
  at: number;
  by: Author;
  /** Why, in one line. */
  why: string;
  /** Set when this version put an earlier one back. */
  restoredFrom?: number;
}

interface HistoryFile {
  id: string;
  revisions: Revision[];
  /** The skill was removed. Its versions stay, and a skill added again
   * under the same id carries on from them. */
  removedAt?: number;
}

/**
 * How many versions one skill keeps.
 *
 * A skill is at most sixteen thousand characters, so a hundred whole
 * versions of the longest one is a few megabytes, and most skills are a
 * few hundred characters. Past it the oldest go, except the first: where
 * a skill started is the version most worth comparing against.
 */
export const MAX_REVISIONS = 100;

/** The one line on why. */
export const MAX_WHY = 200;

/** Ids are slugs already (server/skills.ts); this is the second lock on
 * the door, so a record can never be written outside its folder. */
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function sameText(a: SkillText, b: SkillText): boolean {
  return a.name.trim() === b.name.trim() && a.description.trim() === b.description.trim() && a.body.trim() === b.body.trim();
}

/** A reason as one line, or the fallback when there is none. */
export function oneLine(why: unknown, fallback: string): string {
  const said = typeof why === "string" ? why.replace(/\s+/g, " ").trim() : "";
  return [...(said || fallback)].slice(0, MAX_WHY).join("");
}

function validRevision(r: unknown): r is Revision {
  return (
    isRecord(r) &&
    Number.isInteger(r.n) &&
    (r.n as number) > 0 &&
    typeof r.at === "number" &&
    isRecord(r.by) &&
    typeof (r.by as Record<string, unknown>).kind === "string" &&
    typeof r.why === "string" &&
    typeof r.name === "string" &&
    typeof r.description === "string" &&
    typeof r.body === "string"
  );
}

export class SkillHistory {
  /** Parsed files, kept while the file on disk has not changed: the list
   * of skills asks for every skill's current version, and reading a few
   * hundred whole histories each time would be most of the request. */
  private readonly cache = new Map<string, { mtimeMs: number; size: number; file: HistoryFile }>();

  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private pathOf(id: string): string {
    if (!ID.test(id)) throw Object.assign(new Error("that is not a skill id"), { status: 400 });
    return join(this.dir, `${id}.json`);
  }

  private load(id: string): HistoryFile | null {
    const path = this.pathOf(id);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      this.cache.delete(id);
      return null;
    }
    const held = this.cache.get(id);
    if (held && held.mtimeMs === stat.mtimeMs && held.size === stat.size) return held.file;
    const raw = readSaved<unknown>(path, null, (v) => isRecord(v) && Array.isArray((v as Record<string, unknown>).revisions));
    if (!isRecord(raw)) return null;
    const revisions = (raw.revisions as unknown[]).filter(validRevision).sort((a, b) => a.n - b.n);
    const file: HistoryFile = {
      id,
      revisions,
      ...(typeof raw.removedAt === "number" ? { removedAt: raw.removedAt } : {}),
    };
    this.cache.set(id, { mtimeMs: stat.mtimeMs, size: stat.size, file });
    return file;
  }

  private save(file: HistoryFile) {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    if (file.revisions.length > MAX_REVISIONS) {
      file.revisions = [file.revisions[0], ...file.revisions.slice(-(MAX_REVISIONS - 1))];
    }
    const path = this.pathOf(file.id);
    writeFileAtomic(path, JSON.stringify(file), 0o600, { flush: false });
    try {
      const stat = statSync(path);
      this.cache.set(file.id, { mtimeMs: stat.mtimeMs, size: stat.size, file });
    } catch {
      this.cache.delete(file.id);
    }
  }

  /** Oldest first. */
  revisions(id: string): Revision[] {
    return [...(this.load(id)?.revisions ?? [])];
  }

  latest(id: string): Revision | null {
    const all = this.load(id)?.revisions ?? [];
    return all[all.length - 1] ?? null;
  }

  get(id: string, n: number): Revision | null {
    return this.load(id)?.revisions.find((r) => r.n === n) ?? null;
  }

  /** Whether versions were let go to stay under MAX_REVISIONS. */
  pruned(id: string): boolean {
    const all = this.load(id)?.revisions ?? [];
    return all.length > 1 && all[all.length - 1].n - all[0].n + 1 > all.length;
  }

  /**
   * The version a reader of this text is looking at.
   *
   * A skill with no record yet starts one at version 1, as it stands,
   * which is how every skill written before versions existed comes in
   * without losing a word. A file somebody edited by hand since the last
   * version is kept as the next one, so the record never disagrees with
   * what agents are actually being told.
   */
  sync(id: string, text: SkillText, at = Date.now()): Revision {
    const file = this.load(id);
    const latest = file?.revisions[file.revisions.length - 1];
    if (latest && sameText(latest, text) && !file?.removedAt) return latest;
    if (latest && sameText(latest, text)) {
      this.save({ ...file!, removedAt: undefined });
      return latest;
    }
    const by: Author = latest ? { kind: "file" } : { kind: "migration" };
    const why = latest ? "Changed outside Bloks" : "How it stood when versions began";
    return this.append(id, file, text, { by, why }, at);
  }

  /** A change, kept as the next version. Writing the same text again is
   * not a change, and answers the version it already is. */
  record(id: string, text: SkillText, change: { by: Author; why: string; restoredFrom?: number }, at = Date.now()): Revision {
    const file = this.load(id);
    const latest = file?.revisions[file.revisions.length - 1];
    if (latest && sameText(latest, text)) {
      if (file?.removedAt) this.save({ ...file, removedAt: undefined });
      return latest;
    }
    return this.append(id, file, text, change, at);
  }

  private append(
    id: string,
    file: HistoryFile | null,
    text: SkillText,
    change: { by: Author; why: string; restoredFrom?: number },
    at: number,
  ): Revision {
    const revisions = file?.revisions ?? [];
    const revision: Revision = {
      n: (revisions[revisions.length - 1]?.n ?? 0) + 1,
      at,
      by: { ...change.by },
      why: oneLine(change.why, "Changed"),
      name: text.name.trim(),
      description: text.description.trim(),
      body: text.body.trim(),
      ...(change.restoredFrom ? { restoredFrom: change.restoredFrom } : {}),
    };
    this.save({ id, revisions: [...revisions, revision] });
    return revision;
  }

  /** The skill is gone; what it said stays. */
  removed(id: string, at = Date.now()) {
    const file = this.load(id);
    if (file) this.save({ ...file, removedAt: at });
  }

  /** Every skill that has a record. */
  ids(): string[] {
    try {
      return readdirSync(this.dir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => name.slice(0, -5))
        .filter((id) => ID.test(id));
    } catch {
      return [];
    }
  }
}
