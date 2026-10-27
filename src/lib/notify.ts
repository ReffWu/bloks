// What is worth interrupting somebody for.
//
// Agents work while you are elsewhere, which is the point of them; the
// price is that they generate events all day. A workspace that notifies
// on every one of them gets muted within a week, and a muted workspace
// silently drops the one message that mattered.
//
// So the policy is written down here, once, as a pure function, rather
// than scattered across the places that happen to see an event:
//
//   Unanswered questions and approvals interrupt. A stopped process
//   alone has not asked the person to decide anything.
//
//   A settled reply interrupts only if that agent is allowed to, and
//   only when you are not already looking at it.
//
//   An agent's room mention stays silent. A person naming somebody is
//   handled by the server's targeted phone wake.
//
//   Nothing interrupts when you are looking straight at it. A banner for
//   a message already on your screen is noise with extra steps.
//
//   A hold is a record for its owner, not a question for the person. A
//   goal blocked on the person, and an engine that is out (credits, a
//   plan limit, a sign-in), are stopped until the person acts, so they
//   interrupt like a question. Other goal results follow the reply switch,
//   and while a conversation works toward one,
//   its turns' replies are the work too: the goal's end is said once,
//   when it comes, rather than twenty times on the way.
//
//   The morning brief is one notification for the morning, whatever fed
//   it (server/brief.ts briefNotice decides whether there is one at all),
//   and it opens that brief on Overview. Not while Overview is in front
//   of you: the brief is already there.
//
//   A quiet check-in never interrupts. Its agent answered QUIET because
//   nothing needed you, and what a check-in says on the way to deciding
//   that waits for the end of its turn (CheckInHold), so the commentary
//   of a run that turns out quiet is never news either. Reply banners use
//   the server's settled decision (reply.settled); CheckInHold retains
//   only speech timing. A server too old to send that (no "reply-settled"
//   in its features, settlesReplies) still has its replies announced as
//   they land, the way they were before it could say when a turn was over.

import { itemProgress, type CodexText } from "./codexProgress.ts";
import { t } from "./i18n.ts";

const ENGINE_OUT =
  /credit balance is too low|insufficient[_ ](?:quota|credits|funds|balance)|billing|payment required|\b402\b|out of credits|exceed your available credits|usage limit|limit (?:reached|exceeded)|quota|rate[ _-]?limit|\b429\b|not (?:logged|signed) in|sign in/i;

/** The parts of a message this decision actually depends on. */
export interface NotifiableMessage {
  codexText?: CodexText;
  role?: string;
  kind?: string;
  text?: string;
  from?: string;
  card?: { requestId?: string; runId?: string; title?: string; subtitle?: string; answered?: string; dismissed?: boolean };
  deleted?: boolean;
  /** Part of a quiet check-in (server/store.ts). */
  quiet?: boolean;
  /** A notice about the conversation's goal (server/goals.ts). */
  goal?: string;
  /** Agents stopped at the workspace turn limit (server/agent-chain.ts). */
  chainHeld?: boolean;
  /** The incident desk's card, or its note to a lead (server/incidents.ts). */
  incident?: { kind: string; state?: string };
  /** A routine or a watcher that stopped for failing. */
  failing?: { kind: string };
}

export interface NotifyContext {
  /** A reply that is one to announce: the server's decision after recovery
   * and quiet settlement, or one that landed from a server too old to make it. */
  replySettled?: boolean;
  /** Is the app focused right now? */
  focused: boolean;
  /** The conversation on screen, agent or room. */
  selectedId: string;
  /** Where this message landed. */
  threadId: string;
  /** The agent that owns the thread, if it is a one to one. */
  bot?: { id: string; name: string; notifications?: boolean };
  /** The room it landed in, if it is a room. */
  room?: { id: string; name: string };
  /** The conversation it landed in is working toward a goal right now. */
  goalRunning?: boolean;
}

export interface Notice {
  title: string;
  body: string;
  /** What to open when the banner is clicked. */
  target: string;
  /** Approvals get to be loud; everything else is quiet. */
  urgent: boolean;
  /** The agent's face, when it has one, so a stack of banners reads as
   * people rather than as one app repeating itself. */
  avatar?: string;
}

