// What the owner's own windows and paired phone say their device-local
// settings are, kept only as long as it is worth anything.
//
// Nothing here runs on its own. No timer, no lease, no heartbeat: a window
// says nothing until an inspection asks, and the ask is one private frame
// on the owner's streams, sent at most once per ASK_REUSE_MS however many
// pages an agent reads. A phone also says what it has when it connects
// and when one of its settings changes, because a phone in a pocket
// cannot answer an ask and its last word, dated, is better than none.
//
// Storage is bounded twice: by count, and by age. Old entries go when the
// store is next touched (an ask, a report, a read), not on a clock.
import { randomBytes } from "node:crypto";
import { deviceSettingsSnapshot, type DeviceSettingsSnapshot } from "../src/lib/settings-observation.ts";
import { scalar, type InspectionValue } from "./settings-inspection.ts";

/** How long a read waits for answers before saying what it has. */
export const ASK_WAIT_MS = 1_500;
/** A second read this soon after an ask joins it rather than asking again. */
export const ASK_REUSE_MS = 5_000;
/** An answer this late to an ask is no answer: the ask id stops working. */
export const ANSWER_WINDOW_MS = 10_000;
/** Entries older than this are dropped the next time the store is touched. */
export const OBSERVATION_TTL_MS = 24 * 60 * 60_000;
export const MAX_OBSERVATIONS = 32;
export const MAX_PHONE_SETTINGS = 64;

/** Decided from the request by the server's guard, never from a body. */
export type ReportSource = {
  path: "local" | "network" | "relay";
  /** The paired owner device, or null for the owner's own loopback window. */
  deviceId: string | null;
};

export type PhoneSettingKind = "preference" | "system" | "credential" | "lifecycle";
export interface PhoneSetting {
  id: string;
  kind: PhoneSettingKind;
  value: InspectionValue;
  /** The device's own default for it; null when it has none. Never the server's. */
  default: InspectionValue | null;
  /** The part of the app whose value is the effective one. */
  owner: string;
  /** Where the person changes it, in the app's own words. */
  control: string;
}

type Entry = {
  key: string;
  kind: "window" | "phone";
  source: ReportSource;
  label: string | null;
  /** The app build the device named on the request that carried it. */
  client: string | null;
  window: DeviceSettingsSnapshot | null;
  phone: PhoneSetting[] | null;
  /** Monotonic, for comparing with an ask; never shown. */
  receivedTick: number;
  receivedAt: number;
  clientObservedAt: number | null;
  /** Why it was sent: the answer to an ask, or a phone saying so itself. */
  reason: "asked" | "connected" | "changed";
};

type Ask = { id: string; tick: number; at: number; answered: Set<string>; listeners: Set<() => void> };

const LABEL = /^[A-Za-z0-9_-]{8,64}$/;
const SETTING_ID = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*){0,3}$/;
const KINDS: readonly PhoneSettingKind[] = ["preference", "system", "credential", "lifecycle"];

function own(raw: unknown, key: string): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const field = Object.getOwnPropertyDescriptor(raw, key);
  return field && "value" in field ? field.value : undefined;
}
const text = (raw: unknown, max: number) => typeof raw === "string" && raw.length > 0 && raw.length <= max ? raw : null;

/** One reported value, as narrow as the inspection's own values. A
 * credential can only ever say whether it is configured. */
function reportedValue(raw: unknown, kind: PhoneSettingKind, redact: (text: string) => string): InspectionValue | null {
  const status = own(raw, "status");
  if (kind === "credential") {
    const configured = own(raw, "configured");
    return status === "configured" && typeof configured === "boolean" ? { status: "configured", configured } : null;
  }
  if (status === "value") {
    const value = scalar(own(raw, "value"), redact);
    return value.status === "value" ? value : null;
  }
  if (status === "configured") {
    const configured = own(raw, "configured");
    return typeof configured === "boolean" ? { status: "configured", configured } : null;
  }
  if (status === "unknown") {
    const reason = text(own(raw, "reason"), 64);
    return reason && /^[a-z_]+$/.test(reason) ? { status: "unknown", reason } : null;
  }
  return null;
}

