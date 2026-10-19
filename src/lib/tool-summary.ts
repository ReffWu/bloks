// A turn's tool calls, in one line.
//
// An agent working through a skill can make twenty calls in a minute,
// and a line each pushes the reply people came for off the screen. So a
// run of them reads as what happened, counted: commands run, files read,
// searches, edits, anything else. The list is still there, one click
// away.
//
// Failures are not counted. A command exiting non-zero is ordinary work
// (a test that fails, a grep that finds nothing), and a red number on
// every turn would teach people to ignore it. They are still marked in
// the opened list.

export interface ToolLike {
  name: string;
  command?: string;
  ok?: boolean;
  stopped?: boolean;
}

export type ToolKind = "command" | "read" | "search" | "edit" | "other";

const READ = /^(read|view|notebookread|read_file|cat)$/i;
const SEARCH = /^(grep|glob|ls|list|search|web_?search|websearch|webfetch|web_?fetch|find|codebase_search)$/i;
const EDIT = /^(edit|write|multiedit|multi_edit|notebookedit|create|str_replace(_editor)?|apply_patch|write_file|edit_file)$/i;
const COMMAND = /^(bash|shell|terminal|exec|run|sandbox_exec|run_shell_command|command)$/i;

/** Count by kind, independently of a command's display detail. The
 * whitespace heuristic still recognizes older command-labelled rows. */
export function kindOf(name: string): ToolKind {
  // the OpenAI-compatible driver labels a call "name: argument", and the
  // space in the argument is not what makes it a command
  const head = /^([\w.-]+):\s/.exec(name.trim())?.[1];
  const bare = (head ?? name.trim()).replace(/^mcp__[^_]+__/, "");
  if (COMMAND.test(bare)) return "command";
  if (READ.test(bare)) return "read";
  if (SEARCH.test(bare)) return "search";
  if (EDIT.test(bare)) return "edit";
  if (/\s/.test(bare) && !/^error:/i.test(bare)) return "command";
  return "other";
}

function count(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Ran 3 commands, read 5 files, used 2 other tools". */
export function summarize(tools: ToolLike[]): string {
  const by: Record<ToolKind, number> = { command: 0, read: 0, search: 0, edit: 0, other: 0 };
  for (const tool of tools) by[kindOf(tool.name)]++;
  const parts: string[] = [];
  if (by.command) parts.push(`ran ${count(by.command, "command", "commands")}`);
  if (by.read) parts.push(`read ${count(by.read, "file", "files")}`);
  if (by.search) parts.push(`searched ${by.search === 1 ? "once" : `${by.search} times`}`);
  if (by.edit) parts.push(`edited ${count(by.edit, "file", "files")}`);
  if (by.other) {
    const noun = parts.length ? "other tool" : "tool";
    parts.push(`used ${count(by.other, noun, `${noun}s`)}`);
  }
  const line = parts.join(", ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/** Whether any call in the run is still going. */
export function running(tools: ToolLike[]): boolean {
  return tools.some((tool) => tool.ok === undefined && !tool.stopped);
}

/** The chip a run carries: the highest "same call repeated" mark among
 * its rows, or 0. The server keeps one marked row a turn, but a run of
 * two turns' rows side by side can hold two, and the higher is the one
 * worth saying. */
export function repeatedIn(rows: Array<{ repeated?: number }>): number {
  return rows.reduce((top, row) => (typeof row.repeated === "number" && row.repeated > top ? row.repeated : top), 0);
}

/** One visible command label, with old no-detail rows left as named. */
export function toolLabel(tool: Pick<ToolLike, "name" | "command">): string {
  return tool.command?.split(/\r?\n/).find((line) => line.trim()) ?? tool.name;
}

// What a call is doing, in plain words, for the line that says the
// agent is at work. A command is named by what it is for when the
// command makes that plain (tests, an install, a build). Anything not
// worth a guess is left for that line to call "Working".
const TESTS = /(^|[\s;&|/(])(test|tests|vitest|jest|pytest|mocha|rspec|playwright|go test|cargo test)(\s|$|\))/i;
const INSTALL = /\b(npm|pnpm|yarn|bun|pip3?|brew|gem|poetry|uv|cargo)\s+(i|install|add|ci)\b/i;
const BUILD = /(^|[\s;&|/(])(build|tsc|make|compile)(\s|$|\))/i;

const NAMED: Record<string, string> = {
  websearch: "Searching the web",
  web_search: "Searching the web",
  webfetch: "Reading a web page",
  web_fetch: "Reading a web page",
  open_url: "Opening a web page",
  ls: "Looking through files",
  list: "Looking through files",
  write: "Writing a file",
  create: "Writing a file",
  write_file: "Writing a file",
  todowrite: "Planning",
  task: "Handing work to a helper",
  agent: "Handing work to a helper",
  ask_user: "Waiting for your answer",
  memory_read: "Checking its memory",
  memory_write: "Saving to memory",
  search_history: "Looking back through messages",
  read_message: "Looking back through messages",
};

function commandWords(command: string): string {
  if (TESTS.test(command)) return "Running tests";
  if (INSTALL.test(command)) return "Installing packages";
  if (BUILD.test(command)) return "Building";
  return "Running a command";
}

/** "Running tests", "Reading a file", "Searching the web": what this
 * call is doing, or null when that is not worth a guess. */
export function stepWords(tool: Pick<ToolLike, "name" | "command">): string | null {
  const name = tool.name.trim();
  const peer = /^messaged (.+)$/.exec(name);
  if (peer) return `Messaging ${peer[1]}`;
  // the OpenAI-compatible driver labels a call "name: argument"
  const labelled = /^([\w.-]+):\s(.*)$/s.exec(name);
  const server = /^mcp__([^_]+)__/.exec(name)?.[1];
  const bare = (labelled ? labelled[1] : name).replace(/^mcp__[^_]+__/, "");
  const named = NAMED[bare.toLowerCase()];
  if (named) return named;
  if (bare === "computer_exec") return commandWords(tool.command ?? labelled?.[2] ?? "");
  switch (kindOf(bare)) {
    case "command":
      return commandWords(tool.command ?? labelled?.[2] ?? name);
    case "read":
      return "Reading a file";
    case "search":
      return "Searching the files";
    case "edit":
      return "Editing a file";
    default:
      return server ? `Using ${server}` : null;
  }
}

/** The newest call still going among these rows, if any. */
export function runningCall<T extends { tool?: ToolLike }>(rows: readonly T[]): T | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const tool = rows[i].tool;
    if (tool && tool.ok === undefined && !tool.stopped) return rows[i];
  }
  return null;
}
