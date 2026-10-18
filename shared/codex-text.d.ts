// What the server says about one finished Codex text item, read by every
// client: this app's window, a remote window and a phone.
//
// Types only, on purpose. The server is compiled on its own into a folder
// the packaged app ships whole, and a module with code in it here would
// move that folder's layout; a declaration file is read by both compilers
// and emitted by neither. Each side keeps its own small check of the shape
// (server/codex-text.ts stamps it, src/lib/codexProgress.ts reads it), and
// test/codex-progress.test.ts holds the two to the same answers.

/** Codex's own statement about an item, or what the server could tell. */
export interface CodexItemText {
  /** Codex's phase for the item ("commentary", "final_answer"), else null. */
  phase: string | null;
  /**
   * Whether the item asks anything of the person. Codex's own word when it
   * gives one; otherwise "none" only for commentary whose text the server
   * could read as asking nothing, and "unknown" for everything else.
   */
  questions: "none" | "present" | "unknown";
}

/**
 * Carried as `codexText` on a bot's text message, in history and on the
 * event stream alike, and on the runtime events that stream the same text.
 * Only the server writes it; a client or an agent that sends one is ignored.
 *
 * A client treats an item as progress only when every one of these holds:
 * v is 1, both ids are present, origin is "agent", phase is "commentary",
 * questions is "none", and display is "progress". Anything else, a newer
 * version included, is ordinary text.
 */
export interface CodexText extends CodexItemText {
  v: 1;
  /** Opaque turn identity, scoped to the lane and the speaker. */
  turnId: string;
  /** The completed item within that turn. */
  itemId: string;
  /** Who started the turn, as far as the server knows. */
  origin: "agent" | "person" | "other" | "unknown";
  /** How it reads at the moment it was said: work, or something said. */
  display: "progress" | "full";
}
