// Reaching your agents from Signal.
//
// The same idea as Telegram (server/telegram.ts): a message from a phone
// becomes a turn, the answer goes back to the chat it came from, and the
// conversation lands in the same thread as everything else. What is
// different is who holds the account.
//
// Signal has no bots. An account is a phone number, and its keys live on
// the devices linked to it. So Bloks never holds a Signal credential at
// all: signal-cli does, on this computer, in its own data folder, linked
// to an account as a secondary device the way Signal Desktop is. Bloks
// talks to its JSON-RPC daemon over loopback HTTP: POST /api/v1/rpc for
// everything it asks, and GET /api/v1/events, a stream of what arrived.
// Nothing new listens, nothing reaches the internet from here, and
// unlinking the device in Signal on the phone ends it for good.
//
// Two shapes of account, told apart by where the pairing word arrives:
//
//   A Signal account for the agent, on a number of its own. The owner
//   messages it from their own Signal, like a contact. Other people can
//   message it too, and the people rules (server/signal-people.ts) decide
//   who is answered.
//
//   The owner's own account. Then the agent is in Note to Self, and
//   nothing else: every other conversation on that account is the owner's
//   life, and is dropped here before anything reads it.
//
// The rules are pure (decide) so they can be read in one place and tested
// without signal-cli; the transport below only moves bytes.
import { randomInt } from "node:crypto";

import { messages as formatted } from "./telegram-format.ts";

/** One message, reduced to what the agent and the rules need. */
export interface SignalIncoming {
  /** The linked account it arrived on, as signal-cli names it. */
  account: string;
  /** Who sent it. A service id (ACI) is the one name that does not
   * change: numbers can be hidden or moved, profile names chosen freely. */
  sourceUuid: string;
  sourceNumber?: string;
  sourceName: string;
  /** Signal names a message by its sender's timestamp. A reply quotes it,
   * a remote delete names it, and two messages from one sender never
   * share one. */
  timestamp: number;
  text: string;
  attachments: SignalAttachment[];
  /** In a group. Nothing one to one ever answers a group message. */
  groupId?: string;
  /** The timestamp of the message this one replies to, when it quotes. */
  quoteId?: number;
  /** Service ids of the people mentioned, for a room carried into a group. */
  mentions: string[];
  /** Something the account itself sent from another of its devices, to
   * itself: Note to Self. Only these sync messages are ever read. */
  noteToSelf?: boolean;
}

export interface SignalAttachment {
  id: string;
  contentType: string;
  filename?: string;
  size: number;
  /** Signal marks a recording made with the microphone button. */
  voiceNote?: boolean;
}

const str = (value: unknown, max: number): string | undefined => (typeof value === "string" && value ? value.slice(0, max) : undefined);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A service id as signal-cli writes it, or undefined. */
export function serviceId(value: unknown): string | undefined {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : undefined;
}

/** A phone number in E.164, or undefined. */
export function phoneNumber(value: unknown): string | undefined {
  return typeof value === "string" && /^\+[1-9]\d{6,14}$/.test(value) ? value : undefined;
}

function attachmentsOf(raw: unknown): SignalAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: SignalAttachment[] = [];
  for (const item of raw.slice(0, 10)) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    const id = str(a.id, 200);
    // an id is a file name in signal-cli's folder: nothing that could
    // climb out of it is passed back to ask for
    if (!id || !/^[\w.-]+$/.test(id)) continue;
    const size = Number(a.size);
    out.push({
      id,
      contentType: (str(a.contentType, 120) ?? "application/octet-stream").toLowerCase(),
      ...(str(a.filename, 300) ? { filename: str(a.filename, 300) } : {}),
      size: Number.isFinite(size) && size > 0 ? size : 0,
      ...(a.voiceNote === true ? { voiceNote: true } : {}),
    });
  }
  return out;
}

/**
 * One `receive` notification, as the daemon sends it, or null for
 * anything that is not somebody saying something: receipts, typing,
 * reactions, deletions, calls, stories, edits and the rest.
 *
 * Whatever arrives is the wire's shape, not ours, so every field is
 * checked and bounded rather than trusted.
 */
