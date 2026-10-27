// A stand-in for Composio, as far as app watchers can tell: its project
// REST side (trigger types, connected accounts, trigger instances, the
// realtime credentials and channel auth), its Connect MCP endpoint (only
// what disconnecting an app asks), and its realtime channel, which is a
// Pusher socket. Everything a test needs to see is recorded, and events
// are pushed down the socket when the test says so.
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { Socket } from "node:net";

export const PROJECT_KEY = "ak_test_project";
export const PUSHER_KEY = "pk_test";
export const PROJECT_ID = "pr_test";
export const CHANNEL = `private-${PROJECT_ID}_triggers`;

export interface FakeComposio {
  url: string;
  wsUrl: string;
  calls: Array<{ method: string; path: string; body: any; key?: string }>;
  /** Connected accounts by toolkit; a test changes this to disconnect one. */
  accounts: Record<string, Array<{ id: string; status: string; alias?: string }>>;
  /** Sockets that subscribed to the channel. */
  subscribed(): number;
  /** One event down every subscribed socket, whole or in chunks. */
  push(event: unknown, options?: { chunks?: number }): void;
  /** Ends every socket, the way a network drop would. */
  drop(): void;
  close(): Promise<void>;
}

const TYPES = [
  {
    slug: "GMAIL_NEW_GMAIL_MESSAGE",
    name: "New Gmail message",
    description: "Fires when a new message arrives",
    instructions: "",
    type: "poll",
    types: ["poll"],
    toolkit: { slug: "gmail", name: "gmail", logo: "" },
    config: {
      properties: {
        labelIds: { type: "string", title: "Label", description: "Only this label", default: "INBOX" },
        interval: { type: "integer", title: "Interval", description: "Minutes between looks", default: 1 },
      },
      required: [],
    },
    version: "1",
  },
  {
    slug: "GITHUB_ISSUE_LABELED_EVENT",
    name: "Issue labelled",
    description: "Fires when an issue is labelled",
    instructions: "",
    type: "webhook",
    types: ["webhook"],
    toolkit: { slug: "github", name: "github", logo: "" },
    config: {
      properties: { owner: { type: "string", title: "Owner" }, repo: { type: "string", title: "Repository" } },
      required: ["owner", "repo"],
    },
    version: "1",
  },
];

/** One frame from the server, unmasked, of any length. */
function frame(text: string): Buffer {
  const body = Buffer.from(text);
  if (body.length < 126) return Buffer.concat([Buffer.from([0x81, body.length]), body]);
  if (body.length < 65_536) {
    const head = Buffer.alloc(4);
    head[0] = 0x81;
    head[1] = 126;
    head.writeUInt16BE(body.length, 2);
    return Buffer.concat([head, body]);
  }
  const head = Buffer.alloc(10);
  head[0] = 0x81;
  head[1] = 127;
  head.writeBigUInt64BE(BigInt(body.length), 2);
  return Buffer.concat([head, body]);
}

/** The client's frames out of what arrived so far; the rest waits. */
function unframe(buffer: Buffer): { messages: Array<{ op: number; text: string }>; rest: Buffer } {
  const messages: Array<{ op: number; text: string }> = [];
  let at = 0;
  while (buffer.length - at >= 2) {
    const op = buffer[at] & 0x0f;
    let length = buffer[at + 1] & 0x7f;
    let head = 2;
    if (length === 126) {
      if (buffer.length - at < 4) break;
      length = buffer.readUInt16BE(at + 2);
      head = 4;
    } else if (length === 127) {
      if (buffer.length - at < 10) break;
      length = Number(buffer.readBigUInt64BE(at + 2));
      head = 10;
    }
    if (buffer.length - at < head + 4 + length) break;
    const mask = buffer.subarray(at + head, at + head + 4);
    const body = Buffer.from(buffer.subarray(at + head + 4, at + head + 4 + length));
    for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
    messages.push({ op, text: body.toString("utf8") });
    at += head + 4 + length;
  }
  return { messages, rest: buffer.subarray(at) };
}

const read = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let text = "";
    req.on("data", (c) => (text += c));
    req.on("end", () => resolve(text));
  });

