// Bring your past sessions.
//
// Somebody arriving at Bloks has usually spent months in Claude Code or
// Codex already, and every one of those conversations is on this Mac: what
// was decided, why a plan changed, the command that finally worked. An
// agent that starts with none of it starts as a stranger to the person's
// own work. setup-import.ts brings over what they taught those tools; this
// is its sibling for what they said to them.
//
// Five rules, in the order they were decided.
//
//   Nothing is read until the person asks. The two folders are listed and
//   their files opened only when the import screen is open, and then only
//   to read: a session file is never written, renamed or touched, here or
//   by an engine carrying it on (below).
//
//   Read only from two known places. Claude Code's transcripts under
//   ~/.claude/projects/<folder>/*.jsonl and Codex's under
//   ~/.codex/sessions/**/rollout-*.jsonl. A link is never followed to a
//   file, and a file past a size is named as left alone.
//
//   Unknown lines are skipped, never fatal. Both formats have changed
//   more than once and will again, so each line is read for the few
//   fields that matter and anything else is passed over quietly.
//
//   A line that looks like a key stays behind. Every line of every message
//   goes through setup-import's scrub, and the person's own stored keys
//   through the redactor Settings uses; a line either finds anything is
//   left out whole, with a marker saying a line was, so the conversation
//   still reads.
//
//   What is shown is what is imported. The review shows every session as
//   it will land, with a digest; the import reads the files again and
//   refuses one whose digest moved, as setup-import does.
//
// Carrying on rather than starting over: a lane brought over from an
// engine the agent runs on keeps that session's id, and its first turn
// forks it (Claude Code's --fork-session, Codex's thread/fork) so the
// agent continues the very session with its whole history while the
// person's own file is left exactly as it was. Anywhere else the
// transcript is the context, told to the engine the way a lane that
// changed engines is (server/turn-context.ts).
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

import { isRecord, readSaved, writeFileAtomic } from "./atomic-write.ts";
import { MAX_MESSAGE_CHARS } from "./limits.ts";
import { scrubSecrets } from "./setup-import.ts";
import { toolCommand } from "./tool-command.ts";

export type SessionEngine = "claude" | "codex";

export const ENGINE_NAMES: Record<SessionEngine, string> = { claude: "Claude Code", codex: "Codex" };

/** One thing said or done in a session, as Bloks keeps it. */
export type SessionRow =
  | { role: "user" | "assistant"; text: string; at: number }
  | { role: "tool"; name: string; line: string; ok: boolean; at: number };

/** A session as the list shows it: enough to choose by, nothing more. */
export interface SessionSummary {
  /** engine and id: stable from one look to the next. */
  key: string;
  engine: SessionEngine;
  /** The engine's own id for the session, which is what resumes it. */
  id: string;
  /** Where its file is, with the home folder written as ~. */
  from: string;
  /** The folder it was worked in, when the file says. */
  folder: string | null;
  title: string;
  startedAt: number;
  lastAt: number;
  /** What the person and the engine said, not counting tool calls. */
  messages: number;
  tools: number;
}

export interface Skipped {
  from: string;
  why: string;
}

export interface ProjectGroup {
  /** The folder, or null for sessions whose file does not say. */
  folder: string | null;
  name: string;
  /** The folder with the home folder written as ~. */
  label: string;
  /** Whether the folder is still there, which a resume needs. */
  exists: boolean;
  lastAt: number;
  sessions: SessionSummary[];
}

export interface Discovery {
  projects: ProjectGroup[];
  skipped: Skipped[];
  /** Which of the two places were there to look in. */
  looked: Record<SessionEngine, boolean>;
  /** Sessions past the most a look reads, oldest first, left out. */
  more: number;
}

// ── how much is read ───────────────────────────────────────────────────

/** Session files a look reads, newest first. Months of daily work is a
 * few hundred; past this the oldest are said to be left out. */
export const MAX_SESSION_FILES = 2_000;
/** One session file. A day of heavy tool use is tens of megabytes. */
export const MAX_SESSION_BYTES = 256 * 1024 * 1024;
/** One line, while listing. A line past it is a tool's output, never a
 * title or a count worth the parse. */
const LIST_LINE_BYTES = 256 * 1024;
/** One line, when importing. Past it a line is skipped and counted. */
const READ_LINE_BYTES = 16 * 1024 * 1024;
/** Rows one imported conversation keeps, the latest. Enough to carry on
 * from; the rest is said, not kept. */
export const MAX_ROWS = 3_000;
/** How long a tool's line is, about. */
const TOOL_LINE_CHARS = 200;
/** How long a title is. */
const TITLE_CHARS = 80;
/** Rows of each session the review returns to be read. */
export const PREVIEW_ROWS = 400;

/** Said in place of a line that looked like a key or a password. */
export const LEFT_OUT = "[a line that looked like a key or a password was left out]";

// ── small helpers ──────────────────────────────────────────────────────

function fromHome(home: string, path: string): string {
  const rel = relative(home, path);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? `~/${rel.split(sep).join("/")}` : rel === "" ? "~" : path;
}

function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function timeOf(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const at = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(at) && at > 0 ? at : null;
}