const MAX_BODY = 180;

/** One line of a transcript, clipped to something a banner can hold. */
function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_BODY ? `${flat.slice(0, MAX_BODY - 1)}…` : flat;
}

/**
 * Whether this message should raise a banner, and what it should say.
 * Null means stay quiet, which is the answer most of the time.
 */
export function noticeFor(message: NotifiableMessage, ctx: NotifyContext): Notice | null {
  if (message.role !== "bot" || message.quiet || message.deleted || itemProgress(message)) return null;

  const who = ctx.room ? ctx.room.name : (ctx.bot?.name ?? t("common.anAgent"));
  const target = ctx.room ? ctx.room.id : (ctx.bot?.id ?? ctx.threadId);
  // Looking at it already: the message is on screen, and a banner about
  // something you can see is the definition of noise.
  const watching = ctx.focused && ctx.selectedId === target;

  // An agent that stopped to ask. This one outranks everything, including
  // the per-agent switch: the work is halted until it is answered.
  if (message.kind === "options" && message.card && !message.card.answered && !message.card.dismissed && (message.card.requestId || message.card.runId)) {
    if (watching) return null;
    return {
      title: ctx.room ? t("notify.someoneNeedsYou", { who }) : t("notify.needsYou", { who }),
      body: preview(message.card.runId
        ? `${message.card.title || t("notify.approvalNeeded")} ${message.card.subtitle || ""}`
        : message.card.subtitle || message.card.title || t("notify.waitingForYourAnswer")),
      target,
      urgent: true,
    };
  }

  // A chain hold is a record for its owner, even when it carries a goal
  // or its explanation names billing or quota.
  if (message.kind === "notice" && message.chainHeld) return null;

  // Where a goal ended up. Blocked is judged only when the goal cannot go
  // on without the person (server/goals.ts), so it interrupts like a
  // question. Done or out of turns follows the reply switch.
  if (message.kind === "notice" && message.goal) {
    if (watching) return null;
    if (message.goal === "blocked") {
      return { title: t("notify.needsYou", { who }), body: preview(message.text || t("notify.goalWaiting")), target, urgent: true };
    }
    if ((message.goal === "done" || message.goal === "out") && ctx.bot?.notifications !== false) {
      return { title: who, body: preview(message.text ?? ""), target, urgent: false };
    }
    return null;
  }

  // Something that failed, put to the person by the incident desk
  // (server/incidents.ts), or the one card that stands for many while it
  // is quiet. Like a blocked goal, the person is who settles it now. The
  // note that hands a lead an incident is never the person's news.
  if (message.kind === "notice" && message.incident) {
    if (message.incident.kind === "note" || message.incident.state === "resolved" || watching) return null;
    return { title: t("notify.needsYou", { who }), body: preview(message.text || t("notify.somethingFailed")), target, urgent: true };
  }
  // A routine or a watcher that stopped running on its own: worth a word
  // when it happens, not an interruption, since nothing is waiting on it.
  if (message.kind === "notice" && message.failing) {
    if (watching) return null;
    return { title: who, body: preview(message.text ?? ""), target, urgent: false };
  }

  // An agent that could not answer because its engine is out: credits, a
  // plan limit, a sign-in. Its work is stopped until the person acts, so
  // it is said even when the agent is otherwise quiet. The words match
  // server/failover.ts.
  if (message.kind === "notice" && message.text && ENGINE_OUT.test(message.text)) {
    if (watching) return null;
    return { title: t("notify.couldNotAnswer", { who }), body: preview(message.text), target, urgent: true };
  }

  if (message.kind !== "text" || !message.text?.trim() || !ctx.replySettled) return null;
  if (watching) return null;

  // An agent's room mention is coordination, not a person's ask.
  // Human mentions still use the server's targeted phone wake.
  if (ctx.room) return null;

  // A one to one reply, if this agent is allowed to interrupt, and not
  // one on the way to a goal, whose end is said when it comes.
  if (ctx.bot?.notifications === false || ctx.goalRunning) return null;
  return { title: who, body: preview(message.text), target, urgent: false };
}

