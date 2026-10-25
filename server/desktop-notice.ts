// Banners for a workspace nobody is looking at.
//
// The desktop app runs one server per workspace and shows one of them in
// its window. That window's own page decides its banners
// (src/lib/notify.ts), and it only hears the server it shows. The others
// keep working in the background, routines and watchers included, and
// when one of them stops to ask the person something, the person still
// needs to hear it. So each server says so itself, to the app that
// started it, over the port Electron gives only to its own children: no
// network, no credential, nothing another program can listen to.
//
// The rules are the page's rules, kept here because the server cannot
// import the app's code, and test/desktop-notice.test.ts holds the two to
// the same answers. What differs is that nobody is watching a background
// workspace, so "you are looking at it already" never applies; and each
// banner carries how much it matters ("needs-me" or "activity") so the
// app can hold it to that workspace's mute and notification level.
import { itemProgress } from "./codex-text.ts";
import { clipReply } from "./reply-notifications.ts";

/** The same words as src/lib/notify.ts ENGINE_OUT, which match
 * server/failover.ts. */
const ENGINE_OUT =
  /credit balance is too low|insufficient[_ ](?:quota|credits|funds|balance)|billing|payment required|\b402\b|out of credits|exceed your available credits|usage limit|limit (?:reached|exceeded)|quota|rate[ _-]?limit|\b429\b|not (?:logged|signed) in|sign in/i;

export type DesktopLevel = "needs-me" | "activity";

export interface DesktopNotice {
  /** "needs-me": something is stopped until the person answers. */
  level: DesktopLevel;
  title: string;
  body: string;
  /** What a click opens: the agent or the room. */
  target: string;
  /** The agent's face, as a path on this server. */
  avatar?: string;
}

interface NoticeMessage {
  id?: string;
  role?: string;
  kind?: string;
  text?: string;
  quiet?: boolean;
  deleted?: boolean;
  goal?: string;
  chainHeld?: boolean;
  incident?: { id?: string; kind: string; state?: string };
  failing?: { kind: string };
  card?: { requestId?: string; runId?: string; title?: string; subtitle?: string; answered?: string; dismissed?: boolean };
  codexText?: unknown;
}

/** What the server knows about where a frame landed. */
export interface NoticeContext {
  bot(threadId: string): { id: string; name: string; notifications?: boolean; avatarAt?: number | null } | null;
  room(threadId: string): { id: string; name: string } | null;
  /** The conversation is working toward a goal right now. */
  goalRunning(threadId: string): boolean;
}

/** One line of a transcript, clipped to what a banner holds. */
const preview = (text: string) => clipReply(text);

/**
 * The banner a frame deserves when nobody is looking, or null. Only
 * frames a page would have raised one for: a question or an approval, a
 * blocked goal, an incident put to the person, an engine that is out, a
 * routine that stopped, a goal's end, a settled reply, and the morning
 * brief.
 */
