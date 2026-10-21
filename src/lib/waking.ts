// Your hosted workspace waking up, as this window sees it.
//
// A hosted workspace may sleep when nobody is using it, and the first
// thing asked of it wakes it. The app's stand-in for its server
// (electron/remote.mjs, with electron/waking.mjs) asks again on its own
// until it is up, so nothing in the window retries anything. This keeps
// what that wait looks like, once for the whole window, for the strip that
// says so (components/WakingStrip.tsx); has reads wait in the page meanwhile
// rather than at the stand-in (wakeFetch); and keeps a message sent
// meanwhile in its conversation, faded, until it has gone
// (components/chat/HeldSends.tsx).
//
// None of it is an error. A machine asleep is the plan working, so there
// is no red, no toast and no Try again while it wakes: the app is already
// trying. Only a wait that runs out says anything went wrong, and then
// beside the words it hands back.
//
// No "@/" imports, so the tests can load it as it is.
import { useEffect, useState, useSyncExternalStore } from "react";
import type {} from "../types/bridge.d.ts";

/** What a request that never got through says once the wait ran out
 * (electron/waking.mjs keeps the same words). */
export const WAKE_GAVE_UP = "Your hosted workspace did not wake up in time.";

/** Where the stand-in says how the wait is going (electron/remote.mjs). */
export const WAKE_PATH = "/api/remote/wake";

export type WakeState =
  | { waking: true; since: number; until: number }
  | { waking: false; outcome?: "awake" | "gaveUp" };

const IDLE: WakeState = { waking: false };

/** A wait as the stand-in said it; anything else is no wait at all. */
export function readWake(raw: unknown): WakeState {
  if (!raw || typeof raw !== "object") return IDLE;
  const said = raw as Record<string, unknown>;
  if (said.waking === true) {
    const { since, until } = said;
    return typeof since === "number" && typeof until === "number" && until > since ? { waking: true, since, until } : IDLE;
  }
  return said.outcome === "awake" || said.outcome === "gaveUp" ? { waking: false, outcome: said.outcome } : IDLE;
}

/**
 * How far along a wake probably is, from 0 to 0.95, for a bar that moves
 * from the first second and never claims to be done. Most wakes take
 * seconds and a cold start about two minutes, so it goes quickly at first
 * and slows; only the workspace answering finishes it.
 */
export function wakeProgress(elapsed: number, budget: number): number {
  if (!(elapsed > 0) || !(budget > 0)) return 0;
  return Math.min(0.95, 1 - Math.exp(-elapsed / (budget / 3)));
}

/** Why a request failed, when it is a hosted workspace that never woke:
 * the stand-in marks that answer (store.tsx's api carries the mark). */
export function wakeGaveUp(error: unknown): string | null {
  if (!error || typeof error !== "object" || (error as { waking?: unknown }).waking !== true) return null;
  return (error instanceof Error && error.message) || WAKE_GAVE_UP;
}

/** Whether this window shows your hosted workspace. */
export function isHostedWindow(): boolean {
  return typeof window !== "undefined" && window.bloks?.workspace?.kind === "hosted";
}

// ── the wait, one for the window ───────────────────────────────────────

let wake: WakeState = IDLE;
const wakeListeners = new Set<() => void>();

const sameWake = (a: WakeState, b: WakeState) =>
  a.waking && b.waking ? a.since === b.since && a.until === b.until : !a.waking && !b.waking && a.outcome === b.outcome;

/** Takes what the stand-in said about the wait. */
export function takeWake(raw: unknown): void {
  const next = readWake(raw);
  if (sameWake(next, wake)) return;
  wake = next;
  wakeListeners.forEach((listener) => listener());
}

export function currentWake(): WakeState {
  return wake;
}

/**
 * Follows the wait on a line of its own, for a page that has no event
 * stream yet (the store's carries it as "remote.wake" frames once it is
 * open). Returns the hang-up: a window has only a few connections to its
 * stand-in, so this one is let go as soon as the event stream takes over.
 */
