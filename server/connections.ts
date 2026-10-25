// Connections an agent uses without ever holding the credential (GitHub 386).
//
// A saved secret reaches an agent as an environment variable, so the agent
// has the value: it can print it, write it to a file, or hand it to
// whoever wrote the page it just read. Keeping a key out of the chat is
// not the same as keeping it from the agent.
//
// A connection is the other way round. The person gives Bloks a token for
// one service, Bloks keeps it in config.json beside the saved secrets, and
// it never enters a turn. An agent the person granted the connection to
// gets an address on this computer instead, minted for that one turn:
//
//   http://127.0.0.1:<port>/connect/<handle>/<host>/<path>
//
// A request to that address is checked here, outside the agent: is the
// handle's turn still running, is the grant still there, is the host one
// this service has, and is the method and path one this agent's access
// allows. Only then does Bloks add the credential and send it on, to that
// host and nowhere else, and only then does the response come back,
// with the credential scrubbed from it should the service ever echo it.
// Every request, sent or refused, is one line in the audit log.
//
// What this does not do is worth saying as plainly, and docs/ARCHITECTURE.md
// does (Connections). An agent can still misuse a connection it was
// granted: read access reads everything the token can read, and write
// access can push, open and close what the token can. The handle in its
// environment works for anything that runs during its turn. And an agent
// that runs as the person, on the person's computer, could read
// config.json itself with a file tool if the person allowed that read;
// what Bloks guarantees is that nothing it hands the agent carries the
// value.
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";

import { HOP_HEADERS } from "./hosted.ts";

export type Access = "read" | "write";
export type ServiceId = "github";

/** One connection, as config.json keeps it. The token is the only secret
 * in it, and the only field that never leaves this file. */
export interface ConnectionRecord {
  id: string;
  service: ServiceId;
  token: string;
  /** Who the token is, as the service said when it was checked. */
  account?: string;
  /** The scopes a classic token reports; null for one that reports none. */
  scopes?: string | null;
  addedAt: number;
  checkedAt?: number;
  /** Which agents may use it, and how. Absent is nobody. Kept here, in the
   * owner's file, and never on the agent's own record: an agent may change
   * some of its own settings, and this must not be one of them. */
  grants?: Record<string, Access>;
}

/** One host a service is reached at: how the credential goes on, and
 * which requests may carry it. */
interface HostSpec {
  inject(token: string): Record<string, string>;
  /** Null when the request may go, else why not, in words an agent can
   * act on. */
  refuse(method: string, path: string, search: URLSearchParams, access: Access): string | null;
  /** What the request is, for the audit line. */
  describe(method: string, path: string, search: URLSearchParams): string;
  /** Whether responses are text worth checking for the credential, which
   * means asking for them uncompressed. Git's packs are neither. */
  textual: boolean;
}

export interface ServiceSpec {
  id: ServiceId;
  name: string;
  /** Where a person makes a token for it. */
  tokenUrl: string;
  /** The host the API is on: what a token is checked against. */
  apiHost: string;
  hosts: Record<string, HostSpec>;
}

const READ_METHODS = new Set(["GET", "HEAD"]);
const WRITE_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);

/**
 * GitHub API calls that are refused whatever the access. Each of them hands
 * somebody or something lasting access that outlives the turn and that
 * revoking the connection would not take back: a key the agent holds the
 * private half of, a collaborator, an invitation, a member, a webhook that
 * sends the repository's events wherever it was pointed. Coding work never
 * needs them; an agent steered by something it read would.
 */
