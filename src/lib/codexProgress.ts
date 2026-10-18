// Codex narration in a turn another agent started, shown as work.
//
// The server decides, when an item is said, whether it is progress
// (server/codex-text.ts stamps `codexText`, shaped in
// shared/codex-text.d.ts). This side never makes text quieter than that
// stamp says; it only gives some of it back to the conversation once the
// rest of the turn is known: a person who joined the turn sees all of it,
// and a turn that ended without an answer keeps its last word visible.
import type { CodexText } from "../../shared/codex-text.js";

export type { CodexText };

const identity = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value);

/** The same check the server makes; anything it does not know is ordinary text. */
export function isProgressText(c: CodexText | null | undefined): boolean {
  return Boolean(c && c.v === 1 && identity(c.turnId) && identity(c.itemId) && c.origin === "agent" && c.phase === "commentary" && c.questions === "none" && c.display === "progress");
}

export function itemProgress(message: { role?: string; kind?: string; codexText?: CodexText } | null | undefined): boolean {
  return message?.role === "bot" && message.kind === "text" && isProgressText(message.codexText);
}

export interface ProgressMessage {
  id: string;
  role: string;
  kind?: string;
  text?: string;
  from?: string;
  agent?: unknown;
  via?: unknown;
  queued?: boolean;
  midTurn?: boolean;
  joinedTurnId?: string;
  codexText?: CodexText;
}

/** Presentation only, linear in the loaded history. No stored transitions or news. An incomplete page may omit a person join;
 * in that case retain ordinary visibility until the facts are loaded. */
export function progressIds(history: readonly ProgressMessage[], isRunning: (message: ProgressMessage, index: number) => boolean, headKnown = true, tailKnown = true): ReadonlySet<string> {
  const progress = new Set<string>();
  if (!tailKnown) return progress;
  const knownTurns = new Set<string>();
  const knownLanes = new Set<string>();
  const joined = new Set<string>();
  const finals = new Set<string>();
  const lastCommentary = new Map<string, string>();
  const latest = new Map<string, string>();
  for (const m of history) {
    // A committed new input bounds the direct lane's turn. In a room,
    // a later native turn ID bounds that speaker even with an older page missing.
    if (m.role === "user" && m.kind === "text" && !m.midTurn && !m.queued) knownLanes.add(m.from ?? "");
    if (m.role === "user" && m.midTurn && !m.queued && !m.agent && !m.via && m.joinedTurnId) joined.add(m.joinedTurnId);
    const c = m.codexText;
    if (!c || c.v !== 1 || !identity(c.turnId)) continue;
    const lane = m.from ?? "";
    const previous = latest.get(lane);
    if (headKnown || knownLanes.has(lane) || (previous && previous !== c.turnId)) knownTurns.add(c.turnId);
    latest.set(lane, c.turnId);
    if (m.text?.trim() && c.phase === "final_answer") finals.add(c.turnId);
    if (m.text?.trim() && c.phase === "commentary") lastCommentary.set(c.turnId, m.id);
  }
  for (let index = 0; index < history.length; index++) {
    const m = history[index];
    if (m.role !== "bot" || m.kind !== "text" || !itemProgress(m)) continue;
    const turn = m.codexText!.turnId;
    if (!knownTurns.has(turn) || joined.has(turn)) continue;
    const ended = !isRunning(m, index) || latest.get(m.from ?? "") !== turn;
    if (ended && !finals.has(turn) && lastCommentary.get(turn) === m.id) continue;
    progress.add(m.id);
  }
  return progress;
}
