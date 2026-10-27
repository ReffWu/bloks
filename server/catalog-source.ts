// Where the catalogue comes from, and what is kept of it here.
//
// The index is fetched from one URL and held for half an hour, like the
// skill registry before it. What is new is that it is also kept on disk,
// with every item it lists, so the catalogue still opens on a plane: the
// page says how old its copy is rather than showing an error where the
// list was.
//
// Items are kept by the sha256 the index gave them, and an item is only
// ever kept, or handed to anything, after its bytes were hashed and
// matched. A copy on disk is hashed again when it is read, so a file
// changed in the cache is refused the same way a changed download is.
//
// A link somebody pastes is fetched by the same careful reader, with no
// index to check it against: what arrives is shown in full before it can
// be installed, and installing uses those exact bytes, held in memory
// for the review (StagedReviews), rather than fetching the link again.
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import { readSaved, writeFileAtomic } from "./atomic-write.ts";
import {
  CATALOG_INDEX_MAX_BYTES,
  CATALOG_ITEM_MAX_BYTES,
  CATALOG_TTL_MS,
  CatalogError,
  itemUrl,
  parseIndex,
  sha256Hex,
  verifyItem,
  type CatalogItem,
} from "./catalog.ts";

type Fetch = typeof fetch;

/** The index as last fetched, and when. */
export interface IndexCopy {
  url: string;
  fetchedAt: number;
  items: CatalogItem[];
}

export interface IndexAnswer extends IndexCopy {
  /** True when this is the copy on disk because the fetch failed. */
  offline: boolean;
  /** Why the fetch failed, when it did. */
  error?: string;
}

/**
 * Whether an address may serve the catalogue: https anywhere, or plain
 * http on this machine's own loopback, for somebody running a catalogue
 * of their own while they write it.
 */
export function checkSourceUrl(raw: unknown): { ok: true; url: string } | { ok: false; error: string } {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, error: "Give the address of a catalogue's index.json." };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: "That is not an address." };
  }
  if (url.username || url.password) return { ok: false, error: "An address with a sign-in in it is not used." };
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    return { ok: false, error: "A catalogue is read over https, or plain http on this computer only." };
  }
  if (!/\.json$/i.test(url.pathname)) return { ok: false, error: "Point at the catalogue's index.json." };
  url.hash = "";
  return { ok: true, url: url.toString() };
}

/**
 * A response's body, up to a limit, and an error past it. Read as it
 * arrives rather than trusting a content-length the server may not send
 * or may not tell the truth in.
 */
export async function readLimited(response: Response, max: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > max) throw new CatalogError("That file is too large to install.", 413);
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new CatalogError("That file is too large to install.", 413);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

export class CatalogSource {
  private readonly dir: string;
  private readonly url: () => string;
  private readonly fetcher: Fetch;
  private readonly now: () => number;
  private held: IndexCopy | null = null;
  private prefetching: Promise<void> | null = null;

