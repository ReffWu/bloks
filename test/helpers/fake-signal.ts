// signal-cli's JSON-RPC daemon, as far as Bloks ever sees it: one HTTP
// server on loopback with /api/v1/rpc, /api/v1/events and /api/v1/check.
// Nothing here is Signal, and no test reaches it: every account, number
// and message is made up.
import { createServer, type ServerResponse } from "node:http";
import type { TestContext } from "node:test";

export const AGENT_NUMBER = "+15550000001";
export const AGENT_ACI = "aaaaaaaa-0000-4000-8000-000000000001";
export const OWNER_NUMBER = "+15550000002";
export const OWNER_ACI = "bbbbbbbb-0000-4000-8000-000000000002";
export const STRANGER_NUMBER = "+15550000003";
export const STRANGER_ACI = "cccccccc-0000-4000-8000-000000000003";

export interface RpcCall { method: string; params: any; at: number; timestamp?: number }

export async function fakeSignal(t: TestContext) {
  const state = {
    calls: [] as RpcCall[],
    accounts: [] as Array<{ number: string; aci: string }>,
    groups: [] as Array<{ id: string; name: string }>,
    attachments: new Map<string, Buffer>(),
    events: [] as string[],
    streams: new Set<ServerResponse>(),
    linking: [] as Array<(linked: { number: string; aci: string }) => void>,
    timestamp: 1_800_000_000_000,
    clock: 1_700_000_000_000,
  };
  const server = createServer((req, res) => {
    if (req.url === "/api/v1/check") return res.end();
    if (req.url?.startsWith("/api/v1/events")) {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      // the daemon replays what it still holds after the id it is given
      const after = Number(req.headers["last-event-id"] ?? 0) || 0;
      for (let i = after; i < state.events.length; i++) res.write(state.events[i]);
      state.streams.add(res);
      res.write(": keep-alive\n\n");
      req.on("close", () => state.streams.delete(res));
      return;
    }
    if (req.url !== "/api/v1/rpc" || req.method !== "POST") {
      res.statusCode = 404;
      return res.end();
    }
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      const answer = (result: unknown) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
      };
      state.calls.push({ method: body.method, params: body.params ?? {}, at: Date.now() });
      switch (body.method) {
        case "listAccounts":
          return answer(state.accounts.map((a) => ({ number: a.number, aci: a.aci })));
        case "startLink":
          return answer({ deviceLinkUri: "sgnl://linkdevice?uuid=TEST&pub_key=TEST" });
        case "finishLink":
          // held until the test "scans" the code
          return void state.linking.push((linked) => {
            state.accounts.push(linked);
            answer({ number: linked.number, aci: linked.aci });
          });
        case "send": {
          const timestamp = ++state.timestamp;
          state.calls[state.calls.length - 1]!.timestamp = timestamp;
          return answer({ timestamp, results: [] });
        }
        case "getAttachment": {
          const bytes = state.attachments.get(body.params?.id);
          if (!bytes) {
            res.setHeader("content-type", "application/json");
            return res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -1, message: "no such attachment" } }));
          }
          return answer({ data: bytes.toString("base64") });
        }
        case "listGroups":
          return answer(state.groups.map((g) => ({ ...g, isMember: true, isBlocked: false })));
        default:
          return answer({});
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    for (const res of state.streams) res.end();
    server.closeAllConnections();
    server.close();
  });
  const push = (envelope: Record<string, unknown>, account = AGENT_NUMBER) => {
    const frame = `id: ${state.events.length + 1}\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "receive", params: { envelope, account } })}\n\n`;
    state.events.push(frame);
    for (const res of state.streams) res.write(frame);
  };
  const from = (who: { number: string; aci: string; name: string }) => ({ source: who.number, sourceNumber: who.number, sourceUuid: who.aci, sourceName: who.name, sourceDevice: 1 });
  return {
    state,
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    /** The phone scanning the link Bloks showed. */
    scan(linked = { number: AGENT_NUMBER, aci: AGENT_ACI }) {
      const waiting = state.linking.shift();
      if (!waiting) throw new Error("nothing is waiting to be linked");
      waiting(linked);
    },
    /** Somebody writing to the account, one to one. Returns the timestamp
     * Signal names the message by. */
    say(text: string, who = { number: OWNER_NUMBER, aci: OWNER_ACI, name: "Sam" }, extra: Record<string, unknown> = {}, account = AGENT_NUMBER) {
      const timestamp = ++state.clock;
      push({ ...from(who), timestamp, dataMessage: { timestamp, message: text, attachments: [], mentions: [], ...extra } }, account);
      return timestamp;
    },
    /** The account writing to itself from another of its devices. */
    noteToSelf(text: string, account = AGENT_NUMBER, aci = AGENT_ACI) {
      const timestamp = ++state.clock;
      push({ source: account, sourceNumber: account, sourceUuid: aci, sourceName: "Me", sourceDevice: 2, timestamp, syncMessage: { sentMessage: { destination: account, destinationNumber: account, destinationUuid: aci, timestamp, message: text, attachments: [] } } }, account);
      return timestamp;
    },
    /** The account writing to somebody else from another of its devices. */
    syncTo(text: string, to: { number: string; aci: string }, account = AGENT_NUMBER, aci = AGENT_ACI) {
      const timestamp = ++state.clock;
      push({ source: account, sourceNumber: account, sourceUuid: aci, sourceName: "Me", sourceDevice: 2, timestamp, syncMessage: { sentMessage: { destination: to.number, destinationNumber: to.number, destinationUuid: to.aci, timestamp, message: text, attachments: [] } } }, account);
    },
    push,
    calls: (method: string) => state.calls.filter((c) => c.method === method),
    /** What was sent, one message each, with who it went to. */
    sent: () => state.calls.filter((c) => c.method === "send").map((c) => ({ to: c.params.recipient?.[0] ?? null, group: c.params.groupId ?? null, text: String(c.params.message ?? ""), attachments: (c.params.attachments ?? []) as string[], quote: c.params.quoteTimestamp, timestamp: c.timestamp })),
    streams: () => state.streams.size,
  };
}
