// Moving a whole workspace to another machine: from the person's Mac to a
// hosted workspace, in one file.
//
// A move is a backup with the machine taken out (server/backup.ts writes
// it, and a restore puts it in place), because the backup already knows
// how to carry every agent, lane, room, routine, watcher, intent, memory
// and skill, and how to keep keys out of a file that travels. What a move
// adds is the rest of what belongs to the computer it leaves rather than
// to the workspace: folders on that disk, engine sessions only its CLIs
// can resume, the Undo history of files that are not coming, its relay
// space and paired devices, its port. Those are left out or cleared here,
// and the machine it lands on keeps its own.
//
// Keys never travel in a move, sealed or not. The file says which ones
// were left behind, by name, so the person knows what to enter again.
//
// Everything here is pure: text in, text out.
import { isRecord } from "./atomic-write.ts";

/** Folders and files that only mean something on the machine a move
 * leaves, beyond what a backup already leaves out. */
export function moveLeftOut(rel: string, isDir: boolean): string | null {
  const parts = rel.split("/");
  if (parts.length !== 1) return null;
  const name = parts[0];
  if (isDir) {
    if (name === "checkpoints") return "Undo history of files on the computer it left";
    if (name === "rehearsals") return "rehearsal copies of folders on the computer it left";
    if (name === "vm-home") return "the Local VM's files";
    if (name === "identities") return "agents' signing keys";
    return null;
  }
  const machine: Record<string, string> = {
    "turns-in-flight.json": "turns running on the computer it left",
    "engine-sessions.json": "engine sessions on the computer it left",
    "engine-turns.json": "engine sessions on the computer it left",
    "session-import.json": "what was brought over from that computer's other tools",
    "setup-import.json": "what was brought over from that computer's other tools",
    "pair-links.json": "pairing links for that computer",
    "live-activities.json": "phones paired with that computer",
  };
  return machine[name] ?? null;
}

/** Sections of config.json that describe the computer, not the workspace:
 * its port, its engines' install paths, its relay space and paired
 * devices, its keyboard shortcuts, its cloud box. A move leaves them out,
 * and a machine that takes one in keeps its own. */
export const MACHINE_CONFIG = ["port", "instances", "relay", "remote", "shortcuts", "box"] as const;

/** A key's place in config.json, as a person would name it. */
export function secretLabel(path: string, config: Record<string, unknown>): string {
  const provider = /^providers\.([\w-]+)\.key$/.exec(path);
  if (provider) return `${providerName(provider[1])} key`;
  const custom = /^custom\[([^\]]+)\]\.keys\[([^\]]+)\]\.key$/.exec(path);
  if (custom) {
    const host = Array.isArray(config.custom)
      ? config.custom.find((entry) => isRecord(entry) && String(entry.id) === custom[1])
      : null;
    const name = isRecord(host) && typeof host.name === "string" ? host.name : "a custom host";
    return `Key for ${name}`;
  }
  const mcp = /^mcpServers\[([^\]]+)\]\.headers$/.exec(path);
  if (mcp) {
    const server = Array.isArray(config.mcpServers)
      ? config.mcpServers.find((entry) => isRecord(entry) && String(entry.id) === mcp[1])
      : null;
    return `Headers for the ${isRecord(server) && typeof server.name === "string" ? server.name : "MCP"} server`;
  }
  const telegramBot = /^telegram\.bots\.([\w-]+)\.token$/.exec(path);
  if (telegramBot) return "A Telegram bot token";
  const known: Record<string, string> = {
    "xai.key": "Grok key",
    "composio.key": "Composio key",
    "composio.apiKey": "Composio project key",
    "speech.elevenlabsKey": "ElevenLabs key",
    "speech.openaiKey": "OpenAI speech key",
    "box.token": "Cloud box key",
    "chat.slack.botToken": "Slack bot token",
    "chat.slack.appToken": "Slack app token",
    "chat.discord.token": "Discord token",
    "chat.whatsapp.token": "WhatsApp token",
    "chat.whatsapp.appSecret": "WhatsApp app secret",
    "chat.whatsapp.verifyToken": "WhatsApp verify token",
    "telegram.token": "Telegram bot token",
    "telegram.pending.token": "Telegram bot token",
    "credits.licence": "Bloks Cloud key, for Bloks AI",
    "credits.token": "Bloks Cloud key, for Bloks AI",
  };
  return known[path] ?? path;
}