  constructor(options: { dir: string; url: () => string; fetch?: Fetch; now?: () => number }) {
    this.dir = options.dir;
    this.url = options.url;
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  private get indexFile() {
    return join(this.dir, "index.json");
  }

  private get itemsDir() {
    return join(this.dir, "items");
  }

  /** The copy on disk, for this source only: a catalogue somebody pointed
   * away from is not the one they are looking at now. */
  private onDisk(url: string): IndexCopy | null {
    const saved = readSaved<IndexCopy | null>(this.indexFile, null, (v): v is IndexCopy => Boolean(v && typeof v === "object"));
    if (!saved || saved.url !== url || typeof saved.fetchedAt !== "number") return null;
    try {
      return { url, fetchedAt: saved.fetchedAt, items: parseIndex({ items: saved.items }) };
    } catch {
      return null;
    }
  }

  /**
   * The index: fresh within the half hour, fetched past it, and the copy
   * on disk when the fetch fails. Only a fetch that fails with nothing
   * kept is an error.
   */
  async index(force = false): Promise<IndexAnswer> {
    const url = this.url();
    if (this.held && this.held.url !== url) this.held = null;
    const memory = this.held ?? this.onDisk(url);
    if (!force && memory && this.now() - memory.fetchedAt < CATALOG_TTL_MS) {
      this.held = memory;
      return { ...memory, offline: false };
    }
    try {
      const response = await this.fetcher(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new CatalogError(`the catalogue answered HTTP ${response.status}`, 502);
      const bytes = await readLimited(response, CATALOG_INDEX_MAX_BYTES);
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new CatalogError("the catalogue's index is not JSON", 502);
      }
      const items = parseIndex(parsed);
      const copy: IndexCopy = { url, fetchedAt: this.now(), items };
      this.held = copy;
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      writeFileAtomic(this.indexFile, JSON.stringify(copy), 0o600);
      this.prefetch(copy);
      return { ...copy, offline: false };
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      if (memory) {
        this.held = memory;
        return { ...memory, offline: true, error: why };
      }
      throw new CatalogError(`The catalogue could not be reached: ${why}`, 502);
    }
  }

  /** An item's bytes from the cache, hashed again on the way out. */
  cached(item: Pick<CatalogItem, "size" | "sha256">): Uint8Array | null {
    try {
      const bytes = new Uint8Array(readFileSync(join(this.itemsDir, item.sha256)));
      return verifyItem(item, bytes) ? bytes : null;
    } catch {
      return null;
    }
  }

  /** An item's text, from the cache or fetched, and only ever after it
   * matched the index. A mismatch is refused and nothing is kept. */
  async item(item: CatalogItem, indexUrl?: string): Promise<string> {
    const kept = this.cached(item);
    if (kept) return new TextDecoder().decode(kept);
    const from = itemUrl(indexUrl ?? this.held?.url ?? this.url(), item);
    let response: Response;
    try {
      response = await this.fetcher(from, { headers: { accept: "text/markdown, text/plain" }, signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      throw new CatalogError(`${item.title} could not be fetched, and there is no copy here: ${e instanceof Error ? e.message : String(e)}`, 502);
    }
    if (!response.ok) throw new CatalogError(`${item.title} could not be fetched: HTTP ${response.status}`, 502);
    const bytes = await readLimited(response, CATALOG_ITEM_MAX_BYTES);
    if (!verifyItem(item, bytes)) {
      throw new CatalogError(
        `${item.title} does not match the catalogue's fingerprint for it, so it was not installed. The file may have changed after the index was made; try again later.`,
        409,
      );
    }
    this.keep(item.sha256, bytes);
    return new TextDecoder().decode(bytes);
  }

  private keep(sha: string, bytes: Uint8Array) {
    mkdirSync(this.itemsDir, { recursive: true, mode: 0o700 });
    writeFileAtomic(join(this.itemsDir, sha), Buffer.from(bytes), 0o600);
  }

  /**
   * Every item the index lists, fetched in the background after a fresh
   * index, so the catalogue installs offline later too. A few at a time,
   * and an item that fails is simply not kept: browsing never waits on
   * this. Copies the index no longer lists are cleared.
   */
  prefetch(copy: IndexCopy): Promise<void> {
    if (this.prefetching) return this.prefetching;
    const run = async () => {
      const queue = copy.items.filter((item) => !this.cached(item));
      const worker = async () => {
        for (let item = queue.shift(); item; item = queue.shift()) {
          await this.item(item, copy.url).catch(() => {});
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      const wanted = new Set(copy.items.map((i) => i.sha256));
      try {
        for (const name of readdirSync(this.itemsDir)) {
          if (wanted.has(name)) continue;
          rmSync(join(this.itemsDir, name), { force: true });
        }
      } catch {
        /* nothing kept yet */
      }
    };
    this.prefetching = run().finally(() => {
      this.prefetching = null;
    });
    return this.prefetching;
  }

  /** For a test: wait for the background fetch to settle. */
  settled(): Promise<void> {
    return this.prefetching ?? Promise.resolve();
  }

  /** A link's file, fetched with the same limits as an item. */
  async fetchLink(url: string): Promise<{ text: string; sha256: string; size: number }> {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        headers: { accept: "text/markdown, text/plain" },
        signal: AbortSignal.timeout(15_000),
        redirect: "follow",
      });
    } catch (e) {
      throw new CatalogError(`That link could not be fetched: ${e instanceof Error ? e.message : String(e)}`, 502);
    }
    // a redirect off https is the same as a plain http link
    if (response.url && !response.url.startsWith("https:")) throw new CatalogError("That link led somewhere that is not https.", 400);
    if (!response.ok) throw new CatalogError(`That link answered HTTP ${response.status}.`, 502);
    const type = response.headers.get("content-type") ?? "";
    if (/text\/html/i.test(type)) throw new CatalogError("That link is a web page, not a file. Link to the raw file.", 400);
    const bytes = await readLimited(response, CATALOG_ITEM_MAX_BYTES);
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new CatalogError("That file is not text.", 400);
    }
    return { text, sha256: sha256Hex(bytes), size: bytes.byteLength };
  }

  /** How much is kept on disk, for the page's footer. */
  usage(): { items: number; bytes: number } {
    try {
      const names = readdirSync(this.itemsDir);
      return { items: names.length, bytes: names.reduce((n, name) => n + statSync(join(this.itemsDir, name)).size, 0) };
    } catch {
      return { items: 0, bytes: 0 };
    }
  }
}

// ── what was installed ────────────────────────────────────────────────

/** A team installed from the catalogue or a link, remembered so that a
 * newer version can be offered as an update with what changed, and so
 * an update knows which agents are the team's and what they were given. */
export interface TeamInstall {
  /** `team:<id>` for a catalogue item, `link:<url>` for a link. */
  key: string;
  title: string;
  version: string;
  sha256: string;
  /** The file as installed, which the next version is compared with. */
  text: string;
  roomId: string;
  members: Array<{ title: string; botId: string; description: string; skills: string[]; uses: string[] }>;
  routineIds: string[];
  installedAt: number;
  updatedAt?: number;
}

const MAX_RECORDS = 200;

export class CatalogInstalls {
  private records: TeamInstall[];
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
    this.records = readSaved<TeamInstall[]>(file, [], Array.isArray).filter((r) => r && typeof r.key === "string" && typeof r.roomId === "string");
  }

