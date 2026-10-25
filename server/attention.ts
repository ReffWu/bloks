// The workspace's mute and notification level, as this server keeps them
// (GitHub 391).
//
// The desktop app keeps every workspace's mute and level in its list
// (electron/workspaces.mjs) and holds its own banners to them. The server
// holds the phone's "your answer is ready" to the same word
// (server/answer-ready.ts), so it needs that word too, and it needs it
// whether or not an app started it: bloks-server on an always-on machine,
// a hosted workspace and a workspace the app reaches through Bloks Cloud
// have no app beside them to say it. So the server keeps its own copy in
// its data folder, where a restart finds it.
//
// It hears it three ways. The app that started it says it on the line
// only Electron gives its children, as it always has. The app says it to
// a server on another machine through the same stand-in the window uses,
// and the owner's phone may say it from anywhere, both on the route below,
// which is the owner's alone: never an agent's, never a member's or an
// admin's, whose notifications are their own business and not this one.
// A change on the route is put to an app beside the server first, as the
// mark is (server/workspace-mark.ts), so the switcher shows the same mute
// the server keeps; a server with no app behind it keeps it at once.
//
// A server nobody ever told keeps no file, and is not muted: what it did
// before this was kept.
import { join } from "node:path";

import { attentionFrom, type Attention } from "./answer-ready.ts";
import { isRecord, readSaved, writeFileAtomic } from "./atomic-write.ts";
import type { LineAnswer } from "./desktop-line.ts";

export const ATTENTION_FILE = "attention.json";
export const ATTENTION_PATH = "/api/workspace/attention";

const NOTIFY = ["all", "needs-me", "nothing"] as const;

/** What this data folder was last told, or null when nobody ever said. */
export function readAttention(dir: string): Attention | null {
  return attentionFrom(readSaved<unknown>(join(dir, ATTENTION_FILE), null, isRecord));
}

/** Keeps it, so the next start knows it. */
export function keepAttention(dir: string, attention: Attention): void {
  writeFileAtomic(join(dir, ATTENTION_FILE), `${JSON.stringify(attention)}\n`, 0o600);
}

export const sameAttention = (a: Attention | null, b: Attention | null) =>
  a === b || Boolean(a && b && a.mute === b.mute && a.notify === b.notify);

/** A body the route takes, strictly: a level by name, and a mute that is
 * null, "forever" or the time it ends, in milliseconds. A mute that cannot
 * be read is refused rather than read as no mute. */
export function attentionBody(raw: unknown): Attention | { error: string } {
  const b = (raw ?? {}) as { mute?: unknown; notify?: unknown };
  if (!NOTIFY.includes(b.notify as (typeof NOTIFY)[number])) return { error: "notify is all, needs-me or nothing" };
  const mute = b.mute ?? null;
  if (mute !== null && mute !== "forever" && !(typeof mute === "number" && Number.isSafeInteger(mute) && mute > 0)) {
    return { error: "mute is null, \"forever\", or when it ends in milliseconds" };
  }
  return { mute: mute as Attention["mute"], notify: b.notify as Attention["notify"] };
}

export interface AttentionRouteDeps {
  current(): Attention | null;
  save(attention: Attention): void;
  /** Puts a change to the app beside this server; null when there is none. */
  askApp(attention: Attention): Promise<LineAnswer> | null;
}

/**
 * GET and PUT /api/workspace/attention. The caller has already made sure
 * it is the owner, at this computer or on a device of theirs.
 */
export async function attentionRoute(
  method: string,
  path: string,
  readBody: () => Promise<Record<string, unknown>>,
  deps: AttentionRouteDeps,
): Promise<{ status: number; body: unknown } | null> {
  if (path !== ATTENTION_PATH) return null;
  // null: never said, which answers as it always did
  if (method === "GET") return { status: 200, body: { attention: deps.current() } };
  if (method !== "PUT") return { status: 405, body: { error: `GET or PUT ${ATTENTION_PATH}` } };
  const asked = attentionBody(await readBody());
  if ("error" in asked) return { status: 400, body: asked };
  const app = deps.askApp(asked);
  let kept = asked;
  if (app) {
    const said = await app;
    if (said.error) return { status: typeof said.status === "number" ? said.status : 409, body: { error: said.error } };
    kept = attentionFrom(said) ?? asked;
  }
  deps.save(kept);
  return { status: 200, body: { attention: kept } };
}
