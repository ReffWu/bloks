// The incident desk: when something fails, somebody hears about it.
//
// A turn that ended in an error, a tool call that went silent past its
// limit, a routine, a watcher or a workflow that failed: each of those
// used to leave a notice where it happened and nothing else. A notice in
// a conversation nobody has open is a failure nobody finds out about
// until the morning, or the week after, when the thing it was meant to do
// turns out not to have been done.
//
// So a failure becomes an incident: what failed, where, why and when, on
// a list (incidents.json). And it goes to whoever leads. In a room that
// is the room's lead (leadOf in server/bloks.ts). For one agent on its
// own it is the workspace's lead: the agent the person named for this,
// or the one agent clearly more senior than all the others, the way a
// chief of staff is. When there is nobody like that, or the one who
// leads is the one who failed, it goes straight to the person.
//
// A lead is handed one quiet turn, written as a note from Bloks and
// never as the person's words, with three things it can do through the
// command line: try the failed thing once more, hand it to a teammate,
// or tell the person what is needed, which is a card in the chat that
// Activity and the brief list too. A lead that does none of those, or
// whose own turn fails, has not settled it, and the person gets the card.
//
// What keeps this from becoming a failure of its own is the storm rules,
// all here and all pure, so they can be read in one place and tested:
//
//   The same thing failing again while its incident is open is the same
//   incident, counted, not a new one. Nothing about an incident, its
//   lead's turn or its retry failing, ever starts another.
//
//   One automatic retry per failed thing in a day, and two per
//   conversation in a day, whoever asked for them.
//
//   Past five incidents in an hour the desk goes quiet: what fails after
//   that is listed but handed to nobody, and the person gets one card
//   that says so and keeps count, rather than five more.
//
// The person can switch the desk off, or say who leads incidents
// (`incidents` in config.json). Off means none of this happens, exactly
// as before it existed.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { readSaved, writeFileAtomic } from "./atomic-write.ts";
import { DATA_DIR } from "./config.ts";
import { newId } from "./contracts.ts";

export type IncidentKind = "turn" | "stall" | "routine" | "watcher" | "workflow";

/**
 * Where an incident is in its life.
 *
 *   with-lead   the lead has it: its quiet turn is waiting or running
 *   retrying    tried once more, and how that goes decides the rest
 *   needs-you   the person has a card
 *   muted       raised while the desk was quiet: listed, handed to nobody
 *   resolved    over, one way or another (`resolution` says which)
 *
 * Handing it to a teammate settles it as far as the desk goes: resolved,
 * with `handedTo` saying who has it. What the teammate does is its own
 * work, and its own failure if it fails, not this one carried on.
 */
export type IncidentState = "with-lead" | "retrying" | "needs-you" | "muted" | "resolved";

export type IncidentLead = { kind: "agent"; id: string; name: string } | { kind: "person" };

/** The ids that say where it happened. Whatever applies is set. */
export interface IncidentWhere {
  botId?: string;
  botName?: string;
  laneId?: string;
  roomId?: string;
  routineId?: string;
  watcherId?: string;
  workflowId?: string;
  runId?: string;
}

export interface Incident {
  id: string;
  kind: IncidentKind;
  /** What failed, as a key: the same thing failing again finds this one
   * ("turn:<lane>", "routine:<id>"). */
  subject: string;
  /** The conversation its retries are counted against, per day. */
  thread: string;
  /** What failed, as a person says it: "Sage's turn in General". */
  title: string;
  /** Why, in the failure's own words, redacted and cut short. */
  why: string;
  /** When it first failed, and when it last did. */
  at: number;
  lastAt: number;
  /** How many times it failed while this incident was open. */
  count: number;
  where: IncidentWhere;
  lead: IncidentLead;
  state: IncidentState;
  /** When an automatic retry was made for it, if one was. */
  retriedAt?: number;
  /** The teammate it was handed to, and what the lead asked of them.
   * Set as it is resolved by the handing. */
  handedTo?: { id: string; name: string; note?: string };
  /** What the person is asked, in the lead's words or Bloks' own. */
  needs?: string;
  /** The needs-you card in a chat, once there is one. `base` is the
   * words of the failure's own notice when the card is that notice (see
   * cardLine), so what is added later is added to them, not over them. */
  card?: { threadId: string; messageId: string; base?: string };
  resolvedAt?: number;
  /** How it ended, in a few words, for the list. */
  resolution?: string;
}

