// Updating bloks-server from the app (GitHub 396).
//
// The desktop app updates itself, and the server inside it with it. A
// bloks-server on a computer of its own (bin/bloks-server.mjs, unpacked
// from the release's tarball) had no way forward but a shell on that
// computer, and the app said nothing to tell its own version from the
// server's. This is the owner's way to update that server from their own
// devices, and the plain steps to do it by hand where it cannot.
//
// The parts, in the order an update takes them:
//
//   How it was installed decides whether it may update itself at all
//   (installOf). Only a tarball install started by bloks-server, in a
//   folder the account it runs as can write, with nothing else that
//   starts or replaces it. Under systemd, launchd, pm2 or supervisord, in
//   a container, on a hosted machine, from a source checkout or inside
//   the desktop app, updating itself would fight whatever owns it, so the
//   owner is told the steps instead.
//
//   The release is GitHub's latest stable one, only its server tarball,
//   and only once that matches the sha256 the release publishes beside it
//   (and GitHub's own digest of the file, when GitHub gives one). A
//   release with no checksum is not installed from here.
//
//   It is unpacked beside the version that runs, under versions/ in the
//   install folder, and nothing is switched until all of it is there.
//
//   Running work is drained (server/drain.ts), then the server hands over
//   to a small helper (server/server-update-finish.ts) and stops. The
//   helper switches versions/current to the new version in one rename,
//   starts it, and waits for it to answer as that version. If it does
//   not, the helper stops it, switches back, and starts the old one
//   again. Either way it writes down what happened, for the app to say.
//
// The data folder is not touched by any of it.
import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import {
  accessSync,
  closeSync,
  constants,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { isRecord, writeFileAtomic } from "./atomic-write.ts";
import { OWN_GROUP } from "./no-console.ts";

/** Where the latest stable release is asked for, and where its files are
 * downloaded from. The environment stands in for both in tests. */
export const RELEASES_API = "https://api.github.com/repos/hamedgitty/bloks/releases/latest";
export const RELEASE_DOWNLOADS = "https://github.com/hamedgitty/bloks/releases/download";

/** Beside the install, the versions an update unpacked, and the link to
 * the one that runs. */
export const VERSIONS = "versions";
export const CURRENT = "current";

/** In the data folder: what the last update did, the helper's orders, and
 * the output of a server the helper started, which has no terminal. */
export const RECORD_FILE = "server-update.json";
export const PLAN_FILE = "server-update-plan.json";
export const LOG_FILE = "server.log";

/** The most a server tarball may be. Far more than one is. */
const MAX_TARBALL_BYTES = 512 * 1024 * 1024;

/** How long a new version has to answer before it counts as not
 * starting. A first start can migrate a large workspace. */
export const HEALTHY_WITHIN_MS = 120_000;

/** Said to the owner as it is. */
export class UpdateError extends Error {
  readonly status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.status = status;
  }
}

// ── versions ───────────────────────────────────────────────────────────

/** A stable version's three numbers; null for anything else, a
 * prerelease included. */