export function desktopNotice(frame: unknown, ctx: NoticeContext): DesktopNotice | null {
  const brief = briefNotice(frame);
  if (brief) return brief;
  const f = frame as { kind?: string; threadId?: string; message?: NoticeMessage } | null;
  if (!f || typeof f.threadId !== "string" || !f.message) return null;
  const kind = f.kind;
  if (kind !== "message" && kind !== "message.patch" && kind !== "reply.settled") return null;
  const message = f.message;
  // a patch is news only as the incident desk's card for the person
  if (kind === "message.patch" && !(message.kind === "notice" && message.incident?.kind === "needs-you")) return null;
  if (message.role !== "bot" || message.quiet || message.deleted || itemProgress(message as never)) return null;

  const bot = ctx.bot(f.threadId);
  const room = ctx.room(f.threadId);
  if (!bot && !room) return null;
  const who = room ? room.name : (bot?.name ?? "An agent");
  const target = room ? room.id : (bot?.id ?? f.threadId);
  const face = !room && bot?.avatarAt ? { avatar: `/api/bots/${bot.id}/avatar?v=${bot.avatarAt}` } : {};
  const say = (level: DesktopLevel, title: string, body: string): DesktopNotice => ({ level, title, body: preview(body), target, ...face });

  if (kind === "reply.settled") {
    // a reply in a room is coordination, and an agent asked to be quiet,
    // or one on its way to a goal, says its piece when the goal ends
    if (room || message.kind !== "text" || !message.text?.trim()) return null;
    if (bot?.notifications === false || ctx.goalRunning(f.threadId)) return null;
    return say("activity", who, message.text);
  }

  const card = message.card;
  if (message.kind === "options" && card && !card.answered && !card.dismissed && (card.requestId || card.runId)) {
    return say(
      "needs-me",
      room ? `${who}: someone needs you` : `${who} needs you`,
      card.runId ? `${card.title || "Approval needed"} ${card.subtitle || ""}` : card.subtitle || card.title || "An agent is waiting for your answer.",
    );
  }
  if (message.kind !== "notice") return null;
  if (message.chainHeld) return null;
  if (message.goal) {
    if (message.goal === "blocked") return say("needs-me", `${who} needs you`, message.text || "A goal is waiting on you.");
    if ((message.goal === "done" || message.goal === "out") && bot?.notifications !== false) return say("activity", who, message.text ?? "");
    return null;
  }
  if (message.incident) {
    if (message.incident.kind === "note" || message.incident.state === "resolved") return null;
    return say("needs-me", `${who} needs you`, message.text || "Something failed.");
  }
  if (message.failing) return say("activity", who, message.text ?? "");
  if (message.text && ENGINE_OUT.test(message.text)) return say("needs-me", `${who} could not answer`, message.text);
  return null;
}

/** Where a click on the morning brief's notification goes: that brief,
 * on Overview. The window reads it (src/state/store.tsx). */
export const BRIEF_TARGET = "brief:";

/**
 * The morning brief's one notification (server/brief.ts briefNotice),
 * when its frame says one is due. News, not a question: "activity", so a
 * workspace set to notify only when it needs the person, or muted, keeps
 * it to the page.
 */
export function briefNotice(frame: unknown): DesktopNotice | null {
  const f = frame as { kind?: string; id?: unknown; title?: unknown; body?: unknown; headline?: unknown } | null;
  if (f?.kind !== "brief.ready" || typeof f.id !== "string" || !f.id) return null;
  const body = typeof f.body === "string" ? f.body : typeof f.headline === "string" ? f.headline : "";
  return {
    level: "activity",
    title: typeof f.title === "string" && f.title ? f.title : "Your morning brief is ready",
    body: preview(body),
    target: `${BRIEF_TARGET}${f.id}`,
  };
}

/** The key one notice is known by, so a card patched again, or a frame
 * seen twice, is said once. */
export function noticeKey(frame: unknown): string | null {
  const f = frame as { kind?: string; id?: string; threadId?: string; turnId?: string; botId?: string; message?: NoticeMessage } | null;
  if (f?.kind === "brief.ready" && typeof f.id === "string") return `brief:${f.id}`;
  if (!f?.message || !f.threadId) return null;
  if (f.kind === "reply.settled") return `reply:${f.threadId}:${f.botId ?? ""}:${f.turnId ?? ""}`;
  if (f.kind === "message.patch") return `incident:${f.message.incident?.id ?? f.message.id ?? ""}`;
  return `message:${f.threadId}:${f.message.card?.requestId ?? f.message.card?.runId ?? f.message.id ?? ""}`;
}

/** Remembers the last few hundred keys said, and nothing older. */
export class SaidOnce {
  private keys = new Set<string>();
  take(key: string | null): boolean {
    if (!key) return true;
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    if (this.keys.size > 512) this.keys.delete(this.keys.values().next().value!);
    return true;
  }
}

/** How many conversations have something unseen: the Dock badge's own
 * count (src/lib/unread.ts), for a workspace no window is counting. */
export function unreadCount(bots: Array<{ unread?: boolean; archivedAt?: number | null }>): number {
  return bots.filter((bot) => bot.unread && !bot.archivedAt).length;
}
