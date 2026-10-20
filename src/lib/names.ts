// What people are called in a conversation.
//
// Bloks names people, never handles them. In a conversation a person is
// their first name, the way a group chat between colleagues reads ("Seen
// by Sam, Ana"). Two people in one workspace can answer to the same first
// name, and then the short name says which one: "Sam O." and "Sam K.", by
// the initial of their last name. When even that is shared ("Sam Okafor"
// and "Sam Olsen") the whole name is the only honest answer. Two people
// who gave exactly the same name stay the same on screen: their faces
// differ (tintOf), and a number after one of them would be a handle.
//
// The set is everybody a name could be mistaken among: the workspace's
// people and the owner, plus a room's guests where there is a room. An
// @mention still completes to the name as given, which is what the
// server reads it by; only the label in the list is the short one.
//
// Plain functions over plain data, so the rule can be walked in a test
// (test/names.test.ts). The phone keeps the same rule.

/** The first word of a name, as a conversation calls them. */
export function firstName(name: string): string {
  const clean = name.trim();
  return clean.split(/\s+/)[0] || clean;
}

/** "Sam O." for Sam Okafor; just "Sam" for somebody with one name. */
export function withInitial(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return words[0] ?? name.trim();
  const last = [...words[words.length - 1]][0] ?? "";
  return `${words[0]} ${last.toLocaleUpperCase()}.`;
}

const same = (name: string) => name.toLocaleLowerCase();

/**
 * Each person's name as a conversation shows it, told apart from
 * everybody else in `people`, by id. The first name where nobody else
 * shares it; with the last initial where somebody does; the whole name
 * where the initials match too.
 */
export function distinctNames(people: ReadonlyArray<{ id: string; name: string }>): Map<string, string> {
  const byId = new Map<string, string>();
  for (const p of people) if (p.name.trim() && !byId.has(p.id)) byId.set(p.id, p.name.trim().replace(/\s+/g, " "));
  const byFirst = new Map<string, string[]>();
  for (const [id, name] of byId) {
    const key = same(firstName(name));
    byFirst.set(key, [...(byFirst.get(key) ?? []), id]);
  }
  const out = new Map<string, string>();
  for (const ids of byFirst.values()) {
    if (ids.length === 1) {
      out.set(ids[0], firstName(byId.get(ids[0])!));
      continue;
    }
    const initialed = new Map(ids.map((id) => [id, withInitial(byId.get(id)!)]));
    const counts = new Map<string, number>();
    for (const short of initialed.values()) counts.set(same(short), (counts.get(same(short)) ?? 0) + 1);
    for (const id of ids) {
      const short = initialed.get(id)!;
      out.set(id, counts.get(same(short)) === 1 ? short : byId.get(id)!);
    }
  }
  return out;
}

/** A lookup over distinctNames, for components that name people by id:
 * the told-apart name, else the fallback (a former member, "You"). */
export function namer(people: ReadonlyArray<{ id: string; name: string }>): (id: string, fallback?: string) => string {
  const names = distinctNames(people);
  return (id, fallback = "Someone") => names.get(id) ?? fallback;
}