function firstLine(text: unknown, max = TOOL_LINE_CHARS): string {
  if (typeof text !== "string") return "";
  const line = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * A text with every line that looks like a key or a password left out,
 * and how many were.
 *
 * Whole lines rather than the key alone: a line that held a key is
 * usually about the key ("here is my token: ..."), and what remains of it
 * reads as a riddle. A private key block goes as one, since its body
 * lines look like nothing on their own. A run of lines left out is one
 * marker, so a pasted .env does not become twenty of them.
 */
export function keepSafe(text: string, redact?: (text: string) => string): { text: string; removed: number } {
  let removed = 0;
  const blocks = text.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, () => {
    removed++;
    return LEFT_OUT;
  });
  const out: string[] = [];
  for (const line of blocks.split("\n")) {
    const risky = line !== LEFT_OUT && (scrubSecrets(line).removed > 0 || (redact ? redact(line) !== line : false));
    if (risky) removed++;
    const kept = risky ? LEFT_OUT : line;
    if (kept === LEFT_OUT && out[out.length - 1] === LEFT_OUT) continue;
    out.push(kept);
  }
  return { text: out.join("\n"), removed };
}

/** A path as a person would read it in a line: inside the session's
 * folder, relative to it; inside the home folder, from ~. */
function shortPath(path: unknown, folder: string | null, home: string): string {
  if (typeof path !== "string" || !path) return "a file";
  if (folder && isAbsolute(path)) {
    const rel = relative(folder, path);
    if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return rel.split(sep).join("/");
  }
  return isAbsolute(path) ? fromHome(home, path) : path;
}

function filesOfPatch(patch: unknown): string[] {
  if (typeof patch !== "string") return [];
  const files: string[] = [];
  for (const match of patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) files.push(match[1].trim());
  return files;
}

function namedFiles(verb: string, files: string[], folder: string | null, home: string): string {
  if (!files.length) return `${verb} files`;
  const shown = files.slice(0, 3).map((f) => shortPath(f, folder, home));
  return `${verb} ${shown.join(", ")}${files.length > 3 ? ` and ${files.length - 3} more` : ""}`;
}

// ── reading a file a line at a time ────────────────────────────────────

/**
 * Each line of a file, or null for one longer than `maxLine`, which is
 * passed over without being held: a single tool output can be a hundred
 * megabytes on one line, and holding it to throw it away is the cost to
 * avoid.
 */
async function* linesOf(file: string, maxLine: number): AsyncGenerator<string | null> {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(64 * 1024);
    let parts: Buffer[] = [];
    let length = 0;
    let overlong = false;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      const chunk = buffer.subarray(0, bytesRead);
      let start = 0;
      for (;;) {
        const nl = chunk.indexOf(10, start);
        const end = nl === -1 ? chunk.length : nl;
        if (!overlong) {
          if (length + (end - start) > maxLine) {
            overlong = true;
            parts = [];
            length = 0;
          } else if (end > start) {
            parts.push(Buffer.from(chunk.subarray(start, end)));
            length += end - start;
          }
        }
        if (nl === -1) break;
        yield overlong ? null : Buffer.concat(parts, length).toString("utf8");
        parts = [];
        length = 0;
        overlong = false;
        start = nl + 1;
      }
    }
    if (length || overlong) yield overlong ? null : Buffer.concat(parts, length).toString("utf8");
  } finally {
    await handle.close();
  }
}

// ── what a session says ────────────────────────────────────────────────

/** Where a text came from in a Codex file: its event stream (what the
 * person typed and what the agent said) or the model's own items, which
 * also carry the instructions Codex injects. Claude Code has only one. */
type Source = "event" | "item";

type Tagged = SessionRow & { source: Source; callId?: string };

interface ReadOptions {
  /** Keep the rows, rather than only count them. */
  keep: boolean;
  home: string;
  redact?: (text: string) => string;
}

/** Everything one pass over a session file finds. */
export interface ParsedSession {
  id: string | null;
  folder: string | null;
  /** Who wrote it, where the file says (Codex's originator). */
  originator: string | null;
  title: string;
  startedAt: number;
  lastAt: number;
  messages: number;
  tools: number;
  /** Rows, when kept, the latest MAX_ROWS of them. */
  rows: SessionRow[];
  /** Rows older than the kept ones, left out. */
  left: number;
  /** Lines left out as looking like a key or a password. */
  removed: number;
  /** Lines that could not be read (too long, or not JSON). */
  unreadable: number;
}

class Collector {
  rows: Tagged[] = [];
  folder: string | null = null;
  id: string | null = null;
  originator: string | null = null;
  startedAt = Infinity;
  lastAt = 0;
  unreadable = 0;
  removed = 0;
  private readonly opts: ReadOptions;
  private readonly calls = new Map<string, Tagged & { role: "tool" }>();
  /** The engine's message id of the last assistant text, so text blocks
   * of one message that arrive on separate lines become one message. */
  private lastAssistant: string | null = null;
  /** Sources whose first user message is held, while only listing. */
  private readonly titled = new Set<Source>();

  constructor(opts: ReadOptions) {
    this.opts = opts;
  }

  when(raw: unknown): number {
    const at = timeOf(raw) ?? (this.lastAt || Date.now());
    if (at < this.startedAt) this.startedAt = at;
    if (at > this.lastAt) this.lastAt = at;
    return at;
  }

  say(role: "user" | "assistant", raw: string, at: number, source: Source, messageId?: string) {
    let text = raw.replace(/\r\n/g, "\n").trim();
    if (!text) return;
    const last = this.rows[this.rows.length - 1];
    if (role === "assistant" && messageId && messageId === this.lastAssistant && last?.role === "assistant" && last.source === source) {
      // the same message, another of its text blocks
      if (this.opts.keep) last.text = clip(`${last.text}\n\n${this.clean(text)}`, MAX_MESSAGE_CHARS);
      return;
    }
    this.lastAssistant = role === "assistant" ? (messageId ?? null) : null;
    if (this.opts.keep) text = clip(this.clean(text), MAX_MESSAGE_CHARS);
    else if (role === "user" && !this.titled.has(source)) {
      // a list needs only the first thing the person said, as the title
      this.titled.add(source);
      text = text.slice(0, 2_000);
    } else text = "";
    this.rows.push({ role, text, at, source });
  }

