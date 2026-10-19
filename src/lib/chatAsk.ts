// Asking a conversation to do something from outside it.
//
// The ⌘K palette knows which message you picked, and that you want to
// find or open a terminal, but the thing that can scroll, highlight or
// open a drawer is the conversation itself, and it may not be on screen
// yet: a palette result opens another agent, or another lane whose
// transcript is still on its way. So the ask waits here, one at a time,
// and the conversation takes it once it is the one it was meant for and
// has the message in hand. An ask nobody takes in a few seconds is
// dropped, so it can never fire long after you have moved on.

export type ChatAsk =
  | { kind: "land"; botId: string; threadId: string; messageId: string }
  | { kind: "find"; botId: string }
  | { kind: "terminal"; botId: string };

/** How long an ask waits for its conversation before it is forgotten. */
export const ASK_TTL = 8000;

let pending: (ChatAsk & { at: number }) | null = null;
const listeners = new Set<() => void>();

/** Leave an ask for a conversation, replacing any that was waiting. */
export function askChat(ask: ChatAsk, now = Date.now()): void {
  pending = { ...ask, at: now };
  for (const listener of listeners) listener();
}

/** The ask waiting for this agent, if one is and it is still fresh. */
export function peekAsk(botId: string, now = Date.now()): ChatAsk | null {
  if (!pending) return null;
  if (now - pending.at > ASK_TTL) {
    pending = null;
    return null;
  }
  return pending.botId === botId ? pending : null;
}

/** Done with it. Only the ask that was taken is cleared, never a newer one. */
export function takeAsk(ask: ChatAsk): void {
  if (pending === ask) pending = null;
}

/** Hear new asks; returns the way to stop. */
export function onAsk(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
