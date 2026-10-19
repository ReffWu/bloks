// "You approved this 7 times. Always allow it?"
//
// Rules exist so the hundredth "may I" is answered without anybody being
// asked (server/policy.ts), and most people never write one. They just
// keep pressing Allow on the same thing. So Bloks watches for that and
// offers the rule, once the habit is plain: the same kind of request,
// approved again and again, never refused.
//
// Everything a suggestion can turn into is an ordinary rule, saved where
// rules already live and removed the same way. There is no second system
// of standing permissions here, only a list of what the person decided
// and a way of reading it.
//
// Four decisions worth stating.
//
//   What counts is the person's own answer. A rule or a mode that waved
//   something through says nothing about what the person wants, and an
//   approval asked for by somebody in a shared room, an email or a
//   Telegram contact is the owner answering for someone else. Only the
//   owner's own requests, answered by the owner, are noted.
//
//   Never broader than what was approved. A suggestion names the tool it
//   was approved for, and then the narrowest thing the approvals have in
//   common: the exact command, or the words a family of commands starts
//   with; the folder the files were in; the site the pages were on. It
//   is offered for the agent that kept asking, and for every agent only
//   when more than one did. Commands that run whatever they are given
//   (a shell, an interpreter, curl) are only ever offered word for word.
//
//   Never on the floor (server/safety-floor.ts). Deleting, money and
//   credentials are not offered however often they were approved, and a
//   rule made from a suggestion still never covers them later.
//
//   One no outweighs a run of yeses. A single refusal of the same kind
//   in the window means the person is still deciding case by case, and a
//   suggestion turned down stays quiet for a month.
//
// The list itself is small on purpose: the decisions of the last month,
// capped, with nothing in them the record does not already say.
import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

import { DATA_DIR } from "./config.ts";
import { readSaved } from "./atomic-write.ts";
import {
  MAX_VALUE,
  cleanPath,
  decide,
  folderOf,
  isQuestionTool,
  plainWords,
  siteOf,
  type Ask,
  type Field,
  type Op,
  type Rule,
} from "./policy.ts";
import { dangerous } from "./safety-floor.ts";

/** How many approvals make a habit. */
export const HABIT_COUNT = 5;
/** How far back a habit is read, and how far back a refusal counts. */
export const HABIT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
/** How long a suggestion turned down stays quiet. */
export const QUIET_MS = 30 * 24 * 60 * 60 * 1000;
/** Decisions kept: the window a dismissal lasts, and no more than this. */
const KEPT_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_KEPT = 2_000;

/** One answer the person gave to one approval card. */
export interface HabitDecision {
  at: number;
  botId: string;
  tool: string;
  command?: string;
  path?: string;
  url?: string;
  answer: "allow" | "deny";
}

/** The rule a suggestion would write, without who it is for. */
export interface SuggestedRule {
  effect: "allow";
  field: Field;
  op: Op;
  value: string;
  tool: string;
}

export interface Suggestion {
  /** Stable for the same tool and target, whoever it is for, so turning
   * one down quiets it however the agents change. */
  id: string;
  tool: string;
  rule: SuggestedRule;
  /** What it lets through, to follow "Always allow it to": "run `pnpm
   * test`", "read files in ~/site/src". */
  what: string;
  /** Approvals in the window, all agents together. */
  count: number;
  /** Who approved it, most first. Agents since archived are left out. */
  agents: Array<{ botId: string; name: string; count: number }>;
  /** The agent "Allow for this agent" means: the one that asked most,
   * when it alone reached the count. */
  forAgent: { botId: string; name: string; count: number } | null;
  /** Whether "Allow for everyone" is offered: only when more than one
   * agent was approved for it. */
  forEveryone: boolean;
  /** The question, as the screen and the phone say it. */
  title: string;
  /** When it was last approved. */
  lastAt: number;
}

// ── reading what was approved into the shape of a rule ─────────────────

/** Commands whose next word is the program they run, so the words they
 * start with say nothing about what is being allowed. */
