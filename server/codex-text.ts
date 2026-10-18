// Which Codex text is work in progress, decided once, when it is said.
//
// Codex marks each finished message with a phase: commentary while it
// works, final_answer when it is done. In a turn another agent started,
// commentary is narration nobody is waiting on, and it is kept out of the
// conversation's main line and out of every alert. The decision is stamped
// on the message here (shared/codex-text.d.ts has its shape) and never
// remade later: clients only read it.
//
// Codex does not say whether a commentary item asks anything (its
// agentMessage item carries id, text, phase and a memory citation, nothing
// more), so when it is silent the server reads the text itself, and reads
// it conservatively. Text counts as asking nothing only when it has no
// question mark, does not address anyone, and has none of the words a
// request or a blocker is made of. Whatever it cannot read that way stays
// "unknown", and unknown text is shown like any other. Getting this wrong
// in the quiet direction would hide a question; in the loud direction it
// only shows a line of narration, so every doubt goes the loud way.
import type { CodexItemText, CodexText } from "../shared/codex-text.js";

export type { CodexItemText, CodexText };

const identity = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value);

// Each of these alone is enough to leave a commentary item visible.
const ASKS: readonly RegExp[] = [
  // a question, in the scripts whose question marks we know
  /[?¿;؟？]/,
  // text in a script these patterns cannot read
  /(?!\p{Script=Latin})\p{L}/u,
  // somebody addressed: you, your, a mention
  /\b(you|your|yours|yourself|yourselves|y'all)\b/i,
  /(^|[^\w.])@[\p{L}\p{N}_]/u,
  // the words a request is made of
  /\b(please|pls|plz|kindly|let me know|tell me|get back to me|ping me|lmk)\b/i,
  /\b(want|need|like)s? me to\b/i,
  /\b(shall|should|may|can|could) i\b/i,
  /\b(confirm|confirmation|approve|approval|permission|authori[sz]e|decide|decision|choose|choice|pick one|prefer|preference|reply|respond|answer|advise|clarify|feedback|go-ahead|sign-off|sign off)\b/i,
  // a blocker is a request too, even when it is not phrased as one
  /\b(blocked|stuck|waiting (for|on)|can't continue|cannot continue|can't proceed|cannot proceed|needs? (help|access|credentials|a decision|input|someone|a human))\b/i,
];

/** True only when this commentary text can be read as asking nothing. */
export function asksNothing(text: string): boolean {
  const said = text.trim();
  return said.length > 0 && !ASKS.some((pattern) => pattern.test(said));
}

/**
 * Codex's statement about one completed item. Its own `questions`, when it
 * sends one, wins over anything read from the text; a malformed one is
 * "unknown", never a reason to read the text instead.
 */
export function codexItemText(item: { phase?: unknown; questions?: unknown; text?: unknown }): CodexItemText {
  const phase = typeof item.phase === "string" && item.phase.length <= 64 && !/[\x00-\x1f\x7f]/.test(item.phase) ? item.phase : null;
  let questions: CodexItemText["questions"] = "unknown";
  if (item.questions !== undefined) {
    if (item.questions === null || (Array.isArray(item.questions) && item.questions.length === 0)) questions = "none";
    else if (Array.isArray(item.questions)) questions = "present";
  } else if (phase === "commentary" && typeof item.text === "string" && asksNothing(item.text)) {
    questions = "none";
  }
  return { phase, questions };
}

/** The stamp for one item, or nothing when the ids cannot be trusted. */
export function codexTextFor(item: CodexItemText | undefined, turnId: unknown, itemId: unknown, origin: CodexText["origin"]): CodexText | undefined {
  if (!item || !identity(turnId) || !identity(itemId)) return undefined;
  return { v: 1, turnId, itemId, ...item, origin, display: origin === "agent" && item.phase === "commentary" && item.questions === "none" ? "progress" : "full" };
}

/** Item-time attention rule. Missing or new metadata never makes text quieter. */
export function isProgressText(c: CodexText | null | undefined): boolean {
  return Boolean(c && c.v === 1 && identity(c.turnId) && identity(c.itemId) && c.origin === "agent" && c.phase === "commentary" && c.questions === "none" && c.display === "progress");
}

export function itemProgress(message: { role?: string; kind?: string; codexText?: CodexText } | null | undefined): boolean {
  return message?.role === "bot" && message.kind === "text" && isProgressText(message.codexText);
}
