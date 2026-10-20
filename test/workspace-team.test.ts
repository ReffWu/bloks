// Read receipts and the Team lock, against the real server.
//
// "Seen by": each person's place in a conversation is kept, said by their
// own client, shown to everybody in a room or a team conversation, and in
// a private conversation to its person alone (and the owner, only while
// the owner may read those). Members are Bloks Team's: when the licence
// stops being Team's they are paused, told so plainly, nothing is
// deleted, and they are back when it is Team's again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startHarness } from "./helpers/server.ts";
import { teamPlan } from "./helpers/team-plan.ts";
import { JoinClient } from "../server/join-client.ts";

async function workspace(t: { after(fn: () => unknown): void }) {
  const home = mkdtempSync(join(tmpdir(), "bloks-team-"));
  mkdirSync(join(home, ".bloks"), { recursive: true });
  const licence = await teamPlan();
  t.after(() => licence.close());
  writeFileSync(join(home, ".bloks", "config.json"), JSON.stringify({ remote: { enabled: true }, profile: { name: "Hamed" }, ...licence.config }));
  const h = await startHarness({ HOME: home, ...licence.env });
  t.after(() => h.stop());
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const lan = new URL(h.url).host;
  async function joinAs(name: string) {
    const made = await h.json("/api/workspace/invites", { method: "POST", body: JSON.stringify({ role: "member", name }) });
    assert.ok(made.invite, JSON.stringify(made));
    const client = new JoinClient(() => "http://127.0.0.1:9");
    const found = (await client.lookup(`${made.invite.link}~${lan}`)) as any;
    await client.claim(found.session, { name });
    assert.equal((await h.fetch(`/api/workspace/requests/${made.invite.id}/approve`, { method: "POST" })).status, 200);
    return ((await client.status(found.session)) as any).credentials as { deviceToken: string; personId: string };
  }
  const as = (who: { deviceToken: string }, path: string, init: { method?: string; body?: unknown } = {}) =>
    h.fetchRemote(path, { method: init.method ?? "GET", token: who.deviceToken, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) });
  return { h, licence, joinAs, as };
}