const GITHUB_NEVER: Array<{ method: string; path: RegExp; why: string }> = [
  { method: "POST", path: /^\/user\/(keys|gpg_keys|ssh_signing_keys)$/i, why: "adding a key to the account" },
  { method: "POST", path: /^\/repos\/[^/]+\/[^/]+\/keys$/i, why: "adding a deploy key" },
  { method: "PUT", path: /^\/repos\/[^/]+\/[^/]+\/collaborators\/[^/]+$/i, why: "adding a collaborator" },
  { method: "POST", path: /^\/orgs\/[^/]+\/invitations$/i, why: "inviting someone to an organization" },
  { method: "PUT", path: /^\/orgs\/[^/]+\/memberships\/[^/]+$/i, why: "adding an organization member" },
  { method: "PUT", path: /^\/orgs\/[^/]+\/teams\/[^/]+\/memberships\/[^/]+$/i, why: "adding a team member" },
  { method: "POST", path: /^\/(repos\/[^/]+\/[^/]+|orgs\/[^/]+)\/hooks$/i, why: "adding a webhook" },
  { method: "PATCH", path: /^\/(repos\/[^/]+\/[^/]+|orgs\/[^/]+)\/hooks\/[^/]+(\/config)?$/i, why: "changing a webhook" },
];

/** Git's own requests over HTTPS: what a clone, a fetch and a push send. */
const GIT_PATH = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(info\/refs|git-upload-pack|git-receive-pack)$/;

function repoOf(path: string): string {
  const m = GIT_PATH.exec(path);
  return m ? `${m[1]}/${m[2].replace(/\.git$/, "")}` : path;
}

export const SERVICES: Record<ServiceId, ServiceSpec> = {
  github: {
    id: "github",
    name: "GitHub",
    tokenUrl: "https://github.com/settings/personal-access-tokens/new",
    apiHost: "api.github.com",
    hosts: {
      "api.github.com": {
        textual: true,
        inject: (token) => ({ authorization: `Bearer ${token}` }),
        refuse(method, path, _search, access) {
          const never = GITHUB_NEVER.find((rule) => rule.method === method && rule.path.test(path));
          if (never) return `${never.why} is never sent through a Bloks connection; ask the owner to do it on GitHub`;
          if (access === "read" && !READ_METHODS.has(method)) {
            return `this agent's GitHub connection is read only, so ${method} is not sent; ask the owner for read and write access`;
          }
          if (!WRITE_METHODS.has(method)) return `${method} is not sent to the GitHub API`;
          return null;
        },
        describe: (method, path) => `${method} ${path}`,
      },
      "github.com": {
        textual: false,
        inject: (token) => ({ authorization: `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}` }),
        refuse(method, path, search, access) {
          const m = GIT_PATH.exec(path);
          if (!m) return "only git's clone, fetch and push requests go to github.com through this connection; use the API address for the rest";
          const end = m[3];
          const pushing = end === "git-receive-pack" || (end === "info/refs" && search.get("service") === "git-receive-pack");
          if (end === "info/refs") {
            if (method !== "GET") return `${method} is not how git asks for refs`;
            const service = search.get("service");
            if (service !== "git-upload-pack" && service !== "git-receive-pack") return "git's smart HTTP protocol is the only one sent";
          } else if (method !== "POST") return `${method} is not how git sends packs`;
          if (pushing && access !== "write") return "this agent's GitHub connection is read only, so it can clone and fetch but not push; ask the owner for read and write access";
          return null;
        },
        describe(_method, path, search) {
          const pushing = path.endsWith("/git-receive-pack") || search.get("service") === "git-receive-pack";
          return `${pushing ? "push" : "fetch"} ${repoOf(path)}`;
        },
      },
    },
  },
};

export function serviceSpec(id: unknown): ServiceSpec | null {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(SERVICES, id) ? SERVICES[id as ServiceId] : null;
}

/** A token as GitHub makes them: letters, digits and underscores, and
 * nothing that could end a header line. */
export function cleanToken(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const token = raw.trim();
  return /^[A-Za-z0-9_]{20,255}$/.test(token) ? token : null;
}

export function isAccess(value: unknown): value is Access {
  return value === "read" || value === "write";
}

// ── handles ──────────────────────────────────────────────────────────

