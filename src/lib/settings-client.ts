// This window's answer when an inspection asks what its settings are.
//
// It costs nothing until then. Mounted owners register a reader once and
// keep it current with a ref; nothing listens for resizes or storage, no
// timer runs, nothing is sent. When the server's private settings-request
// frame arrives (only on the owner's own stream, only when an agent or the
// owner reads a device category), this reads what is mounted and stored,
// asks the native bridge once, and posts one report.
import type {} from "../types/bridge.d.ts";
import { deviceSettingsSnapshot, type DeviceSetting, type DeviceValue } from "./settings-observation.ts";
import { storedDeviceSettings } from "./settings-stored.ts";

type Observation = Partial<Record<DeviceSetting, DeviceValue>>;
const owners = new Map<symbol, () => Observation>();

/** The native bridge gets this long; a slow one is reported as unknown
 * rather than holding the answer past the server's wait. */
export const NATIVE_WAIT_MS = 500;

/** Registers an already-mounted committed owner. Registration is all it
 * does: nothing is captured or sent until a request comes. */
export function observeCommittedSettings(read: () => Observation): () => void {
  const key = Symbol();
  owners.set(key, read);
  return () => { owners.delete(key); };
}

// One name for this page for as long as it is open, so two windows
// answer as two. Random, so it says nothing about the window.
let label: string | null = null;
function windowLabel(): string {
  if (!label) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    label = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return label;
}

function capture(): Observation {
  const values: Observation = storedDeviceSettings({ getItem: (key) => localStorage.getItem(key) });
  // What only a mounted owner knows starts as unmounted; an owner on
  // screen replaces it below. Never a default standing in for a value.
  for (const key of ["theme.preference", "theme.applied", "conversations.preference", "conversations.applied", "sidebar.preference",
    "sidebar.applied", "sidebar.foldsConfigured", "desktop.dock", "desktop.width", "desktop.height", "desktop.x", "desktop.y",
    "terminal.height", "terminal.open", "room.lens"] as const) values[key] = { status: "unknown", reason: "unmounted" };
  if (typeof window !== "undefined") {
    values["viewport.width"] = { status: "observed", value: window.innerWidth };
    values["viewport.height"] = { status: "observed", value: window.innerHeight };
  }
  for (const read of owners.values()) {
    try { Object.assign(values, read()); } catch { /* one broken owner does not cost the others */ }
  }
  return values;
}

async function native(read: (() => Promise<unknown>) | undefined): Promise<unknown> {
  if (!read) return {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(read),
      new Promise((resolve) => { timer = setTimeout(() => resolve({}), NATIVE_WAIT_MS); }),
    ]);
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

let revision = 0;
let answering: string | null = null;

/** One answer to one request. Exported for the tests; the stream calls it
 * through consumeSettingsRequest. */
export async function answerSettingsRequest(
  request: string,
  send: (body: unknown) => Promise<unknown> = (body) => fetch("/api/settings/device-report", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }),
): Promise<void> {
  // the same request twice (a stream that replayed it) is answered once
  if (answering === request) return;
  answering = request;
  try {
    const bridge = typeof window !== "undefined" ? window.bloks?.settingsObservation : undefined;
    const fromNative = deviceSettingsSnapshot({ schema: 1, revision: 0, observedAt: 0, values: await native(bridge && (() => bridge())) })!;
    const fromPage = deviceSettingsSnapshot({ schema: 1, revision: 0, observedAt: 0, values: capture() })!;
    const snapshot = deviceSettingsSnapshot({
      schema: 1, revision: ++revision, observedAt: Date.now(),
      values: { ...fromPage.values, ...Object.fromEntries(Object.entries(fromNative.values)
        .filter(([key]) => key.startsWith("native.") || key.startsWith("window."))) },
    });
    // No retry: the next inspection asks again, and an answer that did not
    // land simply leaves this window out of this one.
    await send({ kind: "window", request, label: windowLabel(), snapshot });
  } catch {
    /* the window is still fine; it just did not answer */
  }
}

/** Consumed before sequence and reducer handling: the request is not an
 * ordinary frame and never becomes an action or a notification. */
export function consumeSettingsRequest(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || (raw as { kind?: unknown }).kind !== "settings-request") return false;
  const request = (raw as { request?: unknown }).request;
  if (typeof request === "string" && /^[A-Za-z0-9_-]{43}$/.test(request)) void answerSettingsRequest(request);
  return true;
}