test("read positions: kept per person, shown in rooms and team conversations, private ones kept private", async (t) => {
  const { h, joinAs, as } = await workspace(t);
  const { bot: chief } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Chief" }) });
  const { bot: scout } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Scout" }) });
  const sam = await joinAs("Sam");
  const ana = await joinAs("Ana");
  const { blok: room } = await h.json("/api/bloks", { method: "POST", body: JSON.stringify({ name: "Launch", memberIds: [chief.id, scout.id] }) });

  // a room open to everyone: Sam reads it to its opening line
  const seen = (await as(sam, `/api/member/rooms/${room.id}`)).body;
  const opening = seen.messages[0].id;
  assert.deepEqual(seen.reads, []);
  const marked = await as(sam, `/api/member/threads/${room.id}/read`, { method: "POST", body: { messageId: opening } });
  assert.equal(marked.status, 200, JSON.stringify(marked.body));
  assert.equal(marked.body.read.personId, sam.personId);
  assert.equal(marked.body.read.messageId, opening);
  // a message that is not in it, or not a message at all, moves nothing
  assert.equal((await as(sam, `/api/member/threads/${room.id}/read`, { method: "POST", body: { messageId: "nope" } })).status, 404);
  assert.equal((await as(sam, `/api/member/threads/${room.id}/read`, { method: "POST", body: {} })).status, 400);

  // everyone in the room sees it, on a fresh load: Ana, and the owner
  const anaRoom = (await as(ana, `/api/member/rooms/${room.id}`)).body;
  assert.deepEqual(anaRoom.reads.map((r: any) => [r.personId, r.messageId]), [[sam.personId, opening]]);
  const ownerPage = await h.json(`/api/bloks/${room.id}/messages`);
  assert.deepEqual(ownerPage.reads.map((r: any) => r.personId), [sam.personId]);
  // the owner's own place, said by the owner's screen
  const mine = await h.fetch(`/api/threads/${room.id}/read`, { method: "POST", body: JSON.stringify({ messageId: opening }) });
  assert.equal(mine.status, 200);
  assert.deepEqual(
    (await h.json(`/api/threads/${room.id}/reads`)).reads.map((r: any) => r.personId).sort(),
    ["owner", sam.personId].sort(),
  );
  assert.ok((await as(ana, `/api/member/rooms/${room.id}`)).body.reads.some((r: any) => r.personId === "owner"));

  // the team conversation: Sam writes and reads, everyone on its list sees
  const said = await as(sam, `/api/member/agents/${chief.id}/team/messages`, { method: "POST", body: { text: "hello team" } });
  assert.equal(said.status, 202, JSON.stringify(said.body));
  const teamLane = (await as(sam, `/api/member/agents/${chief.id}/team/messages`)).body;
  const hello = teamLane.messages.find((m: any) => m.text === "hello team").id;
  assert.equal((await as(sam, `/api/member/threads/${teamLane.threadId}/read`, { method: "POST", body: { messageId: hello } })).status, 200);
  const anaTeam = (await as(ana, `/api/member/agents/${chief.id}/team/messages`)).body;
  assert.ok(anaTeam.reads.some((r: any) => r.personId === sam.personId && r.messageId === hello));
  const ownerTeam = await h.json(`/api/bots/${chief.id}/messages?thread=${teamLane.threadId}`);
  assert.ok(ownerTeam.reads.some((r: any) => r.personId === sam.personId));

  // Sam's private conversation: his place is his own
  await as(sam, `/api/member/agents/${chief.id}/private/messages`, { method: "POST", body: { text: "just me" } });
  const samLane = (await as(sam, `/api/member/agents/${chief.id}/private/messages`)).body;
  const own = samLane.messages.find((m: any) => m.text === "just me").id;
  assert.equal((await as(sam, `/api/member/threads/${samLane.threadId}/read`, { method: "POST", body: { messageId: own } })).status, 200);
  assert.deepEqual((await as(sam, `/api/member/agents/${chief.id}/private/messages`)).body.reads.map((r: any) => r.personId), [sam.personId]);
  // Ana cannot reach it at all, nor write a place in it
  assert.equal((await as(ana, `/api/member/threads/${samLane.threadId}/read`, { method: "POST", body: { messageId: own } })).status, 404);
  // the owner: not shown while the setting is off, and never writes one there
  assert.equal((await h.fetch(`/api/threads/${samLane.threadId}/reads`)).status, 200);
  assert.deepEqual((await h.json(`/api/threads/${samLane.threadId}/reads`)).reads, []);
  await h.fetch("/api/workspace/joining", { method: "PATCH", body: JSON.stringify({ privateReadable: true }) });
  assert.deepEqual((await h.json(`/api/threads/${samLane.threadId}/reads`)).reads.map((r: any) => r.personId), [sam.personId]);
  assert.equal((await h.fetch(`/api/threads/${samLane.threadId}/read`, { method: "POST", body: JSON.stringify({ messageId: own }) })).status, 403);
});

test("Team lapses: members are paused and told why, nothing is lost, and all of it is back with Team", async (t) => {
  const { h, licence, joinAs, as } = await workspace(t);
  const { bot: chief } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Chief" }) });
  const sam = await joinAs("Sam");
  await as(sam, `/api/member/agents/${chief.id}/private/messages`, { method: "POST", body: { text: "keep this" } });
  assert.equal((await as(sam, "/api/member/agents")).status, 200);

  // the licence is not Team's any more; the owner's Members page asks afresh
  licence.setTeam(false);
  const members = await h.json("/api/workspace/members");
  assert.equal(members.team, false);
  assert.equal(members.paused, true);
  assert.deepEqual(members.members.map((m: any) => m.name), ["Sam"], "nobody is removed");

  const refused = await as(sam, "/api/member/agents");
  assert.equal(refused.status, 402);
  assert.deepEqual(refused.body, { code: "team_required", error: "Hamed's workspace needs Bloks Team for members right now." });
  assert.equal((await as(sam, `/api/member/agents/${chief.id}/private/messages`)).status, 402);
  // what the workspace is, said plainly, so the member's app can say it
  const ws = await as(sam, "/api/member/workspace");
  assert.equal(ws.status, 200);
  assert.equal(ws.body.paused, "Hamed's workspace needs Bloks Team for members right now.");
  // and no new invites meanwhile
  const invite = await h.fetch("/api/workspace/invites", { method: "POST", body: JSON.stringify({ role: "member" }) });
  assert.equal(invite.status, 402);
  assert.equal((await invite.json()).code, "team_required");

  // Team again: everything as it was
  licence.setTeam(true);
  assert.equal((await h.json("/api/workspace/members")).paused, false);
  const back = await as(sam, `/api/member/agents/${chief.id}/private/messages`);
  assert.equal(back.status, 200);
  assert.ok(back.body.messages.some((m: any) => m.text === "keep this"));
  assert.equal((await as(sam, "/api/member/workspace")).body.paused, undefined);
});