  get(key: string): TeamInstall | null {
    return this.records.find((r) => r.key === key) ?? null;
  }

  list(): TeamInstall[] {
    return this.records;
  }

  put(record: TeamInstall) {
    this.records = [record, ...this.records.filter((r) => r.key !== record.key)].slice(0, MAX_RECORDS);
    this.save();
  }

  /** A room that is gone takes its record with it: there is nothing left
   * to update, and installing again is a fresh install. */
  forgetRoom(roomId: string) {
    const before = this.records.length;
    this.records = this.records.filter((r) => r.roomId !== roomId);
    if (this.records.length !== before) this.save();
  }

  private save() {
    writeFileAtomic(this.file, JSON.stringify(this.records, null, 2), 0o600);
  }
}

/** Reviewed bytes, held until the person says install or the half hour
 * is up. Installing reads these, never the link again. */
export interface Staged {
  token: string;
  kind: "team" | "skill";
  text: string;
  sha256: string;
  origin: "catalogue" | "link" | "file";
  /** The catalogue item, when it is one. */
  item?: CatalogItem;
  /** The link, when it came from one. */
  url?: string;
  /** For a team: the catalogue's skills it uses, already checked. */
  skills?: Record<string, string>;
  /** For a skill: the id the review showed, so a file with no name of
   * its own installs under the one its filename gave it. */
  skillId?: string;
  at: number;
}

export const STAGED_TTL_MS = 30 * 60 * 1000;
const MAX_STAGED = 50;

export class StagedReviews {
  private staged = new Map<string, Staged>();

  put(entry: Omit<Staged, "token" | "at">, token: string, now = Date.now()): Staged {
    this.sweep(now);
    if (this.staged.size >= MAX_STAGED) {
      const oldest = [...this.staged.values()].sort((a, b) => a.at - b.at)[0];
      if (oldest) this.staged.delete(oldest.token);
    }
    const staged: Staged = { ...entry, token, at: now };
    this.staged.set(token, staged);
    return staged;
  }

  take(token: unknown, now = Date.now()): Staged | null {
    this.sweep(now);
    if (typeof token !== "string") return null;
    const found = this.staged.get(token) ?? null;
    if (found) this.staged.delete(token);
    return found;
  }

  peek(token: unknown, now = Date.now()): Staged | null {
    this.sweep(now);
    return typeof token === "string" ? (this.staged.get(token) ?? null) : null;
  }

  private sweep(now: number) {
    for (const [token, entry] of this.staged) if (now - entry.at > STAGED_TTL_MS) this.staged.delete(token);
  }
}
