// A Bloks credits service on loopback, close enough to the real one for
// the app to be held to it: a licence traded for a token, an OpenAI
// compatible model list and completions, an Anthropic-shaped answer, a
// balance, a 402 when the balance is spent, and a 401 for a token it has
// revoked. It also opens a Bloks Cloud space, so activation can be run
// end to end against it.
import { createServer, type IncomingMessage, type Server } from "node:http";

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
  /** Spend it all: completions answer 402 from now on. */
  empty(message?: string): void;
  refill(amount: number): void;
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

export async function startFakeCredits(opts: { balance?: number; models?: string[] } = {}): Promise<FakeCredits> {
  let balance = opts.balance ?? 12.5;
  let emptyWords = "Your Bloks credits have run out. Add more to keep going.";
  const revoked = new Set<string>();
  const live = new Set<string>();
  const issued: string[] = [];
  const traded: string[] = [];
  const bearers: string[] = [];
  const completions: any[] = [];
  const models = opts.models ?? ["claude-sonnet-5", "gpt-6-luna"];

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
    if (url.pathname.startsWith("/api/ai/v1/") || url.pathname === "/api/ai/balance") {
      bearers.push(bearer);
      if (!authorised) return send(401, { error: { message: "token revoked" } });
    }
    if (req.method === "GET" && url.pathname === "/api/ai/balance") {
      return send(200, { balance, currency: "usd", lowAt: 2, autoReload: false });
    }
    if (req.method === "GET" && url.pathname === "/api/ai/v1/models") {
      return send(200, { data: models.map((id) => ({ id, object: "model" })) });
    }
    if (req.method === "POST" && url.pathname === "/api/ai/v1/chat/completions") {
      const body = JSON.parse(raw || "{}");
      completions.push(body);
      if (balance <= 0) return send(402, { error: { message: emptyWords, type: "insufficient_credits" } });
      balance = Math.max(0, balance - 0.01);
      const last = [...(body.messages ?? [])].reverse().find((m: any) => m.role === "user");
      const text = `credits says: ${String(last?.content ?? "").slice(0, 60)}`;
      if (body.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
        res.end("data: [DONE]\n\n");
        return;
      }
      return send(200, { choices: [{ message: { role: "assistant", content: text } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
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
    empty(message) {
      balance = 0;
      if (message) emptyWords = message;
    },
    refill(amount) {
      balance = amount;
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