const RUNS_ANYTHING = new Set([
  "sh", "bash", "zsh", "fish", "dash", "python", "python3", "node", "deno", "bun", "ruby", "perl", "php",
  "npx", "bunx", "pnpx", "uvx", "pipx", "eval", "exec", "xargs", "env", "nohup", "time", "watch", "timeout",
  "ssh", "scp", "rsync", "curl", "wget", "osascript", "open", "docker", "kubectl", "find", "awk", "sed", "make",
]);
/** Second words that hand off to a third: `pnpm run build` and `pnpm run
 * deploy` are different things to approve. */
const HANDS_OFF = new Set(["run", "exec", "x", "dlx", "run-script", "task"]);

interface Shape {
  /** What decisions are grouped by: the tool and the kind of target. */
  family: string;
  field: Field;
  /** For a command family, the exact text, so a family approved in one
   * spelling only is offered word for word. */
  exact?: string;
  /** The words a command family starts with, or the folder or site. */
  value: string;
}

function shapeOf(d: Pick<HabitDecision, "tool" | "command" | "path" | "url">): Shape | null {
  const tool = d.tool.trim();
  const key = tool.toLowerCase();
  if (!tool) return null;
  if (d.command !== undefined) {
    const text = d.command.trim();
    if (!text || text.length > MAX_VALUE) return null;
    const words = plainWords(text);
    if (!words || RUNS_ANYTHING.has(words[0].toLowerCase())) {
      // only ever word for word
      return { family: `${key}\u0000command=\u0000${text}`, field: "command", exact: text, value: text };
    }
    let prefix = [words[0]];
    const second = words[1];
    if (second && /^[a-z][\w:.-]*$/i.test(second)) {
      prefix.push(second);
      if (HANDS_OFF.has(second.toLowerCase()) && words[2] && /^[a-z][\w:.-]*$/i.test(words[2])) prefix.push(words[2]);
    }
    prefix = prefix.map((w) => w.toLowerCase());
    return { family: `${key}\u0000command\u0000${prefix.join(" ")}`, field: "command", exact: words.join(" "), value: prefix.join(" ") };
  }
  if (d.path !== undefined) {
    const folder = folderOf(d.path);
    if (!folder || folder === "/" || folder.length > MAX_VALUE) return null;
    return { family: `${key}\u0000path\u0000${folder}`, field: "path", value: folder };
  }
  if (d.url !== undefined) {
    const site = siteOf(d.url);
    if (!site || site.length > MAX_VALUE) return null;
    return { family: `${key}\u0000url\u0000${site}`, field: "url", value: site };
  }
  return { family: `${key}\u0000tool`, field: "tool", value: tool };
}

/** A home folder said as ~, which is how people say it. */
function tidy(path: string): string {
  return path.replace(/^\/(Users|home)\/[^/]+(?=\/|$)/, "~");
}

/** "mcp__github__create_issue" as a person would say it. */
function toolWords(tool: string): string {
  const mcp = tool.match(/^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/i);
  return mcp ? `${mcp[2].replace(/_/g, " ")} in ${mcp[1]}` : tool;
}

