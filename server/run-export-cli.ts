// bloks-server export-runs: the same export as Settings, Data, Export for
// training, for a script (server/run-export.ts).
//
// It reads the data folder itself, as bloks-server backup does, so it
// works with Bloks running or stopped and asks nothing of the server.
// That folder is the owner's, which is who can run this; an agent's own
// shell (BLOKS_TOKEN set) is refused, as every owner command is.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve, sep } from "node:path";

import {
  diskSource,
  ensureExportsDir,
  exportName,
  readChoice,
  runExport,
  type ExportResult,
  type ExportSource,
  type ExportSummary,
} from "./run-export.ts";

export const EXPORT_EXIT = { done: 0, failed: 1, usage: 2, nothing: 3, refused: 7 } as const;

export interface ExportCliContext {
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
  env: NodeJS.ProcessEnv;
  dataDir: string;
  home?: string;
  /** For the tests: a source other than the folder. */
  source?: ExportSource;
}

class Usage extends Error {}

export const EXPORT_USAGE = `Usage: bloks-server export-runs [options]

Writes agents' runs to a JSONL file on this computer, to train a model on.
Nothing is sent anywhere.

  --format openai|sharegpt|trajectory   the shape of each record (openai)
  --per turn|conversation               one record per turn, or per conversation (turn)
  --agent NAME                          only this agent, by name or id; again for more
  --conversation ID                     only this conversation; again for more
  --from 2026-10-01 --to 2026-10-31     only turns in these days
  --engine KIND                         only this engine (claudeAgent, codex, ...); again for more
  --any-outcome                         keep turns that failed or were stopped too
  --uncorrected                         only turns you did not stop, steer, edit, redo or thumb down
  --thumbs-up                           only turns you gave a thumbs up
  --complete-results                    only turns whose every tool result was recorded
  --min-tokens N --max-tokens N         only records this long, estimated
  --keep emails,phones,paths,names      leave these in (all are taken out by default)
  --include member-private,other-people,system-prompt,memory
                                        add what is left out by default
  --results N                           shorten tool results to N characters (6000)
  --full-results                        leave tool results whole
  --keep-repeats                        keep repeated identical results
  --cap-tokens N                        cap each record at N tokens, estimated
  --out FILE                            where to write (a new file in ~/.bloks-exports)
  --dry-run                             say what would be written and show the first record
  --json                                print the summary as JSON

Keys, tokens and passwords are always taken out.`;

const KEEP = { emails: "emails", phones: "phones", paths: "homePaths", names: "names" } as const;
const INCLUDE = { "member-private": "memberPrivate", "other-people": "otherPeople", "system-prompt": "systemPrompt", memory: "memory" } as const;
const BOOLEAN_FLAGS = new Set(["--any-outcome", "--uncorrected", "--thumbs-up", "--complete-results", "--full-results", "--keep-repeats", "--dry-run", "--json", "--help", "-h"]);

/** The flags as a request body for readChoice. */
export function parseExportArgs(args: readonly string[], agents: ExportSource["bots"]): { body: Record<string, any>; out: string | null; dryRun: boolean; json: boolean; help: boolean } {
  const values = new Map<string, string[]>();
  const flags = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (BOOLEAN_FLAGS.has(arg)) {
      flags.add(arg);
      continue;
    }
    if (!arg.startsWith("--")) throw new Usage(`${arg} is not an option. Run bloks-server export-runs --help to see them.`);
    const [name, inline] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
    const value = inline ?? args[++i];
    if (value === undefined || (inline === undefined && value.startsWith("--"))) throw new Usage(`${name} needs a value.`);
    values.set(name, [...(values.get(name) ?? []), value]);
  }
  const known = new Set(["--format", "--per", "--agent", "--conversation", "--from", "--to", "--engine", "--min-tokens", "--max-tokens", "--keep", "--include", "--results", "--cap-tokens", "--out"]);
  for (const name of values.keys()) if (!known.has(name)) throw new Usage(`${name} is not an option. Run bloks-server export-runs --help to see them.`);
  const one = (name: string) => values.get(name)?.at(-1);
  const list = (name: string) => (values.get(name) ?? []).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);

  const body: Record<string, any> = {
    format: one("--format") ?? "openai",
    unit: one("--per") ?? "turn",
    from: one("--from") ?? null,
    to: one("--to") ?? null,
    finishedWell: !flags.has("--any-outcome"),
    uncorrected: flags.has("--uncorrected"),
    thumbsUp: flags.has("--thumbs-up"),
    completeResults: flags.has("--complete-results"),
    minTokens: one("--min-tokens") ?? null,
    maxTokens: one("--max-tokens") ?? null,
    privacy: { emails: true, phones: true, homePaths: true, names: true },
    include: {},
    compression: {
      toolResultChars: flags.has("--full-results") ? null : (one("--results") ?? 6000),
      repeats: !flags.has("--keep-repeats"),
      capTokens: one("--cap-tokens") ?? null,
    },
  };
  for (const kept of list("--keep")) {
    const key = KEEP[kept as keyof typeof KEEP];
    if (!key) throw new Usage(`--keep takes emails, phones, paths or names, not ${kept}.`);
    body.privacy[key] = false;
  }
  for (const added of list("--include")) {
    const key = INCLUDE[added as keyof typeof INCLUDE];
    if (!key) throw new Usage(`--include takes member-private, other-people, system-prompt or memory, not ${added}.`);
    body.include[key] = true;
  }
  const named = list("--agent");
  if (named.length) {
    body.agents = named.map((wanted) => {
      const lower = wanted.toLowerCase();
      const byId = agents.find((b) => b.id === wanted);
      const match = byId ? [byId] : agents.filter((b) => b.name.toLowerCase() === lower);
      if (match.length === 0) throw new Usage(`No agent is called ${wanted}.`);
      if (match.length > 1) throw new Usage(`More than one agent is called ${wanted}. Name it by its id: ${match.map((b) => b.id).join(", ")}.`);
      return match[0].id;
    });
  }
  const conversations = list("--conversation");
  if (conversations.length) body.conversations = conversations;
  const engines = list("--engine");
  if (engines.length) body.engines = engines;
  return { body, out: one("--out") ?? null, dryRun: flags.has("--dry-run"), json: flags.has("--json"), help: flags.has("--help") || flags.has("-h") };
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const size = (bytes: number) =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
const shown = (path: string, home: string) => (home && (path === home || path.startsWith(home + sep)) ? `~${path.slice(home.length)}` : path);
const RESULT_WORDS = { complete: "complete", partial: "partly recorded", missing: "not recorded", none: "no tool calls" } as const;

