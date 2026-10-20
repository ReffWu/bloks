// What a model's tokens cost, by the providers' list prices.
//
// Most API engines say how many tokens a turn used and nothing about
// what it cost; only OpenRouter puts a price in its answers. Without a
// price, a spending limit on Gemini or on a host of the person's own
// counts nothing, which is a limit in name only. OpenRouter also
// publishes, with no key, nearly every lab's models and what each one
// charges per token. So a turn that came back unpriced is priced from
// that list: its tokens at the model's rates, kept as an estimate and
// shown as one (server/usage.ts), never passed off as the bill.
//
// The list is asked for at most once a day, kept in the data folder with
// when it was fetched, and everything works from that copy, or from
// nothing: with no list and no price of the person's own, a turn stays
// unpriced, as it always was. A model the list does not name is never
// matched to a near neighbour. A wrong price is worse than none, because
// a limit would then be held to a figure nobody gave.
//
// The person's own price per million tokens for an engine (config.json,
// spendPrices) comes ahead of the list: a host of their own, or a model
// the list does not know, is priced the way they say.
//
// Everything but PriceBook's fetch and file is pure.

import { readFileSync } from "node:fs";

import { writeFileAtomic } from "./atomic-write.ts";

/** OpenRouter's public model list. No key, and nothing about the person
 * goes with the request. */
export const PRICES_URL = "https://openrouter.ai/api/v1/models";

/** A list this old is asked for again. */
export const PRICES_TTL_MS = 24 * 60 * 60_000;
/** After a fetch that failed, how long before trying again: offline is
 * the usual reason, and an hour asks little of anybody's network. */
export const PRICES_RETRY_MS = 60 * 60_000;

/** US dollars per token. */
export interface TokenPrice {
  input: number;
  output: number;
  /** Input read from the provider's cache, when it prices that apart. */
  cachedInput?: number;
}

export interface PriceEntry extends TokenPrice {
  /** When the model was listed, epoch seconds, to tell which of a
   * family is the newest for an id ending in "-latest". */
  created?: number;
}

/** The list as kept: prices by OpenRouter id, and the dated ids a lab
 * uses (OpenRouter's canonical slugs) pointing at them. */
export interface PriceList {
  /** Epoch milliseconds. */
  fetchedAt: number;
  prices: Record<string, PriceEntry>;
  aliases: Record<string, string>;
}

/** What a turn used, in tokens. `cachedInput` is part of `input`. */
export interface TokensUsed {
  input: number;
  output: number;
  cachedInput?: number;
}

// ── reading the list ───────────────────────────────────────────────────

/** A rate from the list: a string of dollars per token, or nothing.
 * OpenRouter writes -1 for a router whose price depends on where it
 * sends the request, which is no rate at all. */
function rate(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(n) && n >= 0 && n < 1 ? n : undefined;
}

/**
 * The list from what OpenRouter sent, or null when it is not one. Kept:
 * every model with an input and an output rate. Left out: a variant of
 * another model (":free", ":batch" and the like), whose price is a deal
 * on OpenRouter and not the lab's own; a router, whose price is no
 * model's; and a model at no price at all, which on the lab's own API
 * would not be free, so a zero there would be a guess.
 */
export function parsePriceList(json: unknown, fetchedAt: number): PriceList | null {
  const rows = (json as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return null;
  const prices: Record<string, PriceEntry> = {};
  const aliases: Record<string, string> = {};
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as { id?: unknown; canonical_slug?: unknown; created?: unknown; pricing?: Record<string, unknown> };
    if (typeof r.id !== "string" || !r.id.includes("/") || r.id.includes(":")) continue;
    const id = r.id.toLowerCase();
    if (id.startsWith("openrouter/")) continue;
    const input = rate(r.pricing?.prompt);
    const output = rate(r.pricing?.completion);
    if (input === undefined || output === undefined || (input === 0 && output === 0)) continue;
    const entry: PriceEntry = { input, output };
    const cached = rate(r.pricing?.input_cache_read);
    if (cached !== undefined) entry.cachedInput = cached;
    if (typeof r.created === "number" && Number.isFinite(r.created)) entry.created = r.created;
    prices[id] = entry;
    if (typeof r.canonical_slug === "string") {
      const slug = r.canonical_slug.toLowerCase();
      if (slug !== id && !slug.includes(":") && !(slug in aliases)) aliases[slug] = id;
    }
  }
  // a slug that is itself somebody's id is that model, not an alias
  for (const slug of Object.keys(aliases)) if (slug in prices) delete aliases[slug];
  return { fetchedAt, prices, aliases };
}