/** The single card the person gets while the desk is quiet. */
export interface MuteSummary {
  at: number;
  lastAt: number;
  /** Incidents raised while quiet, the one that started it included. */
  count: number;
  card?: { threadId: string; messageId: string };
}

/** One automatic retry per failed thing in a rolling day. */
export const RETRIES_PER_THING = 1;
/** Automatic retries in one conversation in a rolling day. */
export const RETRIES_PER_THREAD = 2;
/** Incidents in an hour before the desk goes quiet. */
export const MUTE_AFTER = 5;
export const HOUR_MS = 60 * 60_000;
export const DAY_MS = 24 * HOUR_MS;
/** How long a lead has an incident before it is the person's anyway.
 * Its quiet turn settles it as soon as it ends; this is for a turn that
 * never started, a lane that stayed busy, or a restart in between. */
export const LEAD_WAIT_MS = 30 * 60_000;
/** How much of a failure's words an incident keeps. */
export const WHY_MAX = 300;
/** How much a lead may say to the person, or to a teammate. */
export const NEEDS_MAX = 600;
/** Incidents kept on the list: enough for a bad week, then the oldest
 * resolved ones go. */
export const MAX_INCIDENTS = 200;

const INCIDENTS_FILE = join(DATA_DIR, "incidents.json");

// ── who leads ──────────────────────────────────────────────────────────

export interface LeadCandidate {
  id: string;
  name: string;
  seniority?: number;
  /** It can take an incident now: listed, not archived or held, and on
   * an engine that runs the command line it would answer with. */
  able: boolean;
}

/** The person's choice: "auto" (a room's lead, else the workspace's most
 * senior agent), "person" (always the person), or an agent's id. */
export type LeadSetting = "auto" | "person" | string;

/**
 * Who an incident goes to.
 *
 * A room's lead first, since a room is where somebody already leads. For
 * work outside a room, the agent the person named, and otherwise the one
 * agent more senior than every other: one level above the rest is a
 * chief of staff, and a tie at the top is nobody in particular, so the
 * person hears it themselves. Never the agent that failed, which would
 * be asking it to judge its own failure, and never one that cannot act.
 */
export function chooseLead(input: {
  setting?: LeadSetting;
  /** The agent whose work failed, when an agent's did. */
  failing?: string;
  /** In a room: its lead, already chosen with leadOf. */
  roomLead?: LeadCandidate | null;
  agents: readonly LeadCandidate[];
}): IncidentLead {
  const setting = input.setting ?? "auto";
  if (setting === "person") return { kind: "person" };
  const fits = (c: LeadCandidate | null | undefined): c is LeadCandidate => Boolean(c && c.able && c.id !== input.failing);
  if (fits(input.roomLead)) return { kind: "agent", id: input.roomLead.id, name: input.roomLead.name };
  if (setting !== "auto") {
    const named = input.agents.find((a) => a.id === setting);
    return fits(named) ? { kind: "agent", id: named.id, name: named.name } : { kind: "person" };
  }
  const top = Math.max(0, ...input.agents.map((a) => a.seniority ?? 1));
  const atTop = input.agents.filter((a) => (a.seniority ?? 1) === top);
  const chief = atTop.length === 1 ? atTop[0] : null;
  return fits(chief) ? { kind: "agent", id: chief.id, name: chief.name } : { kind: "person" };
}

// ── the storm rules ────────────────────────────────────────────────────

/** Whether a failed thing may be tried once more automatically now, or
 * why not, in words a lead can pass on. */
