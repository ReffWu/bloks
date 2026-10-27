// What a busy room is doing, read from what the app already has.
//
// Three questions the room view asks of its transcript and its stream,
// kept here because each is a little rule with edges, and rules with
// edges want tests rather than a component around them:
//
//   Who handed what to whom. A member that names another with @name in
//   the room passes the turn on (relayMentions in server/index.ts reads
//   it the same way: the name, lower-cased, after an @). The room shows
//   that as one line where the named member's answer begins.
//
//   What a member is saying right now that the room has not got yet. The
//   stream is kept per lane, and a member's words land in the room rather
//   than in its lane, so nothing clears the stream as each part lands.
//   The part already in the transcript is cut off the front instead.
//
//   How to say who is working, in one line.
import type { Message } from "@/state/reducer";
import { t } from "./i18n.ts";

/** One member passing the turn to another. */
export interface Handoff {
  fromId: string;
  toId: string;
  /** The message that named them, which the line opens. */
  sourceId: string;
  /** What they were asked, in a few words, or "" when the line has none. */
  ask: string;
}

export interface Handoffs {
  /** Keyed by the index of the named member's first message after it. */
  placed: Map<number, Handoff[]>;
  /** Named and not answered yet, by who was named. */
  pending: Map<string, Handoff>;
}

/** Room members as this needs them: who, and the name @ reaches. */
export interface Named {
  id: string;
  name: string;
}

function names(text: string, member: Named): boolean {
  return text.toLowerCase().includes(`@${member.name.toLowerCase()}`);
}

/**
 * What the sentence that names someone asks of them. "@Ben, can you draft
 * the API? Thanks" is "can you draft the API?". Everyone named in the
 * sentence is taken out of it, and so is the "and" between them, since
 * the line already says who.
 */
export function askIn(text: string, to: Named, members: readonly Named[]): string {
  const lower = text.toLowerCase();
  const at = lower.indexOf(`@${to.name.toLowerCase()}`);
  if (at === -1) return "";
  // the sentence around the mention: back to the last stop, on to the next
  const before = text.slice(0, at);
  const startsAt = Math.max(before.lastIndexOf("\n"), ...[". ", "! ", "? "].map((stop) => {
    const i = before.lastIndexOf(stop);
    return i === -1 ? -1 : i + 1;
  }));
  const rest = text.slice(at);
  const stop = rest.search(/[.!?](\s|$)|\n/);
  let sentence = text.slice(startsAt + 1, stop === -1 ? text.length : at + stop + 1);
  for (const m of [...members].sort((a, b) => b.name.length - a.name.length)) {
    sentence = sentence.replace(new RegExp(`@${m.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), " ");
  }
  let ask = sentence.replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
  // what joined the names: "@Ada and @Ben, ..." leaves "and ," behind
  for (let was = ""; was !== ask; ) {
    was = ask;
    ask = ask.replace(/^(?:[,:;&]|and\b|or\b)\s*/i, "");
  }
  ask = ask.replace(/\s+([,.!?:;])/g, "$1");
  return /[a-z0-9]/i.test(ask) ? ask : "";
}

/**
 * Where each handoff in the room lands. A member's words that name
 * another member are a handoff to them, placed at the named member's next
 * message. Your own message ends whatever was still waiting: from then on
 * they are answering you, not the member that named them.
 */
export function handoffsIn(said: readonly Message[], members: readonly Named[]): Handoffs {
  const placed = new Map<number, Handoff[]>();
  const pending = new Map<string, Handoff>();
  said.forEach((m, i) => {
    if (m.role === "user") {
      if (m.kind === "text") pending.clear();
      return;
    }
    if (!m.from) return;
    const waiting = pending.get(m.from);
    if (waiting) {
      placed.set(i, [...(placed.get(i) ?? []), waiting]);
      pending.delete(m.from);
    }
    if (m.kind !== "text" || m.deleted || !m.text) return;
    for (const to of members) {
      if (to.id === m.from || !names(m.text, to)) continue;
      pending.set(to.id, { fromId: m.from, toId: to.id, sourceId: m.id, ask: askIn(m.text, to, members) });
    }
  });
  return { placed, pending };
}

/** Where the part of a stream the room already has ends. */
export interface StreamMark {
  /** The member's last words in the room when this was worked out. */
  lastId: string | undefined;
  cut: number;
}

/** The end of `said` inside `stream` from `from` on, if it is there. The
 * room's copy has been through the house style, which turns a dash into a
 * comma, so when its own last words are not found, the stretch after its
 * last comma is looked for instead. */
function endOf(stream: string, said: string, from: number): number | null {
  const words = said.trimEnd();
  for (const tail of [words.slice(-24), (words.split(",").pop() ?? "").trimStart().slice(-24)]) {
    if (tail.trim().length < 4) continue;
    const at = stream.indexOf(tail, from);
    if (at !== -1) return at + tail.length;
  }
  return null;
}

/**
 * What of a member's stream to show: the words after the last part that
 * already landed in the room. `mark` is what the last call returned for
 * this lane, and the next call wants it back.
 *
 * Seen first, a stream may already hold a part the room has (the room
 * opened mid-turn), so it is looked for. Once a new part lands, where it
 * ends is looked for, and failing that everything so far counts as said
 * rather than say it twice. A stream shorter than its cut started again.
 */
export function unsaid(
  stream: string,
  last: { id: string; text: string } | undefined,
  mark: StreamMark | undefined,
): { text: string; mark: StreamMark } {
  let next = mark && stream.length >= mark.cut ? mark : undefined;
  if (!next) next = { lastId: last?.id, cut: (last && endOf(stream, last.text, 0)) ?? 0 };
  else if (next.lastId !== last?.id) {
    next = { lastId: last?.id, cut: (last && endOf(stream, last.text, next.cut)) ?? stream.length };
  }
  return { text: stream.slice(next.cut).replace(/^\s+/, ""), mark: next };
}

/** "Ada", "Ada and Ben", "Ada, Ben and Cy", "Ada, Ben and 2 others". */
export function namesLine(list: readonly string[]): string {
  if (list.length <= 1) return list[0] ?? "";
  if (list.length === 2) return t("roomVoices.two", { a: list[0], b: list[1] });
  if (list.length === 3) return t("roomVoices.three", { a: list[0], b: list[1], c: list[2] });
  return t("roomVoices.others", { a: list[0], b: list[1], count: list.length - 2 });
}
