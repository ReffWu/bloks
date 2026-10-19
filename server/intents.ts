// Standing intents: whenever something comes up in a conversation, do
// something about it.
//
// Bloks has two ways to start work without anybody typing. A routine
// starts it at a time (server/routines.ts); a watcher starts it when
// something outside changes (server/watchers.ts). Neither fits the third
// thing people ask for, which is about what is said: "whenever someone
// mentions the launch date, loop in the Head of Marketing", "whenever a
// customer refund comes up, remind me of the refund policy". The trigger
// is a conversation, and the work is small.
//
// So an intent is a few words or phrases, the conversations it listens
// in, and one of three things to do when a new message in one of them
// says one of the phrases:
//
//   note      a note in that conversation, in the person's own words
//             ("Refunds: full refund within 30 days, no questions")
//   mention   an agent brought into it: woken in the room when it is a
//             member, or sent the excerpt when it cannot be (a 1:1
//             conversation has room for one agent)
//   message   a short message to an agent, in its own first conversation
//
// Matching is words, not a model: each phrase, any case, on word
// boundaries, so "launch" does not fire on "relaunched" and costs nothing
// to check on every message. A word ending in * matches its stem
// ("refund*" is refund, refunds, refunded).
//
// What keeps a sentence from turning into a loop, or into noise:
//
//   Each intent fires at most once a day in any one conversation (the
//   cooldown, 24 hours unless set otherwise), and at most three times a
//   day in all.
//
//   It never fires on its own output or another intent's: every note it
//   posts and every message it sends is marked as an intent's, and so is
//   what an agent says in a turn one of them started.
//
//   It ends. Ninety days after it is made, renewed or approved it stops
//   listening until the person renews it, so last quarter's launch does
//   not keep calling marketing in forever.
//
//   An agent may propose one (`bloks intent`), and a proposal does
//   nothing until the person approves it in Automations.
//
// Everything here is pure; the server stores intents, hears messages and
// carries out what they ask.

/** How long an intent listens before it has to be renewed. */
export const INTENT_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
/** The default quiet time in one conversation after a fire, and its bounds. */
export const DEFAULT_COOLDOWN_HOURS = 24;
export const MIN_COOLDOWN_HOURS = 1;
export const MAX_COOLDOWN_HOURS = 7 * 24;
/** Fires per intent in any 24 hours, wherever they happen. */
export const MAX_FIRES_PER_DAY = 3;
export const MAX_INTENTS = 50;
/** Proposals one agent may have waiting at once. */
export const MAX_PROPOSED_PER_AGENT = 5;
export const MAX_PHRASES = 12;
export const MAX_PHRASE = 60;
export const MAX_ACTION_TEXT = 600;
const MAX_NAME = 60;
/** Fires remembered per intent: enough for its history and its limits. */
const KEEP_FIRES = 20;
/** How much of a long message is looked at. */
const MATCH_CHARS = 20_000;

export type IntentAction =
  | { kind: "note"; text: string }
  | { kind: "mention"; botId: string; text?: string }
  | { kind: "message"; botId: string; text: string };

/** Where an intent listens. Everywhere is every agent's own conversations
 * and every room nobody else was invited into; a room shared with other
 * people is listened in only when it is named. */
export type IntentCovers = { everywhere: true } | { agents: string[]; rooms: string[] };

export interface IntentFire {
  at: number;
  threadId: string;
  messageId: string;
  phrase: string;
  /** A few words around what was said, for the history. */
  excerpt: string;
  /** Set when the action could not be carried out. */
  error?: string;
}

export interface Intent {
  id: string;
  name: string;
  phrases: string[];
  covers: IntentCovers;
  action: IntentAction;
  cooldownHours: number;
  /** The person's pause switch. */
  enabled: boolean;
  /** An agent's proposal waits for the person; only an active intent fires. */
  status: "active" | "proposed";
  createdAt: number;
  /** When it stops listening, until renewed. */
  expiresAt: number;
  by: { kind: "person" } | { kind: "agent"; botId: string; name: string };
  /** Newest first. */
  fires: IntentFire[];
}

// ── matching ───────────────────────────────────────────────────────────