export function retryRefusal(all: readonly Incident[], incident: Incident, now: number): string | null {
  if (incident.state === "resolved") return "this incident is already resolved";
  if (incident.retriedAt !== undefined) return "this has already been tried once more, which is all an incident gets";
  const day = now - DAY_MS;
  const sameThing = all.filter((i) => i.subject === incident.subject && (i.retriedAt ?? 0) > day).length;
  if (sameThing >= RETRIES_PER_THING) return "this already had its one retry today";
  const sameThread = all.filter((i) => i.thread === incident.thread && (i.retriedAt ?? 0) > day).length;
  if (sameThread >= RETRIES_PER_THREAD) return `this conversation already had its ${RETRIES_PER_THREAD} retries today`;
  return null;
}

/** Incidents raised (not counted onto an open one) in the last hour. */
export function raisedInHour(all: readonly Incident[], now: number): number {
  return all.filter((i) => now - i.at < HOUR_MS).length;
}

/** Whether the desk is quiet now: the next incident is listed and handed
 * to nobody. */
export function muted(all: readonly Incident[], now: number): boolean {
  return raisedInHour(all, now) >= MUTE_AFTER;
}

/** Not over yet. */
export function isOpen(incident: Pick<Incident, "state">): boolean {
  return incident.state !== "resolved";
}

// ── words ──────────────────────────────────────────────────────────────

/** A failure's words as an incident keeps them: one line, cut short. */
export function whyOf(text: string | null | undefined): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
  if (!flat) return "it did not finish";
  return flat.length > WHY_MAX ? `${flat.slice(0, WHY_MAX - 1).trimEnd()}…` : flat;
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * What the lead's quiet turn says. A note from Bloks, in the turn's own
 * words and never the system prompt, naming what failed and the three
 * ways to deal with it, and asking for QUIET at the end so the turn folds
 * away like a check-in that found nothing: whatever the lead chooses is
 * what the person sees, not the lead thinking about it.
 */
export function leadNote(incident: Incident, command: string): string {
  const where = incident.where.roomId ? " in a room you lead" : "";
  const many = incident.count > 1 ? ` It has failed ${incident.count} times.` : "";
  return [
    `(A note from Bloks, not from the person: something failed${where}, and you lead, so it comes to you first. Incident ${incident.id}.)`,
    "",
    `What failed: ${incident.title}`,
    `Why: ${incident.why}`,
    `When: ${clock(incident.lastAt)}.${many}`,
    "",
    "Choose one, with the bloks command:",
    `- \`${command} incident retry ${incident.id}\` tries it once more. Only once; if it fails again the person is told.`,
    `- \`${command} incident hand ${incident.id} <agent id> "<what to do>"\` gives it to a teammate.`,
    `- \`${command} incident tell ${incident.id} "<what you need from the person>"\` asks the person, in a card they will see.`,
    "",
    "Then answer with exactly QUIET. If you choose none of these, the person is told it failed.",
  ].join("\n");
}

/** What a teammate is sent when the lead hands an incident on. */
export function handText(incident: Incident, leadName: string, note: string): string {
  return [
    `${leadName} is handing you something that failed (incident ${incident.id}).`,
    `What failed: ${incident.title}`,
    `Why: ${incident.why}`,
    ...(note.trim() ? [`What ${leadName} asks: ${note.trim()}`] : []),
  ].join("\n");
}

/** Why the person is being asked, said on their card. */
export type CardReason = "direct" | "lead" | "retry-failed" | "unsettled" | "lead-failed";

/** The words on a needs-you card, which a phone shows as they are. */
export function cardText(incident: Incident, reason: CardReason): string {
  const lead = incident.lead.kind === "agent" ? incident.lead.name : "";
  switch (reason) {
    case "lead":
      return `${incident.title} failed: ${incident.why}. ${lead} looked at it and needs you: ${incident.needs ?? "a decision"}`;
    case "retry-failed":
      return `${incident.title} failed, and failed again when it was tried once more: ${incident.why}.`;
    case "unsettled":
      return `${incident.title} failed: ${incident.why}. ${lead} did not settle it, so it is with you.`;
    case "lead-failed":
      return `${incident.title} failed: ${incident.why}. ${lead} could not look at it, so it is with you.`;
    default:
      return `${incident.title} failed: ${incident.why}.`;
  }
}

