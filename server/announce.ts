// Saying "Bloks is here" on the local network, so a phone whose saved
// address went stale (Bloks moved to another port because the usual one
// was taken) finds this computer again on its own, instead of somebody
// typing numbers into it.
//
// Only the desktop app announces, only on a Mac, and only while phone
// access is on and the server really listens beyond this machine: an
// announcement of a port nobody else can reach sends a phone to a closed
// door. Nothing in it is secret. The computer's name is already said on
// the network for sharing and AirPlay, and the port is open to anyone who
// looks. A phone still needs a code or a pairing to do anything here, and
// it only ever trusts an announcement from the address it already knows.
//
// The system does the announcing (dns-sd hands it to mDNSResponder), so it
// follows the Mac through sleep and network changes. It lasts exactly as
// long as the dns-sd process, which is why a small shell watches this
// server and ends it once the server is gone, however it went: the app
// kills a server that is slow to stop, and a killed process runs no
// cleanup of its own. An announcement outliving its server would point
// phones at a port that is no longer Bloks.
import { spawn as nodeSpawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR } from "./config.ts";

export const SERVICE_TYPE = "_bloks._tcp";
const DNS_SD = "/usr/bin/dns-sd";
/** DNS-SD allows 63 bytes for a service's own name. */
const NAME_BYTES = 63;

export interface Announcement {
  /** The instance name a phone shows, from instanceName(). */
  name: string;
  port: number;
  /** This workspace, as workspaceTag() says it, so a phone that moved
   * with it can tell it from the other workspaces on the same Mac. */
  tag?: string;
}

/**
 * This workspace, as a phone can recognise it on the network: a hash of a
 * random key kept in the workspace's own folder, made the first time it is
 * asked for. Not the workspace's id, which is "personal" on every Mac, and
 * nothing a reader could learn anything from. Public by design: it says
 * which Bloks this is, never that a phone may trust it. A phone checks
 * that with a proof before its token goes anywhere (server/pairing.ts,
 * proveDevice).
 */
let tagMemo: { dir: string; tag: string } | null = null;
export function workspaceTag(dir: string = DATA_DIR): string {
  if (tagMemo?.dir === dir) return tagMemo.tag;
  const file = join(dir, "announce-key");
  let key = "";
  try {
    key = readFileSync(file, "utf8").trim();
  } catch {
    // not made yet
  }
  if (!/^[0-9a-f]{64}$/.test(key)) {
    key = randomBytes(32).toString("hex");
    try {
      writeFileSync(file, key, { mode: 0o600 });
    } catch {
      // held for this run; a new one next time only renames the workspace
      // to phones, which find it again by their proof
    }
  }
  const tag = createHash("sha256").update(`bloks-announce:${key}`).digest("hex").slice(0, 16);
  tagMemo = { dir, tag };
  return tag;
}

export interface Announcer {
  pid?: number;
  kill(signal?: NodeJS.Signals): boolean;
}

export type Spawner = (command: string, args: string[]) => Announcer;

/** Announces, and ends the announcement once `$3`, this server, is gone.
 * `$4` is the workspace's tag, in the TXT record as ws=. */
const WATCH = [
  `"$0" -R "$1" ${SERVICE_TYPE} local "$2" v=1 "ws=$4" >/dev/null 2>&1 &`,
  "d=$!",
  `trap 'kill "$d" 2>/dev/null; exit 0' TERM INT HUP`,
  // a sleep waited on, not run in front, so a stop is heard at once
  `while kill -0 "$3" 2>/dev/null && kill -0 "$d" 2>/dev/null; do sleep 2 & wait $!; done`,
  `kill "$d" 2>/dev/null`,
].join("\n");

const startHidden: Spawner = (command, args) => {
  // only ever a Mac (mayAnnounce), but hidden all the same, as everything
  // this server starts is
  const child = nodeSpawn(command, args, { stdio: "ignore", windowsHide: true });
  // a dns-sd that cannot start is a phone that has to be told the address,
  // not a reason for this server to fall over
  child.on("error", () => {});
  child.unref();
  return child;
};

let current: { key: string; child: Announcer } | null = null;

/**
 * What a phone calls this Bloks in its list: the computer, and the
 * workspace when it is not Personal, since each workspace is its own
 * Bloks on its own port.
 */
export function instanceName(computer: string, workspace?: string): string {
  const clean = (text: string) => text.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const machine = clean(computer) || "Bloks";
  const space = workspace ? clean(workspace) : "";
  let name = space && space !== "Personal" ? `${space} on ${machine}` : machine;
  while (Buffer.byteLength(name, "utf8") > NAME_BYTES) name = name.slice(0, -1);
  return name.trim();
}

/** The command that announces `a` for as long as `parentPid` lives. */
export function announceCommand(a: Announcement, parentPid: number, dnsSd: string = DNS_SD): [string, string[]] {
  return ["/bin/sh", ["-c", WATCH, dnsSd, a.name, String(a.port), String(parentPid), a.tag ?? ""]];
}

/**
 * Whether this process announces at all. The desktop app starts its
 * servers with a parent port; tests and a server started by hand have
 * none, so they stay quiet unless BLOKS_ANNOUNCE=1 asks. bloks-server
 * keeps to loopback, where there is nothing to announce.
 */
export function mayAnnounce(
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
  fromApp: boolean = Boolean((process as NodeJS.Process & { parentPort?: unknown }).parentPort),
): boolean {
  if (platform !== "darwin") return false;
  if (env.BLOKS_LOOPBACK_ONLY === "1" || env.BLOKS_ANNOUNCE === "0") return false;
  return fromApp || env.BLOKS_ANNOUNCE === "1";
}

/**
 * Announces `a` while `on`, and stops when not. Saying the same thing
 * twice changes nothing; a new name or port replaces the old one.
 * Returns whether this Bloks is being announced now.
 */
export function syncAnnouncement(
  on: boolean,
  a: Announcement,
  start: Spawner = startHidden,
  parentPid: number = process.pid,
  dnsSd?: string,
): boolean {
  const key = `${a.name}\n${a.port}\n${a.tag ?? ""}`;
  if (on && current?.key === key) return true;
  stopAnnouncing();
  if (!on || !a.name || !Number.isInteger(a.port) || a.port < 1 || a.port > 65535) return false;
  const [command, args] = announceCommand(a, parentPid, dnsSd);
  current = { key, child: start(command, args) };
  return true;
}

/** Ends the announcement now, for a stop or phone access turned off. */
export function stopAnnouncing(): void {
  if (!current) return;
  try {
    current.child.kill("SIGTERM");
  } catch {
    // already gone, which is what was wanted
  }
  current = null;
}
