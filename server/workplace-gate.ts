// The one door from an agent working elsewhere back into Bloks.
//
// An agent in a container or on another machine still needs Bloks
// during its turn: its command line (`bloks share`, `bloks memory`, the
// rest), and the helpers its engine calls as MCP servers, the approval
// bridge first among them. Those helpers stay on this computer, where
// the sockets, the keys and the person's Mac are, and the other side is
// pointed at them over HTTP.
//
// The workspace's own server cannot be what it is pointed at. On this
// computer a request with no credential is the person at the keyboard,
// and an SSH tunnel's far end is a port on a machine other people may
// use too. So the other side reaches this instead: a listener of its
// own, on a port of its own, that answers nothing without a turn's own
// token, and only while that turn runs. What it answers:
//
//   /api/...    passed to the workspace with the token, where the agent
//               rules (server/agent-cli.ts) decide what it may do, as
//               they do for an agent here. Only the headers a request
//               of the CLI's needs are passed on, so nothing sent from
//               there can pose as a paired device or a browser.
//   /mcp/<id>   an MCP server of the turn's, over streamable HTTP. A
//               stdio one (the approval bridge, the computer, a server of
//               the person's) runs here, one process per session; an
//               HTTP one is called from here with its own headers. So a
//               server's key never leaves this computer either.
//   /api/gate/ping, which says only that this is a gate, for the Test.
//
// Nothing else, and no token but a live turn's.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";

import { signalGroup } from "./drivers/engine-processes.ts";
import { bearerToken } from "./http-guard.ts";
import { readJsonLines } from "./ndjson.ts";
import { OWN_GROUP } from "./no-console.ts";

/** An MCP server the turn's engine is pointed at through the gate. */
export type GateServer =
  | { transport: "stdio"; command: string; args: string[]; env?: Record<string, string> }
  | { transport: "http"; url: string; headers?: Record<string, string> };

export interface GateTurn {
  botId: string;
  laneId: string;
  /** The credentials this turn's environment carries there. */
  tokens: string[];
  servers: Map<string, GateServer>;
}

/** A JSON-RPC body bigger than this is not an MCP message. */
const MAX_BODY = 8 * 1024 * 1024;
/** Said while a tool call waits on a person, so nothing between here and
 * the engine closes a quiet stream. */
const HEARTBEAT_MS = 15_000;

/** The request headers a call from the other side keeps on its way to the
 * workspace. Everything else stays behind: an Origin naming the far
 * side's address, a forwarded-for, a relay's marks. */
const PASSED = ["authorization", "content-type", "content-length", "accept", "range", "transfer-encoding"];
const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection"]);

interface Session {
  id: string;
  token: string;
  slug: string;
  child: ChildProcessWithoutNullStreams;
  /** Waiting for an answer, by its JSON-RPC id. */
  pending: Map<string, (reply: unknown) => void>;
  /** SSE streams open on this session, for messages that answer nothing. */
  streams: Set<ServerResponse>;
}

const idKey = (id: unknown) => JSON.stringify(id);

function sse(res: ServerResponse, message: unknown) {
  if (!res.writableEnded) res.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "null"));
      } catch {
        reject(new Error("not JSON"));
      }
    });
    req.on("error", reject);
  });
}

const refuse = (res: ServerResponse, status: number, error: string) => {
  if (res.headersSent) return res.end();
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ error }));
};

export class Gate {
  private turns = new Map<string, GateTurn>();
  private sessions = new Map<string, Session>();
  private listening = new Map<string, Promise<number>>();
  private servers: Server[] = [];
  private mainPort: () => number;
  private live: (token: string) => boolean;

  /** `live` is the workspace's own word that a token still belongs to a
   * running turn: the gate's list is the narrower one, never the wider. */
  constructor(options: { mainPort: () => number; live: (token: string) => boolean }) {
    this.mainPort = options.mainPort;
    this.live = options.live;
  }

  /** The port the gate answers on at this address, listening first if it
   * is not yet. One port per address for every turn: a turn is told
   * apart by its token, not by where it knocks. */
  listen(host = "127.0.0.1"): Promise<number> {
    const known = this.listening.get(host);
    if (known) return known;
    const started = new Promise<number>((resolve, reject) => {
      const server = createServer((req, res) => void this.handle(req, res));
      // A tool call can wait a quarter of an hour on a person, which is
      // the request's whole life, not a stall.
      server.requestTimeout = 0;
      server.headersTimeout = 60_000;
      server.keepAliveTimeout = 5_000;
      server.once("error", (error) => {
        this.listening.delete(host);
        reject(error);
      });
      server.listen(0, host, () => {
        this.servers.push(server);
        server.unref();
        resolve((server.address() as AddressInfo).port);
      });
    });
    this.listening.set(host, started);
    return started;
  }