function isPriceList(value: unknown): value is PriceList {
  const v = value as PriceList | null;
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v.fetchedAt === "number" &&
    typeof v.prices === "object" &&
    v.prices !== null &&
    typeof v.aliases === "object" &&
    v.aliases !== null
  );
}

// ── matching a model to the list ───────────────────────────────────────

/** A lab's prefix as people write it, to the namespace the list files it
 * under. Meta has two there: its Llama models and the rest. */
const VENDORS: Record<string, string[]> = {
  openai: ["openai"],
  anthropic: ["anthropic"],
  google: ["google"],
  "x-ai": ["x-ai"],
  xai: ["x-ai"],
  deepseek: ["deepseek"],
  "deepseek-ai": ["deepseek"],
  mistralai: ["mistralai"],
  mistral: ["mistralai"],
  "meta-llama": ["meta-llama"],
  meta: ["meta-llama", "meta"],
  qwen: ["qwen"],
  alibaba: ["qwen"],
  moonshotai: ["moonshotai"],
  moonshot: ["moonshotai"],
};

/** A lab from how its models are named, for an id with no prefix. */
const FAMILIES: Array<[RegExp, string]> = [
  [/^(gpt-|o\d|chatgpt-|codex-)/, "openai"],
  [/^claude-/, "anthropic"],
  [/^(gemini|gemma)/, "google"],
  [/^grok/, "x-ai"],
  [/^deepseek/, "deepseek"],
  [/^(mistral|mixtral|magistral|codestral|devstral|ministral|pixtral|voxtral|open-mistral|open-mixtral)/, "mistralai"],
  [/^llama/, "meta-llama"],
  [/^(qwen|qwq)/, "qwen"],
  [/^(kimi|moonshot)/, "moonshotai"],
];

/** The lab behind an engine that serves only its own models, for a model
 * whose name says nothing (a Moonshot "moonshot-v1" says enough, but an
 * engine is the better witness when a name is bare). */
const ENGINE_VENDOR: Record<string, string> = {
  gemini: "google",
  grok: "x-ai",
  kimi: "moonshotai",
  deepseek: "deepseek",
  mistral: "mistralai",
  llama: "meta-llama",
};

/** How a host says which build of the same model it runs, which changes
 * nothing about whose model it is. */
const HOST_TAG = /-(fp8|fp16|bf16|int4|int8|awq|gguf|versatile|instant)$/;
/** A date or a dated build at the end of an id. */
const FULL_DATE = /-(\d{4}-\d{2}-\d{2}|\d{8})$/;
const SHORT_DATE = /-(\d{2}-\d{2}|\d{4})$/;

/** Versions written with dashes where the list writes a dot: Anthropic's
 * "claude-sonnet-4-5" is the list's "claude-sonnet-4.5". Only a single
 * digit either side, so a date or a size is never read as a version. */
const dotted = (name: string) => name.replace(/(^|-)(\d)-(\d)(?=-|$)/g, "$1$2.$3");

/** The spellings of one model's name worth looking up, most exact first. */
function spellings(name: string, vendor: string): string[] {
  const out: string[] = [];
  const add = (n: string) => {
    if (n && !out.includes(n)) out.push(n);
    const d = dotted(n);
    if (d !== n && !out.includes(d)) out.push(d);
  };
  let n = name;
  add(n);
  while (HOST_TAG.test(n)) add((n = n.replace(HOST_TAG, "")));
  // xAI sells one model with thinking on or off at one price
  if (vendor === "x-ai") add((n = n.replace(/-(non-)?reasoning$/, "")));
  // Moonshot calls most of its models "preview", and the list does not
  if (vendor === "moonshotai") {
    add((n = n.replace(/-preview$/, "")));
    add(n.replace(/-instruct$/, ""));
  }
  const undated = n.replace(FULL_DATE, "");
  if (undated !== n) add((n = undated));
  else {
    const short = n.replace(SHORT_DATE, "");
    if (short !== n) add(short);
  }
  // a Llama a host serves under its size alone is the instruct model
  if (vendor === "meta-llama") for (const s of [...out]) if (!s.endsWith("-instruct")) add(`${s}-instruct`);
  return out;
}

