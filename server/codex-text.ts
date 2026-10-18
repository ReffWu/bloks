// Which Codex text is work in progress, decided once, when it is said.
//
// Codex marks each finished message with a phase: commentary while it
// works, final_answer when it is done. In a turn another agent started,
// commentary is narration nobody is waiting on, and it is kept out of the
// conversation's main line and out of every alert. The decision is stamped
// on the message here (shared/codex-text.d.ts has its shape) and never
// remade later: clients only read it.
import type { CodexItemText, CodexText } from "../shared/codex-text.js";

export type { CodexItemText, CodexText };

const identity = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value);

/**
 * Codex's statement about one completed item. A missing or malformed
 * `questions` is "unknown".
 */
export function codexItemText(item: { phase?: unknown; questions?: unknown }): CodexItemText {
  const phase = typeof item.phase === "string" && item.phase.length <= 64 && !/[\x00-\x1f\x7f]/.test(item.phase) ? item.phase : null;
  let questions: CodexItemText["questions"] = "unknown";
  if (item.questions !== undefined) {
    if (item.questions === null || (Array.isArray(item.questions) && item.questions.length === 0)) questions = "none";
    else if (Array.isArray(item.questions)) questions = "present";
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