/** Full replacement: a setting the phone no longer names is gone, not kept
 * from an earlier report. Unknown shapes are refused field by field, and a
 * field that cannot be read is said to be unreadable rather than dropped. */
export function phoneSettings(raw: unknown, redact: (text: string) => string): PhoneSetting[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_PHONE_SETTINGS) return null;
  const seen = new Set<string>();
  const out: PhoneSetting[] = [];
  for (const item of raw) {
    const id = own(item, "id");
    const kind = own(item, "kind") as PhoneSettingKind;
    if (typeof id !== "string" || !SETTING_ID.test(id) || id.length > 64 || seen.has(id) || !KINDS.includes(kind)) return null;
    seen.add(id);
    const owner = text(own(item, "owner"), 128);
    const control = text(own(item, "control"), 128);
    if (!owner || !control) return null;
    const value = reportedValue(own(item, "value"), kind, redact) ?? { status: "unknown", reason: "invalid_report" };
    const fallback = own(item, "default");
    out.push({
      id, kind, owner: redact(owner), control: redact(control), value,
      // a credential has no default worth saying, and says nothing else
      default: kind === "credential" || fallback === undefined || fallback === null ? null
        : reportedValue(fallback, kind, redact) ?? { status: "unknown", reason: "invalid_report" },
    });
  }
  return out;
}

export class DeviceSettings {
  private readonly entries = new Map<string, Entry>();
  private ask_: Ask | null = null;
  private previous: Ask | null = null;
  private dropped = 0;
  private tick_ = -Infinity;
  private readonly clocks: { monotonic: () => number; wall: () => number };

  constructor(clocks = { monotonic: () => performance.now(), wall: () => Date.now() }) { this.clocks = clocks; }

  // Clamped so an injected clock that runs backwards cannot make an old
  // answer look newer than an ask.
  private tick() { return (this.tick_ = Math.max(this.tick_, this.clocks.monotonic())); }

  private prune(now: number) {
    const cutoff = this.clocks.wall() - OBSERVATION_TTL_MS;
    for (const [key, entry] of this.entries) if (entry.receivedAt < cutoff) this.entries.delete(key);
    // an ask nobody may answer any more holds nothing worth keeping
    if (this.previous && now - this.previous.tick > ANSWER_WINDOW_MS) this.previous = null;
  }

  private store(entry: Entry) {
    this.entries.delete(entry.key);
    this.entries.set(entry.key, entry);
    // Map order is insertion order, and every store re-inserts, so the
    // first entry is always the one heard from longest ago.
    while (this.entries.size > MAX_OBSERVATIONS) {
      this.entries.delete(this.entries.keys().next().value!);
      this.dropped = Math.min(Number.MAX_SAFE_INTEGER, this.dropped + 1);
    }
  }

  /** The ask a read should wait on. A new one is made, and `deliver` sends
   * its frame, only when there is no recent ask to join. */
  ask(deliver: (frame: { kind: "settings-request"; request: string }) => void): Ask {
    const now = this.tick();
    this.prune(now);
    if (this.ask_ && now - this.ask_.tick < ASK_REUSE_MS) return this.ask_;
    const ask: Ask = { id: randomBytes(32).toString("base64url"), tick: now, at: this.clocks.wall(), answered: new Set(), listeners: new Set() };
    this.previous = this.ask_;
    this.ask_ = ask;
    deliver({ kind: "settings-request", request: ask.id });
    return ask;
  }

