// Asking a conversation to do something from outside it.
//
// The ⌘K palette knows which message you picked, and that you want to
// find or open a terminal, but the thing that can scroll, highlight or
// open a drawer is the conversation itself, and it may not be on screen
// yet: a palette result opens another agent, a room, or another lane
// whose transcript is still on its way. So the ask waits here, one at a time,
// and the conversation takes it once it is the one it was meant for and
// has the message in hand. An ask nobody takes in a few seconds is
// dropped, so it can never fire long after you have moved on.

type AgentAsk =
  | { kind: "land"; botId: string; threadId: string; messageId: string }
  | { kind: "find"; botId: string }
  | { kind: "terminal"; botId: string }
  // the open conversation, with the question its × asks (ChatView.tsx)
  | { kind: "close"; botId: string };

/** A room has one transcript and no lanes, so landing is all it is asked. */
type RoomAsk = { kind: "landRoom"; roomId: string; messageId: string };

export type ChatAsk = AgentAsk | RoomAsk;

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
export function peekAsk(botId: string, now = Date.now()): AgentAsk | null {
  const ask = fresh(now);
  return ask && ask.kind !== "landRoom" && ask.botId === botId ? ask : null;
}

/** The ask waiting for this room, if one is and it is still fresh. */
export function peekRoomAsk(roomId: string, now = Date.now()): RoomAsk | null {
  const ask = fresh(now);
  return ask?.kind === "landRoom" && ask.roomId === roomId ? ask : null;
}

function fresh(now: number): (ChatAsk & { at: number }) | null {
  if (pending && now - pending.at > ASK_TTL) pending = null;
  return pending;
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
