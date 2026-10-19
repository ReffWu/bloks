// Who the next message in a room wakes, read from the words as they are
// typed, so the row under the box can say so before anything is sent.
//
// The server decides (postToRoomNow and addressees in server/bloks.ts);
// this reads it the same way, so what the row says is what happens:
// names count against everyone in the room, longest first and each one
// used up, so "@Bobby Tables" never also reads as "@Bo". Nobody named
// means everyone who can answer, or only the lead in a lead-only room.
// In a shared room, words that name a person and no agent wake nobody.

export interface Member {
  id: string;
  name: string;
}

export type Reach =
  | { kind: "named"; ids: string[] }
  | { kind: "lead"; id: string }
  | { kind: "everyone" }
  | { kind: "people" };

/** The members named with @, in room order. */
export function namedIn(text: string, members: readonly Member[]): string[] {
  let remaining = text.toLowerCase();
  const hit = new Set<string>();
  for (const member of [...members].sort((a, b) => b.name.length - a.name.length)) {
    const needle = `@${member.name.toLowerCase()}`;
    if (!member.name || !remaining.includes(needle)) continue;
    hit.add(member.id);
    remaining = remaining.split(needle).join(" ");
  }
  return members.filter((m) => hit.has(m.id)).map((m) => m.id);
}

export function reachOf(
  text: string,
  {
    members,
    lead,
    leadOnly,
    people = [],
  }: {
    /** Everyone in the room, archived members too: a name is a name. */
    members: readonly Member[];
    lead: string | null;
    leadOnly: boolean;
    /** The people a shared room is shared with, and its owner. */
    people?: readonly string[];
  },
): Reach {
  const named = namedIn(text, members);
  if (named.length) return { kind: "named", ids: named };
  const lower = text.toLowerCase();
  if (people.some((name) => name && lower.includes(`@${name.toLowerCase()}`))) return { kind: "people" };
  if (leadOnly && lead) return { kind: "lead", id: lead };
  return { kind: "everyone" };
}