function whatOf(rule: SuggestedRule): string {
  const tool = rule.tool;
  const t = tool.toLowerCase();
  switch (rule.op) {
    case "runs":
      return `run commands starting with \`${rule.value}\``;
    case "in-folder": {
      const verb = /^(read|view|read_file|notebookread)$/.test(t)
        ? "read"
        : /edit|patch|str_replace/.test(t)
          ? "edit"
          : /write|create|save/.test(t)
            ? "write"
            : null;
      return verb ? `${verb} files in ${tidy(rule.value)}` : `use ${toolWords(tool)} on files in ${tidy(rule.value)}`;
    }
    case "on-site": {
      const host = rule.value.replace(/^https?:\/\//, "");
      return /fetch|browse|open_url/.test(t) ? `open pages on ${host}` : `use ${toolWords(tool)} on ${host}`;
    }
    default:
      return rule.field === "command" ? `run \`${rule.value}\`` : `use ${toolWords(tool)}`;
  }
}

const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

/** The id a suggestion keeps: its tool and target, not who it is for. */
export function suggestionId(rule: Pick<SuggestedRule, "tool" | "field" | "op" | "value">): string {
  return createHash("sha256")
    .update(`${rule.tool.toLowerCase()}\u0000${rule.field}\u0000${rule.op}\u0000${rule.value.toLowerCase()}`)
    .digest("hex")
    .slice(0, 16);
}

/** The request a decision was, as policy reads one. */
function askOf(d: HabitDecision, botId: string, agent: string): Ask {
  return {
    tool: d.tool,
    ...(d.command !== undefined ? { command: d.command } : {}),
    ...(d.path !== undefined ? { path: d.path } : {}),
    ...(d.url !== undefined ? { url: d.url } : {}),
    botId,
    agent,
  };
}

export interface SuggestInput {
  decisions: readonly HabitDecision[];
  rules: readonly Rule[];
  now: number;
  /** Suggestion id to the time it stays quiet until. */
  quiet: Readonly<Record<string, number>>;
  /** The agents that can still act: an archived one is no one to allow. */
  agents: ReadonlyArray<{ id: string; name: string }>;
}

/**
 * What to offer now, most approved first.
 *
 * Pure, so every rule above can be tested by handing it a list.
 */
export function suggestionsFrom(input: SuggestInput): Suggestion[] {
  const since = input.now - HABIT_WINDOW_MS;
  const live = new Map(input.agents.map((a) => [a.id, a.name]));
  const families = new Map<string, { shape: Shape; allows: HabitDecision[]; denies: number }>();
  for (const d of input.decisions) {
    if (d.at < since || d.at > input.now) continue;
    const shape = shapeOf(d);
    if (!shape) continue;
    const entry = families.get(shape.family) ?? { shape, allows: [], denies: 0 };
    if (d.answer === "deny") entry.denies += 1;
    else entry.allows.push(d);
    families.set(shape.family, entry);
  }

  const out: Suggestion[] = [];
  for (const { shape, allows, denies } of families.values()) {
    if (denies > 0 || allows.length < HABIT_COUNT) continue;
    const latest = allows.reduce((a, b) => (b.at >= a.at ? b : a));
    const tool = latest.tool.trim();
    if (isQuestionTool(tool)) continue;
    // every one of them off the floor, not only the latest: one force
    // push among the pushes is enough to keep the family off the table
    if (allows.some((d) => dangerous(d))) continue;

    let rule: SuggestedRule;
    if (shape.field === "command") {
      const spellings = new Set(allows.map((d) => shapeOf(d)?.exact));
      rule = spellings.size === 1
        ? { effect: "allow", field: "command", op: "equals", value: latest.command!.trim(), tool }
        : { effect: "allow", field: "command", op: "runs", value: shape.value, tool };
    } else if (shape.field === "path") {
      rule = { effect: "allow", field: "path", op: "in-folder", value: cleanPath(shape.value)!, tool };
    } else if (shape.field === "url") {
      rule = { effect: "allow", field: "url", op: "on-site", value: shape.value, tool };
    } else {
      rule = { effect: "allow", field: "tool", op: "equals", value: tool, tool };
    }
    if (dangerous({ tool, ...(rule.field === "command" || rule.field === "path" || rule.field === "url" ? { [rule.field]: rule.value } : {}) })) continue;

    const id = suggestionId(rule);
    if ((input.quiet[id] ?? 0) > input.now) continue;

    const counts = new Map<string, number>();
    for (const d of allows) if (live.has(d.botId)) counts.set(d.botId, (counts.get(d.botId) ?? 0) + 1);
    const agents = [...counts.entries()]
      .map(([botId, count]) => ({ botId, name: live.get(botId)!, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    if (!agents.length) continue;
    const top = agents[0];
    const forAgent = top.count >= HABIT_COUNT ? top : null;
    const total = agents.reduce((n, a) => n + a.count, 0);
    const forEveryone = agents.length > 1 && total >= HABIT_COUNT;
    if (!forAgent && !forEveryone) continue;

    // Already decided by a rule, either way: allowed means there is
    // nothing to offer, and refused means somebody shut it on purpose.
    const already = decide([...input.rules], askOf(latest, top.botId, top.name));
    if (already.verdict !== "ask") continue;

    const count = forAgent && !forEveryone ? forAgent.count : total;
    out.push({
      id,
      tool,
      rule,
      what: whatOf(rule),
      count,
      agents,
      forAgent,
      forEveryone,
      title: forAgent
        ? `You approved this ${times(forAgent.count)}. Always allow it for ${forAgent.name}?`
        : `You approved this ${times(total)} across ${agents.length} agents. Always allow it for every agent?`,
      lastAt: latest.at,
    });
  }
  return out.sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
}

/** The rule to save for a suggestion taken, for one agent or for all. */
export function ruleFor(suggestion: Suggestion, scope: "agent" | "everyone"): (Omit<Rule, "id" | "createdAt">) | null {
  if (scope === "agent" && !suggestion.forAgent) return null;
  if (scope === "everyone" && !suggestion.forEveryone) return null;
  return {
    ...suggestion.rule,
    ...(scope === "agent" ? { botId: suggestion.forAgent!.botId } : {}),
    enabled: true,
  };
}

// ── the file ───────────────────────────────────────────────────────────

const HABITS_FILE = join(DATA_DIR, "approval-habits.json");

interface Saved {
  decisions: HabitDecision[];
  quiet: Record<string, number>;
}

const valid = (d: unknown): d is HabitDecision => {
  const x = d as HabitDecision;
  return Boolean(x) && typeof x.at === "number" && typeof x.botId === "string" && typeof x.tool === "string" &&
    (x.answer === "allow" || x.answer === "deny");
};

export class RuleSuggestionStore {
  decisions: HabitDecision[] = [];
  quiet: Record<string, number> = {};
  private readonly file: string;

  constructor(file: string = HABITS_FILE) {
    this.file = file;
    const saved = readSaved<Saved>(this.file, { decisions: [], quiet: {} }, (v): v is Saved => Boolean(v) && typeof v === "object");
    this.decisions = Array.isArray(saved.decisions) ? saved.decisions.filter(valid) : [];
    this.quiet = saved.quiet && typeof saved.quiet === "object" ? Object.fromEntries(
      Object.entries(saved.quiet).filter(([, until]) => typeof until === "number"),
    ) : {};
  }

  private save() {
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      writeFileSync(this.file, JSON.stringify({ decisions: this.decisions, quiet: this.quiet }), { mode: 0o600 });
    } catch {
      /* a habit not noted is a suggestion that comes a little later */
    }
  }

  private prune(now: number) {
    this.decisions = this.decisions.filter((d) => now - d.at <= KEPT_MS).slice(-MAX_KEPT);
    for (const [id, until] of Object.entries(this.quiet)) if (until <= now) delete this.quiet[id];
  }

  /** The person answered an approval card. Only what a rule could be
   * about is kept: the tool, and the one target it named. */
  note(decision: HabitDecision, now: number) {
    const clip = (v?: string) => (typeof v === "string" ? v.slice(0, 500) : undefined);
    this.decisions.push({
      at: decision.at,
      botId: decision.botId,
      tool: decision.tool.slice(0, 120),
      ...(decision.command !== undefined ? { command: clip(decision.command) } : {}),
      ...(decision.path !== undefined ? { path: clip(decision.path) } : {}),
      ...(decision.url !== undefined ? { url: clip(decision.url) } : {}),
      answer: decision.answer,
    });
    this.prune(now);
    this.save();
  }

  /** Not now: quiet for a month. Returns when it may come back. */
  dismiss(id: string, now: number): number {
    const until = now + QUIET_MS;
    this.quiet[id] = until;
    this.prune(now);
    this.save();
    return until;
  }

  /** An agent that is gone takes its habits with it. */
  forgetBot(botId: string) {
    const before = this.decisions.length;
    this.decisions = this.decisions.filter((d) => d.botId !== botId);
    if (this.decisions.length !== before) this.save();
  }

  suggestions(input: Omit<SuggestInput, "decisions" | "quiet">): Suggestion[] {
    return suggestionsFrom({ ...input, decisions: this.decisions, quiet: this.quiet });
  }
}