/**
 * What a check-in says, held until its turn ends.
 *
 * The server marks the frames of a quiet routine's turn (`checkIn`), and
 * only the end of the turn says whether it had anything for you: its
 * last words are QUIET, already marked quiet, or they are a report. So
 * speech is held here, the newest replacing the one before, and the raw
 * end of the turn lets go of the last of them unless it was quiet. This
 * preserves the existing speech behavior, not notification authority:
 * reply banners come from reply.settled after server recovery decisions,
 * and only a server too old to send it has the released reply announced.
 */
export class CheckInHold<M extends NotifiableMessage = NotifiableMessage> {
  private held = new Map<string, M>();

  /** Whether this frame's message waits for the end of its turn. */
  holds(message: M, checkIn: boolean): boolean {
    return checkIn && message.role === "bot" && message.kind === "text";
  }

  hold(threadId: string, message: M): void {
    this.held.set(threadId, message);
  }

  /** The turn in this thread ended: its last reply, to announce, or
   * null when there is none or it was quiet. Speech only. */
  release(threadId: string): M | null {
    const last = this.held.get(threadId) ?? null;
    this.held.delete(threadId);
    return last && !last.quiet ? last : null;
  }
}

/** What a server lists in its features (server/features.ts) once it says
 * each turn's reply with reply.settled. */
export const REPLY_SETTLED_FEATURE = "reply-settled";

/** Whether a server's /api/health says it sends reply.settled. In remote
 * mode the desktop can be newer than the computer it works with, and an
 * older one only ever sends the messages. Null when the answer is not a
 * health reading at all, so what was known before is kept. */
export function settlesReplies(health: unknown): boolean | null {
  if (!health || typeof health !== "object" || (health as { app?: unknown }).app !== "bloks") return null;
  const features = (health as { features?: unknown }).features;
  return Array.isArray(features) && features.includes(REPLY_SETTLED_FEATURE);
}

/** Connection-scoped freshness and bounded request-card deduplication.
 * Consume before attention policy, even when the person is watching. */
export class NoticeDelivery {
  private seen = Infinity;
  private keys = new Set<string>();
  reconnect(): void { this.seen = Infinity; this.keys.clear(); }
  hello(sequence: number): void { this.seen = Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : Infinity; this.keys.clear(); }
  take(sequence: unknown, key: string): boolean {
    if (typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence <= this.seen) return false;
    this.seen = sequence;
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    if (this.keys.size > 512) this.keys.delete(this.keys.values().next().value!);
    return true;
  }
}

/** What a click on the brief's notification opens: `brief:<id>`, the
 * same target a background workspace's server gives it
 * (server/desktop-notice.ts BRIEF_TARGET). */
export const BRIEF_TARGET = "brief:";

/** One conversation of one agent, `conversation:<agent>/<conversation>`,
 * each part URI-encoded: what a row in the notch opens, written by the
 * desktop app (electron/notch.mjs, conversationTarget). */
export const CONVERSATION_TARGET = "conversation:";

export function conversationOf(target: string): { id: string; lane: string } | null {
  if (!target.startsWith(CONVERSATION_TARGET)) return null;
  const [id, lane, ...rest] = target.slice(CONVERSATION_TARGET.length).split("/");
  if (!id || !lane || rest.length) return null;
  try {
    return { id: decodeURIComponent(id), lane: decodeURIComponent(lane) };
  } catch {
    return null;
  }
}

/** The morning brief's notification, from its brief.ready frame, or null
 * when there is nothing to say or Overview is already in front of you. */
export function briefNoticeFor(
  frame: { id?: unknown; title?: unknown; body?: unknown; headline?: unknown },
  ctx: { focused: boolean; onOverview: boolean },
): Notice | null {
  if (typeof frame.id !== "string" || !frame.id) return null;
  if (ctx.focused && ctx.onOverview) return null;
  const body = typeof frame.body === "string" ? frame.body : typeof frame.headline === "string" ? frame.headline : "";
  return {
    title: typeof frame.title === "string" && frame.title ? frame.title : t("notify.briefReady"),
    body: preview(body),
    target: `${BRIEF_TARGET}${frame.id}`,
    urgent: false,
  };
}
