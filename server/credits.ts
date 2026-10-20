// Bloks credits: a prepaid balance on the person's Bloks licence that pays
// for model use, so an agent can run with no sign-in and no API key.
//
// The balance lives on bloks.dev, not here. What this machine keeps is a
// credits token, traded once for the licence key and sent as a bearer on
// every call. The server can revoke a token without touching the licence,
// so a token is the thing that travels and the licence stays home: it is
// only spent again when the server says the token is no good (a 401), and
// the token is forgotten the moment the licence changes, since a token
// from an old licence spends somebody else's balance or nobody's.
//
// Two engines spend it. The Bloks engine is the generic OpenAI-compatible
// driver pointed at the credits base with the token as its key, its model
// list read from /v1/models like any other provider's. Claude Code spends
// it when an agent's access says so, through the Anthropic Messages API
// the same base answers, by way of the CLI's own base URL and token
// variables (server/drivers/claude.ts).
//
// Everything about money is the server's to say. This file never decides
// what anything costs, how much is left or when it is low: it reads the
// balance, shows whatever came back, and sends the person to the checkout
// page in their browser when they want more.
import { hostname } from "node:os";

import type { ProviderSpec } from "./providers.ts";

/** The credits service, overridable for tests and for somebody running
 * their own. No trailing slash. */
export function creditsBase(): string {
  const raw = (process.env.BLOKS_CREDITS_URL || "https://bloks.dev/api/ai").trim();
  return raw.replace(/\/+$/, "");
}

/** Where the person buys more, opened in their browser and never inside
 * the app. It sits beside the service, on the same site. */
export function creditsCheckoutUrl(): string {
  try {
    return `${new URL(creditsBase()).origin}/credits`;
  } catch {
    return "https://bloks.dev/credits";
  }
}

// A host started with a token in its environment (a machine somebody
// else runs for the person) uses it as given. Read once and taken out of
// this process's environment straight away: every engine this server
// starts inherits that environment, and an agent's shell is no place for
// a credential that spends money.
const ENV_TOKEN = (process.env.BLOKS_CREDITS_TOKEN ?? "").trim() || null;
delete process.env.BLOKS_CREDITS_TOKEN;

/** The token this process was started with, if any. */
export function creditsEnvToken(): string | null {
  return ENV_TOKEN;
}

/** The engine's driver kind, and its instance id. */
export const CREDITS_KIND = "bloks";

/** The Bloks engine. Its URL is decided when the instance is made, from
 * creditsBase(), so a test or a self-hosted service is honoured; the
 * model list is whatever /v1/models says, which is why there is no
 * fallback catalog here to go stale. */
export const CREDITS_SPEC: ProviderSpec = {
  kind: CREDITS_KIND,
  name: "Bloks",
  url: "",
  auth: "key",
  keyHint: "Uses the credits on your Bloks licence",
  docsUrl: "https://bloks.dev/credits",
  models: { default: "", options: [] },
  limit: 40,
  // the service speaks OpenAI function calling for every model it lists
  tools: true,
};

/** The OpenAI-compatible root the Bloks engine talks to. */
export function creditsCompatUrl(): string {
  return `${creditsBase()}/v1`;
}

/** What the person's balance is, as the service said it. */
export interface CreditsBalance {
  /** In whole units of `currency` (dollars for USD), as sent. */
  balance: number;
  currency: string;
  /** The amount the service calls low, when it says. */
  lowAt: number | null;
  /** Whether the service tops the balance up by itself. */
  autoReload: boolean;
  /** When it was read. */
  at: number;
}

/** The part of the workspace's settings this file reads and writes. */
export interface CreditsSaved {
  licence?: string;
  token?: string;
}

export interface CreditsStore {
  read(): CreditsSaved;
  /** Null forgets a value. */
  write(patch: { licence?: string | null; token?: string | null }): void;
}

/** Thrown when the service refuses for want of money (a 402): its own
 * words, which say what happened better than anything written here. */
export class CreditsEmpty extends Error {
  readonly credits = "empty" as const;
  constructor(message: string) {
    super(message);
    this.name = "CreditsEmpty";
  }
}

