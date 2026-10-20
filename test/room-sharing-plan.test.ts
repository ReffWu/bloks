// Sharing a room with guests of its own (the old share flow), by what the
// relay says the licence holds. Team always; a Cloud licence bought before
// rooms became Team's keeps its one room (`sharedRoom: true`); one bought
// since does not (`false`); a relay too old to say keeps what Cloud
// always had. A room already shared keeps its guests whatever it says.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

import { startHarness } from "./helpers/server.ts";

const KEY = `blok_live_${"b".repeat(32)}`;

async function fakeRelay(plan: Record<string, unknown>) {
  let minted = 0;
  const server = createServer((req: IncomingMessage, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const answer = (status: number, said: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(said));
      };
      if (req.url === "/spaces") return answer(201, { spaceId: "sp_1", agentToken: "agent-tok", clientToken: "client-tok", plan: plan.plan });
      if (req.url === "/space/agent/plan") return answer(200, { ...plan, workspaceId: "personal", spaces: { online: 1, limit: 3 } });
      if (req.url === "/space/agent/clients" && req.method === "POST") return answer(201, { clientToken: `ct_${++minted}_${"x".repeat(24)}` });
      return answer(404, {});
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}

/** Past the plan's door. With no live relay line in a test the pass for
 * the link cannot be minted, so an open door ends there (502), never at
 * the plan (402). */
function doorOpen(got: { status: number; body: any }) {
  assert.notEqual(got.status, 402, JSON.stringify(got.body));
  assert.notEqual(got.body.code, "team_required");
  assert.ok(got.status === 201 || got.status === 502, JSON.stringify(got.body));
}

async function inviteWith(plan: Record<string, unknown>) {
  const relay = await fakeRelay(plan);
  const h = await startHarness({ BLOKS_RELAY_URL: relay.url });
  try {
    assert.equal((await h.fetch("/api/relay/activate", { method: "POST", body: JSON.stringify({ key: KEY }) })).status, 200);
    const said = await h.json("/api/relay/plan");
    const { bot: a } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Ada" }) });
    const { bot: b } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Ben" }) });
    const { blok } = await h.json("/api/bloks", { method: "POST", body: JSON.stringify({ name: "Launch", memberIds: [a.id, b.id] }) });
    const people = await h.json(`/api/bloks/${blok.id}/people`);
    const res = await h.fetch(`/api/bloks/${blok.id}/invites`, { method: "POST", body: JSON.stringify({ role: "collaborator" }) });
    return { plan: said, people, status: res.status, body: await res.json() };
  } finally {
    await h.stop();
    relay.close();
  }
}

test("Cloud bought before rooms became Team's: its one shared room still takes guests", async () => {
  const got = await inviteWith({ plan: "cloud", sharedRoom: true });
  assert.equal(got.plan.sharedRoom, true);
  assert.equal(got.people.sharedRoom, true);
  doorOpen(got);
});

test("Cloud bought since: sharing a room needs Bloks Team", async () => {
  const got = await inviteWith({ plan: "cloud", sharedRoom: false });
  assert.equal(got.plan.sharedRoom, false);
  assert.equal(got.people.sharedRoom, false);
  assert.equal(got.status, 402);
  assert.deepEqual(got.body, { code: "team_required", error: "Sharing rooms needs Bloks Team." });
});

test("a relay too old to say keeps Cloud's shared room", async () => {
  const got = await inviteWith({ plan: "cloud" });
  assert.equal(got.plan.sharedRoom, true);
  assert.equal(got.people.sharedRoom, true);
  doorOpen(got);
});

test("Team shares rooms whatever the field says", async () => {
  const got = await inviteWith({ plan: "team", sharedRoom: false });
  assert.equal(got.plan.sharedRoom, true);
  doorOpen(got);
});