/** What an address hands out: which turn credential it rides on, for
 * which agent and connection. The credential is the turn's own (see
 * server/agent-cli.ts), so the handle ends exactly when the turn does. */
export interface HandleEntry {
  credential: string;
  botId: string;
  connectionId: string;
}

export class ConnectionHandles {
  private byHandle = new Map<string, HandleEntry>();

  mint(entry: HandleEntry): string {
    const handle = `bkc_${randomBytes(24).toString("base64url")}`;
    this.byHandle.set(handle, entry);
    return handle;
  }

  find(handle: string): HandleEntry | undefined {
    return this.byHandle.get(handle);
  }

  forget(handle: string) {
    this.byHandle.delete(handle);
  }

  /** Drops every handle whose credential is no longer good. */
  sweep(live: (credential: string) => boolean) {
    for (const [handle, entry] of this.byHandle) if (!live(entry.credential)) this.byHandle.delete(handle);
  }

  get size(): number {
    return this.byHandle.size;
  }
}

/** The address a handle opens, up to and including the handle. */
export function connectBase(origin: string, handle: string): string {
  return `${origin}/connect/${handle}`;
}

/**
 * What a turn's environment gets for one granted connection: the address,
 * never the credential. For GitHub, git is pointed at the address for
 * https://github.com/ through git's own environment config, so a clone or
 * a push in the agent's shell goes through Bloks without the agent doing
 * anything different, and no credential helper is asked for the local
 * address. Git's environment config counts its entries, so the count
 * carries on from whatever the inherited environment already had.
 */
export function connectionEnv(
  service: ServiceId,
  base: string,
  inherited: Record<string, string | undefined> = {},
): Record<string, string> {
  if (service !== "github") return {};
  const git = `${base}/github.com/`;
  const start = Math.max(0, Number.parseInt(inherited.GIT_CONFIG_COUNT ?? "0", 10) || 0);
  const entries: Array<[string, string]> = [
    [`url.${git}.insteadOf`, "https://github.com/"],
    // an empty helper clears the list for this address: nothing to look
    // up in a keychain, and nothing to prompt for
    [`credential.${base}/.helper`, ""],
  ];
  const env: Record<string, string> = {
    BLOKS_GITHUB_API: `${base}/api.github.com`,
    BLOKS_GITHUB_GIT: `${base}/github.com`,
    GIT_CONFIG_COUNT: String(start + entries.length),
  };
  entries.forEach(([key, value], i) => {
    env[`GIT_CONFIG_KEY_${start + i}`] = key;
    env[`GIT_CONFIG_VALUE_${start + i}`] = value;
  });
  return env;
}

/** The names connectionEnv sets, for an engine that only hands its shell
 * what it is told to (server/drivers/codex.ts). */
export function isConnectionEnvName(name: string): boolean {
  return /^(BLOKS_GITHUB_(API|GIT)|GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+))$/.test(name);
}

/** What the agent is told about a connection it has this turn. */
export function connectionHint(service: ServiceId, access: Access, account?: string): string {
  if (service !== "github") return "";
  const who = account ? ` as @${account}` : "";
  return [
    `GitHub: you have a protected GitHub connection${who}, ${access === "write" ? "read and write" : "read only"}. Bloks adds the credential to your requests on the way out, so you never hold a token and there is none to look for.`,
    `git clone, fetch${access === "write" ? " and push" : ""} over https://github.com/ work as usual.`,
    `For the GitHub REST API, use "$BLOKS_GITHUB_API" in place of https://api.github.com, for example curl -s "$BLOKS_GITHUB_API/repos/OWNER/REPO"${
      access === "write"
        ? `, and open a pull request with curl -s -X POST "$BLOKS_GITHUB_API/repos/OWNER/REPO/pulls" -d '{"title":"...","head":"BRANCH","base":"main","body":"..."}'`
        : ""
    }.`,
    "The address only works during this turn, requests to any other host carry no credential, and every request is logged for the owner.",
  ].join(" ");
}