/** The service's words from an error body: `{ error: { message } }`,
 * `{ error }`, `{ message }`, or the text itself. Bounded, since this is
 * another service's answer and ends up on a screen. */
export function serviceWords(body: string): string {
  let said = "";
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const error = parsed?.error;
    if (typeof error === "string") said = error;
    else if (error && typeof error === "object" && typeof (error as Record<string, unknown>).message === "string") {
      said = (error as Record<string, string>).message;
    } else if (typeof parsed?.message === "string") said = parsed.message;
  } catch {
    said = /^\s*</.test(body) ? "" : body;
  }
  return said.replace(/\s+/g, " ").trim().slice(0, 300);
}

/** What an empty balance says when the service gave no words of its own. */
export const EMPTY_WORDS = "Your Bloks credits have run out.";

type Fetch = typeof fetch;

/** How long a failed trade is left before the next look tries again. A
 * refresh after a 401, or a new licence, does not wait for it. */
const EXCHANGE_PAUSE_MS = 30_000;

/**
 * The token, kept and renewed. One exchange at a time: a dozen turns
 * that all hit a 401 together trade the licence once, not twelve times.
 */
export class CreditsAccount {
  private readonly store: CreditsStore;
  private readonly fetch: Fetch;
  private readonly envToken: () => string | null;
  private exchanging: Promise<string | null> | null = null;
  /** When a trade last failed. The engine's health is asked often, and a
   * service that is down is not asked again on every look. */
  private failedAt = 0;
  private readonly now: () => number;
  /** Why there is no token right now, in words a screen can show. Never
   * the licence or the token. */
  problem: string | null = null;

  constructor(opts: { store: CreditsStore; fetch?: Fetch; envToken?: () => string | null; now?: () => number }) {
    this.store = opts.store;
    this.now = opts.now ?? Date.now;
    this.fetch = opts.fetch ?? ((...args) => fetch(...args));
    this.envToken = opts.envToken ?? creditsEnvToken;
  }

  /** A token came with the process, and is what this host uses. */
  fromEnvironment(): boolean {
    return Boolean(this.envToken());
  }

  /** Whether a token could be had: one in hand, or a licence to trade. */
  canConnect(): boolean {
    const saved = this.store.read();
    return Boolean(this.envToken() || saved.token || saved.licence);
  }

  /** The token to send now, trading the licence for one when there is
   * none yet. Null when there is no way to get one. */
  async token(): Promise<string | null> {
    const env = this.envToken();
    if (env) return env;
    const saved = this.store.read();
    if (saved.token) return saved.token;
    if (!saved.licence) {
      this.problem = "Add your Bloks Cloud key to use credits.";
      return null;
    }
    if (this.now() - this.failedAt < EXCHANGE_PAUSE_MS) return null;
    return this.exchange();
  }

  /** Asked after a 401: a new token, or null. `rejected` is the one that
   * was refused, so a refresh another caller already finished is used
   * rather than traded for again. */
  async refresh(rejected?: string): Promise<string | null> {
    const env = this.envToken();
    if (env) {
      // nothing to trade: the token came from whoever started this host
      this.problem = "The credits token this host was started with was not accepted.";
      return null;
    }
    const saved = this.store.read();
    if (saved.token && rejected !== undefined && saved.token !== rejected) return saved.token;
    if (saved.token) this.store.write({ token: null });
    if (!saved.licence) {
      this.problem = "Add your Bloks Cloud key to use credits.";
      return null;
    }
    return this.exchange();
  }

  /** A new licence: the old token goes with the old one. */
  setLicence(licence: string): void {
    const saved = this.store.read();
    if (saved.licence === licence && saved.token) return;
    this.store.write({ licence, token: null });
    this.problem = null;
    this.failedAt = 0;
  }

  /** Forget the token, and the licence too when asked. */
  forget(opts: { licence?: boolean } = {}): void {
    this.store.write({ token: null, ...(opts.licence ? { licence: null } : {}) });
  }