  tool(name: string, line: string, at: number, callId?: string) {
    this.lastAssistant = null;
    const shown = this.opts.keep ? firstLine(toolCommand(this.clean(line), (t) => t) ?? line) || name : "";
    const row: Tagged & { role: "tool" } = { role: "tool", name: clip(name, 80), line: shown, ok: true, at, source: "event", ...(callId ? { callId } : {}) };
    this.rows.push(row);
    if (callId) this.calls.set(callId, row);
  }

  settle(callId: unknown, ok: boolean) {
    if (typeof callId !== "string") return;
    const row = this.calls.get(callId);
    if (row && !ok) row.ok = false;
  }

  private clean(text: string): string {
    const safe = keepSafe(text, this.opts.redact);
    this.removed += safe.removed;
    return safe.text;
  }

  finish(fallbackId: string | null): ParsedSession {
    // Codex writes what the person typed twice: as an event, and as an
    // item that sits among the instructions it injects. The events are
    // the clean copy; a file old enough to have none has only the items.
    const events = this.rows.some((r) => r.role !== "tool" && r.source === "event");
    const rows = this.rows.filter((r) => r.role === "tool" || r.source === (events ? "event" : "item"));
    const firstUser = rows.find((r): r is Tagged & { role: "user" } => r.role === "user");
    const titleText = firstUser ? (this.opts.keep ? firstUser.text : keepSafe(firstUser.text, this.opts.redact).text) : "";
    const title = firstLine(
      titleText
        .split("\n")
        .filter((l) => l !== LEFT_OUT)
        .join("\n"),
      TITLE_CHARS,
    );
    const messages = rows.filter((r) => r.role !== "tool").length;
    const kept = this.opts.keep ? rows.slice(-MAX_ROWS) : [];
    return {
      id: this.id ?? fallbackId,
      folder: this.folder,
      originator: this.originator,
      title: title || "A conversation without a title",
      startedAt: Number.isFinite(this.startedAt) ? this.startedAt : this.lastAt,
      lastAt: this.lastAt,
      messages,
      tools: rows.length - messages,
      rows: kept.map(({ source: _source, callId: _callId, ...row }) => row as SessionRow),
      left: this.opts.keep ? rows.length - kept.length : 0,
      removed: this.removed,
      unreadable: this.unreadable,
    };
  }
}

// ── Claude Code ────────────────────────────────────────────────────────

/** What Claude Code writes as a user message that the person did not:
 * slash command echoes, a local command's output, the caveat before
 * them, an interruption. */
const CLAUDE_NOT_SAID =
  /^(?:<(?:command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|bash-input|bash-stdout|bash-stderr|user-memory-input|task-notification)>|Caveat: The messages below were generated|\[Request interrupted by user)/;

function claudeText(raw: string): string {
  // a reminder the CLI tucked into the person's message is not theirs
  return raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
}

/** A tool call as one line, in the words a person would use for it. */
export function claudeToolLine(name: string, input: any, folder: string | null, home: string): string {
  const path = (p: unknown) => shortPath(p, folder, home);
  switch (name) {
    case "Bash":
      return firstLine(input?.command) || "Ran a command";
    case "Read":
      return `Read ${path(input?.file_path)}`;
    case "Write":
      return `Wrote ${path(input?.file_path)}`;
    case "Edit":
    case "MultiEdit":
      return `Edited ${path(input?.file_path)}`;
    case "NotebookEdit":
      return `Edited ${path(input?.notebook_path)}`;
    case "Glob":
      return `Looked for ${firstLine(input?.pattern) || "files"}`;
    case "Grep":
      return `Searched for "${firstLine(input?.pattern, 80)}"`;
    case "LS":
      return `Listed ${path(input?.path)}`;
    case "WebFetch":
      return `Fetched ${firstLine(input?.url, 120) || "a page"}`;
    case "WebSearch":
      return `Searched the web for "${firstLine(input?.query, 80)}"`;
    case "Task":
    case "Agent":
      return `Asked a helper: ${firstLine(input?.description, 120) || "a task"}`;
    case "TodoWrite":
      return "Updated the to-do list";
    default: {
      const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
      return mcp ? `Used ${mcp[2]} (${mcp[1]})` : `Used ${name}`;
    }
  }
}

function readClaudeLine(c: Collector, line: any, home: string) {
  if (!isRecord(line) || line.isSidechain === true) return;
  if (typeof line.cwd === "string" && isAbsolute(line.cwd) && !c.folder) c.folder = line.cwd;
  const message = isRecord(line.message) ? line.message : null;
  if (line.type === "user" && message) {
    // the CLI's own lines still say when the session was open
    const at = c.when(line.timestamp);
    if (line.isMeta === true || line.isCompactSummary === true || line.isVisibleInTranscriptOnly === true) return;
    const content = message.content;
    if (typeof content === "string") {
      const text = claudeText(content);
      if (text && !CLAUDE_NOT_SAID.test(text)) c.say("user", text, at, "event");
      return;
    }
    if (!Array.isArray(content)) return;
    const said: string[] = [];
    let images = 0;
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type === "tool_result") c.settle(block.tool_use_id, block.is_error !== true);
      else if (block.type === "text" && typeof block.text === "string") {
        const text = claudeText(block.text);
        if (text && !CLAUDE_NOT_SAID.test(text)) said.push(text);
      } else if (block.type === "image") images++;
    }
    if (images) said.push(images === 1 ? "[an image]" : `[${images} images]`);
    if (said.length) c.say("user", said.join("\n\n"), at, "event");
    return;
  }
  if (line.type === "assistant" && message) {
    // the CLI's own stand-ins (an API error, a limit) are not the model's words
    if (line.isApiErrorMessage === true || message.model === "<synthetic>") return;
    const at = c.when(line.timestamp);
    const content = Array.isArray(message.content) ? message.content : typeof message.content === "string" ? [{ type: "text", text: message.content }] : [];
    const messageId = typeof message.id === "string" ? message.id : undefined;
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type === "text" && typeof block.text === "string") c.say("assistant", block.text, at, "event", messageId);
      else if (block.type === "tool_use" && typeof block.name === "string") {
        c.tool(block.name, claudeToolLine(block.name, block.input, c.folder, home), at, typeof block.id === "string" ? block.id : undefined);
      }
    }
  }
}

