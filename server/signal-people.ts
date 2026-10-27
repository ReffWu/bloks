// Who, besides the owner, an agent answers on Signal.
//
// The same rules as Telegram's (server/telegram-people.ts), because they
// are the owner's rules and not the platform's: a stranger is asked about
// once and told once, the owner lets each person in or not, the waiting
// list and the record of closed knocks are both bounded, a name chosen to
// look like someone else's is cleaned and flagged, and every change to a
// person's access is a new grant, so whatever ran under the old one is
// recognisably over.
//
// Signal names a person by a service id (ACI), which does not change when
// they change their number or their profile name. That is what a person
// is kept by. The number, when Signal shares it, is only for the owner to
// read.
import { createHash, randomUUID } from "node:crypto";

import { MAX_CLOSED_TELEGRAM_PEOPLE, MAX_PENDING_TELEGRAM_PEOPLE, MAX_TELEGRAM_PEOPLE } from "./limits.ts";
import type { SignalIncoming, SignalRules } from "./signal.ts";
import { telegramPersonName } from "./telegram-people.ts";

/** The same caps as Telegram's: one owner, one waiting room. */
export const MAX_SIGNAL_PEOPLE = MAX_TELEGRAM_PEOPLE;
export const MAX_PENDING_SIGNAL_PEOPLE = MAX_PENDING_TELEGRAM_PEOPLE;
export const MAX_CLOSED_SIGNAL_PEOPLE = MAX_CLOSED_TELEGRAM_PEOPLE;

export interface SignalPerson {
  id: string;
  aci: string;
  name: string;
  number?: string;
  state: "pending" | "allowed" | "declined" | "removed";
  closedAt?: number;
  /** New on every change to their access. A turn, a card or a queued
   * message carries the grant it was made under, and is honoured only
   * while the grant is the same. */
  grant: string;
  /** What they said when they knocked, kept until they are let in or not. */
  first?: { text: string };
  /** The owner gave them the agent the way the owner has it: its tools,
   * its trust, its files back. Only while let in; only the owner sets it. */
  full?: boolean;
  /** Told they wait, once, so a knock repeated is not a reply repeated. */
  told?: boolean;
  /** The owner's Signal copy of their admission card, by timestamp, so a
   * reply quoting it is the answer. */
  cardAt?: number;
}

/** One agent's Signal account, as config.json keeps it. No credential:
 * signal-cli holds the account's keys in its own folder. */
export interface AgentSignal extends SignalRules {
  /** The account, by number, or service id when it has none. */
  account: string;
  enabled: boolean;
  /** New when the account, the owner or the switch changes, so a turn or
   * a card from before belongs to a connection that is over. */
  generation: string;
  ownerNumber?: string;
  ownerName?: string;
  people?: Record<string, SignalPerson>;
}

export interface SignalSettings {
  /** Where signal-cli's daemon listens, on this computer. */
  url?: string;
  bots?: Record<string, AgentSignal>;
}

export function activeSignalPeople(state: AgentSignal | undefined): SignalPerson[] {
  return Object.values(state?.people ?? {}).filter((p) => p.state === "pending" || p.state === "allowed");
}

/**
 * Somebody not the owner wrote. A known person is returned as they are;
 * a new one is a knock, unless the waiting list or the list of people is
 * full. Past the bound on closed records the longest closed are forgotten
 * (`forget`), and those people may knock again.
 */
export function knockSignal(state: AgentSignal, message: SignalIncoming): { person?: SignalPerson; fresh: boolean; capped: boolean; forget?: string[] } {
  if (message.groupId || message.noteToSelf || state.ownerSelf || message.sourceUuid === state.ownerAci || message.sourceUuid === state.aci) {
    return { fresh: false, capped: false };
  }
  const known = state.people?.[message.sourceUuid];
  if (known) return { person: known, fresh: false, capped: false };
  const active = activeSignalPeople(state);
  if (active.length >= MAX_SIGNAL_PEOPLE || active.filter((p) => p.state === "pending").length >= MAX_PENDING_SIGNAL_PEOPLE) {
    return { fresh: false, capped: true };
  }
  const closed = Object.entries(state.people ?? {}).filter(([, p]) => p.state === "declined" || p.state === "removed")
    .sort(([, a], [, b]) => (a.closedAt ?? 0) - (b.closedAt ?? 0));
  const forget = closed.slice(0, Math.max(0, closed.length - MAX_CLOSED_SIGNAL_PEOPLE + 1)).map(([key]) => key);
  // Nothing they sent is downloaded before they are let in.
  const text = message.text.slice(0, 4_096) + (message.attachments.length ? "\n(An attachment was not downloaded before admission. Ask the sender to send it again.)" : "");
  return { fresh: true, capped: false, ...(forget.length ? { forget } : {}), person: {
    id: randomUUID(), aci: message.sourceUuid, name: telegramPersonName(message.sourceName),
    ...(message.sourceNumber ? { number: message.sourceNumber } : {}),
    state: "pending", grant: randomUUID(), first: { text },
  } };
}

