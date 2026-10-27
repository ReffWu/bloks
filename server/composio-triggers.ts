// Composio's triggers, for app watchers (server/app-watch.ts).
//
// Two halves. The REST half is Composio's documented trigger API on its
// project side (backend.composio.dev, v3.1, the project key in
// `x-api-key`): which events an app offers and the config each asks for,
// the connected accounts that can be watched, and making, switching and
// removing one trigger instance. The consumer key that opens connections
// (server/composio.ts) is not accepted here, which is why app watchers
// need the project key as well.
//
// The other half is delivery: how an event gets from Composio to this
// machine. Composio delivers to a webhook URL, and a desktop app has no
// address the internet can reach. What it offers instead is the realtime
// channel its own SDK subscribes to (`composio.triggers.subscribe()`): a
// Pusher channel per project, authorised with the project key, carrying
// the same envelope a webhook would. That is what this uses, spoken
// directly over the WebSocket Node already has, so nothing is added to
// the app for it. It holds one connection for every app watcher.
//
// The channel does not replay: what Composio sends while nothing is
// listening is gone. So delivery says whether it catches up, and the
// server shows a gap as missed rather than as quiet. A webhook through
// the relay, which could hold events for a machine that was asleep, would
// be a second TriggerDelivery with `catchesUp` true and nothing else here
// would change.
const BACKEND = () => (process.env.BLOKS_COMPOSIO_BACKEND || "https://backend.composio.dev").replace(/\/+$/, "");
/** Where the realtime socket is, for a test that serves its own. Real
 * Pusher hosts are named by the cluster Composio answers with. */
const REALTIME = () => process.env.BLOKS_COMPOSIO_REALTIME?.replace(/\/+$/, "");

const isRecord = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Why a request to Composio did not work, in words a person can act on. */
export class ComposioError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** What the server asks of Composio's trigger side. An interface so a test
 * can stand in for all of it without a network. */
export interface TriggerApi {
  /** The events an app offers, raw as Composio lists them. */
  listTriggerTypes(toolkit: string): Promise<unknown[]>;
  getTriggerType(slug: string): Promise<unknown>;
  /** The active connected accounts of an app. */
  listAccounts(toolkit: string): Promise<ConnectedAccount[]>;
  /** One account's status, or null when it is gone. */
  accountStatus(id: string): Promise<string | null>;
  upsertTrigger(slug: string, accountId: string, config: Record<string, unknown>): Promise<string>;
  setTriggerEnabled(triggerId: string, enabled: boolean): Promise<void>;
  deleteTrigger(triggerId: string): Promise<void>;
  realtimeCredentials(): Promise<{ key: string; cluster: string; projectId: string }>;
  realtimeAuth(socketId: string, channel: string): Promise<string>;
}

export interface ConnectedAccount {
  id: string;
  toolkit: string;
  status: string;
  /** What tells two accounts of one app apart: its alias, Composio's
   * short name for it, or when it was connected. */
  label: string;
}

