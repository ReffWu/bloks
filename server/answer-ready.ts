// "Your answer is ready", on the person's phone (GitHub 384).
//
// The phone is the device asleep in a pocket while an answer is being
// written. Every frame about a turn reaches it only on a stream it no
// longer holds, and the end of its Live Activity is not news: that goes
// in silence, by design, and is gone at once. So a turn the person is
// waiting on says once, when it ends with its answer, that the answer is
// there: a wake through Bloks Cloud, with the answer's first words sealed
// for the phone (wakeFor and previewOf in server/index.ts).
//
// Who is waiting is the Live Activity's rule (GitHub 280): the owner's own
// message started or joined the turn, from any device. Not a routine's
// turn, another agent's, a member's, or one asked from Telegram, whose
// answer goes back there. The banner itself follows the desktop's rule for
// a settled reply (src/lib/notify.ts): a conversation with one agent, an
// agent whose switch allows it, not on the way to a goal.
//
// Unless they are reading it already. Reading is a client's own word,
// said while it shows a conversation in front of the person (POST
// /api/viewing), and it counts only while it keeps being said. A window
// that loses focus or is hidden, a phone put away, a computer gone to
// sleep and a line that dropped all stop saying it, and a word older than
// VIEWING_FRESH_MS no longer counts. Being connected is not reading.

/** How often a client that shows a conversation says so again. */
export const VIEWING_EVERY_MS = 30_000;
/** How long one word that a conversation is on screen holds: two of
 * VIEWING_EVERY_MS and some, so one late word does not end it, and a
 * client that went quiet without saying so stops counting soon after. */
export const VIEWING_FRESH_MS = 75_000;
/** More windows and phones than anybody has; the oldest word goes first. */
const MAX_VIEWERS = 64;
/** Turns already announced, so a replayed end says nothing again. */
const MAX_SAID = 256;

const VIEWER = /^[\w-]{6,64}$/;
const THREAD = /^[\w-]{1,80}$/;

/** One client's word about what it shows, as a route reads it, or why not. */
export function viewingReport(body: unknown): { viewer: string; threadId: string | null; seq: number } | { error: string } {
  const b = (body ?? {}) as { viewer?: unknown; threadId?: unknown; seq?: unknown };
  if (typeof b.viewer !== "string" || !VIEWER.test(b.viewer)) return { error: "viewer is this client's own id" };
  if (b.threadId !== null && (typeof b.threadId !== "string" || !THREAD.test(b.threadId))) {
    return { error: "threadId is the conversation on screen, or null for none" };
  }
  if (typeof b.seq !== "number" || !Number.isSafeInteger(b.seq) || b.seq < 0) return { error: "seq counts this client's words" };
  return { viewer: b.viewer, threadId: b.threadId, seq: b.seq };
}

/** What each client says it has in front of the person right now. */
export class Viewing {
  private seen = new Map<string, { threadId: string | null; seq: number; at: number }>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /**
   * `viewer` is the client, keyed by whoever asked (a paired device, or
   * this machine) so one cannot speak for another. Words can cross on the
   * way, leaving one conversation for the next, so a word older than the
   * last one heard from the same client changes nothing.
   */
  say(viewer: string, threadId: string | null, seq: number): boolean {
    const was = this.seen.get(viewer);
    if (was && seq <= was.seq) return false;
    this.seen.delete(viewer);
    this.seen.set(viewer, { threadId, seq, at: this.now() });
    while (this.seen.size > MAX_VIEWERS) this.seen.delete(this.seen.keys().next().value!);
    return true;
  }

  /** Whether some client has this conversation in front of the person. */
  sees(threadId: string): boolean {
    const now = this.now();
    let found = false;
    for (const [viewer, word] of this.seen) {
      if (now - word.at > VIEWING_FRESH_MS) this.seen.delete(viewer);
      else if (word.threadId === threadId) found = true;
    }
    return found;
  }

  /** A device that was unpaired says nothing more. */
  forget(prefix: string) {
    for (const viewer of [...this.seen.keys()]) if (viewer.startsWith(prefix)) this.seen.delete(viewer);
  }
}

/** The desktop app's word on a workspace's interruptions: its mute (until
 * when, or for good) and its notification level (electron/workspaces.mjs).
 * A server nobody's desktop started never hears one, and is not muted. */
export interface Attention {
  mute: number | "forever" | null;
  notify: "all" | "needs-me" | "nothing";
}

export function attentionFrom(raw: unknown): Attention | null {
  const a = (raw ?? {}) as { mute?: unknown; notify?: unknown };
  const notify = a.notify === "needs-me" || a.notify === "nothing" ? a.notify : a.notify === "all" ? "all" : null;
  if (!notify) return null;
  const mute = a.mute === "forever" ? "forever" : typeof a.mute === "number" && Number.isFinite(a.mute) && a.mute > 0 ? a.mute : null;
  return { mute, notify };
}

/** An answer is activity, not something waiting on the person: a muted
 * workspace says nothing, and one set to "needs me" or "nothing" not this. */
export function answersAllowed(attention: Attention | null, now = Date.now()): boolean {
  if (!attention) return true;
  if (attention.mute === "forever" || (typeof attention.mute === "number" && attention.mute > now)) return false;
  return attention.notify === "all";
}

/** How a turn ended, as far as telling the phone goes. */
export interface AnswerEnd {
  /** The owner's own message started or joined it (see the top). */
  asked: boolean;
  /** It ended well. A failed turn says so in its own notice, and a stopped
   * one was the person's own doing: neither is "your answer is ready". */
  ok: boolean;
  /** The lane it ran in. */
  laneId: string;
  /** Where its settled reply landed, or null when it said nothing worth
   * saying (server/reply-notifications.ts decides). A room is not a lane. */
  replyIn: string | null;
  /** A member's private conversation is theirs, never the owner's news. */
  personal: boolean;
  /** The agent's own notifications switch. */
  notifications: boolean;
  /** Working toward a goal, whose end is said when it comes. */
  goalRunning: boolean;
  /** The workspace's mute and level allow it (answersAllowed). */
  allowed: boolean;
  /** Some client has this conversation in front of the person. */
  viewed: boolean;
}

export function answerDue(end: AnswerEnd): boolean {
  return (
    end.asked &&
    end.ok &&
    end.replyIn !== null &&
    end.replyIn === end.laneId &&
    !end.personal &&
    end.notifications &&
    !end.goalRunning &&
    end.allowed &&
    !end.viewed
  );
}

/**
 * Once per turn. `ready` marks the reply.settled frame about to be sent
 * as one that wakes the phone; the wake, built when that frame goes out,
 * takes the mark. A turn already announced is never marked again, so a
 * replayed end, a reconnect or a second look at the same turn stays quiet.
 */
export class AnswerReady {
  private said: string[] = [];
  private due = new Set<string>();

  ready(turnId: string): boolean {
    if (this.said.includes(turnId)) return false;
    this.said.push(turnId);
    if (this.said.length > MAX_SAID) this.said.splice(0, this.said.length - MAX_SAID);
    this.due.add(turnId);
    return true;
  }

  take(turnId: unknown): boolean {
    return typeof turnId === "string" && this.due.delete(turnId);
  }
}