export function parseReceive(params: unknown): SignalIncoming | null {
  const p = params as { envelope?: Record<string, any>; account?: unknown; result?: { envelope?: Record<string, any>; account?: unknown } } | null;
  const envelope = p?.envelope ?? p?.result?.envelope;
  const account = str(p?.account ?? p?.result?.account, 64);
  if (!envelope || typeof envelope !== "object" || !account) return null;
  const sourceUuid = serviceId(envelope.sourceUuid);
  const timestamp = Number(envelope.timestamp);
  if (!sourceUuid || !Number.isSafeInteger(timestamp) || timestamp <= 0) return null;
  const sent = envelope.syncMessage?.sentMessage;
  const data = envelope.dataMessage ?? sent;
  if (!data || typeof data !== "object") return null;
  // Reactions, deletions and the like carry no words of their own.
  if (data.reaction || data.remoteDelete || data.groupInfo?.type === "UPDATE") return null;
  const text = typeof data.message === "string" ? data.message.trim().slice(0, 4_000) : "";
  const attachments = attachmentsOf(data.attachments);
  if (!text && !attachments.length) return null;
  const group = str(data.groupInfo?.groupId ?? data.groupV2?.id, 200);
  const quoteId = Number(data.quote?.id);
  const mentions = Array.isArray(data.mentions)
    ? data.mentions.slice(0, 50).map((m: any) => serviceId(m?.uuid)).filter((m: string | undefined): m is string => Boolean(m))
    : [];
  const base = {
    account,
    sourceUuid,
    ...(phoneNumber(envelope.sourceNumber) ? { sourceNumber: envelope.sourceNumber } : {}),
    sourceName: str(envelope.sourceName, 120) ?? "Someone",
    timestamp,
    text,
    attachments,
    ...(group ? { groupId: group } : {}),
    ...(Number.isSafeInteger(quoteId) && quoteId > 0 ? { quoteId } : {}),
    mentions,
  };
  if (sent && !envelope.dataMessage) {
    // A sync message is the account talking, from one of its other
    // devices. To somebody else it is the owner's own conversation, and
    // never ours; to itself it is Note to Self.
    const to = serviceId(sent.destinationUuid);
    const toNumber = phoneNumber(sent.destinationNumber ?? sent.destination);
    const self = !group && (to === sourceUuid || (toNumber !== undefined && toNumber === account));
    return self ? { ...base, noteToSelf: true } : null;
  }
  return base;
}

/** What to do with one message, decided without touching anything. */
export type Decision =
  | { kind: "pair"; self: boolean }
  | { kind: "owner" }
  /** Somebody who is not the owner, in a one to one chat with an agent's
   * own number: the people rules take it from here. */
  | { kind: "person" }
  | { kind: "ignore"; why: "group" | "own-account" | "unpaired" | "self" | "echo" };

/** The part of an agent's Signal settings the rules read. */
export interface SignalRules {
  /** The account's own service id, once known. */
  aci?: string;
  pairing?: string | null;
  ownerAci?: string;
  /** The owner linked their own account, and talks to it in Note to Self. */
  ownerSelf?: boolean;
}

export function decide(state: SignalRules, message: SignalIncoming, sentByUs: (timestamp: number) => boolean = () => false): Decision {
  // A room carried into a group is the chat bridge's (server/chat-bridge.ts).
  if (message.groupId) return { kind: "ignore", why: "group" };
  if (message.noteToSelf) {
    // Our own replies in Note to Self, should signal-cli ever hand one back.
    if (sentByUs(message.timestamp)) return { kind: "ignore", why: "echo" };
    if (state.pairing && !message.attachments.length && message.text.trim() === state.pairing) return { kind: "pair", self: true };
    return state.ownerSelf ? { kind: "owner" } : { kind: "ignore", why: "self" };
  }
  if (state.aci && message.sourceUuid === state.aci) return { kind: "ignore", why: "self" };
  // On the owner's own account everybody else is a friend writing to
  // them, not to an agent. Dropped before the word is even compared.
  if (state.ownerSelf) return { kind: "ignore", why: "own-account" };
  if (state.pairing && !message.attachments.length && message.text.trim() === state.pairing) return { kind: "pair", self: false };
  if (state.ownerAci && message.sourceUuid === state.ownerAci) return { kind: "owner" };
  // Nobody to ask about a stranger yet.
  if (!state.ownerAci) return { kind: "ignore", why: "unpaired" };
  return { kind: "person" };
}