/**
 * What a card adds to the failure's own notice when it is that notice.
 * A failed turn has already said what went wrong, in a notice, and a
 * second notice saying it again is the "one per layer" the conversation
 * keeps out; so the desk marks that notice as the card, and only says
 * what is new: what the lead needs, that a retry failed too, or that the
 * lead did not settle it. Null when there is nothing to add.
 */
export function cardLine(incident: Incident, reason: CardReason): string | null {
  const lead = incident.lead.kind === "agent" ? incident.lead.name : "";
  switch (reason) {
    case "lead":
      return `${lead} looked at it and needs you: ${incident.needs ?? "a decision"}`;
    case "retry-failed":
      return `It failed again when it was tried once more: ${incident.why}.`;
    case "unsettled":
      return `${lead} did not settle it, so it is with you.`;
    case "lead-failed":
      return `${lead} could not look at it, so it is with you.`;
    default:
      return null;
  }
}

/** The one card while the desk is quiet. */
export function summaryText(count: number): string {
  return `${count} things failed in the last hour, so Bloks has stopped handing them to leads for now. Each one is listed in Activity.`;
}

// ── storage ───────────────────────────────────────────────────────────

/** How raising a failure turned out, for the caller to act on. */
export type Raised =
  /** A new incident, to be handed to its lead or put to the person. */
  | { outcome: "new"; incident: Incident }
  /** The same thing again while its incident is open: counted, nothing more. */
  | { outcome: "counted"; incident: Incident }
  /** Its one retry failed: the person is told, and nobody else. */
  | { outcome: "retry-failed"; incident: Incident }
  /** Raised while the desk is quiet: listed, and the summary counts it. */
  | { outcome: "muted"; incident: Incident; summary: MuteSummary; first: boolean };

export interface RaiseInput {
  kind: IncidentKind;
  subject: string;
  thread: string;
  title: string;
  why: string;
  where: IncidentWhere;
}

export class IncidentStore {
  incidents: Incident[] = [];
  summary: MuteSummary | null = null;

  private file: string;

  constructor(file = INCIDENTS_FILE) {
    this.file = file;
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const saved = readSaved<{ incidents?: unknown; summary?: unknown }>(this.file, {}, (v) => typeof v === "object" && v !== null && !Array.isArray(v));
    this.incidents = Array.isArray(saved.incidents) ? saved.incidents.filter(isIncident) : [];
    this.summary = isSummary(saved.summary) ? saved.summary : null;
  }

  private save() {
    writeFileAtomic(this.file, JSON.stringify({ incidents: this.incidents, summary: this.summary }, null, 2), 0o600);
  }

  get(id: string): Incident | null {
    return this.incidents.find((i) => i.id === id) ?? null;
  }

  /** The open incident for this thing, if there is one. */
  openFor(subject: string): Incident | null {
    return this.incidents.find((i) => i.subject === subject && isOpen(i)) ?? null;
  }

  /** Newest first. */
  list(): Incident[] {
    return [...this.incidents].sort((a, b) => b.lastAt - a.lastAt);
  }

  open(): Incident[] {
    return this.list().filter(isOpen);
  }

