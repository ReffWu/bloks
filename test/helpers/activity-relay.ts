// A loopback-only relay and one paired synthetic phone, for the Live
// Activity pushes a workspace asks Bloks Cloud to send (see
// server/live-activities.ts). Frames are taken and dropped; what this
// keeps is every activity push, as the relay would hand it to Apple.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { TestContext } from "node:test";
import { deviceKey, open, peek } from "../../server/relay-crypto.ts";
import { waitFor } from "./turns.ts";
import type { Harness } from "./server.ts";

export interface ActivityPushSeen {
  token: string;
  env: string;
  event: "start" | "update" | "end";
  state?: string;
  startedAt?: number;
  sealed?: string;
  agentId?: string;
  laneId?: string;
  /** `sealed`, opened with the phone's own key. */
  words?: any;
}

export async function activityRelay(t: TestContext, h: Harness) {
  await h.json("/api/pair", { method: "PUT", body: JSON.stringify({ enabled: true }) });
  const started = await h.json("/api/pair/start", { method: "POST" });
  const claimed = await h.json("/api/pair/claim", { method: "POST", body: JSON.stringify({ code: started.code, device: "Example phone" }) });
  const digest = createHash("sha256").update(claimed.token).digest("hex");
  const key = deviceKey(digest, "mac-to-phone");
  const pushes: ActivityPushSeen[] = [];
  const relay = { status: 200, connected: false };
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/space/agent/stream")) {
      relay.connected = true;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ kind: "hello", spaceId: "example-space" })}\n\n`);
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (req.url?.startsWith("/space/agent/activity")) {
        const push = JSON.parse(body || "{}") as ActivityPushSeen;
        if (push.sealed) push.words = open(key, peek(push.sealed)!);
        pushes.push(push);
        res.writeHead(relay.status, { "content-type": "application/json" });
        return res.end("{}");
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  await h.json("/api/relay", {
    method: "PUT",
    body: JSON.stringify({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, agentToken: "example-agent-token", clientToken: claimed.token, enabled: true }),
  });
  assert.ok(await waitFor(() => (relay.connected ? true : null)), "the isolated server did not connect to its relay");
  /** What the phone says on the paired channel, as the phone. */
  const report = (body: unknown) => h.fetchRemote("/api/live-activities", { method: "POST", token: claimed.token, body: JSON.stringify(body) });
  return { deviceId: claimed.device.id as string, token: claimed.token as string, pushes, relay, report };
}