/**
 * Which listed model a turn ran on, or null when the list does not have
 * it. `engine` is the engine's driver kind ("gemini", "custom", ...),
 * used only for a model whose name does not say whose it is. Pure.
 *
 * An id is taken as the lab names it ("gemini-2.5-pro",
 * "claude-sonnet-4-5-20250929", "models/gemini-2.5-flash"), as a host
 * names it with the lab in front ("meta-llama/Llama-3.3-70B-Instruct",
 * "openai/gpt-oss-120b"), or as OpenRouter does. Only an exact name in
 * the list counts, after the spellings above: a date taken off, a dash
 * for a dot, a host's build tag. "-latest" is the newest of that name.
 */
export function matchModel(list: Pick<PriceList, "prices" | "aliases">, engine: string, model: string): string | null {
  const raw = model.trim().toLowerCase();
  if (!raw) return null;
  const look = (key: string): string | null => (key in list.prices ? key : (list.aliases[key] ?? null));

  // already as the list writes it, whoever made it
  const exact = look(raw);
  if (exact) return exact;

  let name = raw.replace(/^.*\bmodels\//, "");
  let vendors: string[] = [];
  const slash = name.indexOf("/");
  if (slash > 0) {
    const named = VENDORS[name.slice(0, slash)];
    // a lab the list is not asked about here is matched exactly or not at all
    if (!named) return null;
    vendors = named;
    name = name.slice(slash + 1);
  } else {
    const family = FAMILIES.find(([pattern]) => pattern.test(name))?.[1] ?? ENGINE_VENDOR[engine];
    if (family) vendors = [family];
  }
  if (!vendors.length || !name || name.includes("/") || name.includes(":")) return null;

  for (const vendor of vendors) {
    if (name.endsWith("-latest")) {
      const found = newest(list, vendor, name.slice(0, -"-latest".length));
      if (found) return found;
      continue;
    }
    for (const spelling of spellings(name, vendor)) {
      const found = look(`${vendor}/${spelling}`);
      if (found) return found;
    }
  }
  return null;
}

/** The newest listed model of a name: OpenRouter's own "-latest" when it
 * keeps one, else the most recently listed model called that name, or
 * that name and a version after it. */
function newest(list: Pick<PriceList, "prices">, vendor: string, base: string): string | null {
  for (const b of new Set([base, dotted(base)])) {
    const alias = `~${vendor}/${b}-latest`;
    if (alias in list.prices) return alias;
    const stem = `${vendor}/${b}`;
    let best: string | null = null;
    let bestAt = -1;
    for (const [id, entry] of Object.entries(list.prices)) {
      if (id !== stem && !(id.startsWith(`${stem}-`) && /^\d/.test(id.slice(stem.length + 1)))) continue;
      const at = (entry as PriceEntry).created ?? 0;
      if (at > bestAt) [best, bestAt] = [id, at];
    }
    if (best) return best;
  }
  return null;
}

// ── the arithmetic ─────────────────────────────────────────────────────

/** What a turn's tokens come to at a price, in dollars. Input read from
 * the cache is at the cache's rate when there is one, and at the full
 * rate when there is not, which can only overstate it. */
export function estimateCost(price: TokenPrice, used: TokensUsed): number {
  const input = Math.max(0, Number.isFinite(used.input) ? used.input : 0);
  const output = Math.max(0, Number.isFinite(used.output) ? used.output : 0);
  const cached = Math.min(input, Math.max(0, Number.isFinite(used.cachedInput) ? (used.cachedInput as number) : 0));
  return (input - cached) * price.input + cached * (price.cachedInput ?? price.input) + output * price.output;
}

/** The person's own price for an engine, in dollars per million tokens
 * as a provider's price page writes it. */
export interface OwnPrice {
  input: number;
  output: number;
}

/** The most a price per million anybody could mean. */
export const MAX_PER_MILLION = 10_000;

/** One rate as asked for: dollars per million, zero or more, to a tenth
 * of a cent. Undefined is not one. */
function perMillion(value: unknown): number | undefined {
  // an empty field is no answer, not a price of nothing
  if (typeof value === "string" && !value.trim()) return undefined;
  const n = typeof value === "string" ? Number(value.trim().replace(/^\$/, "")) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > MAX_PER_MILLION) return undefined;
  return Math.round(n * 1000) / 1000;
}