function providerName(kind: string): string {
  const names: Record<string, string> = {
    openrouter: "OpenRouter",
    gemini: "Gemini",
    grok: "Grok",
    kimi: "Kimi",
    llama: "Llama",
    deepseek: "DeepSeek",
    mistral: "Mistral",
    groq: "Groq",
    custom: "Custom host",
  };
  return names[kind] ?? kind;
}

/**
 * config.json for a move, given the copy a backup has already taken the
 * keys out of (`stripped`, with where each was) and the original, which
 * is read for names only. The machine's own sections go, and so does the
 * new-agent folder, which is a folder on that disk. Says which keys are
 * to be entered again, by name, each once.
 */
export function configForMove(
  stripped: Record<string, unknown>,
  leftOut: string[],
  original: Record<string, unknown>,
): { config: Record<string, unknown>; toEnter: string[] } {
  const config = structuredClone(stripped);
  for (const key of MACHINE_CONFIG) delete config[key];
  if (isRecord(config.agentDefaults)) delete config.agentDefaults.cwd;
  const labels = new Set<string>();
  for (const path of leftOut) {
    // the space's tokens and the paired devices stay with that computer
    // and are nothing to enter again; a new space is opened here
    if (/^(relay|remote)\./.test(path)) continue;
    if (path === "secrets") {
      const names = isRecord(original.secrets) ? Object.keys(original.secrets) : [];
      for (const name of names) labels.add(`Saved secret ${name}`);
      continue;
    }
    labels.add(secretLabel(path, original));
  }
  return { config, toEnter: [...labels] };
}

/** bots.json for a move: every agent and lane kept, without the folders
 * of the computer it leaves or the engine sessions only that computer can
 * resume. A lane whose session is gone is told the conversation so far on
 * its next turn, the way a dropped session is (store.dropSession). */
export function botsForMove(text: string): string {
  const bots = JSON.parse(text);
  if (!Array.isArray(bots)) return text;
  for (const bot of bots) {
    if (!isRecord(bot)) continue;
    delete bot.cwd;
    bot.resumeCursors = {};
    // a box or a VM on that computer, or that computer itself, is not
    // here; off stays off, anything else lets the new machine decide
    if (bot.computer !== "off") delete bot.computer;
    const tasks = Array.isArray(bot.tasks) ? bot.tasks : [];
    for (const task of tasks) {
      if (!isRecord(task)) continue;
      delete task.cwd;
      task.resumeCursors = {};
      // served by no engine in particular: the next one is told the story
      task.lastInstanceId = "";
      delete task.reading;
      delete task.pendingCompaction;
      task.busy = false;
      if (isRecord(task.imported)) task.imported.resumes = false;
    }
  }
  return `${JSON.stringify(bots, null, 2)}\n`;
}

/** bloks.json for a move: a room's desk is a folder on that disk, so the
 * room's first turn here chooses one again. */
export function roomsForMove(text: string): string {
  const rooms = JSON.parse(text);
  if (!Array.isArray(rooms)) return text;
  for (const room of rooms) {
    if (!isRecord(room)) continue;
    delete room.cwd;
    delete room.pinnedCwd;
  }
  return `${JSON.stringify(rooms, null, 2)}\n`;
}

/** projects.json for a move: a project keeps its name, people and notes,
 * and loses the folders it covered on that disk, since a project whose
 * folders are missing stops its agents rather than guess. */
export function projectsForMove(text: string): string {
  const projects = JSON.parse(text);
  if (!Array.isArray(projects)) return text;
  for (const project of projects) {
    if (isRecord(project)) project.folders = [];
  }
  return `${JSON.stringify(projects, null, 2)}\n`;
}

/** The files a move rewrites on the way out, by their path in the data
 * folder. config.json is done apart, after its keys are taken out. */
export const MOVE_REWRITES: Record<string, (text: string) => string> = {
  "bots.json": botsForMove,
  "bloks.json": roomsForMove,
  "projects.json": projectsForMove,
};

/** A config.json that arrived in a move, given the one this machine has:
 * this machine's own sections put back over it, whole. */
export function keepThisMachine(current: Record<string, unknown>, restored: Record<string, unknown>): void {
  for (const key of MACHINE_CONFIG) {
    if (current[key] === undefined) delete restored[key];
    else restored[key] = structuredClone(current[key]);
  }
}

/** Whether a workspace is empty enough to take a move in: nothing said by
 * the person, no rooms and no standing work. A first start seeds an agent
 * that greets, which is not anybody's work. */
export function emptyEnoughForMove(counts: { mine: number; rooms: number; routines: number; watchers: number; intents: number }): boolean {
  return counts.mine === 0 && counts.rooms === 0 && counts.routines === 0 && counts.watchers === 0 && counts.intents === 0;
}
