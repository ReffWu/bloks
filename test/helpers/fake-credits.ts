// A Bloks AI service on loopback, close enough to the real one for the
// app to be held to it: a licence traded for a token, an OpenAI
// compatible model list and completions, an Anthropic-shaped answer,
// what is left as shares of the plan, member caps, the hosting status,
// a 402 when the allowance is used up, and a 401 for a token it has
// revoked. It also opens a Bloks Cloud space, so activation can be run
// end to end against it.
//
// Like a careless upstream, it names the models it really ran and the
// money it cost in its answers, so a test can show none of that gets
// past the app.
import { createServer, type IncomingMessage, type Server } from "node:http";

/** What the fake says it ran underneath, which the app must never show. */
export const UPSTREAM_MODEL = "upstream-sekrit-9";

export interface FakeMember {
  member: string;
  usedPercent: number;
  dailyCapPercent?: number | null;
}

export interface FakeCredits {
  /** The base the app is pointed at (BLOKS_CREDITS_URL). */
  base: string;
  /** The same server's root, for BLOKS_RELAY_URL. */
  root: string;
  /** Tokens it has handed out, in order. */
  issued: string[];
  /** Licences it was asked to trade, in order. */
  traded: string[];
  /** Every bearer that reached a /v1 route or the balance. */
  bearers: string[];
  /** Requests to the chat completions route, bodies parsed. */
  completions: any[];
  /** The tag headers each completion carried, in order. */
  tags: Array<{ work: string | null; member: string | null }>;
  /** Bodies posted to /settings, parsed. */
  settings: any[];
  /** Use it all up: completions answer 402 from now on. */
  empty(message?: string): void;
  /** What is left again, as a share. */
  refill(leftPercent: number): void;
  /** A token it no longer accepts. */
  revoke(token: string): void;
  close(): Promise<void>;
}

const LICENCE = /^blok_live_[0-9a-f]{32}$/;

function bodyOf(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

export async function startFakeCredits(
  opts: { leftPercent?: number; models?: string[]; team?: boolean; members?: FakeMember[] } = {},
): Promise<FakeCredits> {
  let left = opts.leftPercent ?? 62;
  let emptyWords = "Bloks AI is used up for this month. Top up to keep going.";
  const revoked = new Set<string>();
  const live = new Set<string>();
  const issued: string[] = [];
  const traded: string[] = [];
  const bearers: string[] = [];
  const completions: any[] = [];
  const tags: FakeCredits["tags"] = [];
  const settings: any[] = [];
  const members = (opts.members ?? []).map((m) => ({ ...m }));
  const models = opts.models ?? ["bloks-ai", UPSTREAM_MODEL];

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    const raw = await bodyOf(req);

    // Bloks Cloud opening a space for a licence
    if (req.method === "POST" && url.pathname === "/spaces") {
      if (!LICENCE.test(bearer)) return send(401, { error: "not a licence" });
      return send(201, { spaceId: "sp_test", agentToken: "agent-token-x", clientToken: "client-token-x" });
    }
    if (req.method === "POST" && url.pathname === "/api/ai/token") {
      if (!LICENCE.test(bearer)) return send(401, { error: "That licence is not one we know." });
      traded.push(bearer);
      const token = `cred_${issued.length + 1}_${"t".repeat(24)}`;
      issued.push(token);
      live.add(token);
      return send(200, { token });
    }
    const authorised = live.has(bearer) && !revoked.has(bearer);
    if (url.pathname.startsWith("/api/ai/v1/") || url.pathname === "/api/ai/balance" || url.pathname === "/api/ai/settings" || url.pathname === "/api/hosting/status") {
      bearers.push(bearer);
      if (!authorised) return send(401, { error: { message: "token revoked" } });
    }
    if (req.method === "GET" && url.pathname === "/api/ai/balance") {
      return send(200, {
        plan: opts.team ? "team" : "solo",
        usedPercent: 100 - left,
        leftPercent: left,
        monthlyLeftPercent: left,
        topUps: 1,
        renewsAt: "2026-11-19T00:00:00Z",
        low: left <= 10,
        ...(opts.team ? { members } : {}),
        // what a careless service might add, never to be shown
        balanceUsd: 41.17,
        model: UPSTREAM_MODEL,
      });
    }
    if (req.method === "POST" && url.pathname === "/api/ai/settings") {
      const body = JSON.parse(raw || "{}");
      settings.push(body);
      for (const [member, cap] of Object.entries((body.memberCaps ?? {}) as Record<string, number | null>)) {
        const row = members.find((m) => m.member === member);
        if (row) row.dailyCapPercent = cap;
      }
      return send(200, { ok: true });
    }
    if (req.method === "GET" && url.pathname === "/api/hosting/status") {
      return send(200, { team: opts.team === true });
    }
    if (req.method === "GET" && url.pathname === "/api/ai/v1/models") {
      return send(200, { data: models.map((id) => ({ id, object: "model" })) });
    }
    if (req.method === "POST" && url.pathname === "/api/ai/v1/chat/completions") {
      const body = JSON.parse(raw || "{}");
      completions.push(body);
      const header = (name: string) => {
        const value = req.headers[name];
        return typeof value === "string" ? value : null;
      };
      tags.push({ work: header("x-bloks-work"), member: header("x-bloks-member") });
      if (left <= 0) return send(402, { error: { message: emptyWords, type: "insufficient_quota" } });
      const last = [...(body.messages ?? [])].reverse().find((m: any) => m.role === "user");
      const text = `bloks ai says: ${String(last?.content ?? "").slice(0, 60)}`;
      if (body.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ model: UPSTREAM_MODEL, choices: [{ delta: { content: text } }] })}\n\n`);
        res.end("data: [DONE]\n\n");
        return;
      }
      return send(200, {
        model: UPSTREAM_MODEL,
        choices: [{ message: { role: "assistant", content: text } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0123 },
      });
    }
    return send(404, { error: "no such route" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const root = `http://127.0.0.1:${port}`;
  return {
    base: `${root}/api/ai`,
    root,
    issued,
    traded,
    bearers,
    completions,
    tags,
    settings,
    empty(message) {
      left = 0;
      if (message) emptyWords = message;
    },
    refill(leftPercent) {
      left = leftPercent;
    },
    revoke(token) {
      revoked.add(token);
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