export async function fakeComposio(): Promise<FakeComposio> {
  const calls: FakeComposio["calls"] = [];
  const accounts: FakeComposio["accounts"] = { gmail: [{ id: "ca_gmail", status: "ACTIVE", alias: "work" }], github: [{ id: "ca_github", status: "ACTIVE" }] };
  const sockets = new Set<Socket>();
  const live = new Set<Socket>();
  let triggers = 0;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const text = await read(req);
    let body: any = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = Object.fromEntries(new URLSearchParams(text));
    }
    const key = (req.headers["x-api-key"] as string | undefined) ?? (req.headers["x-consumer-api-key"] as string | undefined);
    calls.push({ method: req.method ?? "GET", path: url.pathname + url.search, body, key });
    const send = (status: number, value: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };
    const p = url.pathname;
    // the Connect MCP side: only what disconnecting an app does
    if (p === "/mcp") {
      const toolkits = body?.params?.arguments?.toolkits ?? [];
      const results = Object.fromEntries(toolkits.map((t: any) => [t.name, { status: "active", accounts: [{ id: `mcp_${t.name}`, status: "ACTIVE" }] }]));
      return send(200, { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify({ data: { results } }) }] } });
    }
    if (key !== PROJECT_KEY) return send(401, { error: { message: "bad key", code: 401, slug: "unauthorized", status: 401 } });
    if (p === "/api/v3/toolkits") return send(200, { items: [] });
    if (p === "/api/v3.1/triggers_types") {
      const kit = url.searchParams.get("toolkit_slugs");
      return send(200, { items: TYPES.filter((t) => t.toolkit.slug === kit), next_cursor: null, total_items: 1 });
    }
    let m = p.match(/^\/api\/v3\.1\/triggers_types\/(\w+)$/);
    if (m) {
      const type = TYPES.find((t) => t.slug === m![1]);
      return type ? send(200, type) : send(404, { error: { message: "no such trigger type" } });
    }
    if (p === "/api/v3.1/connected_accounts") {
      const kit = url.searchParams.get("toolkit_slugs") ?? "";
      const items = (accounts[kit] ?? [])
        .filter((a) => a.status === "ACTIVE")
        .map((a) => ({ id: a.id, status: a.status, alias: a.alias ?? null, word_id: null, toolkit: { slug: kit }, created_at: "2026-10-01T00:00:00Z", is_disabled: false }));
      return send(200, { items, next_cursor: null, total_pages: 1, current_page: 1, total_items: items.length });
    }
    m = p.match(/^\/api\/v3\.1\/connected_accounts\/([\w-]+)$/);
    if (m) {
      const found = Object.values(accounts).flat().find((a) => a.id === m![1]);
      return found ? send(200, { id: found.id, status: found.status, is_disabled: false }) : send(404, { error: { message: "gone" } });
    }
    m = p.match(/^\/api\/v3\.1\/trigger_instances\/(\w+)\/upsert$/);
    if (m && req.method === "POST") return send(200, { trigger_id: `ti_${++triggers}` });
    m = p.match(/^\/api\/v3\.1\/trigger_instances\/manage\/([\w-]+)$/);
    if (m && (req.method === "PATCH" || req.method === "DELETE")) return send(200, { status: "success" });
    if (p === "/api/v3/internal/sdk/realtime/credentials") return send(200, { pusher_key: PUSHER_KEY, pusher_cluster: "test", project_id: PROJECT_ID });
    if (p === "/api/v3/internal/sdk/realtime/auth") {
      if (body?.channel_name !== CHANNEL || !body?.socket_id) return send(403, { error: { message: "no" } });
      return send(200, { auth: `${PUSHER_KEY}:sig-${body.socket_id}` });
    }
    send(404, { error: { message: `nothing at ${p}` } });
  });

  server.on("upgrade", (req, socket: Socket) => {
    const accept = createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    sockets.add(socket);
    calls.push({ method: "WS", path: req.url ?? "", body: null });
    const socketId = `${Math.floor(Math.random() * 1e6)}.${Math.floor(Math.random() * 1e6)}`;
    const say = (value: unknown) => socket.write(frame(JSON.stringify(value)));
    if (!req.url?.startsWith(`/app/${PUSHER_KEY}?`)) {
      say({ event: "pusher:error", data: { code: 4001, message: "App key not in this cluster" } });
      socket.end();
      return;
    }
    say({ event: "pusher:connection_established", data: JSON.stringify({ socket_id: socketId, activity_timeout: 120 }) });
    let pending: Buffer = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      const { messages, rest } = unframe(Buffer.concat([pending, chunk]));
      pending = rest;
      for (const message of messages) {
        if (message.op === 8) {
          socket.end();
          continue;
        }
        if (message.op !== 1) continue;
        let parsed: any;
        try {
          parsed = JSON.parse(message.text);
        } catch {
          continue;
        }
        calls.push({ method: "WS", path: parsed.event, body: parsed.data });
        if (parsed.event === "pusher:subscribe") {
          if (parsed.data?.channel === CHANNEL && parsed.data?.auth === `${PUSHER_KEY}:sig-${socketId}`) {
            live.add(socket);
            say({ event: "pusher_internal:subscription_succeeded", channel: CHANNEL, data: "{}" });
          } else say({ event: "pusher:subscription_error", channel: parsed.data?.channel, data: { status: 403 } });
        }
        if (parsed.event === "pusher:ping") say({ event: "pusher:pong", data: "{}" });
      }
    });
    const gone = () => {
      sockets.delete(socket);
      live.delete(socket);
    };
    socket.on("close", gone);
    socket.on("error", gone);
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}`,
    calls,
    accounts,
    subscribed: () => live.size,
    push(event, options = {}) {
      const data = JSON.stringify(event);
      for (const socket of live) {
        if (!options.chunks) {
          socket.write(frame(JSON.stringify({ event: "trigger_to_client", channel: CHANNEL, data })));
          continue;
        }
        const size = Math.ceil(data.length / options.chunks);
        const id = `chunk-${Math.random()}`;
        for (let i = 0; i < options.chunks; i++) {
          const piece = { id, index: i, chunk: data.slice(i * size, (i + 1) * size), final: i === options.chunks - 1 };
          socket.write(frame(JSON.stringify({ event: "chunked-trigger_to_client", channel: CHANNEL, data: JSON.stringify(piece) })));
        }
      }
    },
    drop() {
      for (const socket of sockets) socket.destroy();
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

/** A V3 envelope, as Composio sends a trigger event. */
export function v3Event(triggerId: string, id: string, data: unknown, slug = "GMAIL_NEW_GMAIL_MESSAGE") {
  return {
    id,
    type: "composio.trigger.message",
    metadata: { log_id: `log_${id}`, trigger_slug: slug, trigger_id: triggerId, connected_account_id: "ca_gmail", auth_config_id: "ac_1", user_id: "u1" },
    data,
    timestamp: "2026-10-27T10:30:00Z",
  };
}