// ── Codex ──────────────────────────────────────────────────────────────

/** What Codex puts in a user item that the person did not type. */
const CODEX_NOT_SAID = /^(?:<(?:environment_context|user_instructions|permissions instructions|user_shell_command|turn_aborted)>|# AGENTS\.md instructions)/;

function codexItemTexts(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (isRecord(part) && typeof part.text === "string" && /^(input_text|output_text|text)$/.test(String(part.type)) ? part.text : ""))
    .filter(Boolean)
    .join("\n\n");
}

function parseArgs(raw: unknown): any {
  if (isRecord(raw)) return raw;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function shellLine(command: unknown): string {
  if (typeof command === "string") return command;
  if (!Array.isArray(command)) return "";
  const words = command.filter((w): w is string => typeof w === "string");
  // ["bash", "-lc", "the script"] is the script
  if (words.length >= 3 && /(?:^|\/)(?:ba|z|da)?sh$/.test(words[0]) && /^-l?c$/.test(words[1])) return words.slice(2).join(" ");
  return words.join(" ");
}

/** A Codex call as one line, and the tool name the chat counts it by. */
export function codexToolLine(name: string, args: any, folder: string | null, home: string): { name: string; line: string } {
  switch (name) {
    case "shell":
    case "container.exec":
    case "local_shell":
      return { name: "shell", line: firstLine(shellLine(args?.command)) || "Ran a command" };
    case "exec_command":
      return { name: "shell", line: firstLine(shellLine(args?.cmd ?? args?.command)) || "Ran a command" };
    case "apply_patch":
      return { name: "apply_patch", line: namedFiles("Edited", filesOfPatch(args?.input ?? args?.patch), folder, home) };
    case "update_plan":
      return { name: "update_plan", line: "Updated the plan" };
    case "view_image":
      return { name: "view_image", line: `Looked at ${shortPath(args?.path, folder, home)}` };
    case "read_file":
      return { name: "read_file", line: `Read ${shortPath(args?.file_path ?? args?.path, folder, home)}` };
    case "list_dir":
      return { name: "list_dir", line: `Listed ${shortPath(args?.dir_path ?? args?.path, folder, home)}` };
    case "grep_files":
      return { name: "grep", line: `Searched for "${firstLine(args?.pattern, 80)}"` };
    default:
      return { name, line: `Used ${name}` };
  }
}

/** Whether a call's output says it failed. Shapes vary by version: a
 * JSON string with an exit code, a plain text that starts with one, or
 * an object with a success flag. Anything else is taken as done. */
function codexOutputOk(output: unknown): boolean {
  if (isRecord(output)) {
    if (output.success === false) return false;
    return codexOutputOk(output.content);
  }
  if (typeof output !== "string") return true;
  const head = output.slice(0, 2_000);
  const plain = /^Exit code: (\d+)/m.exec(head);
  if (plain) return plain[1] === "0";
  const code = /"exit_code"\s*:\s*(-?\d+)/.exec(head);
  return code ? code[1] === "0" : true;
}

function readCodexItem(c: Collector, item: any, at: number, home: string) {
  if (!isRecord(item)) return;
  switch (item.type) {
    case "message": {
      if (item.role !== "user" && item.role !== "assistant") return;
      const text = codexItemTexts(item.content).trim();
      if (!text || (item.role === "user" && CODEX_NOT_SAID.test(text))) return;
      c.say(item.role, text, at, "item");
      return;
    }
    case "function_call": {
      if (typeof item.name !== "string") return;
      const shown = codexToolLine(item.name, parseArgs(item.arguments), c.folder, home);
      c.tool(shown.name, shown.line, at, typeof item.call_id === "string" ? item.call_id : undefined);
      return;
    }
    case "custom_tool_call": {
      if (typeof item.name !== "string") return;
      const shown = codexToolLine(item.name, item.name === "apply_patch" ? { input: item.input } : parseArgs(item.input), c.folder, home);
      c.tool(shown.name, shown.line, at, typeof item.call_id === "string" ? item.call_id : undefined);
      return;
    }
    case "local_shell_call": {
      const action = isRecord(item.action) ? item.action : {};
      c.tool("shell", firstLine(shellLine(action.command)) || "Ran a command", at, typeof item.call_id === "string" ? item.call_id : undefined);
      if (item.status === "failed" || item.status === "incomplete") c.settle(item.call_id, false);
      return;
    }
    case "web_search_call": {
      const action = isRecord(item.action) ? item.action : {};
      const query = firstLine(action.query, 80);
      c.tool("web_search", query ? `Searched the web for "${query}"` : "Searched the web", at);
      return;
    }
    case "function_call_output":
    case "custom_tool_call_output":
      c.settle(item.call_id, codexOutputOk(item.output));
      return;
    default:
      return;
  }
}

function readCodexLine(c: Collector, line: any, home: string) {
  if (!isRecord(line)) return;
  const payload = isRecord(line.payload) ? line.payload : null;
  switch (line.type) {
    case "session_meta": {
      const meta = payload && isRecord(payload.meta) ? payload.meta : payload;
      if (!meta) return;
      if (typeof meta.id === "string" && !c.id) c.id = meta.id;
      if (typeof meta.cwd === "string" && isAbsolute(meta.cwd) && !c.folder) c.folder = meta.cwd;
      if (typeof meta.originator === "string") c.originator = meta.originator;
      c.when(meta.timestamp ?? line.timestamp);
      return;
    }
    case "turn_context":
      if (payload && typeof payload.cwd === "string" && isAbsolute(payload.cwd) && !c.folder) c.folder = payload.cwd;
      return;
    case "event_msg": {
      if (!payload) return;
      const at = c.when(line.timestamp);
      if (payload.type === "user_message" && typeof payload.message === "string") {
        // some versions mark the instructions they inject with a kind
        if (typeof payload.kind === "string" && payload.kind !== "plain") return;
        if (CODEX_NOT_SAID.test(payload.message.trim())) return;
        c.say("user", payload.message, at, "event");
      } else if (payload.type === "agent_message" && typeof payload.message === "string") {
        c.say("assistant", payload.message, at, "event");
      }
      return;
    }
    case "response_item":
      readCodexItem(c, payload, c.when(line.timestamp), home);
      return;
    case "compacted":
      return;
    default:
      // The first format: no envelope, a header line with the id, then
      // the items themselves, one a line.
      if (line.type === undefined && typeof line.id === "string" && line.timestamp !== undefined && line.record_type === undefined) {
        if (!c.id) c.id = line.id;
        c.when(line.timestamp);
        return;
      }
      if (typeof line.type === "string") readCodexItem(c, line, c.when(line.timestamp), home);
  }
}

/** One pass over a session file. Never throws for what is in the file;
 * a file that cannot be opened is the caller's to report. */
export async function readSessionFile(file: string, engine: SessionEngine, opts: ReadOptions): Promise<ParsedSession> {
  const c = new Collector(opts);
  for await (const raw of linesOf(file, opts.keep ? READ_LINE_BYTES : LIST_LINE_BYTES)) {
    if (raw === null) {
      c.unreadable++;
      continue;
    }
    if (!raw.trim()) continue;
    let line: unknown;
    try {
      line = JSON.parse(raw);
    } catch {
      c.unreadable++;
      continue;
    }
    try {
      if (engine === "claude") readClaudeLine(c, line, opts.home);
      else readCodexLine(c, line, opts.home);
    } catch {
      c.unreadable++;
    }
  }
  const fallback =
    engine === "claude"
      ? basename(file, ".jsonl")
      : (/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(basename(file))?.[1] ?? null);
  const parsed = c.finish(fallback);
  // Claude Code finds a session by its file's name, whatever the lines say
  if (engine === "claude") parsed.id = basename(file, ".jsonl");
  return parsed;
}

// ── finding them ───────────────────────────────────────────────────────

interface Candidate {
  engine: SessionEngine;
  file: string;
  size: number;
  mtimeMs: number;
}

const SESSION_ID = /^[\w.-]{8,128}$/;

/** A regular file, never a link: a link in a session folder pointing
 * somewhere else is not a session to read. */
function plainFile(path: string): { size: number; mtimeMs: number } | null {
  try {
    const stat = lstatSync(path);
    return stat.isFile() ? { size: stat.size, mtimeMs: stat.mtimeMs } : null;
  } catch {
    return null;
  }
}

function entries(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export function claudeProjectsDir(home: string): string {
  return join(home, ".claude", "projects");
}

export function codexSessionsDir(home: string): string {
  return join(home, ".codex", "sessions");
}

/** Whether either place is there, without listing or opening anything in
 * it: what the first run needs to know whether to offer the step. */
export function sessionPlaces(home: string = homedir()): Record<SessionEngine, boolean> {
  return { claude: isFolder(claudeProjectsDir(home)), codex: isFolder(codexSessionsDir(home)) };
}

function candidates(home: string): { found: Candidate[]; skipped: Skipped[] } {
  const found: Candidate[] = [];
  const skipped: Skipped[] = [];
  const consider = (engine: SessionEngine, file: string) => {
    const stat = plainFile(file);
    if (!stat) return;
    if (stat.size > MAX_SESSION_BYTES) {
      skipped.push({ from: fromHome(home, file), why: `larger than ${Math.round(MAX_SESSION_BYTES / (1024 * 1024))} MB, so it was left alone` });
      return;
    }
    if (stat.size === 0) return;
    found.push({ engine, file, ...stat });
  };
  // ~/.claude/projects/<the folder, spelled with dashes>/<session>.jsonl.
  // Helpers' own transcripts (agent-*.jsonl, and the folders beside a
  // session) are parts of a session, not sessions.
  const claude = claudeProjectsDir(home);
  for (const project of entries(claude)) {
    const dir = join(claude, project);
    if (!isFolder(dir)) continue;
    for (const name of entries(dir)) {
      if (!name.endsWith(".jsonl") || name.startsWith("agent-") || !SESSION_ID.test(basename(name, ".jsonl"))) continue;
      consider("claude", join(dir, name));
    }
  }
  // ~/.codex/sessions/<year>/<month>/<day>/rollout-<time>-<id>.jsonl, and
  // a flat folder from before the dates
  const codex = codexSessionsDir(home);
  const walk = (dir: string, depth: number) => {
    for (const name of entries(dir)) {
      const path = join(dir, name);
      if (/^rollout-.*\.jsonl$/.test(name)) consider("codex", path);
      else if (depth < 3 && /^\d+$/.test(name) && isFolder(path)) walk(path, depth + 1);
    }
  };
  walk(codex, 0);
  return { found, skipped };
}

/** Lists read before, by file, so a second look reads only what moved. */
const listed = new Map<string, { size: number; mtimeMs: number; parsed: ParsedSession }>();

async function summaryOf(candidate: Candidate, home: string, redact?: (text: string) => string): Promise<ParsedSession> {
  const known = listed.get(candidate.file);
  if (known && known.size === candidate.size && known.mtimeMs === candidate.mtimeMs) return known.parsed;
  const parsed = await readSessionFile(candidate.file, candidate.engine, { keep: false, home, redact });
  listed.delete(candidate.file);
  listed.set(candidate.file, { size: candidate.size, mtimeMs: candidate.mtimeMs, parsed });
  while (listed.size > MAX_SESSION_FILES * 2) listed.delete(listed.keys().next().value!);
  return parsed;
}

/** What a session found is called, everywhere. */
export function sessionKey(engine: SessionEngine, id: string): string {
  return `${engine}:${id}`;
}

export interface DiscoverOptions {
  home?: string;
  /** Sessions Bloks ran itself: its own conversations already, which an
   * import would only bring back as copies. */
  own?: (engine: SessionEngine, id: string) => boolean;
  redact?: (text: string) => string;
}

/** A found session, with where its file is, for the server's own use. */
export interface Located extends SessionSummary {
  file: string;
}

/**
 * Every session there is to bring over, by project folder, newest first.
 * Reads, and never writes.
 */
export async function discoverSessions(opts: DiscoverOptions = {}): Promise<{ discovery: Discovery; located: Map<string, Located> }> {
  const home = opts.home ?? homedir();
  const { found, skipped } = candidates(home);
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const reading = found.slice(0, MAX_SESSION_FILES);
  const located = new Map<string, Located>();
  // a few at a time: one at a time is slow on a long history, and all at
  // once opens a file for every session there is
  let next = 0;
  const work = async () => {
    while (next < reading.length) {
      const candidate = reading[next++];
      let parsed: ParsedSession;
      try {
        parsed = await summaryOf(candidate, home, opts.redact);
      } catch {
        skipped.push({ from: fromHome(home, candidate.file), why: "could not be read" });
        continue;
      }
      const id = parsed.id;
      if (!id || !SESSION_ID.test(id) || parsed.messages === 0) continue;
      if (opts.own?.(candidate.engine, id)) continue;
      // Bloks drives Codex as a client named "bloks", which Codex writes
      // down as the session's originator
      if (candidate.engine === "codex" && parsed.originator === "bloks") continue;
      const key = sessionKey(candidate.engine, id);
      if (located.has(key)) continue;
      located.set(key, {
        key,
        engine: candidate.engine,
        id,
        file: candidate.file,
        from: fromHome(home, candidate.file),
        folder: parsed.folder,
        title: parsed.title,
        startedAt: parsed.startedAt || candidate.mtimeMs,
        lastAt: parsed.lastAt || candidate.mtimeMs,
        messages: parsed.messages,
        tools: parsed.tools,
      });
    }
  };
  await Promise.all([work(), work(), work(), work()]);

  const groups = new Map<string, ProjectGroup>();
  for (const session of located.values()) {
    const id = session.folder ?? "";
    let group = groups.get(id);
    if (!group) {
      group = {
        folder: session.folder,
        name: session.folder ? basename(session.folder) || session.folder : "Folder not recorded",
        label: session.folder ? fromHome(home, session.folder) : "",
        exists: session.folder ? isFolder(session.folder) : false,
        lastAt: 0,
        sessions: [],
      };
      groups.set(id, group);
    }
    const { file: _file, ...summary } = session;
    group.sessions.push(summary);
    group.lastAt = Math.max(group.lastAt, session.lastAt);
  }
  const projects = [...groups.values()];
  for (const project of projects) project.sessions.sort((a, b) => b.lastAt - a.lastAt);
  projects.sort((a, b) => b.lastAt - a.lastAt);
  return {
    discovery: { projects, skipped, looked: sessionPlaces(home), more: Math.max(0, found.length - reading.length) },
    located,
  };
}

// ── one session, whole ─────────────────────────────────────────────────

/** A session read whole, as it will land. */
export interface ReadSession {
  summary: Located;
  rows: SessionRow[];
  left: number;
  removed: number;
  unreadable: number;
  /** sha256 of the rows, which is how the import knows nothing moved
   * since the review. */
  digest: string;
}

export async function readWhole(summary: Located, opts: { home?: string; redact?: (text: string) => string } = {}): Promise<ReadSession> {
  const parsed = await readSessionFile(summary.file, summary.engine, { keep: true, home: opts.home ?? homedir(), redact: opts.redact });
  return {
    summary,
    rows: parsed.rows,
    left: parsed.left,
    removed: parsed.removed,
    unreadable: parsed.unreadable,
    digest: sha256(JSON.stringify(parsed.rows)),
  };
}

// ── what came over, and where ──────────────────────────────────────────

export interface ImportedEntry {
  botId: string;
  laneId: string;
  at: number;
  digest: string;
}

/**
 * One small file beside the workspace: which session became which lane.
 * Kept so the list can say what was brought over already, and so the same
 * session is not brought over twice into two lanes that would then go
 * their separate ways.
 */
export class SessionImportRecord {
  private readonly file: string;
  private entries: Record<string, ImportedEntry>;

  constructor(file: string) {
    this.file = file;
    const saved = readSaved<Record<string, unknown>>(file, {}, isRecord);
    this.entries = {};
    for (const [key, value] of Object.entries(saved)) {
      if (isRecord(value) && typeof value.botId === "string" && typeof value.laneId === "string") {
        this.entries[key] = value as unknown as ImportedEntry;
      }
    }
  }

  get(key: string): ImportedEntry | undefined {
    return Object.hasOwn(this.entries, key) ? this.entries[key] : undefined;
  }

  set(key: string, entry: ImportedEntry) {
    this.entries[key] = entry;
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    writeFileAtomic(this.file, JSON.stringify(this.entries, null, 2), 0o600);
  }
}

/** Engine sessions Bloks has run itself, newest last. */
const MAX_OWN = 5_000;

/**
 * Sessions Bloks started or carried on, by the engine's own id.
 *
 * Every turn Bloks runs on Claude Code or Codex leaves a session file in
 * the same folders this reads, in the agent's project folder as often as
 * not, and they would otherwise come back as "past sessions" to import:
 * conversations the person already has here. So the ids are noted as
 * engines report them.
 */
export class OwnSessions {
  private readonly file: string;
  private ids: Set<string>;

  constructor(file: string) {
    this.file = file;
    const saved = readSaved<unknown[]>(file, [], Array.isArray);
    this.ids = new Set(saved.filter((id): id is string => typeof id === "string"));
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  note(id: string) {
    if (!SESSION_ID.test(id) || this.ids.has(id)) return;
    this.ids.add(id);
    while (this.ids.size > MAX_OWN) this.ids.delete(this.ids.values().next().value!);
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      writeFileAtomic(this.file, JSON.stringify([...this.ids]), 0o600, { flush: false });
    } catch {
      /* kept in memory; written with the next one */
    }
  }
}

// ── the review and the import ──────────────────────────────────────────

/** Where the picked sessions go: an agent, or one hired for each project
 * folder they came from. */
export type Destination = { botId: string } | { hire: true };

export interface Pick {
  key: string;
  digest?: string;
}

/** What a window may send, checked into shape. Anything else is dropped. */
export function cleanPicks(value: unknown, max = 200): Pick[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: Pick[] = [];
  for (const raw of value.slice(0, max)) {
    const key = typeof raw === "string" ? raw : isRecord(raw) ? raw.key : undefined;
    if (typeof key !== "string" || key.length > 200 || !/^(claude|codex):[\w.-]{8,128}$/.test(key) || seen.has(key)) continue;
    seen.add(key);
    const digest = isRecord(raw) && typeof raw.digest === "string" && /^[0-9a-f]{64}$/.test(raw.digest) ? raw.digest : undefined;
    out.push({ key, ...(digest ? { digest } : {}) });
  }
  return out;
}

export function cleanDestination(value: unknown): Destination | null {
  if (!isRecord(value)) return null;
  if (value.hire === true) return { hire: true };
  if (typeof value.botId === "string" && /^[\w-]{1,64}$/.test(value.botId)) return { botId: value.botId };
  return null;
}

/** What the rest of Bloks does for an import. Passed in, so the rules of
 * the import can be checked without a running workspace. */
export interface SessionImportDeps {
  /** An agent that can take conversations, and how many more it has room for. */
  agent(id: string): { id: string; name: string; room: number } | null;
  /** Whether a lane an earlier import made is still there. */
  laneThere(botId: string, laneId: string): boolean;
  /** Whether a session sent to this agent would carry on in its engine's
   * own session, and why not when it would not. `botId` null is an agent
   * about to be hired for the folder, on `engine`. */
  resumes(botId: string | null, session: Located, engine?: SessionEngine): { resumes: boolean; why?: string };
  /** An agent hired for a project folder. Its id. */
  hire(folder: string | null, engine: SessionEngine): Promise<string>;
  /** A lane holding the session. Its id, or an error to report. */
  addLane(botId: string, session: ReadSession): string;
}

export interface ReviewedSession {
  key: string;
  engine: SessionEngine;
  title: string;
  from: string;
  folder: string | null;
  startedAt: number;
  lastAt: number;
  messages: number;
  tools: number;
  removed: number;
  left: number;
  digest: string;
  resumes: boolean;
  why?: string;
  /** Already brought over, and to where. */
  imported?: { botId: string; laneId: string };
  /** The rows, as they will land, up to PREVIEW_ROWS of the latest. */
  rows: SessionRow[];
  more: number;
  error?: string;
}

export interface Review {
  sessions: ReviewedSession[];
  /** Who they go to: an agent and its room, or the agents to be hired. */
  to: { botId: string; name: string; room: number } | { hire: Array<{ folder: string | null; name: string }> };
}

function engineFor(sessions: Located[]): SessionEngine {
  const claude = sessions.filter((s) => s.engine === "claude").length;
  return claude >= sessions.length - claude ? "claude" : "codex";
}

function hireName(folder: string | null): string {
  return folder ? basename(folder) || folder : "Past sessions";
}

/** Exactly what an import of these sessions would bring, read whole. */
export async function reviewSessions(
  located: Map<string, Located>,
  picks: Pick[],
  to: Destination,
  deps: SessionImportDeps,
  record: SessionImportRecord,
  opts: { home?: string; redact?: (text: string) => string } = {},
): Promise<Review> {
  const sessions: ReviewedSession[] = [];
  // a hired agent runs on the engine most of its folder's sessions ran on
  const found = picks.map((pick) => located.get(pick.key)).filter((s): s is Located => Boolean(s));
  const hireEngine = (folder: string | null) => engineFor(found.filter((s) => s.folder === folder));
  for (const summary of found) {
    let whole: ReadSession;
    try {
      whole = await readWhole(summary, opts);
    } catch {
      continue;
    }
    const before = record.get(summary.key);
    const imported = before && deps.laneThere(before.botId, before.laneId) ? { botId: before.botId, laneId: before.laneId } : undefined;
    const plan = "botId" in to ? deps.resumes(to.botId, summary) : deps.resumes(null, summary, hireEngine(summary.folder));
    const { file: _file, ...shown } = summary;
    sessions.push({
      ...shown,
      removed: whole.removed,
      left: whole.left,
      digest: whole.digest,
      resumes: plan.resumes,
      ...(plan.why ? { why: plan.why } : {}),
      ...(imported ? { imported } : {}),
      rows: whole.rows.slice(-PREVIEW_ROWS),
      more: Math.max(0, whole.rows.length - PREVIEW_ROWS),
    });
  }
  if ("botId" in to) {
    const agent = deps.agent(to.botId);
    return { sessions, to: { botId: to.botId, name: agent?.name ?? "That agent", room: agent?.room ?? 0 } };
  }
  const folders = [...new Set(sessions.map((s) => s.folder))];
  return { sessions, to: { hire: folders.map((folder) => ({ folder, name: hireName(folder) })) } };
}

export interface ImportResult {
  key: string;
  ok: boolean;
  botId?: string;
  laneId?: string;
  resumes?: boolean;
  error?: string;
}

export interface ImportOutcome {
  results: ImportResult[];
  /** Agents hired by this import. */
  created: string[];
}

/**
 * Brings the picked sessions over, each on its own: one that cannot come
 * says why and the rest still go. Takes from the window only which
 * sessions, the digests it was shown and where they go; the content is
 * read here, again.
 */
export async function importSessions(
  located: Map<string, Located>,
  picks: Pick[],
  to: Destination,
  deps: SessionImportDeps,
  record: SessionImportRecord,
  opts: { home?: string; redact?: (text: string) => string; now?: number } = {},
): Promise<ImportOutcome> {
  const outcome: ImportOutcome = { results: [], created: [] };
  const ready: ReadSession[] = [];
  for (const pick of picks) {
    const summary = located.get(pick.key);
    if (!summary) {
      outcome.results.push({ key: pick.key, ok: false, error: "it is not there any more. Look again." });
      continue;
    }
    const before = record.get(pick.key);
    if (before && deps.laneThere(before.botId, before.laneId)) {
      const where = deps.agent(before.botId)?.name;
      outcome.results.push({
        key: pick.key,
        ok: false,
        error: `it is already a conversation${where ? ` with ${where}` : ""}. Close that one to bring it over again.`,
      });
      continue;
    }
    let whole: ReadSession;
    try {
      whole = await readWhole(summary, opts);
    } catch {
      outcome.results.push({ key: pick.key, ok: false, error: "it could not be read." });
      continue;
    }
    if (pick.digest && pick.digest !== whole.digest) {
      outcome.results.push({ key: pick.key, ok: false, error: "it changed since you looked, so it was not brought over. Look again." });
      continue;
    }
    ready.push(whole);
  }

  // one agent per project folder when hiring, made once whatever the number
  // of sessions going to it, and on the engine most of them ran on
  const hired = new Map<string, string>();
  if ("hire" in to) {
    const byFolder = new Map<string, ReadSession[]>();
    for (const session of ready) {
      const id = session.summary.folder ?? "";
      byFolder.set(id, [...(byFolder.get(id) ?? []), session]);
    }
    for (const [id, sessions] of byFolder) {
      try {
        const botId = await deps.hire(id || null, engineFor(sessions.map((s) => s.summary)));
        hired.set(id, botId);
        outcome.created.push(botId);
      } catch (error) {
        for (const session of sessions) {
          outcome.results.push({ key: session.summary.key, ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }
  }

  // oldest first, so the newest ends up the latest lane
  ready.sort((a, b) => a.summary.lastAt - b.summary.lastAt);
  for (const session of ready) {
    const key = session.summary.key;
    const botId = "botId" in to ? to.botId : hired.get(session.summary.folder ?? "");
    if (!botId) continue; // the hire failed, and said so above
    const agent = deps.agent(botId);
    if (!agent) {
      outcome.results.push({ key, ok: false, error: "choose an agent for this, or a new one" });
      continue;
    }
    if (agent.room < 1) {
      outcome.results.push({ key, ok: false, error: `${agent.name} has as many conversations open as one agent keeps. Close one, or bring this to another agent.` });
      continue;
    }
    try {
      const resumes = deps.resumes(botId, session.summary).resumes;
      const laneId = deps.addLane(botId, session);
      record.set(key, { botId, laneId, at: opts.now ?? Date.now(), digest: session.digest });
      outcome.results.push({ key, ok: true, botId, laneId, resumes });
    } catch (error) {
      outcome.results.push({ key, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return outcome;
}
