// What an approval card is asking, read back out of what the card carries.
//
// A card holds the tool's name and one line of summary, and that line is
// whatever each engine had to hand: the command itself, a URL, a sentence
// of reason, an ACP title with the code in backticks, or, for a tool with
// none of those, its arguments as JSON cut off at two hundred characters.
// Put on screen as it came, that last one is a wall of braces and quotes
// that nobody reads before pressing Allow, which is worse than not asking.
//
// So the card is read here into a plain verb ("wants to run a command")
// and the one thing worth looking at before saying yes: the command, the
// file, the page, or the change. Nothing is invented. A field that cannot
// be read out of the summary is left out, and a summary the server cut
// short says so.
//
// The rules a person can write (server/policy.ts) are what "Always allow"
// offers, and only those: a rule compares one field, for one agent or for
// all of them. So the choices are this exact command, this tool for this
// agent, or this tool for every agent, each named for what it lets
// through. Anything that looks like it can delete or overwrite work gets
// no shortcut at all: no Enter to allow, no rule from the card.

export type ApprovalKind =
  | "command"
  | "edit"
  | "write"
  | "read"
  | "delete"
  | "move"
  | "fetch"
  | "search"
  | "web-search"
  | "agent"
  | "mcp"
  | "other";

export type ApprovalDetail =
  | { kind: "command"; text: string }
  | { kind: "path"; path: string }
  | { kind: "diff"; path?: string; removed: string; added: string }
  | { kind: "content"; path?: string; text: string }
  | { kind: "url"; url: string }
  | { kind: "fields"; name?: string; fields: Array<[string, string]> }
  | { kind: "text"; text: string };

export interface RuleShape {
  effect: "allow";
  field: "tool" | "command";
  op: "equals";
  value: string;
  botId?: string;
}

export interface AlwaysScope {
  id: "command" | "agent" | "everyone";
  label: string;
  /** What it lets through, said plainly. */
  note: string;
  /** The rule as Settings will show it. */
  rule: RuleShape;
  /** Reaches past this one agent. */
  wide?: boolean;
}

export interface ApprovalView {
  kind: ApprovalKind;
  /** "wants to run a command", to follow the agent's name. */
  verb: string;
  detail?: ApprovalDetail;
  /** One line for the settled card: the command, the file, the page. */
  short: string;
  /** The server cut the summary, so what is shown is not all of it. */
  cut: boolean;
  /** Someone other than the owner asked for this, in the server's words. */
  askedBy?: string;
  /** Why this one deserves a closer look, when it can do damage. */
  risk?: string;
  scopes: AlwaysScope[];
}

const COMMAND = /^(bash|shell|execute|exec|run|run_shell_command|terminal|command|local_shell|sandbox_exec)$/i;
const EDIT = /^(edit|multiedit|multi_edit|notebookedit|str_replace|str_replace_editor|str_replace_based_edit_tool|apply_patch|edit_file|patch)$/i;
const WRITE = /^(write|write_file|create|create_file|save_file)$/i;
const READ = /^(read|view|read_file|notebookread)$/i;
const FETCH = /^(webfetch|web_fetch|fetch|open_url|browse)$/i;
const WEB_SEARCH = /^(websearch|web_search)$/i;
const SEARCH = /^(search|grep|glob|ls|list|find|codebase_search)$/i;
const AGENT = /^(task|agent|spawn_agent)$/i;

/** Where the engines cut a summary (server/harness/ask-broker.ts and the
 * drivers): a command or a URL at 200, an ACP title at 100. ACP names
 * its tools by kind, in lower case, which is how its titles are told
 * from a Claude Code command that happens to be 100 long. */
function cutShort(summary: string, tool: string): boolean {
  return summary.length === 200 || (summary.length === 100 && tool === tool.toLowerCase());
}

function kindOf(tool: string): ApprovalKind {
  const bare = tool.trim();
  if (/^mcp__/i.test(bare)) return "mcp";
  if (COMMAND.test(bare)) return "command";
  if (EDIT.test(bare)) return "edit";
  if (WRITE.test(bare)) return "write";
  if (READ.test(bare)) return "read";
  if (/^delete$/i.test(bare)) return "delete";
  if (/^move$/i.test(bare)) return "move";
  if (FETCH.test(bare)) return "fetch";
  if (WEB_SEARCH.test(bare)) return "web-search";
  if (SEARCH.test(bare)) return "search";
  if (AGENT.test(bare)) return "agent";
  return "other";
}

