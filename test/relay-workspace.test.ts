// One licence, a relay space per workspace. The server names its
// workspace when it activates (BLOKS_WORKSPACE_ID, set by the desktop
// app), says the relay's plan limit in the relay's own words, and taking
// a workspace offline frees its slot at the relay rather than only
// hanging up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

import { startHarness } from "./helpers/server.ts";

const KEY = `blok_live_${"a".repeat(32)}`;

async function fakeRelay(answer: (req: IncomingMessage, body: string) => { status: number; body: unknown }) {
  const seen: Array<{ method: string; url: string; body: string; auth: string }> = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", body, auth: String(req.headers.authorization ?? "") });
      const said = answer(req, body);
      res.writeHead(said.status, { "content-type": "application/json" });
      res.end(JSON.stringify(said.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen, close: () => server.close() };
}

test("activation names the workspace, and the relay's limit is said as the relay said it", async () => {
  const limit = "Bloks Cloud keeps 3 workspaces online at once. Turn one off, or move to Bloks Team for all of them.";
  const relay = await fakeRelay(() => ({ status: 402, body: { error: limit, reason: "workspace-limit", limit: 3 } }));
  const h = await startHarness({ BLOKS_RELAY_URL: relay.url, BLOKS_WORKSPACE_ID: "ws_0a1b2c3d4e5f" });
  try {
    const res = await h.fetch("/api/relay/activate", { method: "POST", body: JSON.stringify({ key: KEY }) });
    assert.equal(res.status, 402);
    assert.equal((await res.json()).error, limit);
    const asked = relay.seen.find((r) => r.url === "/spaces")!;
    assert.deepEqual(JSON.parse(asked.body), { workspaceId: "ws_0a1b2c3d4e5f" });
  } finally {
    await h.stop();
    relay.close();
  }
});

test("a server on its own is the personal space it always was", async () => {
  const relay = await fakeRelay(() => ({ status: 402, body: { error: "no" } }));
  const h = await startHarness({ BLOKS_RELAY_URL: relay.url });
  try {
    await h.fetch("/api/relay/activate", { method: "POST", body: JSON.stringify({ key: KEY }) });
    assert.deepEqual(JSON.parse(relay.seen[0].body), { workspaceId: "personal" });
  } finally {
    await h.stop();
    relay.close();
  }
});

test("online counts come from the relay, and going offline frees the slot and keeps the licence", async () => {
  const relay = await fakeRelay((req) => {
    if (req.url === "/spaces") return { status: 201, body: { spaceId: "sp_1", agentToken: "agent-tok", clientToken: "client-tok", plan: "cloud", workspaceId: "personal" } };
    if (req.url === "/space/agent/plan") return { status: 200, body: { plan: "cloud", workspaceId: "personal", spaces: { online: 2, limit: 3 } } };
    if (req.url === "/space/agent" && req.method === "DELETE") return { status: 200, body: { ok: true } };
    return { status: 404, body: {} };
  });
  const h = await startHarness({ BLOKS_RELAY_URL: relay.url });
  try {
    const before = await h.json("/api/relay/plan");
    assert.equal(before.plan, null, "no space yet, nothing to ask");
    const on = await h.fetch("/api/relay/activate", { method: "POST", body: JSON.stringify({ key: KEY }) });
    assert.equal(on.status, 200);
    const plan = await h.json("/api/relay/plan");
    assert.deepEqual(plan.spaces, { online: 2, limit: 3 });
    assert.equal(plan.licence, true);
    assert.equal(relay.seen.find((r) => r.url === "/space/agent/plan")?.auth, "Bearer agent-tok");

    const off = await h.fetch("/api/relay/space", { method: "DELETE" });
    assert.equal(off.status, 200);
    const freed = relay.seen.find((r) => r.url === "/space/agent" && r.method === "DELETE");
    assert.equal(freed?.auth, "Bearer agent-tok");
    assert.equal((await h.json("/api/relay/status")).enabled, false);

    // back on with the licence it kept, nothing typed
    const again = await h.fetch("/api/relay/activate", { method: "POST", body: JSON.stringify({ again: true }) });
    assert.equal(again.status, 200);
    assert.equal(relay.seen.filter((r) => r.url === "/spaces").length, 2);
    assert.equal(relay.seen.filter((r) => r.url === "/spaces")[1].auth, `Bearer ${KEY}`);
  } finally {
    await h.stop();
    relay.close();
  }
});

test("a website cannot take a workspace offline", async () => {
  const h = await startHarness();
  try {
    const res = await h.fetchAs("https://evil.example", "/api/relay/space", { method: "DELETE" });
    assert.notEqual(res.status, 200);
  } finally {
    await h.stop();
  }
});