export function versionParts(value: unknown): [number, number, number] | null {
  if (typeof value !== "string") return null;
  const m = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(value.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Whether `a` is a later stable version than `b`. */
export function isNewer(a: unknown, b: unknown): boolean {
  const x = versionParts(a);
  const y = versionParts(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/** Whether this Node meets a package's `engines.node`. Only the ">=x.y.z"
 * form the server package uses is read; anything else is not ours to
 * judge, and passes. */
export function nodeSatisfies(range: unknown, have: string = process.versions.node): boolean {
  if (typeof range !== "string") return true;
  const m = /^\s*>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?\s*$/.exec(range);
  if (!m) return true;
  const want = [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
  const got = have.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((got[i] ?? 0) !== want[i]) return (got[i] ?? 0) > want[i];
  return true;
}

// ── how this server was installed ──────────────────────────────────────

export type InstallKind =
  | "self"
  | "desktop"
  | "hosted"
  | "checkout"
  | "container"
  | "service"
  | "windows"
  | "readonly"
  | "disabled"
  | "unknown";

export interface Install {
  kind: InstallKind;
  /** Whether it updates itself from the app. Only "self" does. */
  canInstall: boolean;
  /** The folder the release was unpacked into; updates go beside it. */
  home?: string;
  /** What starts it, when something does: "systemd", "launchd", ... */
  manager?: string;
  /** The unit, label or name the manager knows it by, when it says. */
  unit?: string;
  /** A systemd unit of the person's own (systemctl --user). */
  user?: boolean;
  /** In a sentence, why it does or does not update itself. */
  why: string;
}

/** Everything installOf reads, gathered by installFacts and handed in, so
 * every answer can be tested without being that machine. */
export interface InstallFacts {
  platform: string;
  env: NodeJS.ProcessEnv;
  /** Started by the desktop app, which gives a process a parent port. */
  desktop: boolean;
  hosted: boolean;
  /** The folder this server's code is in: above server/ or dist-server/. */
  codeRoot: string;
  container: boolean;
  /** This process's own cgroup path on Linux (the unified line), or null. */
  cgroup: string | null;
  exists(path: string): boolean;
  writable(path: string): boolean;
  packageOf(dir: string): Record<string, unknown> | null;
}

/** What starts this process and would start it again: a service
 * manager, by the marks each leaves. Null when nothing does. */
export function serviceManager(f: Pick<InstallFacts, "env" | "platform" | "cgroup">): { manager: string; unit?: string; user?: boolean } | null {
  // A systemd service, system or user, is its cgroup's last part. A
  // terminal or an ssh login is a scope, never a service, so a shell that
  // merely inherited a service's variables is not mistaken for one.
  const last = f.cgroup?.split("/").filter(Boolean).pop();
  if (last?.endsWith(".service")) return { manager: "systemd", unit: last, ...(/\/user@\d+\.service\//.test(f.cgroup ?? "") ? { user: true } : {}) };
  if (f.env.SUPERVISOR_ENABLED) return { manager: "supervisord", unit: f.env.SUPERVISOR_PROCESS_NAME || undefined };
  if (f.env.pm_id !== undefined || f.env.PM2_HOME) return { manager: "pm2", unit: f.env.name || f.env.pm_id || undefined };
  // launchd names a job's processes by its label; Terminal says "0" and an
  // app's own children say "application.<id>", which are not jobs
  const label = f.env.XPC_SERVICE_NAME;
  if (f.platform === "darwin" && label && label !== "0" && !label.startsWith("application.")) return { manager: "launchd", unit: label };
  return null;
}

/** How this server was installed, and so whether it may update itself. */
export function installOf(f: InstallFacts): Install {
  if (f.desktop) {
    return { kind: "desktop", canInstall: false, why: "This server is the one inside the Bloks app, and it updates with the app." };
  }
  if (f.hosted) {
    return {
      kind: "hosted",
      canInstall: false,
      why: "This workspace runs on a hosted machine, which gets new versions of Bloks with its image, not from here.",
    };
  }
  if (f.env.BLOKS_SERVER_UPDATES === "off") {
    return { kind: "disabled", canInstall: false, why: "Updating from the app is turned off on this server (BLOKS_SERVER_UPDATES=off)." };
  }
  // Started by bloks-server, which says which folder it ran from. A server
  // started any other way, or one whose code is not in that folder, has
  // nobody to start it again.
  const root = f.env.BLOKS_SERVER_ROOT ? resolve(f.env.BLOKS_SERVER_ROOT) : "";
  if (!root || root !== resolve(f.codeRoot)) {
    return {
      kind: "unknown",
      canInstall: false,
      why: "This server was not started with bloks-server, so Bloks can't restart it safely. Update it where it is installed, and restart it the way you started it.",
    };
  }
  if (f.exists(join(root, "server", "index.ts"))) {
    return {
      kind: "checkout",
      canInstall: false,
      home: root,
      why: `This server runs from a source checkout at ${root}. Update it there with git pull and pnpm install, then restart it.`,
    };
  }
  const home = resolve(f.env.BLOKS_SERVER_HOME || root);
  const own = f.packageOf(root);
  // the release's server, and either the folder it was unpacked into or a
  // version an update put beside it there
  const inside = root === home || dirname(root) === join(home, VERSIONS);
  if (own?.name !== "bloks-server" || !inside) {
    return {
      kind: "unknown",
      canInstall: false,
      why: "This server is not laid out the way the release unpacks, so Bloks can't update it safely. Update it where it is installed, and restart it.",
    };
  }
  if (f.container) {
    return {
      kind: "container",
      canInstall: false,
      home,
      why: "This server runs in a container, where the image decides what runs. Build the image again from the new release and recreate the container on the same volume; the workspace is kept.",
    };
  }
  if (f.platform === "win32") {
    return {
      kind: "windows",
      canInstall: false,
      home,
      why: "A server on Windows doesn't update itself yet. Stop it, unpack the new release over it, and start it again.",
    };
  }
  const managed = serviceManager(f);
  if (managed) {
    return {
      kind: "service",
      canInstall: false,
      home,
      ...managed,
      why: `${managed.manager} runs this server and would start the old version again over the new one, so update it by hand and restart it with ${managed.manager}.`,
    };
  }
  const versions = join(home, VERSIONS);
  if (!f.writable(home) || (f.exists(versions) && !f.writable(versions))) {
    return {
      kind: "readonly",
      canInstall: false,
      home,
      why: `The account Bloks runs as can't write to ${home}, where it is installed, so it can't update itself. Update it as the account that owns that folder.`,
    };
  }
  return {
    kind: "self",
    canInstall: true,
    home,
    why: `Installed at ${home}. A new version is unpacked beside this one and switched to once it is checked, and if it doesn't start, this one comes back.`,
  };
}

/** This machine's facts, for installOf. */
export function installFacts(o: { desktop: boolean; hosted: boolean; codeRoot: string; env?: NodeJS.ProcessEnv }): InstallFacts {
  const env = o.env ?? process.env;
  const read = (path: string) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return "";
    }
  };
  const self = process.platform === "linux" ? read("/proc/self/cgroup") : "";
  const init = process.platform === "linux" ? read("/proc/1/cgroup") : "";
  const container =
    existsSync("/.dockerenv") ||
    existsSync("/run/.containerenv") ||
    Boolean(env.container) ||
    Boolean(env.KUBERNETES_SERVICE_HOST) ||
    /docker|kubepods|containerd|libpod|lxc/.test(init);
  return {
    platform: process.platform,
    env,
    desktop: o.desktop,
    hosted: o.hosted,
    codeRoot: o.codeRoot,
    container,
    // the unified hierarchy's line, "0::/system.slice/bloks.service"
    cgroup: self.split("\n").find((line) => line.startsWith("0::"))?.slice(3).trim() || null,
    exists: existsSync,
    writable(path) {
      try {
        accessSync(path, constants.W_OK);
        return true;
      } catch {
        return false;
      }
    },
    packageOf(dir) {
      try {
        const parsed = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        return isRecord(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
  };
}

// ── the release ────────────────────────────────────────────────────────

export interface Release {
  version: string;
  /** The release notes, as written, cut short if long. */
  notes: string;
  /** The release's page on GitHub. */
  page: string;
  publishedAt?: string;
  tarball: { name: string; url: string; size?: number; digest?: string };
  /** The sha256 published beside the tarball; a release before 3.0.14
   * has none. */
  checksum?: { name: string; url: string };
}

const MAX_NOTES = 8_000;

/** The tarball's name for a version, as scripts/pack-server.mjs names it. */
export const tarballName = (version: string) => `bloks-server-${version}.tar.gz`;

/** A release as GitHub's API describes it, read for what an update
 * needs. The files are fetched from the official download path, built
 * here from the version, never from a URL in the answer. */
export function releaseFrom(raw: unknown, downloads: string = RELEASE_DOWNLOADS): Release {
  if (!isRecord(raw)) throw new UpdateError("GitHub's answer about the latest release didn't make sense.", 502);
  if (raw.draft === true || raw.prerelease === true) throw new UpdateError("The latest release is not a stable one.", 502);
  const version = typeof raw.tag_name === "string" ? raw.tag_name.replace(/^v/, "") : "";
  if (!versionParts(version)) throw new UpdateError("The latest release has no version Bloks can read.", 502);
  const assets = Array.isArray(raw.assets) ? raw.assets.filter(isRecord) : [];
  const name = tarballName(version);
  const asset = assets.find((a) => a.name === name);
  if (!asset) throw new UpdateError(`Bloks ${version} has no server download.`, 502);
  const sums = assets.find((a) => a.name === `${name}.sha256`);
  const base = `${downloads.replace(/\/+$/, "")}/v${version}`;
  const page = typeof raw.html_url === "string" && raw.html_url.startsWith("https://github.com/") ? raw.html_url : `https://github.com/hamedgitty/bloks/releases/tag/v${version}`;
  const notes = typeof raw.body === "string" ? raw.body.trim() : "";
  return {
    version,
    notes: notes.length > MAX_NOTES ? `${notes.slice(0, MAX_NOTES).trimEnd()}\n\n(The rest is on the release page.)` : notes,
    page,
    ...(typeof raw.published_at === "string" ? { publishedAt: raw.published_at } : {}),
    tarball: {
      name,
      url: `${base}/${name}`,
      ...(typeof asset.size === "number" ? { size: asset.size } : {}),
      ...(typeof asset.digest === "string" && /^sha256:[0-9a-f]{64}$/i.test(asset.digest) ? { digest: asset.digest.slice(7).toLowerCase() } : {}),
    },
    ...(sums ? { checksum: { name: `${name}.sha256`, url: `${base}/${name}.sha256` } } : {}),
  };
}

type Fetcher = typeof fetch;

/** The latest stable release, asked of GitHub now. */
export async function latestRelease(
  o: { api?: string; downloads?: string; fetcher?: Fetcher; userAgent?: string } = {},
): Promise<Release> {
  const fetcher = o.fetcher ?? fetch;
  let res: Response;
  try {
    res = await fetcher(o.api ?? RELEASES_API, {
      headers: { accept: "application/vnd.github+json", "user-agent": o.userAgent ?? "bloks-server" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new UpdateError("Couldn't reach GitHub to look for a new version. Try again in a few minutes.", 502);
  }
  if (!res.ok) {
    throw new UpdateError(
      res.status === 403 || res.status === 429
        ? "GitHub is limiting how often this server may ask. Try again in an hour."
        : `GitHub answered ${res.status} when asked for the latest release.`,
      502,
    );
  }
  return releaseFrom(await res.json().catch(() => null), o.downloads);
}

/** The sha256 a checksum file gives for `name`: the "<hex>  <name>" lines
 * sha256sum and shasum write, or one bare hash. */
export function checksumFor(text: string, name: string): string | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const m = /^([0-9a-fA-F]{64})(?:\s+\*?(.+))?$/.exec(line);
    if (!m) continue;
    if (!m[2] ? lines.length === 1 : basename(m[2].trim()) === name) return m[1].toLowerCase();
  }
  return null;
}

/**
 * Downloads the release's server tarball into `dir`, hashing it on the
 * way, and keeps it only if it is the file the release says it is. The
 * checksum is read first, so a release without one costs no download.
 */
export async function downloadVerified(
  release: Release,
  dir: string,
  o: { fetcher?: Fetcher; signal?: AbortSignal; onProgress?: (done: number, total: number | null) => void; maxBytes?: number } = {},
): Promise<string> {
  const fetcher = o.fetcher ?? fetch;
  if (!release.checksum) {
    throw new UpdateError(`Bloks ${release.version} publishes no checksum for its server, so it isn't installed from here. Update it by hand.`);
  }
  let sums: string;
  try {
    const res = await fetcher(release.checksum.url, { signal: o.signal ?? AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(String(res.status));
    sums = (await res.text()).slice(0, 4096);
  } catch {
    throw new UpdateError("Couldn't download the release's checksum, so nothing was downloaded. Try again in a few minutes.", 502);
  }
  const want = checksumFor(sums, release.tarball.name);
  if (!want) throw new UpdateError("The release's checksum file doesn't name the server download, so nothing was installed.", 502);
  // GitHub keeps its own sha256 of every file it hosts. Two records that
  // disagree mean one of them was changed after the release was made.
  if (release.tarball.digest && release.tarball.digest !== want) {
    throw new UpdateError("The release's checksum and GitHub's own record of the file disagree, so nothing was installed.", 502);
  }

  mkdirSync(dir, { recursive: true });
  const file = join(dir, release.tarball.name);
  const partial = `${file}.partial`;
  rmSync(partial, { force: true });
  const max = o.maxBytes ?? MAX_TARBALL_BYTES;
  let res: Response;
  try {
    res = await fetcher(release.tarball.url, { signal: o.signal });
  } catch (e) {
    if (o.signal?.aborted) throw e;
    throw new UpdateError("Couldn't download the new version. Try again in a few minutes.", 502);
  }
  if (!res.ok || !res.body) throw new UpdateError(`The download answered ${res.status}, so nothing was installed.`, 502);
  const total = Number(res.headers.get("content-length")) || release.tarball.size || null;
  if (total && total > max) throw new UpdateError("The download is far larger than a server release, so it was refused.", 502);
  const hash = createHash("sha256");
  const out = createWriteStream(partial, { mode: 0o600 });
  let done = 0;
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      done += chunk.byteLength;
      if (done > max) throw new UpdateError("The download is far larger than a server release, so it was refused.", 502);
      hash.update(chunk);
      if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
      o.onProgress?.(done, total);
    }
    await new Promise<void>((done, fail) => out.end((e?: Error | null) => (e ? fail(e) : done())));
  } catch (e) {
    out.destroy();
    rmSync(partial, { force: true });
    throw e;
  }
  if (hash.digest("hex") !== want) {
    rmSync(partial, { force: true });
    throw new UpdateError("The download doesn't match the checksum the release publishes, so it was thrown away and nothing changed.", 502);
  }
  renameSync(partial, file);
  return file;
}

// ── beside the version that runs ───────────────────────────────────────

/** The version folder versions/current points at, or null when it points
 * nowhere and the install folder's own version runs. */
export function pointerOf(home: string): string | null {
  // macOS can fail a read that races the rename switching the link with
  // EINVAL, though the link is there throughout, so that is asked again
  for (let tries = 0; ; tries++) {
    try {
      const target = readlinkSync(join(home, VERSIONS, CURRENT));
      return versionParts(target) && !target.includes(sep) ? target : null;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EINVAL" || tries >= 5) return null;
    }
  }
}

/**
 * Points versions/current at a version folder, in one step: the new link
 * is made under a name of its own and renamed over the old one, which
 * replaces it whole, so a start at any moment finds one or the other and
 * never neither. Null removes the link, and the install folder's own
 * version runs again.
 */
export function pointTo(home: string, version: string | null): void {
  const link = join(home, VERSIONS, CURRENT);
  if (version === null) {
    try {
      unlinkSync(link);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    return;
  }
  if (!versionParts(version)) throw new UpdateError(`${version} is not a version.`);
  mkdirSync(join(home, VERSIONS), { recursive: true });
  const temp = join(home, VERSIONS, `.current-${randomBytes(6).toString("hex")}`);
  symlinkSync(version, temp);
  try {
    renameSync(temp, link);
  } catch (e) {
    rmSync(temp, { force: true });
    throw e;
  }
}

/** The folder whose code a start runs, the way bin/bloks-server.mjs picks
 * it: versions/current when that is a newer bloks-server than the install
 * folder's own, which a copy unpacked there by hand can overtake. */
export function chosenRoot(home: string): string {
  const read = (dir: string) => {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      return isRecord(parsed) && parsed.name === "bloks-server" ? parsed : null;
    } catch {
      return null;
    }
  };
  const own = read(home);
  const pointer = pointerOf(home);
  if (!own || !pointer) return home;
  const there = join(home, VERSIONS, pointer);
  const theirs = read(there);
  return theirs && isNewer(theirs.version, own.version) && existsSync(join(there, "bin", "bloks-server.mjs")) ? there : home;
}

/** What a tarball holds, checked before anything comes out of it: every
 * entry under bloks-server/, none absolute, none climbing out. */
function tarEntries(file: string): string[] {
  const listed = execFileSync("tar", ["-tzf", file], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const entries = listed.split("\n").filter(Boolean);
  for (const entry of entries) {
    const clean = entry.replace(/^\.\//, "");
    if (clean.startsWith("/") || clean.split("/").includes("..") || !(clean === "bloks-server/" || clean === "bloks-server" || clean.startsWith("bloks-server/"))) {
      throw new UpdateError("The download holds files outside the server's folder, so it was refused.", 502);
    }
  }
  return entries;
}

/**
 * Unpacks a checked tarball into versions/<version>, beside what runs.
 * It goes into a folder of its own first and is renamed into place only
 * once it is all there and is the version it says, so a half unpacked
 * version is never one a start could find.
 */
export function unpackBeside(home: string, file: string, version: string): string {
  tarEntries(file);
  const versions = join(home, VERSIONS);
  mkdirSync(versions, { recursive: true });
  const staging = join(versions, `.incoming-${version}-${randomBytes(4).toString("hex")}`);
  mkdirSync(staging);
  try {
    execFileSync("tar", ["-xzf", file, "-C", staging], { stdio: "ignore" });
    const unpacked = join(staging, "bloks-server");
    let pkg: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(readFileSync(join(unpacked, "package.json"), "utf8"));
      pkg = isRecord(parsed) ? parsed : null;
    } catch {
      /* said just below */
    }
    if (pkg?.name !== "bloks-server" || pkg.version !== version) {
      throw new UpdateError(`The download is not bloks-server ${version}, so it was refused.`, 502);
    }
    for (const need of ["bin/bloks-server.mjs", "dist-server/index.js"]) {
      if (!existsSync(join(unpacked, need))) throw new UpdateError(`The download is missing ${need}, so it was refused.`, 502);
    }
    const engines = isRecord(pkg.engines) ? pkg.engines.node : undefined;
    if (!nodeSatisfies(engines)) {
      throw new UpdateError(`Bloks ${version} needs Node ${String(engines).replace(/^\s*>=\s*/, "")} or newer, and this server has ${process.versions.node}. Update Node first.`);
    }
    const target = join(versions, version);
    if (pointerOf(home) === version) throw new UpdateError(`Bloks ${version} is already the version here.`);
    rmSync(target, { recursive: true, force: true });
    renameSync(unpacked, target);
    return target;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** Clears versions/ of everything but what is kept: the version now
 * running, the one before it to go back to, and the link. */
export function prune(home: string, keep: Array<string | null>): void {
  const versions = join(home, VERSIONS);
  let names: string[];
  try {
    names = readdirSync(versions);
  } catch {
    return;
  }
  for (const name of names) {
    if (name === CURRENT || keep.includes(name)) continue;
    if (versionParts(name) || name.startsWith(".incoming-") || name.startsWith(".current-") || name === ".download") {
      rmSync(join(versions, name), { recursive: true, force: true });
    }
  }
}

// ── the hand over ──────────────────────────────────────────────────────

/** The helper's orders, written by the server that is stopping. */
export interface UpdatePlan {
  home: string;
  dataDir: string;
  port: number;
  /** The server that is stopping, to wait for. */
  oldPid: number;
  from: { version: string; pointer: string | null };
  to: { version: string; pointer: string };
  /** The install folder's bin/bloks-server.mjs, which a start by hand
   * runs too, so the helper starts it exactly that way. */
  launcher: string;
  cwd: string;
  log: string;
  startedAt: number;
}

/** What the last update did, for the app to say. */
export interface UpdateRecord {
  from: string;
  to: string;
  at: number;
  /** Still going: the helper has not said how it ended yet. */
  pending?: boolean;
  ok: boolean;
  /** The old version is running again after the new one failed. */
  rolledBack?: boolean;
  /** The version running when the helper finished, if any is. */
  running?: string;
  error?: string;
  /** Where the server's output goes now it has no terminal. */
  log: string;
}

export function readRecord(dataDir: string): UpdateRecord | null {
  try {
    const parsed = JSON.parse(readFileSync(join(dataDir, RECORD_FILE), "utf8"));
    return isRecord(parsed) && typeof parsed.to === "string" && typeof parsed.ok === "boolean" ? (parsed as unknown as UpdateRecord) : null;
  } catch {
    return null;
  }
}

function writeRecord(dataDir: string, record: UpdateRecord): void {
  writeFileAtomic(join(dataDir, RECORD_FILE), `${JSON.stringify(record, null, 2)}\n`, 0o600);
}

/** A server the helper started, as far as the helper needs to know it. */
export interface Started {
  pid: number;
  /** Its exit code, or the signal that ended it; null while it runs. */
  ended(): number | string | null;
}

export interface FinishDeps {
  alive(pid: number): boolean;
  kill(pid: number, signal: NodeJS.Signals): void;
  /** What answers /api/health on the port, or null when nothing does. */
  health(port: number): Promise<{ app?: unknown; version?: unknown; pid?: unknown } | null>;
  start(plan: UpdatePlan): Started;
  sleep(ms: number): Promise<void>;
  say(line: string): void;
  healthyWithinMs: number;
}

/** The real machine: processes, the port and the log. A server the
 * helper starts gets `env`, which is the helper's own: the stopping
 * server started the helper with what the next one should have. */
export const processDeps = (env: NodeJS.ProcessEnv = process.env): FinishDeps => ({
  alive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === "EPERM";
    }
  },
  kill(pid, signal) {
    try {
      process.kill(pid, signal);
    } catch {
      /* gone already */
    }
  },
  async health(port) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2_000) });
      if (!res.ok) return null;
      const body = await res.json();
      return isRecord(body) ? body : null;
    } catch {
      return null;
    }
  },
  start(plan) {
    // Its own session, so the terminal the old one ran in can close
    // without taking it, and its output in the log, since nobody reads
    // that terminal now.
    const fd = openSync(plan.log, "a", 0o600);
    try {
      const child = spawn(process.execPath, [plan.launcher], {
        cwd: existsSync(plan.cwd) ? plan.cwd : plan.home,
        env,
        detached: OWN_GROUP,
        stdio: ["ignore", fd, fd],
        windowsHide: true,
      });
      let ended: number | string | null = null;
      child.on("exit", (code, signal) => (ended = code ?? signal ?? "ended"));
      child.on("error", () => (ended = "failed to start"));
      child.unref();
      return { pid: child.pid ?? -1, ended: () => ended };
    } finally {
      closeSync(fd);
    }
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  say: (line) => console.log(`[bloks update] ${line}`),
  healthyWithinMs: HEALTHY_WITHIN_MS,
});

/** Waits for the server just started to answer as `version`, from its own
 * process. Null when it does; why not, when it does not. */
async function healthy(plan: UpdatePlan, started: Started, version: string, deps: FinishDeps): Promise<string | null> {
  const until = Date.now() + deps.healthyWithinMs;
  while (Date.now() < until) {
    const ended = started.ended();
    if (ended !== null) return `Bloks ${version} stopped while starting (${typeof ended === "number" ? `exit code ${ended}` : ended}).`;
    const said = await deps.health(plan.port);
    if (said?.app === "bloks" && said.version === version && said.pid === started.pid) return null;
    await deps.sleep(500);
  }
  return `Bloks ${version} did not answer within ${Math.round(deps.healthyWithinMs / 1000)} seconds.`;
}

/** Stops a server the helper started: asked first, then told. */
async function stop(started: Started, deps: FinishDeps): Promise<void> {
  if (started.ended() !== null) return;
  deps.kill(started.pid, "SIGTERM");
  for (let i = 0; i < 30 && started.ended() === null && deps.alive(started.pid); i++) await deps.sleep(500);
  if (started.ended() === null && deps.alive(started.pid)) {
    // its whole group, engines and all: it was started in a session of its own
    deps.kill(-started.pid, "SIGKILL");
    deps.kill(started.pid, "SIGKILL");
    for (let i = 0; i < 10 && deps.alive(started.pid); i++) await deps.sleep(200);
  }
}

/** Until nothing answers on the port, so the next start can have it. */
async function portFree(port: number, deps: FinishDeps): Promise<boolean> {
  for (let i = 0; i < 30; i++) {
    if (!(await deps.health(port))) return true;
    await deps.sleep(500);
  }
  return false;
}

/**
 * The helper's whole job, once the old server has been told to stop:
 * wait for it to go, switch, start the new version and see it answer,
 * or switch back and start the old one. Returns what it wrote down.
 */
export async function finishUpdate(plan: UpdatePlan, deps: FinishDeps = processDeps()): Promise<UpdateRecord> {
  const base = { from: plan.from.version, to: plan.to.version, at: Date.now(), log: plan.log };
  writeRecord(plan.dataDir, { ...base, pending: true, ok: false });
  const done = (record: UpdateRecord) => {
    writeRecord(plan.dataDir, record);
    deps.say(record.ok ? `now running ${record.to}` : `${record.error ?? "failed"}${record.running ? ` Running ${record.running}.` : ""}`);
    return record;
  };

  // the old server, finishing its shutdown
  for (let i = 0; i < 120 && deps.alive(plan.oldPid); i++) await deps.sleep(500);
  if (deps.alive(plan.oldPid)) {
    deps.kill(plan.oldPid, "SIGKILL");
    for (let i = 0; i < 25 && deps.alive(plan.oldPid); i++) await deps.sleep(200);
  }
  if (!(await portFree(plan.port, deps))) {
    // something else has the port, so neither version could start
    return done({ ...base, at: Date.now(), ok: false, error: `Something else answers on port ${plan.port}, so Bloks could not start again there.` });
  }

  const back = async (why: string): Promise<UpdateRecord> => {
    deps.say(`${why} Going back to ${plan.from.version}.`);
    try {
      pointTo(plan.home, plan.from.pointer);
    } catch (e) {
      // left pointing at the new version, which the start below would
      // then run; said rather than tried
      return done({ ...base, at: Date.now(), ok: false, error: `${why} Then switching back failed: ${(e as Error).message}. Start it with bloks-server.` });
    }
    const old = deps.start(plan);
    const failed = await healthy(plan, old, plan.from.version, deps);
    return done({
      ...base,
      at: Date.now(),
      ok: false,
      rolledBack: !failed,
      ...(failed ? {} : { running: plan.from.version }),
      error: failed ? `${why} Then ${plan.from.version} didn't start again either: ${failed} Start it with bloks-server.` : why,
    });
  };

  try {
    pointTo(plan.home, plan.to.pointer);
  } catch (e) {
    return back(`Couldn't switch to ${plan.to.version}: ${(e as Error).message}.`);
  }
  deps.say(`switched to ${plan.to.version}, starting it`);
  const started = deps.start(plan);
  const failed = await healthy(plan, started, plan.to.version, deps);
  if (failed) {
    await stop(started, deps);
    await portFree(plan.port, deps);
    return back(failed);
  }
  try {
    prune(plan.home, [plan.to.pointer, plan.from.pointer]);
  } catch {
    /* an old version left on disk costs space, nothing more */
  }
  return done({ ...base, at: Date.now(), ok: true, running: plan.to.version });
}

/** The helper's entry file, for the server to start it with. */
export function finishEntry(): string {
  const ext = import.meta.url.endsWith(".ts") ? "ts" : "js";
  return fileURLToPath(new URL(`./server-update-finish.${ext}`, import.meta.url));
}

/** Starts the helper on its orders, in a session of its own so it lives
 * on once this server stops, writing where the next server will. */
export function startHelper(planFile: string, plan: UpdatePlan, env: Record<string, string>): void {
  const out = openSync(plan.log, "a", 0o600);
  try {
    spawn(process.execPath, [finishEntry(), planFile], { cwd: plan.home, env, detached: OWN_GROUP, stdio: ["ignore", out, out], windowsHide: true }).unref();
  } finally {
    closeSync(out);
  }
}

// ── the update, from the running server ────────────────────────────────

export type Phase = "downloading" | "unpacking" | "draining" | "restarting" | "failed" | "cancelled";

export interface Job {
  phase: Phase;
  version: string;
  from: string;
  startedAt: number;
  percent?: number;
  /** While draining: turns still running, and until when it waits. */
  running?: number;
  deadline?: number;
  error?: string;
}

export interface Check {
  at: number;
  latest?: { version: string; notes: string; page: string; publishedAt?: string; checksum: boolean };
  /** The latest is newer than this server. */
  newer: boolean;
  error?: string;
}

/** What the running server lends an update. */
export interface UpdaterHooks {
  /** Why an update may not start now (a backup or a restore), or null. */
  busy(): string | null;
  drainStart(ms: number): void;
  drainStatus(): { done: boolean; running: number; deadline?: number };
  drainEnd(): void;
  /** Start the helper on the plan, with the environment the next server
   * should have, and stop this server. */
  handOver(planFile: string, plan: UpdatePlan, env: Record<string, string>): void;
}

export interface UpdaterOptions {
  version: string;
  install: Install;
  dataDir: string;
  port: number;
  hooks: UpdaterHooks;
  api?: string;
  downloads?: string;
  fetcher?: Fetcher;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

const ACTIVE: Phase[] = ["downloading", "unpacking", "draining", "restarting"];

export class ServerUpdater {
  job: Job | null = null;
  check: Check | null = null;
  private abort: AbortController | null = null;

  private readonly o: UpdaterOptions;

  constructor(o: UpdaterOptions) {
    this.o = o;
  }

  get install(): Install {
    return this.o.install;
  }

  private ask(): Promise<Release> {
    return latestRelease({ api: this.o.api, downloads: this.o.downloads, fetcher: this.o.fetcher, userAgent: `bloks-server/${this.o.version || "unknown"}` });
  }

  /** Asks GitHub for the latest stable release, and keeps the answer. */
  async checkNow(): Promise<Check> {
    try {
      const release = await this.ask();
      this.check = {
        at: Date.now(),
        latest: {
          version: release.version,
          notes: release.notes,
          page: release.page,
          ...(release.publishedAt ? { publishedAt: release.publishedAt } : {}),
          checksum: Boolean(release.checksum),
        },
        newer: isNewer(release.version, this.o.version),
      };
    } catch (e) {
      this.check = { at: Date.now(), newer: false, error: e instanceof UpdateError ? e.message : "Couldn't look for a new version." };
    }
    return this.check;
  }

  /** The steps to update by hand, for an install that does not update
   * itself, or one whose owner would rather. */
  steps(version: string | undefined = this.check?.latest?.version): string[] {
    if (!version) return [];
    return manualSteps(this.o.install, { version, downloads: this.o.downloads ?? RELEASE_DOWNLOADS, platform: process.platform });
  }

  /** The last update's record, as the helper left it. */
  last(): UpdateRecord | null {
    return readRecord(this.o.dataDir);
  }

  /** Starts installing `version`, which has to be the latest release and
   * newer than this; the rest goes on in the background. */
  start(version: unknown, drainMs: number): Job {
    if (!this.o.install.canInstall || !this.o.install.home) throw new UpdateError(this.o.install.why);
    if (this.job && ACTIVE.includes(this.job.phase)) throw new UpdateError("An update is already under way.");
    if (typeof version !== "string" || !versionParts(version)) throw new UpdateError("Say which version to install.", 400);
    if (!isNewer(version, this.o.version)) throw new UpdateError(`This server already runs ${this.o.version}.`);
    const busy = this.o.hooks.busy();
    if (busy) throw new UpdateError(busy);
    this.abort = new AbortController();
    const job: Job = { phase: "downloading", version, from: this.o.version, startedAt: Date.now() };
    this.job = job;
    void this.run(job, this.o.install.home, drainMs, this.abort.signal);
    return job;
  }

  /** Calls it off while it downloads, unpacks or waits for running work.
   * Once it is restarting it is the helper's. */
  cancel(): Job {
    const job = this.job;
    if (!job || !["downloading", "unpacking", "draining"].includes(job.phase)) {
      throw new UpdateError("Only an update that hasn't started restarting can be called off.");
    }
    const draining = job.phase === "draining";
    job.phase = "cancelled";
    this.abort?.abort();
    if (draining) this.o.hooks.drainEnd();
    return job;
  }

  private async run(job: Job, home: string, drainMs: number, signal: AbortSignal): Promise<void> {
    let drained = false;
    const stopped = () => (job.phase as Phase) === "cancelled";
    try {
      // asked again now rather than trusting an earlier answer: the
      // version installed is the one the release says today
      const release = await this.ask();
      if (release.version !== job.version) throw new UpdateError(`The latest release is ${release.version} now. Check again.`);
      const file = await downloadVerified(release, join(home, VERSIONS, ".download"), {
        fetcher: this.o.fetcher,
        signal,
        onProgress: (done, total) => {
          if (total) job.percent = Math.min(100, Math.floor((done / total) * 100));
        },
      });
      if (stopped()) return;
      job.phase = "unpacking";
      try {
        unpackBeside(home, file, job.version);
      } finally {
        rmSync(file, { force: true });
      }
      if (stopped()) return;
      job.phase = "draining";
      drained = true;
      this.o.hooks.drainStart(drainMs);
      for (;;) {
        if (stopped()) return;
        const status = this.o.hooks.drainStatus();
        job.running = status.running;
        job.deadline = status.deadline;
        if (status.done) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      job.phase = "restarting";
      const plan = this.planFor(home, job.version);
      const planFile = join(this.o.dataDir, PLAN_FILE);
      writeFileAtomic(planFile, `${JSON.stringify(plan, null, 2)}\n`, 0o600);
      this.o.hooks.handOver(planFile, plan, this.serverEnv());
    } catch (e) {
      if (stopped()) return;
      job.phase = "failed";
      job.error = e instanceof UpdateError ? e.message : `The update stopped: ${e instanceof Error ? e.message : String(e)}`;
      if (drained) this.o.hooks.drainEnd();
    }
  }

  /** What the next server starts with: this one's environment, less
   * what bloks-server set for this version's folder alone. Handed to the
   * helper as its own, never written down: it can hold keys. */
  serverEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(this.o.env ?? process.env)) if (typeof value === "string") env[name] = value;
    if (env.BLOKS_SERVER_STATIC === "1") delete env.BLOKS_STATIC_DIR;
    for (const name of ["BLOKS_SERVER_HOME", "BLOKS_SERVER_ROOT", "BLOKS_SERVER_STATIC"]) delete env[name];
    // said in full: a relative one was relative to where this started
    env.BLOKS_DATA_DIR = resolve(this.o.dataDir);
    return env;
  }

  /** The helper's orders. */
  planFor(home: string, version: string): UpdatePlan {
    return {
      home,
      dataDir: resolve(this.o.dataDir),
      port: this.o.port,
      oldPid: process.pid,
      from: { version: this.o.version, pointer: pointerOf(home) },
      to: { version, pointer: version },
      launcher: join(home, "bin", "bloks-server.mjs"),
      cwd: this.o.cwd ?? process.cwd(),
      log: join(resolve(this.o.dataDir), LOG_FILE),
      startedAt: Date.now(),
    };
  }

  status() {
    const install = this.o.install;
    return {
      version: this.o.version,
      install: {
        kind: install.kind,
        canInstall: install.canInstall,
        why: install.why,
        ...(install.manager ? { manager: install.manager } : {}),
      },
      check: this.check,
      job: this.job,
      last: this.last(),
      steps: this.check?.newer ? this.steps() : [],
    };
  }
}

/** The steps to update by hand, as commands, for how it was installed. */
export function manualSteps(install: Install, o: { version: string; downloads?: string; platform?: string }): string[] {
  const name = tarballName(o.version);
  const base = `${(o.downloads ?? RELEASE_DOWNLOADS).replace(/\/+$/, "")}/v${o.version}`;
  const sum = (o.platform ?? process.platform) === "darwin" ? "shasum -a 256 -c" : "sha256sum -c";
  const fetchAndCheck = [`curl -LO ${base}/${name}`, `curl -LO ${base}/${name}.sha256`, `${sum} ${name}.sha256`];
  const home = install.home ?? "/opt/bloks-server";
  const over = `tar -xzf ${name} --strip-components=1 -C ${quoteIfNeeded(home)}`;
  switch (install.kind) {
    case "desktop":
    case "hosted":
      return [];
    case "checkout":
      return [`cd ${quoteIfNeeded(home)}`, "git pull", "pnpm install", "bloks-server drain", "then restart it the way you started it"];
    case "container":
      return [
        ...fetchAndCheck,
        `tar -xzf ${name}`,
        "cd bloks-server && docker build -t bloks-server .",
        "docker exec bloks bloks-server drain",
        "docker rm -f bloks",
        "docker run -d --name bloks --restart unless-stopped -v bloks:/root/.bloks bloks-server",
      ];
    case "service": {
      const restart =
        install.manager === "systemd"
          ? `${install.user ? "systemctl --user" : "sudo systemctl"} restart ${install.unit ?? "bloks-server"}`
          : install.manager === "launchd"
            ? `launchctl kickstart -k gui/$(id -u)/${install.unit ?? "<its label>"}`
            : install.manager === "pm2"
              ? `pm2 restart ${install.unit ?? "<its name>"}`
              : install.manager === "supervisord"
                ? `supervisorctl restart ${install.unit ?? "<its name>"}`
                : "then restart it";
      return ["bloks-server drain", ...fetchAndCheck, over, restart];
    }
    default:
      return ["bloks-server drain", ...fetchAndCheck, over, "then restart it the way you started it"];
  }
}

function quoteIfNeeded(path: string): string {
  return /^[\w./~-]+$/.test(path) ? path : `"${path.replace(/(["\\$`])/g, "\\$1")}"`;
}