/** The arguments, from a summary that is JSON, whole or cut short. A cut
 * one still has its first few fields intact, and those are usually the
 * ones that matter (file_path comes before the text being written). */
function readJson(text: string): { fields: Record<string, unknown>; whole: boolean } | null {
  const t = text.trim();
  if (!t.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(t);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return { fields: parsed, whole: true };
  } catch {
    // cut short: take the pairs that closed before the cut
  }
  const fields: Record<string, unknown> = {};
  const pair = /"((?:[^"\\]|\\.)+)"\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null)(?=\s*[,}])/g;
  for (const m of t.matchAll(pair)) {
    try {
      fields[JSON.parse(`"${m[1]}"`)] = JSON.parse(m[2]);
    } catch {
      // a pair that does not read is left out, not guessed at
    }
  }
  return Object.keys(fields).length ? { fields, whole: false } : null;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

/** The code in an ACP title such as "Run `pnpm test`", or null. */
function backticked(text: string): string | null {
  const m = text.match(/`([^`]+)`/);
  return m ? m[1] : null;
}

/** Whether a line is a sentence about the work rather than the work. */
function prose(text: string): boolean {
  return /^[A-Z][a-z]/.test(text) && /[.?!]$/.test(text.trim()) && text.split(/\s+/).length >= 4 && !/[|&;$=<>]/.test(text);
}

/** A home directory said as ~, which is how people say it. */
export function tidyPath(path: string): string {
  return path.replace(/^\/(Users|home)\/[^/]+(?=\/|$)/, "~");
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** Shapes of command that can lose work for good. A short list on
 * purpose: a warning on every command would teach people to skip it. */
const RISKY: Array<[RegExp, string]> = [
  [/\bsudo\b/, "This one asks for admin rights."],
  [/\brm\s+(-[a-z]*[rf][a-z]*\b|--recursive|--force)/i, "This one can delete files for good."],
  [/\bgit\s+push\b[^\n]*(--force\b|--force-with-lease\b|\s-f\b)/, "This one can overwrite history on the remote."],
  [/\bgit\s+reset\s+--hard\b/, "This one throws away uncommitted work."],
  [/\bgit\s+clean\s+-[a-z]*f/i, "This one deletes untracked files."],
  [/\bgit\s+checkout\s+--?\s*\.(\s|$)/, "This one throws away uncommitted work."],
  [/\b(mkfs|diskutil\s+erase\w*)\b/, "This one can erase a disk."],
  [/\bdd\s+[^\n]*\bof=/, "This one writes straight to a disk or file."],
  [/\bdrop\s+(table|database|schema)\b/i, "This one deletes data from a database."],
  [/\btruncate\s+table\b/i, "This one deletes data from a database."],
  [/\bchmod\s+-R\b|\bchown\s+-R\b/, "This one changes permissions on everything under a folder."],
];

export function riskOf(kind: ApprovalKind, text: string | undefined): string | undefined {
  if (kind === "delete") return "This one deletes files.";
  if (!text || (kind !== "command" && kind !== "other" && kind !== "mcp")) return undefined;
  for (const [pattern, why] of RISKY) if (pattern.test(text)) return why;
  return undefined;
}

/** Names for what a tool rule lets through, by kind. */
const NOUN: Record<ApprovalKind, { any: string; doing: string } | null> = {
  command: { any: "Any command", doing: "running commands" },
  edit: { any: "Any file edit", doing: "editing files" },
  write: { any: "Any file write", doing: "writing files" },
  read: { any: "Any file read", doing: "reading files" },
  delete: null,
  move: { any: "Any file move", doing: "moving files" },
  fetch: { any: "Any page", doing: "opening pages" },
  search: { any: "Any search", doing: "searching files" },
  "web-search": { any: "Any web search", doing: "searching the web" },
  agent: { any: "Any helper agent", doing: "starting helper agents" },
  mcp: null,
  other: null,
};

/** The questions the engines ask through a tool, which a rule must never
 * answer (server/policy.ts, QUESTION_TOOLS). The server refuses such a
 * rule; the card does not offer it. */
const QUESTION_TOOL = /^(ask_user|askuserquestion|request_secret|request_connection|requestuserinput|exitplanmode)$/i;

export interface CardLike {
  title?: string;
  subtitle?: string;
  tool?: string;
  askedFor?: string;
}

export function readApproval(card: CardLike, agent: { id: string; name: string }): ApprovalView {
  const tool = (card.tool ?? "").trim();
  let kind = kindOf(tool);
  let summary = (card.subtitle ?? "").trim();

  // The server adds who asked for it, in brackets, after the summary.
  let askedBy: string | undefined;
  const by = summary.match(/\s*\((?:asked for by|for) ([^()]+)\)$/);
  if (by) {
    askedBy = by[1];
    summary = summary.slice(0, by.index).trim();
  }
  // a summary that is only the tool's name, or empty, says nothing more
  if (!summary || summary.toLowerCase() === tool.toLowerCase()) summary = "";

  const json = readJson(summary);
  const args = json?.fields ?? {};
  let cut = Boolean(json && !json.whole) || (!json && cutShort(summary, tool));

  let detail: ApprovalDetail | undefined;
  const path = str(args.file_path) ?? str(args.notebook_path) ?? str(args.path) ?? str(args.filePath) ?? str(args.target_file);
  const url = str(args.url) ?? str(args.uri);
  const command = str(args.command) ?? str(args.cmd);

  if (json) {
    if (command) {
      if (kind === "other") kind = "command";
      detail = { kind: "command", text: command };
    } else if ((kind === "edit" || kind === "other") && path && typeof args.old_string === "string" && typeof args.new_string === "string") {
      kind = "edit";
      detail = { kind: "diff", path, removed: args.old_string, added: args.new_string };
    } else if ((kind === "write" || kind === "other") && path && typeof args.content === "string") {
      kind = "write";
      detail = { kind: "content", path, text: args.content };
    } else if (path && kind !== "mcp" && kind !== "other") {
      detail = { kind: "path", path };
    } else if (url && kind !== "mcp") {
      if (kind === "other") kind = "fetch";
      detail = { kind: "url", url };
    } else if (kind === "web-search" && str(args.query)) {
      detail = { kind: "text", text: str(args.query)! };
    } else if (kind === "agent" && (str(args.description) || str(args.prompt))) {
      detail = { kind: "text", text: (str(args.description) ?? str(args.prompt))! };
    } else {
      const fields = Object.entries(args)
        .filter(([, v]) => v !== null && v !== "" && typeof v !== "object")
        .map(([k, v]) => [k.replace(/_/g, " "), String(v)] as [string, string]);
      if (fields.length) detail = { kind: "fields", fields };
    }
  } else if (summary) {
    const code = backticked(summary);
    if (kind === "command") {
      detail = prose(summary) && !code ? { kind: "text", text: summary } : { kind: "command", text: code ?? summary };
    } else if (/^https?:\/\//i.test(summary)) {
      if (kind === "other") kind = "fetch";
      detail = { kind: "url", url: summary };
    } else if (code && (kind === "edit" || kind === "write" || kind === "read" || kind === "delete" || kind === "move")) {
      detail = { kind: "path", path: code };
    } else if (code && kind === "other") {
      detail = { kind: "command", text: code };
    } else {
      detail = { kind: "text", text: summary };
    }
  }
  // The text of a whole command said in full is never cut, whatever its
  // length happens to be.
  if (json?.whole) cut = false;

  const mcp = tool.match(/^mcp__([^_]+(?:_[^_]+)*?)(?:__(.+))?$/i);
  const server = mcp?.[1];
  const mcpTool = mcp?.[2];
  if (kind === "mcp" && detail?.kind === "fields") detail = { ...detail, name: mcpTool };

  const files = Array.isArray(args.edits) ? args.edits.length : 0;
  const verb = (() => {
    switch (kind) {
      case "command":
        return "wants to run a command";
      case "edit":
        return path || detail?.kind === "path" ? (files > 1 ? `wants to make ${files} edits to a file` : "wants to edit a file") : "wants to make an edit";
      case "write":
        return "wants to write a file";
      case "read":
        return "wants to read a file";
      case "delete":
        return "wants to delete a file";
      case "move":
        return "wants to move a file";
      case "fetch":
        return "wants to open a page";
      case "web-search":
        return "wants to search the web";
      case "search":
        return "wants to search your files";
      case "agent":
        return "wants to start a helper agent";
      case "mcp":
        return server ? `wants to use ${server}` : "wants to use a connected app";
      default:
        if (!tool) return "needs your approval";
        return `wants to use ${tool}`;
    }
  })();

  const short = (() => {
    switch (detail?.kind) {
      case "command":
      case "text":
        return detail.text.split(/\r?\n/).find((l) => l.trim())?.trim() ?? "";
      case "path":
        return basename(detail.path);
      case "diff":
      case "content":
        return detail.path ? basename(detail.path) : "";
      case "url":
        return detail.url.replace(/^https?:\/\//i, "");
      case "fields":
        return detail.name ?? "";
      default:
        return mcpTool ?? "";
    }
  })();

  const risk = riskOf(kind, detail?.kind === "command" || detail?.kind === "text" ? detail.text : summary);

  // Always allow, as the rules can say it. Not for a question tool, not
  // for one a member or a stranger asked for (an owner's rule does not
  // answer theirs, so the offer would be a promise the card cannot keep),
  // and not for anything risky.
  const scopes: AlwaysScope[] = [];
  if (tool && !QUESTION_TOOL.test(tool) && !card.askedFor && !askedBy && !risk) {
    // Claude Code's Bash puts the command itself in the summary, which is
    // the same text a command rule is matched against. Other engines put
    // a reason there as often as not, so an exact command is offered
    // only where the summary is known to be the command.
    if (tool === "Bash" && detail?.kind === "command" && !cut && !json && detail.text.length < 200) {
      scopes.push({
        id: "command",
        label: "This exact command",
        note: `${agent.name} runs it again without asking. Nothing else changes.`,
        rule: { effect: "allow", field: "command", op: "equals", value: detail.text, botId: agent.id },
      });
    }
    const noun = NOUN[kind];
    const any = noun?.any ?? `Any ${mcpTool ?? tool} call`;
    const doing = noun?.doing ?? `using ${mcpTool ?? tool}`;
    scopes.push({
      id: "agent",
      label: `${any}, for ${agent.name}`,
      note: `${agent.name} stops asking before ${doing}.`,
      rule: { effect: "allow", field: "tool", op: "equals", value: tool, botId: agent.id },
    });
    scopes.push({
      id: "everyone",
      label: `${any}, for every agent`,
      note: `No agent asks before ${doing}.`,
      rule: { effect: "allow", field: "tool", op: "equals", value: tool },
      wide: true,
    });
  }

  return { kind, verb, detail, short, cut, askedBy, risk, scopes };
}

/** How an answer to an approval reads once it has settled. The engines'
 * own labels count: ACP agents name their choices ("Allow once",
 * "Reject"), and the card sends that label back as the answer. */
export function settledAs(answer: string | undefined): "allowed" | "denied" | "other" {
  if (!answer) return "other";
  if (/^(allow|approve|accept|yes|proceed)/i.test(answer.trim()) || /\balways allow\b/i.test(answer)) return "allowed";
  if (/^(deny|reject|decline|no\b|don'?t|cancel|dismissed)/i.test(answer.trim())) return "denied";
  return "other";
}

/** Which of an approval's choices is the yes and which the no, so the two
 * become buttons. The rest (an agent's own "Always allow") are offered
 * beside them in its own words. */
export function splitChoices(options: string[]): { allow?: string; deny?: string; others: string[] } {
  const allow = options.find((o) => settledAs(o) === "allowed" && !/always/i.test(o)) ?? options.find((o) => settledAs(o) === "allowed");
  const deny = options.find((o) => settledAs(o) === "denied");
  return { allow, deny, others: options.filter((o) => o !== allow && o !== deny) };
}