/** A connection as anyone but config.json sees it: no token, ever. */
export function publicConnection(record: ConnectionRecord, botExists: (id: string) => boolean) {
  const spec = SERVICES[record.service];
  return {
    id: record.id,
    service: record.service,
    name: spec?.name ?? record.service,
    account: record.account ?? null,
    scopes: record.scopes ?? null,
    addedAt: record.addedAt,
    checkedAt: record.checkedAt ?? null,
    hosts: Object.keys(spec?.hosts ?? {}),
    grants: Object.fromEntries(Object.entries(record.grants ?? {}).filter(([id, access]) => botExists(id) && isAccess(access))),
  };
}

// ── checking a token ─────────────────────────────────────────────────

export type TokenCheck = { ok: true; account: string; scopes: string | null } | { ok: false; error: string };

/** Asks GitHub who a token is. Never says the token back, whatever
 * happens: the error words are ours. */
export async function checkGitHubToken(token: string, apiOrigin: string, fetchImpl: typeof fetch = fetch): Promise<TokenCheck> {
  let res: Response;
  try {
    res = await fetchImpl(`${apiOrigin.replace(/\/$/, "")}/user`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "Bloks" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, error: "GitHub did not answer. Check the internet connection and try again." };
  }
  if (res.status === 401) return { ok: false, error: "GitHub did not accept that token. Check it was copied whole and has not expired." };
  if (!res.ok) return { ok: false, error: `GitHub answered ${res.status} when asked who the token is. Try again in a moment.` };
  const body = (await res.json().catch(() => null)) as { login?: unknown } | null;
  if (!body || typeof body.login !== "string" || !body.login) return { ok: false, error: "GitHub did not say whose token it is." };
  return { ok: true, account: body.login.slice(0, 100), scopes: res.headers.get("x-oauth-scopes") };
}

// ── the audit log ────────────────────────────────────────────────────

export interface AuditLine {
  at: number;
  connectionId: string;
  service: ServiceId;
  botId: string;
  /** The agent's name when it asked, so the line still reads after it is gone. */
  agent?: string;
  /** What was asked, in words: "push owner/repo", "GET /repos/o/r". Never
   * a header, a body or a query string. */
  what: string;
  host: string;
  method: string;
  status: number;
  outcome: "sent" | "refused";
  reason?: string;
}

/** One line per use, in a file of its own, 0600. Kept to about a
 * megabyte: when it grows past that, the older half goes. */
export class AuditLog {
  private file: string;
  private cap: number;

  constructor(file: string, cap = 1_000_000) {
    this.file = file;
    this.cap = cap;
  }

  append(line: AuditLine) {
    try {
      appendFileSync(this.file, `${JSON.stringify(line)}\n`, { mode: 0o600 });
      if (statSync(this.file).size > this.cap) {
        const lines = readFileSync(this.file, "utf8").split("\n").filter(Boolean);
        writeFileSync(this.file, `${lines.slice(Math.floor(lines.length / 2)).join("\n")}\n`, { mode: 0o600 });
      }
    } catch {
      /* a log that cannot be written is not a reason to fail the request */
    }
  }

  /** The newest lines for one connection, newest first. */
  recent(connectionId: string, limit = 30): AuditLine[] {
    if (!existsSync(this.file)) return [];
    let text = "";
    try {
      text = readFileSync(this.file, "utf8");
    } catch {
      return [];
    }
    const out: AuditLine[] = [];
    const lines = text.split("\n");
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      if (!lines[i]) continue;
      try {
        const line = JSON.parse(lines[i]) as AuditLine;
        if (line.connectionId === connectionId) out.push(line);
      } catch {
        /* a line cut short by a crash */
      }
    }
    return out;
  }
}

// ── the proxy ────────────────────────────────────────────────────────

/** Request headers passed on. Everything else stays here: the agent's own
 * authorization and cookies above all, so nothing it sends can stand in
 * for the credential or ride along with it. */