  /** A turn's tokens open the gate until close(). */
  open(turn: GateTurn) {
    for (const token of turn.tokens) if (token) this.turns.set(token, turn);
  }

  /** The turn is over: its tokens close the gate, and every MCP session it
   * opened ends, with whatever it was still waiting on. */
  close(laneId: string) {
    for (const [token, turn] of this.turns) if (turn.laneId === laneId) this.turns.delete(token);
    for (const session of [...this.sessions.values()]) {
      if (!this.turns.has(session.token)) this.endSession(session);
    }
  }

  /** Whether any turn is open, for tests and for tidying up. */
  openTurns(): number {
    return new Set(this.turns.values()).size;
  }

  async dispose() {
    for (const session of [...this.sessions.values()]) this.endSession(session);
    this.turns.clear();
    await Promise.all(this.servers.map((server) => new Promise((resolve) => server.close(resolve))));
    this.servers = [];
    this.listening.clear();
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://gate");
    const method = req.method ?? "GET";
    // never a browser's: a page cannot send the bearer token without a
    // preflight, and no preflight is ever answered here
    if (method === "OPTIONS") return refuse(res, 405, "not here");
    if (method === "GET" && url.pathname === "/api/gate/ping") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: true, gate: true }));
    }
    const token = bearerToken(req);
    const turn = token ? this.turns.get(token) : undefined;
    if (!token || !turn || !this.live(token)) {
      req.resume();
      return refuse(res, 401, "Bloks answers only a running turn's own credential here");
    }
    const mcp = /^\/mcp\/([A-Za-z0-9_-]{1,64})$/.exec(url.pathname);
    if (mcp) {
      const server = turn.servers.get(mcp[1]);
      if (!server) {
        req.resume();
        return refuse(res, 404, "no such server for this turn");
      }
      return server.transport === "stdio" ? this.stdio(req, res, token, mcp[1], server) : this.forwardHttp(req, res, server);
    }
    if (url.pathname.startsWith("/api/")) return this.forward(req, res);
    req.resume();
    return refuse(res, 404, "not here");
  }

  /** A request for the workspace, with only the headers it should have. */
  private forward(req: IncomingMessage, res: ServerResponse) {
    const port = this.mainPort();
    const headers: Record<string, string> = { host: `127.0.0.1:${port}` };
    for (const name of PASSED) {
      const value = req.headers[name];
      if (typeof value === "string") headers[name] = value;
    }
    const upstream = httpRequest({ host: "127.0.0.1", port, method: req.method, path: req.url, headers }, (answer) => {
      const back: Record<string, string | string[]> = {};
      for (const [name, value] of Object.entries(answer.headers)) {
        if (value !== undefined && !HOP.has(name)) back[name] = value;
      }
      res.writeHead(answer.statusCode ?? 502, back);
      answer.pipe(res);
    });
    upstream.on("error", () => refuse(res, 502, "the workspace did not answer"));
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  }

  /** An MCP server of the person's over HTTP, called from here, with the
   * headers it needs added here. */
  private async forwardHttp(req: IncomingMessage, res: ServerResponse, server: Extract<GateServer, { transport: "http" }>) {
    const headers: Record<string, string> = { ...(server.headers ?? {}) };
    for (const name of ["content-type", "accept", "mcp-session-id", "mcp-protocol-version", "last-event-id"]) {
      const value = req.headers[name];
      if (typeof value === "string") headers[name] = value;
    }
    const method = req.method ?? "GET";
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    try {
      const body = method === "GET" || method === "HEAD" || method === "DELETE" ? undefined : await readRaw(req);
      const answer = await fetch(server.url, { method, headers, body, signal: abort.signal, redirect: "manual" });
      const back: Record<string, string> = {};
      for (const name of ["content-type", "mcp-session-id", "cache-control"]) {
        const value = answer.headers.get(name);
        if (value) back[name] = value;
      }
      res.writeHead(answer.status, back);
      if (answer.body) Readable.fromWeb(answer.body as any).on("error", () => res.end()).pipe(res);
      else res.end();
    } catch {
      refuse(res, 502, "the MCP server did not answer");
    }
  }

  /** A stdio MCP server, run here, spoken to the far side as streamable
   * HTTP. A request is answered on an event stream of its own, kept open
   * with comments while a tool call waits on a person. */
  private async stdio(req: IncomingMessage, res: ServerResponse, token: string, slug: string, server: Extract<GateServer, { transport: "stdio" }>) {
    const method = req.method ?? "GET";
    const asked = req.headers["mcp-session-id"];
    const existing = typeof asked === "string" ? this.sessions.get(asked) : undefined;
    const own = existing && existing.token === token && existing.slug === slug ? existing : undefined;
    if (method === "DELETE") {
      if (own) this.endSession(own);
      res.writeHead(own ? 200 : 404);
      return res.end();
    }
    // Messages the server sends unasked go out on a request's own stream,
    // which is all a bridge for these helpers ever needs.
    if (method !== "POST") return refuse(res, 405, "this server answers POST");
    let body: unknown;
    try {
      body = await readJson(req);
    } catch (error) {
      return refuse(res, 400, `the request was ${(error as Error).message}`);
    }
    const messages = (Array.isArray(body) ? body : [body]).filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === "object");
    if (!messages.length) return refuse(res, 400, "no message");
    let session = own;
    if (messages.some((m) => m.method === "initialize")) {
      if (session) this.endSession(session);
      session = this.startSession(token, slug, server);
    }
    if (!session) return refuse(res, 404, "no such session; initialize first");

    const requests = messages.filter((m) => typeof m.method === "string" && m.id !== undefined && m.id !== null);
    if (!requests.length) {
      for (const message of messages) session.child.stdin.write(JSON.stringify(message) + "\n");
      res.writeHead(202, { "mcp-session-id": session.id });
      return res.end();
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", "mcp-session-id": session.id });
    res.write(": open\n\n");
    const left = new Set(requests.map((m) => idKey(m.id)));
    const live = session;
    live.streams.add(res);
    const beat = setInterval(() => !res.writableEnded && res.write(": waiting\n\n"), HEARTBEAT_MS);
    beat.unref();
    const done = () => {
      clearInterval(beat);
      live.streams.delete(res);
      if (!res.writableEnded) res.end();
    };
    for (const key of left) {
      live.pending.set(key, (reply) => {
        sse(res, reply);
        left.delete(key);
        if (!left.size) done();
      });
    }
    res.on("close", () => {
      for (const key of left) live.pending.delete(key);
      done();
    });
    for (const message of messages) live.child.stdin.write(JSON.stringify(message) + "\n");
  }

  private startSession(token: string, slug: string, server: Extract<GateServer, { transport: "stdio" }>): Session {
    const child = spawn(server.command, server.args, {
      env: { ...process.env, ...(server.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
      detached: OWN_GROUP,
      windowsHide: true,
    });
    const session: Session = { id: randomBytes(16).toString("hex"), token, slug, child, pending: new Map(), streams: new Set() };
    this.sessions.set(session.id, session);
    child.stderr.resume();
    child.stdin.on("error", () => {});
    readJsonLines(child.stdout, (message) => {
      if (message && typeof message === "object" && "id" in message && !("method" in message)) {
        const waiter = session.pending.get(idKey(message.id));
        if (waiter) {
          session.pending.delete(idKey(message.id));
          return waiter(message);
        }
      }
      const stream = [...session.streams][0];
      if (stream) sse(stream, message);
    });
    const gone = () => {
      if (this.sessions.get(session.id) === session) this.sessions.delete(session.id);
      for (const [key, waiter] of [...session.pending]) {
        session.pending.delete(key);
        waiter({ jsonrpc: "2.0", id: JSON.parse(key), error: { code: -32000, message: "Bloks: this tool's server stopped" } });
      }
    };
    child.once("exit", gone);
    child.once("error", gone);
    return session;
  }

  private endSession(session: Session) {
    this.sessions.delete(session.id);
    for (const stream of session.streams) if (!stream.writableEnded) stream.end();
    session.streams.clear();
    signalGroup(session.child, "SIGTERM");
    const kill = setTimeout(() => signalGroup(session.child, "SIGKILL"), 2_000);
    kill.unref();
    session.child.once("exit", () => clearTimeout(kill));
  }
}

function readRaw(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