  /**
   * A failure arrives. The same thing again while it is open is counted
   * onto it, and its retry failing turns it to the person; anything else
   * is a new incident, handed to `lead` unless the desk is quiet.
   */
  raise(input: RaiseInput, lead: IncidentLead, now: number): Raised {
    const open = this.openFor(input.subject);
    if (open) {
      open.count++;
      open.lastAt = now;
      open.why = whyOf(input.why);
      const retried = open.state === "retrying";
      if (retried) open.state = "needs-you";
      this.save();
      return retried ? { outcome: "retry-failed", incident: open } : { outcome: "counted", incident: open };
    }
    const quiet = muted(this.incidents, now);
    const incident: Incident = {
      id: newId(),
      kind: input.kind,
      subject: input.subject,
      thread: input.thread,
      title: input.title.slice(0, 160),
      why: whyOf(input.why),
      at: now,
      lastAt: now,
      count: 1,
      where: input.where,
      lead: quiet ? { kind: "person" } : lead,
      state: quiet ? "muted" : lead.kind === "agent" ? "with-lead" : "needs-you",
    };
    this.incidents.push(incident);
    this.trim();
    if (!quiet) {
      this.save();
      return { outcome: "new", incident };
    }
    // One card for the whole quiet stretch: a new one only when the last
    // was more than an hour ago.
    // It counts what failed in the hour, so the card's number is the one
    // the person would get by counting the list.
    const first = !this.summary || now - this.summary.lastAt >= HOUR_MS;
    const count = raisedInHour(this.incidents, now);
    this.summary = first ? { at: now, lastAt: now, count } : { ...this.summary!, lastAt: now, count };
    this.save();
    return { outcome: "muted", incident, summary: this.summary, first };
  }

  update(id: string, change: (incident: Incident) => void): Incident | null {
    const incident = this.get(id);
    if (!incident) return null;
    change(incident);
    this.save();
    return incident;
  }

  resolve(id: string, resolution: string, now: number): Incident | null {
    return this.update(id, (incident) => {
      if (incident.state === "resolved") return;
      incident.state = "resolved";
      incident.resolvedAt = now;
      incident.resolution = resolution.slice(0, 120);
    });
  }

  /** The thing worked: its open incident, in one of these states, is
   * over. Null when there was none. */
  resolveSubject(subject: string, states: readonly IncidentState[], resolution: string, now: number): Incident | null {
    const open = this.openFor(subject);
    if (!open || !states.includes(open.state)) return null;
    return this.resolve(open.id, resolution, now);
  }

  setSummaryCard(card: { threadId: string; messageId: string; base?: string }) {
    if (!this.summary) return;
    this.summary.card = card;
    this.save();
  }

  /** Oldest resolved ones go first, so an open incident is never lost to
   * a busy week. */
  private trim() {
    while (this.incidents.length > MAX_INCIDENTS) {
      const settled = this.incidents.filter((i) => !isOpen(i)).sort((a, b) => a.lastAt - b.lastAt)[0];
      const drop = settled ?? [...this.incidents].sort((a, b) => a.lastAt - b.lastAt)[0];
      this.incidents = this.incidents.filter((i) => i !== drop);
    }
  }
}

const STATES: readonly IncidentState[] = ["with-lead", "retrying", "needs-you", "muted", "resolved"];
const KINDS: readonly IncidentKind[] = ["turn", "stall", "routine", "watcher", "workflow"];

/** incidents.json is a file a person can open, so it is checked rather
 * than trusted. A malformed entry is dropped. */
function isIncident(value: unknown): value is Incident {
  const i = value as Incident | null;
  return (
    typeof i === "object" && i !== null &&
    typeof i.id === "string" && typeof i.subject === "string" && typeof i.thread === "string" &&
    typeof i.title === "string" && typeof i.why === "string" &&
    typeof i.at === "number" && typeof i.lastAt === "number" && typeof i.count === "number" &&
    KINDS.includes(i.kind) && STATES.includes(i.state) &&
    typeof i.where === "object" && i.where !== null &&
    typeof i.lead === "object" && i.lead !== null && (i.lead.kind === "person" || (i.lead.kind === "agent" && typeof i.lead.id === "string"))
  );
}

function isSummary(value: unknown): value is MuteSummary {
  const s = value as MuteSummary | null;
  return typeof s === "object" && s !== null && typeof s.at === "number" && typeof s.lastAt === "number" && typeof s.count === "number";
}

/** An incident as the person's clients read it: everything but nothing
 * extra, since nothing on it is secret, plus whether it is open. */
export function incidentView(incident: Incident) {
  return { ...incident, open: isOpen(incident) };
}
