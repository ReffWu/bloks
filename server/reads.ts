// How far each person has read each conversation: the last message they
// had on screen, per person per conversation, the owner included (as
// "owner"). What the "Seen by" under a message is drawn from.
//
// A position only moves forward. A person's client says what is visible
// as they read, from more than one device and in no particular order, and
// an older word arriving late must not take back what a newer one said.
// Agents never write here: the routes that do are a person's own.
//
// Who may see whose position is not this file's to say: server/access.ts
// (readsVisible) decides, and the server asks it before anything leaves.
import { isRecord, readSaved, writeFileAtomic } from "./atomic-write.ts";

export interface ReadMark {
  threadId: string;
  /** A member's person id, or "owner". */
  personId: string;
  messageId: string;
  at: number;
}

type Saved = { version: 1; threads: Record<string, Record<string, { messageId: string; at: number }>> };

const ID = /^[\w-]{1,80}$/;

export class Reads {
  private data: Saved;

  private readonly file: string;
  private readonly now: () => number;

  constructor(file: string, now: () => number = Date.now) {
    this.file = file;
    this.now = now;
    const raw = readSaved<Partial<Saved>>(file, {}, isRecord);
    const threads: Saved["threads"] = {};
    if (raw.threads && typeof raw.threads === "object") {
      for (const [threadId, byPerson] of Object.entries(raw.threads)) {
        if (!ID.test(threadId) || !byPerson || typeof byPerson !== "object") continue;
        for (const [personId, mark] of Object.entries(byPerson)) {
          if (!ID.test(personId) || !mark || typeof mark.messageId !== "string" || typeof mark.at !== "number") continue;
          (threads[threadId] ??= {})[personId] = { messageId: mark.messageId, at: mark.at };
        }
      }
    }
    this.data = { version: 1, threads };
  }

  /**
   * Somebody has read a conversation up to a message. `order` is the
   * conversation's message ids, oldest first. Returns the new mark, or
   * null when nothing moved: an unknown message, or one at or before
   * where they had already read to.
   */
  mark(threadId: string, personId: string, messageId: string, order: readonly string[]): ReadMark | null {
    if (!ID.test(threadId) || !ID.test(personId)) return null;
    const at = order.indexOf(messageId);
    if (at === -1) return null;
    const was = this.data.threads[threadId]?.[personId];
    if (was) {
      const before = order.indexOf(was.messageId);
      if (before >= at) return null;
    }
    const mark = { messageId, at: this.now() };
    (this.data.threads[threadId] ??= {})[personId] = mark;
    this.save();
    return { threadId, personId, ...mark };
  }

  /** Everybody's position in one conversation. */
  of(threadId: string): ReadMark[] {
    const byPerson = this.data.threads[threadId] ?? {};
    return Object.entries(byPerson).map(([personId, mark]) => ({ threadId, personId, ...mark }));
  }

  /** Somebody left the workspace: where they had read to goes with them. */
  forgetPerson(personId: string) {
    let changed = false;
    for (const byPerson of Object.values(this.data.threads)) {
      if (byPerson[personId]) {
        delete byPerson[personId];
        changed = true;
      }
    }
    if (changed) this.save();
  }

  /** A conversation that is gone takes its positions with it. */
  forgetThread(threadId: string) {
    if (!this.data.threads[threadId]) return;
    delete this.data.threads[threadId];
    this.save();
  }

  private save() {
    try {
      writeFileAtomic(this.file, JSON.stringify(this.data), 0o600);
    } catch {
      /* kept in memory; the next mark tries again */
    }
  }
}