/** The summary as sentences, the way the Settings page says it. */
export function summaryLines(summary: ExportSummary): string[] {
  const lines: string[] = [];
  if (summary.leftOut.total) {
    lines.push(`Left out ${plural(summary.leftOut.total, "turn", "turns")}: ${summary.leftOut.reasons.map((r) => `${r.count.toLocaleString("en-US")} ${r.label}`).join(", ")}.`);
  }
  const removed = summary.removed;
  const taken = [
    removed.secrets && plural(removed.secrets, "key or password", "keys or passwords"),
    removed.emails && plural(removed.emails, "email address", "email addresses"),
    removed.phones && plural(removed.phones, "phone number", "phone numbers"),
    removed.homePaths && plural(removed.homePaths, "home folder path", "home folder paths"),
    removed.names && plural(removed.names, "name", "names"),
  ].filter(Boolean);
  if (taken.length) lines.push(`Taken out: ${taken.join(", ")}.`);
  const c = summary.compression;
  const short = [
    c.shortened && plural(c.shortened, "long result shortened", "long results shortened"),
    c.repeats && plural(c.repeats, "repeated result left out", "repeated results left out"),
    c.droppedTurns && plural(c.droppedTurns, "early turn dropped to fit the cap", "early turns dropped to fit the cap"),
  ].filter(Boolean);
  if (short.length) lines.push(`Shortened: ${short.join(", ")}.`);
  for (const engine of summary.engines) {
    lines.push(`${engine.name}: ${plural(engine.turns, "turn", "turns")}, tool results ${RESULT_WORDS[engine.toolResults]}.`);
  }
  for (const warning of summary.warnings) lines.push(warning);
  return lines;
}

export async function exportRunsMain(args: readonly string[], ctx: ExportCliContext): Promise<number> {
  const home = ctx.home ?? homedir();
  try {
    if (ctx.env.BLOKS_TOKEN) {
      ctx.stderr.write("This is the owner's to run, not an agent's: it reads every conversation in the workspace.\n");
      return EXPORT_EXIT.refused;
    }
    const source = ctx.source ?? diskSource(ctx.dataDir, home);
    const parsed = parseExportArgs(args, source.bots);
    if (parsed.help) {
      ctx.stdout.write(`${EXPORT_USAGE}\n`);
      return EXPORT_EXIT.done;
    }
    const choice = readChoice(parsed.body);
    if (typeof choice === "string") throw new Usage(`${choice[0].toUpperCase()}${choice.slice(1)}.`);
    let out: string | null = null;
    if (!parsed.dryRun) {
      if (parsed.out) {
        out = resolve(parsed.out);
        if (existsSync(out)) throw new Usage(`There is a file at ${out} already. Choose another name.`);
        if (!existsSync(dirname(out))) throw new Usage(`There is no folder at ${dirname(out)}.`);
      } else {
        const dir = ensureExportsDir(ctx.dataDir);
        out = resolve(dir, exportName(dir, choice));
      }
    }
    const result: ExportResult = await runExport(source, choice, { out });
    const { summary } = result;
    if (parsed.json) {
      ctx.stdout.write(`${JSON.stringify({ file: result.file, summary, ...(parsed.dryRun ? { first: result.first } : {}) }, null, 2)}\n`);
    } else {
      const what = `${plural(summary.records, "record", "records")} (${plural(summary.turns, "turn", "turns")})`;
      if (!summary.records) ctx.stdout.write(`Nothing to export: no turn matched.${summary.considered ? "" : " There are no conversations to look in."}\n`);
      else if (parsed.dryRun) ctx.stdout.write(`Would export ${what}, ${size(summary.bytes)}. Nothing was written.\n`);
      else ctx.stdout.write(`Exported ${what} to ${shown(result.file!, home)}, ${size(summary.bytes)}.\n`);
      for (const line of summaryLines(summary)) ctx.stdout.write(`${line}\n`);
      if (parsed.dryRun && result.preview) ctx.stdout.write(`\nThe first record, as it would be written:\n${result.preview}\n`);
    }
    return summary.records ? EXPORT_EXIT.done : EXPORT_EXIT.nothing;
  } catch (e) {
    if (e instanceof Usage) {
      ctx.stderr.write(`${e.message}\n`);
      return EXPORT_EXIT.usage;
    }
    ctx.stderr.write(`The export stopped: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXPORT_EXIT.failed;
  }
}
