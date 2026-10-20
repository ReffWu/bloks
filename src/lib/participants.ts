// Who is in a conversation, and how its messages are drawn because of it.
//
// One person and one agent read best as they always have: the person's
// words in a bubble, the agent's reply as the page. Once a third voice is
// there (a room, or a team agent's conversation with more than one human
// on its list or speaking in it) that stops working: whose words are
// whose is half the meaning. So every message becomes a bubble, the
// reader's own on their side in their accent and everyone else's on the
// other with a face and a name, a run from one sender drawn as one.
//
// Plain functions over plain data, so the rule and its edge cases can be
// walked in a test (test/participants.test.ts).

/** The people and agents in a conversation, by id. "owner" is the owner. */
export interface Participants {
  humans: ReadonlySet<string>;
  agents: ReadonlySet<string>;
}

/** More than two of them: every message is a bubble. */
export function isGroup(p: Participants): boolean {
  return p.humans.size + p.agents.size > 2;
}

/** Whether anybody besides the reader is a human here, which is when
 * "Seen by" has anything to say. */
export function otherHumans(p: Participants, me: string): number {
  return [...p.humans].filter((id) => id !== me).length;
}

/** A team agent's access list, as server/access.ts reads it. */
export interface AccessShape {
  mode: "everyone" | "only" | "except";
  people: string[];
  admins?: boolean;
}

/** Who is in a team agent's shared conversation: the owner always,
 * then each member by the agent's list (server/access.ts,
 * inTeamConversation, the same rule). */
export function teamHumans(access: AccessShape | null | undefined, members: ReadonlyArray<{ id: string; role: "member" | "admin" }>): Set<string> {
  const humans = new Set<string>(["owner"]);
  for (const m of members) {
    if (!access || access.mode === "everyone") humans.add(m.id);
    else if (m.role === "admin" && access.admins !== false) humans.add(m.id);
    else if (access.mode === "only" ? access.people.includes(m.id) : !access.people.includes(m.id)) humans.add(m.id);
  }
  return humans;
}

/** The fields of a message that say who sent it. */
export interface Said {
  id: string;
  role: "user" | "bot";
  /** A member's person id; absent is the owner. */
  author?: string;
  /** Which agent, in a room. */
  from?: string;
  /** Somebody writing from Telegram into the owner's conversation. */
  telegramPerson?: { personId: string };
  at: number;
}

/** Who sent a message, as one id: a person's ("owner", a member's id, or
 * a Telegram person's), or an agent's ("agent:<id>"). */
export function senderOf(m: Said, agentId?: string): string {
  if (m.role === "bot") return `agent:${m.from ?? agentId ?? "agent"}`;
  if (m.telegramPerson) return `telegram:${m.telegramPerson.personId}`;
  return m.author ?? "owner";
}

/** The humans who have spoken in a conversation. */
export function speakers(messages: readonly Said[]): Set<string> {
  const out = new Set<string>();
  for (const m of messages) if (m.role === "user") out.add(senderOf(m));
  return out;
}

/** Messages from one sender this close together read as one run. */
export const RUN_GAP_MS = 5 * 60_000;

/** Where a message sits in its sender's run: the first of a run carries
 * the face and the name, the last its time, and those in between only
 * their words, closer together. `bubbles` says which messages are drawn
 * as bubbles at all; anything else (a tool line, a card) ends a run. */
export function runs<T extends Said>(list: readonly T[], bubbles: (m: T) => boolean, agentId?: string): Map<string, { first: boolean; last: boolean }> {
  const out = new Map<string, { first: boolean; last: boolean }>();
  const joins = (a: T | undefined, b: T | undefined) =>
    Boolean(a && b && bubbles(a) && bubbles(b) && senderOf(a, agentId) === senderOf(b, agentId) && Math.abs(b.at - a.at) < RUN_GAP_MS);
  list.forEach((m, i) => {
    if (!bubbles(m)) return;
    out.set(m.id, { first: !joins(list[i - 1], m), last: !joins(m, list[i + 1]) });
  });
  return out;
}

/** One person's place in a conversation, as the server keeps it. */
export interface ReadMark {
  personId: string;
  messageId: string;
  at: number;
}

/**
 * Where each other person's "Seen by" sits: under the latest message
 * drawn that they have read. A place on something not drawn as its own
 * row (a tool line, a folded check-in) moves back to the nearest one that
 * is. `order` is every message id in the conversation, oldest first;
 * `anchors` the ones that can carry a receipt. The reader's own place is
 * never shown to them.
 */
export function receiptsAt(order: readonly string[], anchors: ReadonlySet<string>, reads: readonly ReadMark[], me: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const index = new Map(order.map((id, i) => [id, i]));
  for (const r of reads) {
    if (r.personId === me) continue;
    let i = index.get(r.messageId);
    if (i === undefined) continue;
    while (i >= 0 && !anchors.has(order[i])) i--;
    if (i < 0) continue;
    const at = order[i];
    out.set(at, [...(out.get(at) ?? []), r.personId]);
  }
  return out;
}

/** "Seen by Sam", "Seen by Sam, Ana". */
export function seenLine(names: readonly string[]): string {
  return `Seen by ${names.join(", ")}`;
}
