// Finding a model server that is already running here.
//
// The request this answers asked for Bloks to download a small model and
// start using it. We are not going to ship one: a bundled model is a
// licence, a few gigabytes, and a promise about hardware we cannot keep
// across every laptop this runs on. Ollama already does that job well,
// and plenty of people have it running before they ever open Bloks.
//
// What was missing is smaller and entirely ours. Ollama was in the
// engine list, needing nothing to sign in to, and still had to be
// connected by hand from Settings, which is a strange thing to ask of
// somebody whose model server is already answering on this machine. So
// we look, once, at boot.
//
// Only ever read, and only where Ollama itself would look: this machine
// on the port Ollama documents, or wherever the person's OLLAMA_HOST
// points, which is how Ollama's own command line and most clients find
// one running on another machine (GitHub 309). A probe that found
// nothing costs one refused connection.
import type { AppConfig } from "./config.ts";

/** Where Ollama listens unless its owner moved it. */
export const OLLAMA_URL = "http://127.0.0.1:11434";

/**
 * Where to look for Ollama: OLLAMA_HOST read the way Ollama reads it, or
 * the default when it is unset or cannot be read. Accepts a host, a host
 * and port, or a URL; without a scheme the port defaults to 11434, with
 * http:// or https:// to that scheme's own port, as in Ollama.
 */
export function ollamaUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = (env.OLLAMA_HOST ?? "").trim();
  if (!raw) return OLLAMA_URL;
  let scheme = "http";
  let rest = raw;
  let port = "11434";
  const cut = raw.indexOf("://");
  if (cut >= 0) {
    scheme = raw.slice(0, cut).toLowerCase();
    rest = raw.slice(cut + 3);
    if (scheme === "http") port = "80";
    else if (scheme === "https") port = "443";
    else return OLLAMA_URL;
  }
  const slash = rest.indexOf("/");
  const path = slash >= 0 ? rest.slice(slash) : "";
  const hostPort = slash >= 0 ? rest.slice(0, slash) : rest;
  let host = hostPort;
  // [v6]:port, v4-or-name:port, or a bare host with no port
  const bracketed = /^\[([^\]]+)\](?::(\d*))?$/.exec(hostPort);
  if (bracketed) {
    host = bracketed[1];
    if (bracketed[2] !== undefined) port = bracketed[2];
  } else {
    const colons = hostPort.split(":").length - 1;
    if (colons === 1) [host, port] = hostPort.split(":") as [string, string];
  }
  if (!host) host = "127.0.0.1";
  const number = Number(port);
  if (!/^\d+$/.test(port) || number > 65_535) return OLLAMA_URL;
  const named = host.includes(":") ? `[${host}]` : host;
  return `${scheme}://${named}:${number}${path.replace(/\/+$/, "")}`;
}

export interface LocalModels {
  running: boolean;
  /** What it has pulled, which is the only honest model list for it. */
  models: string[];
}

/**
 * Ask a local Ollama what it has.
 *
 * Short timeout on purpose: this sits in the boot path, and somebody
 * without Ollama should not wait on it. Any failure at all means "not
 * running", because there is nothing here worth distinguishing.
 */
export async function probeOllama(baseUrl = OLLAMA_URL): Promise<LocalModels> {
  try {
    const response = await fetch(`${baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return { running: false, models: [] };
    const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
    const models = (body.data ?? [])
      .map((entry) => (typeof entry.id === "string" ? entry.id : ""))
      .filter(Boolean)
      .slice(0, 50);
    // Answering but holding nothing is not useful yet: selecting it would
    // give somebody an engine with no model behind it.
    return { running: models.length > 0, models };
  } catch {
    return { running: false, models: [] };
  }
}

/**
 * Whether to connect it for them.
 *
 * Never over an entry that already exists, even an empty one: somebody
 * who disconnected Ollama on purpose should not find it back tomorrow,
 * and somebody who pointed it at another port should keep that.
 */
export function shouldAdopt(cfg: AppConfig, found: LocalModels): boolean {
  return found.running && !cfg.providers?.ollama;
}