const PASSED = new Set([
  "accept",
  "accept-language",
  "content-type",
  "content-encoding",
  "content-length",
  "user-agent",
  "git-protocol",
  "x-github-api-version",
  "if-none-match",
  "if-modified-since",
  "range",
]);

/** The most of a text response held to be checked before it is sent. */
const MAX_TEXT = 16 * 1024 * 1024;

export interface ProxyContext {
  handles: ConnectionHandles;
  /** The agent the handle's credential still speaks for, or null once its
   * turn is over or the credential is not one for this. */
  liveAgent(entry: HandleEntry): string | null;
  connection(id: string): ConnectionRecord | undefined;
  agentName(botId: string): string | undefined;
  audit: AuditLog;
  /** Where a host's requests really go: https://<host> in use, a local
   * stand-in under test. */
  upstream(host: string): string;
}

/** Every form of the credential that could come back in a response. */
function forms(token: string): string[] {
  return [token, Buffer.from(`x-access-token:${token}`).toString("base64")];
}

export function scrub(text: string, token: string): string {
  let out = text;
  for (const form of forms(token)) if (form.length >= 8) out = out.split(form).join("[redacted]");
  return out;
}

function refuseJson(res: ServerResponse, status: number, error: string) {
  const body = JSON.stringify({ error });
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body), "cache-control": "no-store" });
  res.end(body);
}

/**
 * Serves one request to /connect/<handle>/<host>/<path>. `local` is the
 * server's own word that the request came from this computer, in the way
 * every local-only route asks (server/http-guard.ts). `path` is already
 * normalised, so no dot segment can step out of the host it names.
 */