  private exchange(): Promise<string | null> {
    if (this.exchanging) return this.exchanging;
    this.exchanging = (async () => {
      const licence = this.store.read().licence;
      if (!licence) return null;
      // set now and cleared on success, so every way out below counts
      this.failedAt = this.now();
      let res: Response;
      try {
        res = await this.fetch(`${creditsBase()}/token`, {
          method: "POST",
          // The licence as a bearer, the way Bloks Cloud takes it when a
          // space is opened, and the machine's name so the person can tell
          // their tokens apart when they revoke one.
          headers: { authorization: `Bearer ${licence}`, "content-type": "application/json" },
          body: JSON.stringify({ host: hostname().slice(0, 120) }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        // never the thrown message: a failed fetch can quote its request
        this.problem = "Bloks credits could not be reached. Check the connection and try again.";
        return null;
      }
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        const said = serviceWords(text);
        this.problem =
          said ||
          (res.status === 401 || res.status === 403
            ? "That Bloks Cloud key was not accepted for credits."
            : `Bloks credits answered HTTP ${res.status}.`);
        return null;
      }
      let token = "";
      try {
        const parsed = JSON.parse(text) as { token?: unknown };
        token = typeof parsed.token === "string" ? parsed.token.trim() : "";
      } catch {
        /* not JSON; said below */
      }
      if (!token) {
        this.problem = "Bloks credits answered without a token.";
        return null;
      }
      this.store.write({ token });
      this.problem = null;
      this.failedAt = 0;
      return token;
    })().finally(() => {
      this.exchanging = null;
    });
    return this.exchanging;
  }

  /** The balance, as the service says it. A 401 is answered by one
   * refresh and one more try; anything else comes back as an error with
   * the service's own words. */
  async balance(): Promise<CreditsBalance> {
    let token = await this.token();
    if (!token) throw new Error(this.problem ?? "No credits token.");
    const ask = (bearer: string) =>
      this.fetch(`${creditsBase()}/balance`, {
        headers: { authorization: `Bearer ${bearer}` },
        signal: AbortSignal.timeout(10_000),
      });
    let res: Response;
    try {
      res = await ask(token);
      if (res.status === 401) {
        await res.body?.cancel().catch(() => {});
        const fresh = await this.refresh(token);
        if (!fresh) throw new Error(this.problem ?? "The credits token was not accepted.");
        token = fresh;
        res = await ask(token);
      }
    } catch (error) {
      if (error instanceof Error && !/fetch failed|network|timeout|abort/i.test(error.message)) throw error;
      throw new Error("Bloks credits could not be reached.");
    }
    const text = await res.text().catch(() => "");
    if (!res.ok) throw new Error(serviceWords(text) || `Bloks credits answered HTTP ${res.status}.`);
    return readBalance(text);
  }
}

/** A balance answer, checked one field at a time: another service's JSON,
 * any field of which a bad day could deliver as null or a string. */
export function readBalance(text: string, now = Date.now()): CreditsBalance {
  let parsed: Record<string, unknown> = {};
  try {
    const value = JSON.parse(text);
    if (value && typeof value === "object") parsed = value as Record<string, unknown>;
  } catch {
    /* read as empty below */
  }
  const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const balance = number(parsed.balance);
  if (balance === null) throw new Error("Bloks credits answered without a balance.");
  const currency = typeof parsed.currency === "string" && /^[A-Za-z]{3}$/.test(parsed.currency) ? parsed.currency.toUpperCase() : "USD";
  return { balance, currency, lowAt: number(parsed.lowAt), autoReload: parsed.autoReload === true, at: now };
}

/** What the generic driver needs from whoever holds a credential that
 * can change while the engine is loaded (server/drivers/openai-compat.ts). */
export interface CompatAccess {
  token(): Promise<string | null>;
  refresh(rejected: string): Promise<string | null>;
  problem(): string | null;
}

/**
 * The Bloks engine's credential, for the driver registered at startup.
 * The driver list is built before the server has read its settings, so
 * the account is handed in afterwards (`use`); until then there is no
 * token and the engine says so.
 */
let current: CreditsAccount | null = null;
export const creditsAccess: CompatAccess & { use(account: CreditsAccount | null): void } = {
  use(account) {
    current = account;
  },
  token: async () => (current ? current.token() : null),
  refresh: async (rejected) => (current ? current.refresh(rejected) : null),
  problem: () => current?.problem ?? null,
};
