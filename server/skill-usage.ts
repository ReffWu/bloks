// Which skills are pulling their weight.
//
// A library that grows by suggestion needs a way to tell the skill that
// gets used every day from the one written once and never read again,
// and the version that works from the one somebody keeps correcting.
// Counting is free, so this never spends a call to find out.
//
// What counts as a use is deliberately narrow, because a skill attached
// to an agent rides along on every turn whether or not the turn needed
// it, and counting that would make every skill look busy:
//
//   the person named it with a slash, like /release-notes, or
//   an agent read it in full during a turn (`bloks skill <id>`), or
//   a review of the conversation, when the workspace runs those, saw the
//   turn follow it.
//
// Each counts once a turn, against the version that was current then.
// A use is "corrected" when the person's next words in that conversation
// read as putting the agent right ("no, not like that"), which is the
// cheapest honest signal that a version did not do its job.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { isRecord, readSaved, writeFileAtomic } from "./atomic-write.ts";

export interface UseCount {
  uses: number;
  /** Uses the person corrected straight after. */
  corrected: number;
  lastUsed: number | null;
}

interface Entry extends UseCount {
  /** By version, as a string key because that is what JSON keeps. */
  revisions: Record<string, UseCount>;
}

export interface Usage {
  total: UseCount;
  revisions: Record<number, UseCount>;
}

/** More skills than the library holds, built-ins and removed ones too. */
const MAX_SKILLS = 500;

const empty = (): UseCount => ({ uses: 0, corrected: 0, lastUsed: null });

function count(v: unknown): UseCount | null {
  if (!isRecord(v)) return null;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);
  return { uses: n(v.uses), corrected: n(v.corrected), lastUsed: typeof v.lastUsed === "number" ? v.lastUsed : null };
}

export class SkillUsage {
  private entries: Record<string, Entry>;
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
    const raw = readSaved<Record<string, unknown>>(file, {}, isRecord);
    this.entries = {};
    for (const [id, value] of Object.entries(raw)) {
      const total = count(value);
      if (!total || !isRecord(value)) continue;
      const revisions: Record<string, UseCount> = {};
      if (isRecord(value.revisions)) {
        for (const [n, c] of Object.entries(value.revisions)) {
          const parsed = count(c);
          if (parsed && /^\d+$/.test(n)) revisions[n] = parsed;
        }
      }
      this.entries[id] = { ...total, revisions };
    }
  }

  private save() {
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      writeFileAtomic(this.file, JSON.stringify(this.entries), 0o600, { flush: false });
    } catch {
      /* a count is a signal; never fail a turn over one */
    }
  }

  private entry(id: string): Entry {
    let entry = this.entries[id];
    if (!entry) {
      const ids = Object.keys(this.entries);
      if (ids.length >= MAX_SKILLS) {
        // the one used longest ago makes room
        const oldest = ids.sort((a, b) => (this.entries[a].lastUsed ?? 0) - (this.entries[b].lastUsed ?? 0))[0];
        delete this.entries[oldest];
      }
      entry = this.entries[id] = { ...empty(), revisions: {} };
    }
    return entry;
  }

  used(id: string, revision: number, at = Date.now()) {
    const entry = this.entry(id);
    const version = (entry.revisions[String(revision)] ??= empty());
    entry.uses++;
    version.uses++;
    entry.lastUsed = version.lastUsed = at;
    this.save();
  }

  /** The person put the agent right straight after it used this version. */
  corrected(id: string, revision: number) {
    const entry = this.entries[id];
    const version = entry?.revisions[String(revision)];
    if (!entry || !version) return;
    // never more corrections than uses, whatever order the calls came in
    if (version.corrected >= version.uses) return;
    entry.corrected++;
    version.corrected++;
    this.save();
  }

  of(id: string): Usage {
    const entry = this.entries[id];
    if (!entry) return { total: empty(), revisions: {} };
    const revisions: Record<number, UseCount> = {};
    for (const [n, c] of Object.entries(entry.revisions)) revisions[Number(n)] = { ...c };
    return { total: { uses: entry.uses, corrected: entry.corrected, lastUsed: entry.lastUsed }, revisions };
  }
}

/**
 * The skills named with a slash in the person's own words, like
 * "/release-notes", among the ones this agent has. The composer offers
 * them that way (#51), and the agent is told a slash and an id means the
 * person is asking for that skill.
 */
export function skillsNamed(words: string[], ids: string[]): string[] {
  if (!ids.length) return [];
  const have = new Set(ids);
  const named = new Set<string>();
  for (const text of words) {
    for (const match of (text ?? "").matchAll(/(?:^|[\s(])\/([a-z0-9][a-z0-9-]{0,63})(?=$|[\s.,;:!?)])/gm)) {
      if (have.has(match[1])) named.add(match[1]);
    }
  }
  return [...named];
}