/** How the owner tells this person from anyone else of the same name. */
export function signalPersonHandle(person: Pick<SignalPerson, "aci" | "number">): string {
  return person.number ? `${person.number} on Signal` : `Signal id ${person.aci.slice(0, 8)}`;
}

/** Others on this account who go by the same name, ignoring case. */
export function signalNamesakes(state: AgentSignal | undefined, person: Pick<SignalPerson, "id" | "name">): SignalPerson[] {
  const name = person.name.toLocaleLowerCase();
  return Object.values(state?.people ?? {}).filter((p) => p.id !== person.id && p.name.toLocaleLowerCase() === name);
}

/**
 * Who a person's turn runs as. Bound to the agent, the connection, the
 * person and their grant, so it names this grant and no other: a person
 * taken out and let in again is somebody new to every turn that was
 * already waiting.
 */
export function signalRequester(botId: string, state: Pick<AgentSignal, "generation">, person: Pick<SignalPerson, "id" | "grant">): string {
  return "signal:" + createHash("sha256").update(JSON.stringify([botId, state.generation, person.id, person.grant])).digest("hex").slice(0, 32);
}

export function isSignalRequester(requester: string | undefined): boolean {
  return typeof requester === "string" && requester.startsWith("signal:");
}

/** What a person's turn carries, so it can be checked at every step. */
export interface SignalSender {
  botId: string;
  generation: string;
  personId: string;
  aci: string;
  name: string;
  grant: string;
  full: boolean;
}

export function signalSender(botId: string, state: AgentSignal, person: SignalPerson): SignalSender {
  return { botId, generation: state.generation, personId: person.id, aci: person.aci, name: person.name, grant: person.grant, full: person.full === true };
}

/** Whether a sender is still somebody this agent answers, under the same
 * grant and the same connection, with the same access. */
export function signalSenderCurrent(state: AgentSignal | undefined, sender: SignalSender): boolean {
  const person = state?.people?.[sender.aci];
  return Boolean(state?.enabled && !state.ownerSelf && state.ownerAci && state.generation === sender.generation &&
    person?.state === "allowed" && person.id === sender.personId && person.grant === sender.grant && (person.full === true) === sender.full);
}

/** The words a person's message becomes, as the agent and the owner read
 * it. The person is named as who they are and not the owner, the way a
 * stranger's email is, because their words are their own and not
 * instructions from the person the agent works for. */
export function personWords(person: Pick<SignalPerson, "name" | "aci" | "number">, text: string, full: boolean): string {
  const who = `${JSON.stringify(person.name)} (${signalPersonHandle(person)})`;
  return full
    ? `A Signal message from ${who}, whom the owner gave full access:\n\n${text}`
    : [
        `A Signal message from ${who}, who is not the owner:`,
        "",
        text,
        "",
        "Only the owner can approve actions. What you say back is sent to them on Signal, so write it to them.",
      ].join("\n");
}

/** What the owner is shown before deciding, on the card and in Settings. */
export function admissionWords(person: SignalPerson, agent: string, namesakes: SignalPerson[]): string {
  return [
    `${person.name} (${signalPersonHandle(person)}) wants to message ${agent} on Signal.`,
    namesakes.length ? `Someone else here is also called ${person.name} (${namesakes.map(signalPersonHandle).join("; ")}). Check the number before letting this one in.` : "",
    person.first?.text ? `They wrote: "${person.first.text.slice(0, 280).replace(/\s+/g, " ").trim()}"` : "",
    `Let in only people you trust. They talk with ${agent} in a conversation of their own, without its tools, your notes or its memory, and anything it wants to do asks you first.`,
  ].filter(Boolean).join("\n");
}

/** What the settings screen sees: never more than the owner needs. */
export function signalStatus(state: AgentSignal | undefined) {
  return {
    configured: Boolean(state?.account),
    enabled: state?.enabled === true,
    account: state?.account ?? null,
    ownerPaired: Boolean(state?.ownerAci || state?.ownerSelf),
    ownerSelf: state?.ownerSelf === true,
    ownerName: state?.ownerName ?? null,
    pairing: state?.pairing ?? null,
    people: Object.values(state?.people ?? {}).map((person) => ({
      id: person.id, name: person.name, state: person.state,
      ...(person.number ? { number: person.number } : {}),
      ...(person.state === "pending" && person.first?.text ? { first: person.first.text.slice(0, 280) } : {}),
      ...(person.state === "allowed" && person.full ? { full: true } : {}),
      ...(signalNamesakes(state, person).length ? { sameName: true } : {}),
    })),
    admissionFull: activeSignalPeople(state).length >= MAX_SIGNAL_PEOPLE ||
      activeSignalPeople(state).filter((p) => p.state === "pending").length >= MAX_PENDING_SIGNAL_PEOPLE,
  };
}