export function followWake(
  open: (url: string) => Pick<EventSource, "onmessage" | "close"> = (url) => new EventSource(url),
): () => void {
  const source = open(WAKE_PATH);
  source.onmessage = (event: MessageEvent) => {
    try {
      takeWake(JSON.parse(String(event.data)));
    } catch {
      /* a line that is not a wait */
    }
  };
  return () => source.close();
}

const subscribeWake = (listener: () => void) => {
  wakeListeners.add(listener);
  return () => {
    wakeListeners.delete(listener);
  };
};

/** The window's wait for its hosted workspace, as it goes. `follow` asks
 * for it on its own line while mounted, for the moment before the store's
 * event stream is open. */
export function useWake(follow = false): WakeState {
  useEffect(() => {
    if (follow && isHostedWindow()) return followWake();
  }, [follow]);
  return useSyncExternalStore(subscribeWake, currentWake, currentWake);
}

/** Settles once the window's wait is over, at once when there is none.
 * Never later than a little past the end the wait was given, so a word
 * that its end came which never arrived cannot hold anything for good. */
export function wakeOver(): Promise<void> {
  if (!wake.waking) return Promise.resolve();
  const by = wake.until;
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      if (wake.waking && Date.now() < by + 15_000) return;
      wakeListeners.delete(done);
      clearTimeout(timer);
      resolve();
    };
    wakeListeners.add(done);
    timer = setTimeout(done, Math.max(0, by - Date.now()) + 15_000);
  });
}

const sharedReads = new Map<string, Promise<Response>>();

/**
 * fetch, except while your hosted workspace wakes: then a read of the API
 * waits here, in the page, until it is up, and the same read asked twice
 * meanwhile is asked once. A window has only a few connections to its
 * stand-in, and a read held there for the whole wait holds one of them;
 * with the lists polling every few seconds they ran out, and a message
 * sent meanwhile queued behind them instead of waiting at the stand-in to
 * go the moment the workspace answered. Writes are never held here: the
 * stand-in holds them, and sends them itself.
 */
export function wakeFetch(path: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  if (!wake.waking || (method !== "GET" && method !== "HEAD") || !path.startsWith("/api/")) return fetch(path, init);
  // one that can be called off waits on its own, so calling it off calls off nobody else's
  if (init?.signal) return wakeOver().then(() => fetch(path, init));
  const key = `${method} ${path}`;
  let read = sharedReads.get(key);
  if (!read) {
    read = wakeOver().then(() => fetch(path, init));
    sharedReads.set(key, read);
    const forget = () => {
      if (sharedReads.get(key) === read) sharedReads.delete(key);
    };
    read.then(forget, forget);
  }
  return read.then((res) => res.clone());
}

/** The time now, again every `every` ms while `on`, for a bar that moves. */
export function useTicking(every: number, on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every, on]);
  return now;
}

// ── words on their way ─────────────────────────────────────────────────
// A send to a hosted workspace that is asleep waits for it to wake, up to
// two minutes. The words leave the composer at once, as any send's do, so
// they are kept here by conversation (the composer's own key) until the
// send is over, and the conversation shows them where they will land.

export interface HeldSend {
  id: number;
  text: string;
  /** When it set out, by this computer's clock. */
  at: number;
  /** The last message in the conversation when it set out, so its own copy
   * arriving is told from an older message with the same words. */
  after: string | null;
  /** Still out a moment later: worth showing on a hosted workspace even
   * before it has said it is asleep, since Bloks Cloud holds the first ask
   * twelve seconds before saying so. */
  slow: boolean;
}

/** How long a send may take before a hosted workspace's conversation
 * shows it on its way. Under this, it is only the usual moment. */
export const SLOW_SEND_MS = 2_000;