/** The word a person sends to claim an agent's Signal account. The same
 * alphabet and length as Telegram's: short to type, long to guess. */
export function pairingWord(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let word = "";
  for (let i = 0; i < 8; i++) word += alphabet[randomInt(alphabet.length)];
  return word;
}

/** Signal splits nothing for us past this, so a long reply is several. */
export const SIGNAL_MESSAGE_CHARS = 2_000;

/** An agent's reply as Signal messages: its Markdown read and written out
 * plainly, links as their addresses, cut where it reads well. Signal
 * shows no Markdown, and asterisks around every bold word are noise. */
export function signalMessages(text: string, markdown = true): string[] {
  return formatted(text, markdown, SIGNAL_MESSAGE_CHARS).map((chunk) => chunk.plain).filter((part) => part.trim());
}

/** The daemon's address, or null. Loopback only: the daemon has no
 * password, and whoever reaches it can speak as the account. */
export function cleanDaemonUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let url: URL;
  try {
    url = new URL(raw.trim().replace(/\/+$/, ""));
  } catch {
    return null;
  }
  if (url.protocol !== "http:" || url.username || url.password || url.search || url.hash) return null;
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  return `http://${url.host}`;
}

export const DEFAULT_DAEMON_URL = "http://127.0.0.1:8080";

/** The command that starts the daemon this file talks to, at an address.
 * Without -a: in that mode one daemon can link accounts and serve several. */
export function daemonCommand(url: string): string {
  return `signal-cli daemon --http ${new URL(url).host}`;
}

// ── the wire ────────────────────────────────────────────────────────────

/** signal-cli saying no, with its JSON-RPC code. */
export class SignalError extends Error {
  code: number;
  constructor(message: string, code = 0) {
    super(message);
    this.code = code;
  }
}

/** The daemon could not be reached at all, as opposed to refusing. */
export function unreachable(error: unknown): boolean {
  return error instanceof TypeError || (error as { name?: string })?.name === "TimeoutError" || (error as { name?: string })?.name === "AbortError";
}

let rpcId = 0;

/** One JSON-RPC call. A refusal throws a SignalError with signal-cli's
 * own words, which name what was wrong (an unknown number, an unlinked
 * account) better than anything said here would. */