export function proxyConnection(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  search: string,
  local: boolean,
  ctx: ProxyContext,
) {
  const method = (req.method ?? "GET").toUpperCase();
  const parts = /^\/connect\/(bkc_[A-Za-z0-9_-]{20,64})\/([a-z0-9.-]+)(\/.*)?$/.exec(path);
  if (!local) return refuseJson(res, 403, "a connection only works on this computer");
  if (!parts) return refuseJson(res, 404, "not a connection address");
  const [, handle, host, rest = "/"] = parts;
  const entry = ctx.handles.find(handle);
  if (!entry) return refuseJson(res, 403, "this connection address has ended; it lasts one turn");
  const botId = ctx.liveAgent(entry);
  if (!botId) {
    ctx.handles.forget(handle);
    return refuseJson(res, 403, "this connection address has ended; it lasts one turn");
  }
  const record = ctx.connection(entry.connectionId);
  const spec = record ? SERVICES[record.service] : undefined;
  const access = record?.grants?.[botId];
  const params = new URLSearchParams(search);
  const line = (status: number, outcome: AuditLine["outcome"], what: string, reason?: string) =>
    ctx.audit.append({
      at: Date.now(),
      connectionId: entry.connectionId,
      service: record?.service ?? "github",
      botId,
      agent: ctx.agentName(botId),
      what: what.slice(0, 200),
      host,
      method,
      status,
      outcome,
      ...(reason ? { reason } : {}),
    });
  if (!record || !spec || !isAccess(access)) {
    line(403, "refused", `${method} ${rest}`, "not granted");
    return refuseJson(res, 403, "this agent no longer has this connection; the owner can grant it again in Settings");
  }
  const hostSpec = Object.prototype.hasOwnProperty.call(spec.hosts, host) ? spec.hosts[host] : undefined;
  if (!hostSpec) {
    line(403, "refused", `${method} ${host}${rest}`, `${host} is not one of ${spec.name}'s hosts`);
    return refuseJson(res, 403, `${host} is not one of ${spec.name}'s hosts, so nothing is sent there through this connection`);
  }
  const what = hostSpec.describe(method, rest, params);
  const refused = hostSpec.refuse(method, rest, params, access);
  if (refused) {
    line(403, "refused", what, refused);
    return refuseJson(res, 403, refused);
  }

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string" && PASSED.has(name)) headers[name] = value;
  }
  if (!headers["user-agent"]) headers["user-agent"] = "Bloks";
  // asked for plain, so what comes back can be read for the credential
  if (hostSpec.textual) headers["accept-encoding"] = "identity";
  else if (typeof req.headers["accept-encoding"] === "string") headers["accept-encoding"] = req.headers["accept-encoding"];
  Object.assign(headers, hostSpec.inject(record.token));

  let target: URL;
  try {
    target = new URL(ctx.upstream(host));
  } catch {
    return refuseJson(res, 502, `${spec.name} could not be reached`);
  }
  const send = target.protocol === "https:" ? httpsRequest : httpRequest;
  const base = `http://${req.headers.host}/connect/${handle}`;
  const upstream = send(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      method,
      path: `${target.pathname.replace(/\/$/, "")}${rest}${search}`,
      headers,
      timeout: 120_000,
    },
    (answer) => {
      const status = answer.statusCode ?? 502;
      // A credential the service turned down is said in words, not passed
      // on as a 401: git would take that as a cue to ask a credential
      // helper for this address, and there is nothing it should find.
      if (status === 401 || status === 407) {
        answer.resume();
        line(502, "sent", what, "the service did not accept the saved credential");
        return refuseJson(res, 502, `${spec.name} did not accept the connection's token. The owner can check or replace it in Settings.`);
      }
      const out: Record<string, string | string[]> = {};
      for (const [name, value] of Object.entries(answer.headers)) {
        if (value === undefined || HOP_HEADERS.has(name) || name === "set-cookie" || name === "content-length") continue;
        out[name] = Array.isArray(value) ? value.map((v) => scrub(v, record.token)) : scrub(value, record.token);
      }
      // A redirect to one of this service's own hosts comes back through
      // here, to be checked again; anywhere else it goes as it is, and the
      // client follows it without the credential.
      const location = typeof out.location === "string" ? out.location : undefined;
      if (location) {
        try {
          const to = new URL(location, `https://${host}`);
          if (to.protocol === "https:" && Object.prototype.hasOwnProperty.call(spec.hosts, to.hostname)) {
            out.location = `${base}/${to.hostname}${to.pathname}${to.search}`;
          }
        } catch {
          delete out.location;
        }
      }
      out["cache-control"] = "no-store";
      line(status, "sent", what);
      const type = String(answer.headers["content-type"] ?? "");
      if (hostSpec.textual || /json|text|xml|javascript/i.test(type)) {
        const chunks: Buffer[] = [];
        let size = 0;
        let over = false;
        answer.on("data", (chunk: Buffer) => {
          if (over) return;
          size += chunk.length;
          if (size > MAX_TEXT) {
            over = true;
            answer.destroy();
            if (!res.headersSent) refuseJson(res, 502, `${spec.name}'s answer was too large to check, so it was not passed on`);
            return;
          }
          chunks.push(chunk);
        });
        answer.on("end", () => {
          if (over || res.headersSent) return;
          const body = Buffer.from(scrub(Buffer.concat(chunks).toString("latin1"), record.token), "latin1");
          res.writeHead(status, { ...out, "content-length": body.length });
          res.end(body);
        });
        answer.on("error", () => {
          if (!res.headersSent) refuseJson(res, 502, `${spec.name} stopped answering`);
          else res.destroy();
        });
        return;
      }
      if (answer.headers["content-length"]) out["content-length"] = answer.headers["content-length"];
      res.writeHead(status, out);
      answer.pipe(res);
    },
  );
  upstream.on("timeout", () => upstream.destroy(new Error("timed out")));
  upstream.on("error", () => {
    if (!res.headersSent) {
      line(502, "sent", what, "no answer");
      refuseJson(res, 502, `${spec.name} did not answer`);
    } else res.destroy();
  });
  req.pipe(upstream);
}