const LETTER = "[\\p{L}\\p{N}_]";
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A phrase as it is kept: one line, its quotes and spare spaces gone. */
export function cleanPhrase(raw: unknown): string {
  return String(raw ?? "")
    .replace(/["“”]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PHRASE);
}

/** The pattern for one phrase: its words in order, any case, whole words,
 * any run of spaces or a hyphen between them, and a word ending in * open
 * at its end. Null for a phrase with no word in it. */
export function phrasePattern(phrase: string): RegExp | null {
  const words = cleanPhrase(phrase)
    .split(/[\s-]+/)
    .map((w) => w.trim())
    .filter((w) => w && w !== "*");
  if (!words.length || !words.some((w) => new RegExp(LETTER, "u").test(w))) return null;
  const parts = words.map((word) => (word.endsWith("*") ? `${escape(word.slice(0, -1))}${LETTER}*` : escape(word)));
  return new RegExp(`(?<!${LETTER})${parts.join("[\\s-]+")}(?!${LETTER})`, "iu");
}

/** The first phrase a text says, and where, or null. */
export function matchPhrases(text: string, phrases: string[]): { phrase: string; index: number; length: number } | null {
  const looked = text.slice(0, MATCH_CHARS);
  for (const phrase of phrases) {
    const found = phrasePattern(phrase)?.exec(looked);
    if (found) return { phrase, index: found.index, length: found[0].length };
  }
  return null;
}

/** A few words either side of a match, on one line. */
export function excerptAround(text: string, at: { index: number; length: number }, room = 160): string {
  const side = Math.max(20, Math.floor((room - at.length) / 2));
  const start = Math.max(0, at.index - side);
  const end = Math.min(text.length, at.index + at.length + side);
  const cut = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${cut}${end < text.length ? "…" : ""}`;
}

// ── who it listens to, and when it may speak ───────────────────────────

/** Where a message was said: a room (and whether it is shared with other
 * people), or one of an agent's own conversations. */
export type Where = { roomId: string; shared: boolean } | { botId: string };

export function coversWhere(intent: Pick<Intent, "covers">, where: Where): boolean {
  if ("everywhere" in intent.covers) return "botId" in where || !where.shared;
  return "botId" in where ? intent.covers.agents.includes(where.botId) : intent.covers.rooms.includes(where.roomId);
}

export type FireRefusal = "paused" | "proposed" | "expired" | "cooldown" | "daily";

/** Whether an intent may fire in this conversation now, or why not. */
export function mayFire(intent: Intent, threadId: string, now: number): { ok: true } | { ok: false; why: FireRefusal } {
  if (intent.status !== "active") return { ok: false, why: "proposed" };
  if (!intent.enabled) return { ok: false, why: "paused" };
  if (now >= intent.expiresAt) return { ok: false, why: "expired" };
  const day = 24 * 60 * 60 * 1000;
  if (intent.fires.filter((f) => now - f.at < day).length >= MAX_FIRES_PER_DAY) return { ok: false, why: "daily" };
  const quiet = intent.cooldownHours * 60 * 60 * 1000;
  if (intent.fires.some((f) => f.threadId === threadId && now - f.at < quiet)) return { ok: false, why: "cooldown" };
  return { ok: true };
}

/** The fire, recorded: newest first, a bounded few. */
export function recordFire(intent: Intent, fire: IntentFire) {
  intent.fires = [fire, ...intent.fires].slice(0, KEEP_FIRES);
}

// ── what it says ───────────────────────────────────────────────────────

/** What an agent is told when an intent brings it in or writes to it. Its
 * own words after the line saying where it came from, like a watcher's,
 * so the agent can tell a standing instruction from a person talking. */
export function agentTurnText(input: {
  intent: Pick<Intent, "name" | "action">;
  phrase: string;
  where: string;
  who: string;
  excerpt: string;
  /** The agent could not be brought into the conversation itself. */
  outside?: boolean;
}): string {
  const asked = input.intent.action.kind === "note" ? "" : (input.intent.action.text ?? "").trim();
  const lead =
    input.intent.action.kind === "mention"
      ? input.outside
        ? `Your standing intent "${input.intent.name}" asked for you to be looped in, but you cannot join that conversation, so here is what was said.`
        : `Your standing intent "${input.intent.name}" brought you into this conversation.`
      : `Your standing intent "${input.intent.name}" was set off.`;
  return [
    lead,
    `"${input.phrase}" came up in ${input.where}, from ${input.who}:`,
    `> ${input.excerpt}`,
    "",
    ...(asked ? [`What you were asked to do when this happens: ${asked}`, ""] : []),
    "If this does not need you, say so in one line and stop.",
  ].join("\n");
}

// ── checking what is asked for ─────────────────────────────────────────

export type IntentFields = Pick<Intent, "name" | "phrases" | "covers" | "action" | "cooldownHours">;

/** Phrases from a list or a comma separated string, cleaned, without
 * repeats, and only those that have a word in them. */
export function phrasesFrom(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,;\n]/) : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const phrase = cleanPhrase(item);
    if (!phrase || !phrasePattern(phrase) || seen.has(phrase.toLowerCase())) continue;
    seen.add(phrase.toLowerCase());
    out.push(phrase);
  }
  return out;
}

/**
 * A request's intent, checked, or what is wrong with it. `base` is the
 * intent being changed, whose fields stand where the request leaves one
 * out. Agents and rooms are checked against what exists through `has`.
 */
export function cleanIntent(
  raw: Record<string, unknown>,
  has: { agent: (id: string) => boolean; room: (id: string) => boolean },
  base?: IntentFields,
): { ok: true; value: IntentFields } | { ok: false; error: string } {
  const phrases = raw.phrases !== undefined || raw.when !== undefined ? phrasesFrom(raw.phrases ?? raw.when) : (base?.phrases ?? []);
  if (!phrases.length) return { ok: false, error: "say which words or phrases to listen for" };
  if (phrases.length > MAX_PHRASES) return { ok: false, error: `an intent listens for at most ${MAX_PHRASES} phrases` };

  let covers: IntentCovers;
  const asked = raw.covers;
  if (asked === undefined) covers = base?.covers ?? { everywhere: true };
  else if (asked === "everywhere" || (isRecord(asked) && asked.everywhere === true)) covers = { everywhere: true };
  else if (isRecord(asked)) {
    const ids = (value: unknown) => (Array.isArray(value) ? [...new Set(value.filter((x): x is string => typeof x === "string"))] : []);
    const agents = ids(asked.agents);
    const rooms = ids(asked.rooms);
    if (!agents.length && !rooms.length) return { ok: false, error: "name at least one agent or room to listen in, or listen everywhere" };
    if (agents.length + rooms.length > 50) return { ok: false, error: "an intent listens in at most 50 places; listen everywhere instead" };
    const missing = [...agents.filter((id) => !has.agent(id)), ...rooms.filter((id) => !has.room(id))];
    if (missing.length) return { ok: false, error: `no agent or room ${missing[0]}` };
    covers = { agents, rooms };
  } else return { ok: false, error: "covers is everywhere, or the agents and rooms to listen in" };

  let action: IntentAction;
  const a = raw.action === undefined ? base?.action : raw.action;
  if (!isRecord(a)) return { ok: false, error: "say what to do: a note, a mention or a message" };
  const text = typeof a.text === "string" ? a.text.trim() : "";
  if (text.length > MAX_ACTION_TEXT) return { ok: false, error: `what it says is at most ${MAX_ACTION_TEXT} characters` };
  if (a.kind === "note") {
    if (!text) return { ok: false, error: "a note needs the words to post" };
    action = { kind: "note", text };
  } else if (a.kind === "mention" || a.kind === "message") {
    const botId = typeof a.botId === "string" ? a.botId : "";
    if (!has.agent(botId)) return { ok: false, error: "no such agent to bring in" };
    if (a.kind === "message") {
      if (!text) return { ok: false, error: "a message needs the words to send" };
      action = { kind: "message", botId, text };
    } else action = { kind: "mention", botId, ...(text ? { text } : {}) };
  } else return { ok: false, error: "action.kind is note, mention or message" };

  const hours = raw.cooldownHours === undefined ? (base?.cooldownHours ?? DEFAULT_COOLDOWN_HOURS) : Number(raw.cooldownHours);
  if (!Number.isFinite(hours) || hours < MIN_COOLDOWN_HOURS || hours > MAX_COOLDOWN_HOURS) {
    return { ok: false, error: `the cooldown is ${MIN_COOLDOWN_HOURS} to ${MAX_COOLDOWN_HOURS} hours` };
  }
  const named = typeof raw.name === "string" ? raw.name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME) : "";
  const name = named || (raw.name === undefined ? base?.name : undefined) || phrases[0].slice(0, MAX_NAME);
  return { ok: true, value: { name, phrases, covers, action, cooldownHours: Math.round(hours) } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** What a client is shown: the intent, and what it is doing now in words
 * a list row can say. */
export function intentView(intent: Intent, now: number) {
  const day = 24 * 60 * 60 * 1000;
  const state: "proposed" | "paused" | "expired" | "listening" =
    intent.status === "proposed" ? "proposed" : !intent.enabled ? "paused" : now >= intent.expiresAt ? "expired" : "listening";
  return {
    ...intent,
    state,
    firesToday: intent.fires.filter((f) => now - f.at < day).length,
  };
}