export async function rpc<T = unknown>(url: string, method: string, params: Record<string, unknown> = {}, timeoutMs = 20_000): Promise<T> {
  const response = await fetch(`${url}/api/v1/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: `bloks-${++rpcId}`, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = (await response.json().catch(() => null)) as { result?: T; error?: { code?: number; message?: string } } | null;
  if (body?.error) throw new SignalError(String(body.error.message ?? "signal-cli refused").slice(0, 300), Number(body.error.code) || 0);
  if (!response.ok || !body) throw new SignalError(`signal-cli answered HTTP ${response.status}`);
  return body.result as T;
}

/** Whether a daemon answers there. */
export async function check(url: string): Promise<boolean> {
  const response = await fetch(`${url}/api/v1/check`, { signal: AbortSignal.timeout(5_000) });
  return response.ok;
}

/** The accounts linked in this daemon, by number (or service id for one
 * without a number). */
export async function accounts(url: string): Promise<Array<{ account: string; aci?: string }>> {
  const result = await rpc<unknown>(url, "listAccounts");
  if (!Array.isArray(result)) return [];
  return result.flatMap((row) => {
    const r = row as { number?: unknown; aci?: unknown; uuid?: unknown };
    const aci = serviceId(r.aci ?? r.uuid);
    const account = phoneNumber(r.number) ?? aci;
    return account ? [{ account, ...(aci ? { aci } : {}) }] : [];
  });
}

/** A link to show as a QR code, valid for a few minutes. */
export async function startLink(url: string): Promise<string> {
  const result = await rpc<{ deviceLinkUri?: unknown }>(url, "startLink");
  const uri = result?.deviceLinkUri;
  if (typeof uri !== "string" || !uri.startsWith("sgnl://linkdevice?")) throw new SignalError("signal-cli did not give a link to scan");
  return uri;
}

/** Waits for the phone to scan the link, then names the account it linked. */
export async function finishLink(url: string, deviceLinkUri: string, deviceName: string): Promise<{ account: string; aci?: string }> {
  const result = await rpc<{ number?: unknown; aci?: unknown; uuid?: unknown }>(url, "finishLink", { deviceLinkUri, deviceName }, 5 * 60_000);
  const aci = serviceId(result?.aci ?? result?.uuid);
  const account = phoneNumber(result?.number) ?? aci;
  if (!account) throw new SignalError("signal-cli linked something it could not name");
  return { account, ...(aci ? { aci } : {}) };
}

/** Where a message goes: one person, or one group. */
export type SignalTarget = { recipient: string } | { groupId: string };

/** A file, as signal-cli takes one without a path: RFC 2397 with a name. */
export function dataUri(mime: string, name: string, bytes: Uint8Array): string {
  const safe = name.replace(/[;,\s]/g, "_").slice(0, 120) || "file";
  return `data:${mime || "application/octet-stream"};filename=${safe};base64,${Buffer.from(bytes).toString("base64")}`;
}

/** One message, and the timestamp Signal names it by. */
export async function send(url: string, account: string, to: SignalTarget, text: string, extra: { attachments?: string[]; quote?: { timestamp: number; author: string } } = {}): Promise<number | undefined> {
  const result = await rpc<{ timestamp?: unknown }>(url, "send", {
    account,
    ...("groupId" in to ? { groupId: to.groupId } : { recipient: [to.recipient] }),
    message: text,
    ...(extra.attachments?.length ? { attachments: extra.attachments } : {}),
    ...(extra.quote ? { quoteTimestamp: extra.quote.timestamp, quoteAuthor: extra.quote.author } : {}),
  }, extra.attachments?.length ? 120_000 : 20_000);
  const at = Number(result?.timestamp);
  return Number.isSafeInteger(at) && at > 0 ? at : undefined;
}

export async function typing(url: string, account: string, recipient: string, stop = false): Promise<void> {
  await rpc(url, "sendTyping", { account, recipient: [recipient], ...(stop ? { stop: true } : {}) }, 5_000);
}

export async function remoteDelete(url: string, account: string, recipient: string, targetTimestamp: number): Promise<void> {
  await rpc(url, "remoteDelete", { account, recipient: [recipient], targetTimestamp }, 5_000);
}

/** The bytes of a file somebody sent, from signal-cli's own folder. The
 * size is checked before and after: what a message claims is not a promise. */
export async function attachment(url: string, account: string, file: SignalAttachment, from: string, maxBytes: number): Promise<Uint8Array> {
  const tooBig = new Error(`it is over ${Math.round(maxBytes / (1024 * 1024))} MB`);
  if (file.size > maxBytes) throw tooBig;
  const result = await rpc<unknown>(url, "getAttachment", { account, id: file.id, recipient: from }, 60_000);
  const base64 = typeof result === "string" ? result : (result as { data?: unknown } | null)?.data;
  if (typeof base64 !== "string" || !base64) throw new Error("signal-cli did not hand it over");
  if (base64.length > Math.ceil(maxBytes / 3) * 4 + 4) throw tooBig;
  const bytes = new Uint8Array(Buffer.from(base64, "base64"));
  if (bytes.length > maxBytes) throw tooBig;
  if (!bytes.length) throw new Error("it arrived empty");
  return bytes;
}

/** The groups an account is in, for choosing one to carry a room into. */
export async function groups(url: string, account: string): Promise<Array<{ id: string; name: string }>> {
  const result = await rpc<unknown>(url, "listGroups", { account });
  if (!Array.isArray(result)) return [];
  return result.flatMap((row) => {
    const g = row as { id?: unknown; name?: unknown; isMember?: unknown; isBlocked?: unknown };
    if (typeof g.id !== "string" || g.isMember === false || g.isBlocked === true) return [];
    return [{ id: g.id.slice(0, 200), name: (typeof g.name === "string" && g.name.trim() ? g.name.trim() : "A group").slice(0, 120) }];
  });
}

/**
 * Read the daemon's event stream until it ends or `signal` aborts.
 *
 * Server-Sent Events: lines of `id:` and `data:`, a blank line ending
 * each event, comments for keep-alive. The daemon keeps its last thousand
 * events and replays those after the id it is given, so a reconnect loses
 * nothing it still has; the caller remembers the last id it handled.
 */
export async function events(url: string, lastEventId: string | undefined, signal: AbortSignal, onEvent: (id: string | undefined, data: unknown) => Promise<void>, onOpen?: () => void): Promise<void> {
  const response = await fetch(`${url}/api/v1/events`, {
    headers: { accept: "text/event-stream", ...(lastEventId ? { "last-event-id": lastEventId } : {}) },
    signal,
  });
  if (!response.ok || !response.body) throw new SignalError(`signal-cli answered HTTP ${response.status}`);
  onOpen?.();
  const decoder = new TextDecoder();
  let buffer = "";
  let id: string | undefined;
  let data: string[] = [];
  const reader = response.body.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    // one runaway line cannot hold the whole of memory
    if (buffer.length > 8_000_000) throw new SignalError("signal-cli sent an event too big to read");
    let at: number;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at).replace(/\r$/, "");
      buffer = buffer.slice(at + 1);
      if (line === "") {
        if (data.length) {
          let parsed: unknown = null;
          try {
            parsed = JSON.parse(data.join("\n"));
          } catch {
            /* not JSON: nothing we can read */
          }
          if (parsed) await onEvent(id, parsed);
        }
        data = [];
        continue;
      }
      if (line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      const said = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "id") id = said.slice(0, 100);
      else if (field === "data") data.push(said);
    }
  }
}

/** Images Signal shows in the chat and the app takes as pasted ones. */
export const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** A recording, whether or not it was marked as one: a phone's voice
 * note arrives as AAC or Ogg, and a forwarded one may lose the mark. */
export function isVoice(file: SignalAttachment): boolean {
  return file.voiceNote === true || /^audio\/(aac|mp4|m4a|x-m4a|ogg|opus|mpeg|webm|wav|x-wav)$/.test(file.contentType.split(";")[0]!.trim());
}

/** A file name's extension for what came, never one the image or voice
 * serving routes would take for theirs. */
export function extensionOf(file: SignalAttachment): string {
  const mime = file.contentType.split(";")[0]!.trim();
  const known: Record<string, string> = {
    "application/pdf": "pdf", "text/plain": "txt", "text/csv": "csv", "application/json": "json", "application/zip": "zip",
    "video/mp4": "mp4", "video/quicktime": "mov", "audio/aac": "aac", "audio/mp4": "m4a", "audio/ogg": "oga", "audio/mpeg": "mp3",
  };
  if (known[mime]) return known[mime]!;
  const ext = /\.([a-z0-9]{1,8})$/i.exec(file.filename ?? "")?.[1]?.toLowerCase();
  return ext && !["png", "jpg", "jpeg", "gif", "webp", "ogg"].includes(ext) ? ext : "bin";
}

/** The most one file sent back with an answer may be. Signal itself takes
 * a little more; a phone on mobile data is the reason for the margin. */
export const SEND_MAX_BYTES = 95 * 1024 * 1024;
/** How many files come back with one answer; the rest are in the app. */
export const FILES_PER_TURN = 5;