/** An own price as asked for, null to take it off, or undefined when it
 * is neither. Both rates free is no price, and is refused. */
export function readOwnPrice(value: unknown): OwnPrice | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const input = perMillion(v.input);
  const output = perMillion(v.output);
  if (input === undefined || output === undefined || (input === 0 && output === 0)) return undefined;
  return { input, output };
}

/** An own price per million, as a rate per token. */
export function ownTokenPrice(own: OwnPrice): TokenPrice {
  return { input: own.input / 1e6, output: own.output / 1e6 };
}

/**
 * What a turn that came back unpriced is estimated at, or null for no
 * estimate. The person's own price for the engine first, then the list's
 * for its model; neither, and it stays unpriced. A turn of no tokens is
 * no estimate either: it says nothing, which is not the same as free.
 */
export function estimateTurn(
  used: TokensUsed & { model: string },
  engine: string,
  own: OwnPrice | null | undefined,
  list: Pick<PriceList, "prices" | "aliases"> | null,
): { cost: number; source: "own" | "list"; id?: string } | null {
  if (!(used.input > 0) && !(used.output > 0)) return null;
  if (own) return { cost: estimateCost(ownTokenPrice(own), used), source: "own" };
  if (!list) return null;
  const id = matchModel(list, engine, used.model);
  if (!id) return null;
  return { cost: estimateCost(list.prices[id], used), source: "list", id };
}

// ── the copy in the data folder ────────────────────────────────────────

export interface PriceBookOptions {
  /** Where the list is kept between runs. */
  file: string;
  url?: string;
  /** Fetches the list and returns its JSON. Injectable, so a test never
   * reaches the network. */
  fetchList?: (url: string) => Promise<unknown>;
  now?: () => number;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`price list HTTP ${res.status}`);
  return res.json();
}

/**
 * The price list, from the data folder, refreshed at most once a day.
 * Nothing waits on it: a turn is priced from whatever copy there is, and
 * a refresh happens beside it for the turns after.
 */
export class PriceBook {
  private list: PriceList | null | undefined;
  private lastTry = -Infinity;
  private pending: Promise<boolean> | null = null;
  private readonly file: string;
  private readonly url: string;
  private readonly fetchList: (url: string) => Promise<unknown>;
  private readonly now: () => number;

  constructor(options: PriceBookOptions) {
    this.file = options.file;
    this.url = options.url ?? PRICES_URL;
    this.fetchList = options.fetchList ?? fetchJson;
    this.now = options.now ?? Date.now;
  }

  /** The list as last kept, or null when there is none. A copy that will
   * not read is the same as none: the next fetch replaces it, and it was
   * only ever a convenience. */
  current(): PriceList | null {
    if (this.list === undefined) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(this.file, "utf8"));
        this.list = isPriceList(parsed) ? parsed : null;
      } catch {
        this.list = null;
      }
    }
    return this.list;
  }

  /** Fetched within the day. A fetch time ahead of the clock (the clock
   * was put back) is not trusted to be fresh. */
  fresh(): boolean {
    const list = this.current();
    if (!list) return false;
    const age = this.now() - list.fetchedAt;
    return age >= 0 && age < PRICES_TTL_MS;
  }

  /** Fetches the list when it is a day old or missing, and not more than
   * once an hour after a fetch that failed. Resolves to whether a fresh
   * list is in hand; never rejects. */
  refresh(): Promise<boolean> {
    if (this.fresh()) return Promise.resolve(true);
    if (this.pending) return this.pending;
    const now = this.now();
    if (now - this.lastTry < PRICES_RETRY_MS) return Promise.resolve(false);
    this.lastTry = now;
    this.pending = (async () => {
      try {
        const list = parsePriceList(await this.fetchList(this.url), this.now());
        // an empty answer would wipe a good copy for nothing
        if (!list || !Object.keys(list.prices).length) return false;
        this.list = list;
        try {
          writeFileAtomic(this.file, JSON.stringify(list), 0o600, { flush: false });
        } catch {
          /* kept in memory for this run; the next run asks again */
        }
        return true;
      } catch {
        return false;
      } finally {
        this.pending = null;
      }
    })();
    return this.pending;
  }

  /** What a turn that came back unpriced is estimated at (estimateTurn),
   * from the list as it stands. */
  estimate(used: TokensUsed & { model: string }, engine: string, own?: OwnPrice | null) {
    return estimateTurn(used, engine, own, this.current());
  }
}