const NONE: readonly HeldSend[] = Object.freeze([]);
const held = new Map<string, readonly HeldSend[]>();
const unsent = new Map<string, string>();
const heldListeners = new Set<() => void>();
let heldIds = 0;

const heldChanged = () => heldListeners.forEach((listener) => listener());

function putHeld(key: string, list: readonly HeldSend[]) {
  if (list.length) held.set(key, list);
  else held.delete(key);
  heldChanged();
}

/** The sends out now in a conversation, oldest first. */
export function heldSends(key: string): readonly HeldSend[] {
  return held.get(key) ?? NONE;
}

/** Why the last send in a conversation came back, when it was a hosted
 * workspace that never woke. */
export function unsentReason(key: string): string | null {
  return unsent.get(key) ?? null;
}

export function dismissUnsent(key: string): void {
  if (unsent.delete(key)) heldChanged();
}

/**
 * Sends, keeping the words with their conversation until the send is
 * over. What `send` resolves or throws is passed on as it was; a hosted
 * workspace that never woke also leaves its reason with the conversation,
 * for the composer to say beside the words it hands back. A new send
 * clears an older reason: it was about the last one.
 */
export async function sendHeld<T>(
  key: string,
  text: string,
  send: () => Promise<T>,
  {
    after = null,
    now = Date.now,
    later = (run: () => void, ms: number): unknown => setTimeout(run, ms),
    cancel = (timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  }: {
    after?: string | null;
    now?: () => number;
    later?: (run: () => void, ms: number) => unknown;
    cancel?: (timer: unknown) => void;
  } = {},
): Promise<T> {
  const id = ++heldIds;
  unsent.delete(key);
  putHeld(key, [...heldSends(key), { id, text, at: now(), after, slow: false }]);
  const timer = later(() => {
    const list = heldSends(key);
    if (list.some((h) => h.id === id)) putHeld(key, list.map((h) => (h.id === id ? { ...h, slow: true } : h)));
  }, SLOW_SEND_MS);
  try {
    return await send();
  } catch (error) {
    const reason = wakeGaveUp(error);
    if (reason) unsent.set(key, reason);
    throw error;
  } finally {
    cancel(timer);
    putHeld(key, heldSends(key).filter((h) => h.id !== id));
  }
}

type Said = { id: string; role: string; text?: string | null };

/** Whether a held send's own copy is already in the conversation: the
 * same words from you, after what was last there when it set out (or,
 * when that has scrolled out of what is loaded, among the last few). */
function landed(send: HeldSend, said: readonly Said[], queued: readonly Said[]): boolean {
  if (queued.some((m) => m.role === "user" && m.text === send.text)) return true;
  const at = send.after ? said.findIndex((m) => m.id === send.after) : -1;
  const from = at >= 0 ? at + 1 : Math.max(0, said.length - 3);
  for (let i = from; i < said.length; i++) if (said[i].role === "user" && said[i].text === send.text) return true;
  return false;
}

/**
 * Which held sends a conversation draws: while the workspace wakes, every
 * one; on a hosted workspace that has not said so yet, those slow enough
 * to notice; anywhere else, none, since a send is over in a moment. One
 * whose own copy has arrived is not drawn twice.
 */
export function heldToShow(
  list: readonly HeldSend[],
  { waking, hosted }: { waking: boolean; hosted: boolean },
  said: readonly Said[] = [],
  queued: readonly Said[] = [],
): HeldSend[] {
  if (!waking && !hosted) return [];
  return list.filter((send) => (waking || send.slow) && !landed(send, said, queued));
}

const subscribeHeld = (listener: () => void) => {
  heldListeners.add(listener);
  return () => {
    heldListeners.delete(listener);
  };
};

export function useHeldSends(key: string): readonly HeldSend[] {
  return useSyncExternalStore(subscribeHeld, () => heldSends(key), () => heldSends(key));
}

export function useUnsentReason(key: string): string | null {
  return useSyncExternalStore(subscribeHeld, () => unsentReason(key), () => unsentReason(key));
}