/** Composio's REST trigger API, with the project key. */
export function restTriggerApi(apiKey: string): TriggerApi {
  const call = async (method: string, path: string, body?: unknown, form?: Record<string, string>) => {
    let response: Response;
    try {
      response = await fetch(`${BACKEND()}${path}`, {
        method,
        headers: {
          "x-api-key": apiKey,
          accept: "application/json",
          ...(form ? { "content-type": "application/x-www-form-urlencoded" } : body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(form ? { body: new URLSearchParams(form).toString() } : body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ComposioError("Composio could not be reached. Check the connection and try again.", 0);
    }
    const said = await response.text();
    let parsed: any = null;
    try {
      parsed = said ? JSON.parse(said) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new ComposioError("Composio refused the project key. Check it in Settings, Apps and keys.", response.status);
      }
      // Composio's own message, when it gave one, is about the request
      // (a config field, a missing account) and worth passing on
      const message = typeof parsed?.error?.message === "string" ? parsed.error.message : typeof parsed?.message === "string" ? parsed.message : "";
      throw new ComposioError(message ? `Composio said: ${message.slice(0, 200)}` : `Composio did not answer (HTTP ${response.status}). Try again in a moment.`, response.status);
    }
    return parsed;
  };
  const pages = async (path: string, max = 4) => {
    const items: unknown[] = [];
    let cursor = "";
    for (let page = 0; page < max; page++) {
      const body = await call("GET", `${path}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (Array.isArray(body?.items)) items.push(...body.items);
      cursor = typeof body?.next_cursor === "string" ? body.next_cursor : "";
      if (!cursor) break;
    }
    return items;
  };
  const slug = (s: string) => encodeURIComponent(s);
  return {
    listTriggerTypes: (toolkit) => pages(`/api/v3.1/triggers_types?toolkit_slugs=${slug(toolkit)}&limit=50`),
    getTriggerType: (s) => call("GET", `/api/v3.1/triggers_types/${slug(s)}`),
    async listAccounts(toolkit) {
      const rows = await pages(`/api/v3.1/connected_accounts?toolkit_slugs=${slug(toolkit)}&statuses=ACTIVE&limit=50`, 2);
      return rows.filter(isRecord).flatMap((row): ConnectedAccount[] => {
        if (typeof row.id !== "string" || row.is_disabled === true) return [];
        const made = typeof row.created_at === "string" ? Date.parse(row.created_at) : NaN;
        const label =
          [row.alias, row.word_id].find((v): v is string => typeof v === "string" && v.trim().length > 0) ??
          (Number.isFinite(made) ? `Connected ${new Date(made).toISOString().slice(0, 10)}` : row.id);
        return [{ id: row.id, toolkit: String(row.toolkit?.slug ?? toolkit), status: String(row.status ?? "ACTIVE").toUpperCase(), label: label.slice(0, 80) }];
      });
    },
    async accountStatus(id) {
      try {
        const row = await call("GET", `/api/v3.1/connected_accounts/${slug(id)}`);
        if (row?.is_disabled === true) return "DISABLED";
        return typeof row?.status === "string" ? row.status.toUpperCase() : "UNKNOWN";
      } catch (e) {
        if (e instanceof ComposioError && (e.status === 404 || e.status === 410)) return null;
        throw e;
      }
    },
    async upsertTrigger(s, accountId, config) {
      const body = await call("POST", `/api/v3.1/trigger_instances/${slug(s)}/upsert`, { connected_account_id: accountId, trigger_config: config });
      const id = body?.trigger_id ?? body?.triggerId ?? body?.id;
      if (typeof id !== "string" || !id) throw new ComposioError("Composio made the trigger but did not say its id.", 502);
      return id;
    },
    async setTriggerEnabled(triggerId, enabled) {
      await call("PATCH", `/api/v3.1/trigger_instances/manage/${slug(triggerId)}`, { status: enabled ? "enable" : "disable" });
    },
    async deleteTrigger(triggerId) {
      try {
        await call("DELETE", `/api/v3.1/trigger_instances/manage/${slug(triggerId)}`);
      } catch (e) {
        // already gone is what was asked for
        if (e instanceof ComposioError && e.status === 404) return;
        throw e;
      }
    },
    async realtimeCredentials() {
      const body = await call("GET", "/api/v3/internal/sdk/realtime/credentials");
      const key = body?.pusher_key;
      const cluster = body?.pusher_cluster;
      const projectId = body?.project_id;
      if (typeof key !== "string" || typeof cluster !== "string" || typeof projectId !== "string") {
        throw new ComposioError("Composio did not say where to listen for events.", 502);
      }
      return { key, cluster, projectId };
    },
    async realtimeAuth(socketId, channel) {
      const body = await call("POST", "/api/v3/internal/sdk/realtime/auth", undefined, { socket_id: socketId, channel_name: channel });
      if (typeof body?.auth !== "string") throw new ComposioError("Composio would not let this machine listen for events.", 403);
      return body.auth;
    },
  };
}

// ── delivery ───────────────────────────────────────────────────────────

/** connecting: on its way; live: events arrive; down: not listening, and
 * trying again; refused: the key was refused, and it waits to be changed. */
export type DeliveryState = { state: "connecting" | "live" | "down" | "refused"; error?: string };

/**
 * How events reach this machine. One instance serves every app watcher;
 * the server filters by trigger id.
 */
export interface TriggerDelivery {
  readonly kind: "realtime" | "relay";
  /** Whether events sent while it was down arrive once it is back. */
  readonly catchesUp: boolean;
  start(handlers: { event(raw: unknown): void; state(s: DeliveryState): void }): void;
  stop(): void;
}

/** Pusher's protocol, as far as a subscriber needs it. */
const PROTOCOL = "protocol=7&client=js&version=8.4.0&flash=false";
/** What arrives in pieces is put back together up to this size. */
const MAX_CHUNKED = 2_000_000;

/**
 * Composio's realtime channel. Connects, authorises the private channel
 * through Composio with the project key, and hands every
 * `trigger_to_client` event on, whole or reassembled from its chunks.
 * Reconnects on its own with a growing wait; a refused key stops it until
 * it is started again.
 */
export class RealtimeDelivery implements TriggerDelivery {
  readonly kind = "realtime" as const;
  readonly catchesUp = false;
  private ws: WebSocket | null = null;
  private stopped = true;
  private delay = 1_000;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private handlers: { event(raw: unknown): void; state(s: DeliveryState): void } | null = null;
  private chunks = new Map<string, { parts: string[]; final: boolean; size: number }>();
  private readonly api: TriggerApi;
  private readonly options: { WebSocket?: typeof WebSocket };

  constructor(api: TriggerApi, options: { WebSocket?: typeof WebSocket } = {}) {
    this.api = api;
    this.options = options;
  }

  start(handlers: { event(raw: unknown): void; state(s: DeliveryState): void }) {
    this.handlers = handlers;
    if (!this.stopped) return;
    this.stopped = false;
    this.delay = 1_000;
    void this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.retryTimer = this.idleTimer = null;
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close();
    } catch {
      /* already closed */
    }
    this.chunks.clear();
  }

  private say(s: DeliveryState) {
    this.handlers?.state(s);
  }

  private retry(error?: string) {
    if (this.stopped) return;
    this.say({ state: "down", ...(error ? { error } : {}) });
    const wait = this.delay;
    this.delay = Math.min(this.delay * 2, 60_000);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => void this.connect(), wait);
    this.retryTimer.unref?.();
  }

  private async connect() {
    this.retryTimer = null;
    if (this.stopped) return;
    this.say({ state: "connecting" });
    let creds: { key: string; cluster: string; projectId: string };
    try {
      creds = await this.api.realtimeCredentials();
    } catch (e) {
      if (e instanceof ComposioError && (e.status === 401 || e.status === 403)) {
        this.say({ state: "refused", error: e.message });
        this.stopped = true;
        return;
      }
      return this.retry((e as Error).message);
    }
    if (this.stopped) return;
    const channel = `private-${creds.projectId}_triggers`;
    const base = REALTIME() ?? `wss://ws-${encodeURIComponent(creds.cluster)}.pusher.com`;
    const Socket = this.options.WebSocket ?? WebSocket;
    let ws: WebSocket;
    try {
      ws = new Socket(`${base}/app/${encodeURIComponent(creds.key)}?${PROTOCOL}`);
    } catch (e) {
      return this.retry((e as Error).message);
    }
    this.ws = ws;
    let activity = 120_000;
    let waitingPong = false;
    // Quiet for the server's activity timeout, it is asked whether it is
    // there; no answer in half a minute more and the line is dead, which a
    // sleeping laptop's socket often is without ever saying so.
    const idle = () => {
      if (this.idleTimer) clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => {
        if (this.ws !== ws) return;
        if (waitingPong) {
          try {
            ws.close();
          } catch {
            /* closing anyway */
          }
          return;
        }
        waitingPong = true;
        send({ event: "pusher:ping", data: {} });
        idle();
      }, waitingPong ? 30_000 : activity);
      this.idleTimer.unref?.();
    };
    const send = (frame: unknown) => {
      try {
        ws.send(JSON.stringify(frame));
      } catch {
        /* the close handler takes it from here */
      }
    };
    ws.onmessage = (message) => {
      if (this.ws !== ws) return;
      waitingPong = false;
      idle();
      let frame: any;
      try {
        frame = JSON.parse(String(message.data));
      } catch {
        return;
      }
      const data = (() => {
        if (typeof frame.data !== "string") return frame.data;
        try {
          return JSON.parse(frame.data);
        } catch {
          return frame.data;
        }
      })();
      switch (frame.event) {
        case "pusher:connection_established": {
          const socketId = data?.socket_id;
          if (Number.isFinite(data?.activity_timeout)) activity = Math.max(10, Math.min(300, data.activity_timeout)) * 1000;
          if (typeof socketId !== "string") return ws.close();
          this.api
            .realtimeAuth(socketId, channel)
            .then((auth) => this.ws === ws && send({ event: "pusher:subscribe", data: { channel, auth } }))
            .catch((e) => {
              if (this.ws !== ws) return;
              if (e instanceof ComposioError && (e.status === 401 || e.status === 403)) {
                this.say({ state: "refused", error: e.message });
                this.stopped = true;
              }
              try {
                ws.close();
              } catch {
                /* closing anyway */
              }
            });
          return;
        }
        case "pusher_internal:subscription_succeeded":
        case "pusher:subscription_succeeded":
          this.delay = 1_000;
          this.say({ state: "live" });
          return;
        case "pusher:ping":
          return send({ event: "pusher:pong", data: {} });
        case "pusher:pong":
          return;
        case "pusher:error": {
          // 4000 to 4099: the app key or the request is wrong, and asking
          // again in a second will not change that
          const code = Number(data?.code);
          if (code >= 4000 && code < 4100) this.delay = Math.max(this.delay, 5 * 60_000);
          return;
        }
        case "pusher:subscription_error":
          this.say({ state: "refused", error: "Composio would not let this machine listen for events." });
          this.stopped = true;
          return ws.close();
        case "trigger_to_client":
          if (frame.channel && frame.channel !== channel) return;
          return this.hand(data);
        case "chunked-trigger_to_client":
          if (frame.channel && frame.channel !== channel) return;
          return this.piece(data);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.idleTimer) clearTimeout(this.idleTimer);
      this.chunks.clear();
      this.retry();
    };
    ws.onerror = () => {
      /* onclose follows */
    };
    idle();
  }

  private hand(data: unknown) {
    if (!isRecord(data)) return;
    try {
      this.handlers?.event(data);
    } catch {
      /* one bad event never takes the line down */
    }
  }

  /** One piece of an event too long for a single frame. */
  private piece(data: unknown) {
    if (!isRecord(data) || typeof data.id !== "string" || !Number.isInteger(data.index) || typeof data.chunk !== "string") return;
    if (data.index < 0 || data.index > 2_000) return;
    const entry = this.chunks.get(data.id) ?? { parts: [], final: false, size: 0 };
    entry.parts[data.index] = data.chunk;
    entry.size += data.chunk.length;
    if (data.final) entry.final = true;
    if (entry.size > MAX_CHUNKED) {
      this.chunks.delete(data.id);
      return;
    }
    this.chunks.set(data.id, entry);
    // a few half-sent events at most; the oldest goes first
    if (this.chunks.size > 20) this.chunks.delete(this.chunks.keys().next().value!);
    const whole = entry.final && entry.parts.length === Object.keys(entry.parts).length;
    if (!whole) return;
    this.chunks.delete(data.id);
    try {
      this.hand(JSON.parse(entry.parts.join("")));
    } catch {
      /* not an event after all */
    }
  }
}
