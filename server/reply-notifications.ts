// A turn's reply, said once when the turn settles (`reply.settled`).
//
// Clients used to raise a banner for each reply message as it landed, and
// a chatty turn was kept to one by a timer. The server knows better: it
// knows when an attempt is really over (not asked again, not handed to a
// backup, not a quiet check-in folded away), so it picks the one reply
// worth saying and sends it on its own frame. A desktop that finds a
// server without this (no "reply-settled" in server/features.ts) goes on
// announcing replies as they land.
import type { Message } from "./store.ts";

/** How much of a reply a banner shows (preview in src/lib/notify.ts).
 * The server cannot import the app's code, so the rule is kept here too,
 * and test/reply-notifications.test.ts holds the two to the same answer. */
export const REPLY_PREVIEW_MAX = 180;

/** A reply flattened and cut to what a banner can hold, so a long answer
 * is not sent whole to every client only to be clipped there. */
export function clipReply(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > REPLY_PREVIEW_MAX ? `${flat.slice(0, REPLY_PREVIEW_MAX - 1)}…` : flat;
}

/** A snapshot of already saved text, never another transcript message. */
export type ReplyPreview = Pick<Message, "id" | "at" | "role" | "kind" | "text" | "from" | "quiet" | "deleted">;
export type ReplyPhase = "commentary" | "final_answer";
interface Attempt {
  turnId: string;
  threadId: string;
  botId: string;
  goalOwned: boolean;
  last?: ReplyPreview;
  final?: ReplyPreview;
}

/** One bounded record per active lane, discarded at that attempt's end.
 * A successful empty backup cannot inherit its failed predecessor's words. */
export class ReplyNotifications {
  private active = new Map<string, Attempt>();

  start(laneId: string, turnId: string | undefined, threadId: string, botId: string, goalOwned: boolean): void {
    this.active.delete(laneId);
    if (turnId) this.active.set(laneId, { turnId, threadId, botId, goalOwned });
  }

  text(laneId: string, turnId: string | undefined, message: Message, phase?: ReplyPhase, synthetic = false): void {
    const a = this.active.get(laneId);
    if (synthetic || !a || a.turnId !== turnId || message.role !== "bot" || message.kind !== "text" || !message.text?.trim() || message.quiet || message.deleted) return;
    // Terminal presentation (PR314) is not final-answer provenance.
    if (phase === "commentary") return;
    const { id, at, role, kind, text, from, quiet, deleted } = message;
    const preview: ReplyPreview = { id, at, role, kind, text, ...(from ? { from } : {}), ...(quiet ? { quiet } : {}), ...(deleted ? { deleted } : {}) };
    a.last = preview;
    if (phase === "final_answer") a.final = preview;
  }

  take(laneId: string, turnId: string | undefined): Attempt | undefined {
    const a = this.active.get(laneId);
    if (!a || a.turnId !== turnId) return;
    this.active.delete(laneId);
    return a;
  }
}

export type SettledReply = { kind: "reply.settled"; threadId: string; botId: string; turnId: string; message: ReplyPreview };

/** The reply an attempt that is really over has to say, or null. Whether
 * it ended well does not matter: words it saved before failing are still
 * its answer, and the failure says itself in its own notice. A Stop is
 * the person's own doing, so it is not news to them. */
export function settledReply(attempt: Attempt | undefined, end: {
  stopReason?: string | null; continues: boolean; quiet: boolean; maintenance: boolean;
}): SettledReply | null {
  if (!attempt || end.stopReason === "interrupted" || end.continues || end.quiet || end.maintenance || attempt.goalOwned) return null;
  const message = attempt.final ?? attempt.last;
  return message ? { kind: "reply.settled", threadId: attempt.threadId, botId: attempt.botId, turnId: attempt.turnId, message } : null;
}

/** The frame to send, read against the transcript as it is now: deletion
 * may have withdrawn the chosen words while the attempt ran, and then
 * nothing is said rather than falling back to older text. */
export function settledFrame(reply: SettledReply, current: Message | undefined): SettledReply | null {
  if (current?.id !== reply.message.id || current.role !== "bot" || current.kind !== "text" || current.deleted || current.quiet || !current.text?.trim()) return null;
  return { ...reply, message: { ...reply.message, text: clipReply(current.text) } };
}