  /** Until `everyone` says all expected answers are in, or the wait ends.
   * The one timer is the read's own and goes with it. */
  async wait(ask: Ask, everyone: (answers: number) => boolean, ms = ASK_WAIT_MS): Promise<void> {
    const left = ms - (this.tick() - ask.tick);
    if (left <= 0 || everyone(ask.answered.size)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let listener: (() => void) | undefined;
    try {
      await new Promise<void>((resolve) => {
        timer = setTimeout(resolve, left);
        listener = () => { if (everyone(ask.answered.size)) resolve(); };
        ask.listeners.add(listener);
      });
    } finally {
      clearTimeout(timer);
      if (listener) ask.listeners.delete(listener);
    }
  }

  private answered(ask: Ask, key: string) {
    ask.answered.add(key);
    for (const listener of [...ask.listeners]) listener();
  }

  private answering(request: unknown): Ask | null {
    if (typeof request !== "string") return null;
    const now = this.tick();
    for (const ask of [this.ask_, this.previous]) {
      if (ask && ask.id.length === request.length && ask.id === request && now - ask.tick <= ANSWER_WINDOW_MS) return ask;
    }
    return null;
  }

  /** A desktop window's answer. Windows only ever answer: an unasked report
   * from a window is refused, which is what keeps a loopback caller (the
   * owner, to this server, with or without a window) from planting values
   * nobody asked for. */
  reportWindow(source: ReportSource, body: unknown, client: string | null): boolean {
    const ask = this.answering(own(body, "request"));
    const label = own(body, "label");
    const snapshot = deviceSettingsSnapshot(own(body, "snapshot"));
    if (!ask || typeof label !== "string" || !LABEL.test(label) || !snapshot) return false;
    const key = `window:${source.path}:${source.deviceId ?? "-"}:${label}`;
    if (!ask.answered.has(key) && ask.answered.size >= MAX_OBSERVATIONS) return false;
    const now = this.tick();
    this.prune(now);
    this.store({
      key, kind: "window", source: { ...source }, label, client, window: snapshot, phone: null,
      receivedTick: now, receivedAt: this.clocks.wall(), clientObservedAt: snapshot.observedAt, reason: "asked",
    });
    this.answered(ask, key);
    return true;
  }

  /** A paired phone's own settings, as an answer or because it connected
   * or something changed. Only a paired owner device has an identity to
   * file it under; the guard decides that, and nothing in the body can. */
  reportPhone(source: ReportSource, body: unknown, client: string | null, redact: (text: string) => string): boolean {
    if (!source.deviceId) return false;
    const request = own(body, "request");
    const ask = request === undefined ? null : this.answering(request);
    if (request !== undefined && !ask) return false;
    const reason = ask ? "asked" : own(body, "reason") === "changed" ? "changed" : own(body, "reason") === "connected" ? "connected" : null;
    const observedAt = own(body, "observedAt");
    const settings = phoneSettings(own(body, "settings"), redact);
    if (!reason || !settings || typeof observedAt !== "number" || !Number.isFinite(observedAt)) return false;
    const key = `phone:${source.deviceId}`;
    const now = this.tick();
    this.prune(now);
    this.store({
      key, kind: "phone", source: { ...source }, label: null, client, window: null, phone: settings,
      receivedTick: now, receivedAt: this.clocks.wall(), clientObservedAt: observedAt, reason,
    });
    if (ask) this.answered(ask, key);
    return true;
  }

  /** A revoked device's word is no longer the owner's. */
  forget(deviceId: string): void {
    for (const [key, entry] of this.entries) if (entry.source.deviceId === deviceId) this.entries.delete(key);
  }

  /** Pairing switched off, or every device revoked. */
  forgetDevices(): void {
    for (const [key, entry] of this.entries) if (entry.source.deviceId !== null) this.entries.delete(key);
  }

  /** What is kept, each entry dated against the ask the read waited on: an
   * entry heard since that ask is current, anything older is the last
   * thing said, and says when. */
  inspect(ask: Ask | null) {
    this.prune(this.tick());
    return {
      askedAt: ask?.at ?? null,
      droppedForSpace: this.dropped,
      bounds: { entries: MAX_OBSERVATIONS, maxAgeHours: OBSERVATION_TTL_MS / 3_600_000 },
      entries: [...this.entries.values()].map((entry) => ({
        key: entry.key, kind: entry.kind, label: entry.label, client: entry.client,
        source: { path: entry.source.path, deviceId: entry.source.deviceId,
          identity: entry.source.deviceId === null ? "owner-local-window" : "paired-owner-device" },
        freshness: ask && entry.receivedTick >= ask.tick ? "current" as const : "last-reported" as const,
        reason: entry.reason, receivedAt: entry.receivedAt, clientObservedAt: entry.clientObservedAt,
        window: entry.window ? structuredClone(entry.window) : null,
        phone: entry.phone ? structuredClone(entry.phone) : null,
      })),
    };
  }
}
