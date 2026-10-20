// What a member's app is built on, against the real server: what it is
// told about the workspace, deleting a solo agent of its own, an admin
// reaching the Members page from their own device, the owner's reader for
// members' private conversations (only while the setting is on), the room
// picker's lists, and leaving the workspace.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startHarness } from "./helpers/server.ts";
import { JoinClient } from "../server/join-client.ts";
import { memberFrame, type MemberView } from "../server/member-access.ts";

test("a member's app is told enough to draw itself, and an admin's reaches the Members page", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "bloks-member-mode-"));
  mkdirSync(join(home, ".bloks"), { recursive: true });
  writeFileSync(join(home, ".bloks", "config.json"), JSON.stringify({ remote: { enabled: true }, profile: { name: "Hamed" } }));
  const h = await startHarness({ HOME: home });
  t.after(() => h.stop());
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const lan = new URL(h.url).host;
  const { bot: chief } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Chief" }) });
  const { bot: scout } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Scout" }) });

  async function joinAs(name: string, role: "member" | "admin") {
    const made = await h.json("/api/workspace/invites", { method: "POST", body: JSON.stringify({ role, name }) });
    const client = new JoinClient(() => "http://127.0.0.1:9");
    const found = (await client.lookup(`${made.invite.link}~${lan}`)) as any;
    assert.ok(found.ok, JSON.stringify(found));
    await client.claim(found.session, { name });
    assert.equal((await h.fetch(`/api/workspace/requests/${made.invite.id}/approve`, { method: "POST" })).status, 200);
    return ((await client.status(found.session)) as any).credentials as { deviceToken: string; personId: string };
  }
  const sam = await joinAs("Sam", "member");
  const ana = await joinAs("Ana", "admin");
  const as = (who: { deviceToken: string }, path: string, init: { method?: string; body?: unknown } = {}) =>
    h.fetchRemote(path, { method: init.method ?? "GET", token: who.deviceToken, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) });

  // what member mode is decided from, and what its pages need
  const ws = await as(sam, "/api/member/workspace");
  assert.equal(ws.status, 200);
  assert.equal(ws.body.you.role, "member");
  assert.equal(ws.body.owner.name, "Hamed");
  assert.deepEqual(ws.body.solo, { count: 0, max: 3 });
  assert.ok(Array.isArray(ws.body.engines));
  assert.match(ws.body.privacy.line, /yours/);

  // a solo agent of Sam's, deleted by Sam, and nobody else can
  const solo = (await as(sam, "/api/member/agents", { method: "POST", body: { name: "Helper" } })).body.agent;
  assert.equal((await as(sam, "/api/member/workspace")).body.solo.count, 1);
  assert.equal((await as(ana, `/api/member/agents/${solo.id}`, { method: "DELETE" })).status, 404, "not Ana's");
  assert.equal((await as(sam, `/api/member/agents/${chief.id}`, { method: "DELETE" })).status, 404, "a team agent is nobody's to delete from here");
  assert.equal((await as(sam, `/api/member/agents/${solo.id}`, { method: "DELETE" })).status, 200);
  assert.ok(!(await as(sam, "/api/member/agents")).body.agents.some((a: any) => a.id === solo.id));
  assert.equal((await as(sam, "/api/member/workspace")).body.solo.count, 0);

  // an admin's device reaches the Members page and its badge; a member's
  // reaches the list and a zero
  assert.equal((await as(ana, "/api/workspace/members")).status, 200);
  assert.equal((await as(ana, "/api/workspace/waiting")).status, 200);
  assert.equal((await as(sam, "/api/workspace/waiting")).body.count, 0);
  const invited = await as(ana, "/api/workspace/invites", { method: "POST", body: { role: "member", name: "Leo" } });
  assert.equal(invited.status, 201, JSON.stringify(invited.body));
  assert.equal((await as(sam, "/api/workspace/invites", { method: "POST", body: { role: "member" } })).status, 403);

  // the room picker's lists: each room's audience, its members and guests
  const { blok } = await h.json("/api/bloks", { method: "POST", body: JSON.stringify({ name: "Launch", memberIds: [chief.id, scout.id] }) });
  const picked = await h.fetch(`/api/workspace/rooms/${blok.id}/access`, { method: "PATCH", body: JSON.stringify({ audience: "some", members: [sam.personId] }) });
  assert.equal(picked.status, 200);
  const room = (await h.json("/api/workspace/access")).rooms.find((r: any) => r.id === blok.id);
  assert.equal(room.audience, "some");
  assert.deepEqual(room.members, [sam.personId]);
  assert.deepEqual(room.guests, []);
  assert.equal((await as(sam, `/api/member/rooms/${blok.id}`)).status, 200);
  assert.equal((await as(ana, `/api/member/rooms/${blok.id}`)).status, 404, "an admin is in the rooms they are put in, like anyone");

  // the owner's reader: nothing while the setting is off, the private
  // conversations with a member's name once it is on
  assert.equal((await as(sam, `/api/member/agents/${chief.id}/private/messages`, { method: "POST", body: { text: "between us" } })).status, 202);
  const closed = await h.json(`/api/workspace/private/${chief.id}`);
  assert.equal(closed.readable, false);
  assert.deepEqual(closed.conversations, []);
  await h.fetch("/api/workspace/joining", { method: "PATCH", body: JSON.stringify({ privateReadable: true }) });
  const open = await h.json(`/api/workspace/private/${chief.id}`);
  assert.equal(open.readable, true);
  assert.equal(open.conversations.length, 1);
  assert.equal(open.conversations[0].name, "Sam");
  assert.match(open.line, /Members are told/);
  const read = await h.json(`/api/bots/${chief.id}/messages?thread=${open.conversations[0].threadId}`);
  assert.ok(JSON.stringify(read).includes("between us"));
  assert.equal((await as(sam, `/api/workspace/private/${chief.id}`)).status, 403, "a member's device never reaches the reader");

  // leaving: out at once, the owner's list without them, the device gone
  const left = await as(sam, "/api/member/leave", { method: "POST" });
  assert.equal(left.status, 200);
  assert.ok(!(await h.json("/api/workspace/members")).members.some((m: any) => m.id === sam.personId));
  assert.notEqual((await as(sam, "/api/member/workspace")).status, 200);
});

const view: MemberView = { joinedAt: 0, history: "all", activityDetail: false, personId: "p_sam", role: "collaborator", thread: "private" };

test("a reply's words stream to whoever may read the conversation, and nothing else of the engine does", () => {
  const delta = { kind: "runtime", event: { type: "content.delta", streamKind: "assistant_text", threadId: "lane1", delta: "Hel", itemId: "x", usage: { cost: 1 } } };
  const seen = memberFrame(delta, (id) => (id === "lane1" ? view : null)) as any;
  assert.deepEqual(seen, { kind: "runtime", event: { type: "content.delta", threadId: "lane1", streamKind: "assistant_text", delta: "Hel" } });
  assert.equal(memberFrame(delta, () => null), null, "not to anyone who may not read it");
  const tool = { kind: "runtime", event: { type: "content.delta", streamKind: "tool_output", threadId: "lane1", delta: "/Users/hamed/secret" } };
  assert.equal(memberFrame(tool, () => view), null, "a tool's output is the owner's");
  const started = memberFrame({ kind: "runtime", event: { type: "turn.started", threadId: "lane1", model: "x" } }, () => view) as any;
  assert.deepEqual(started.event, { type: "turn.started", threadId: "lane1" });
  assert.equal(memberFrame({ kind: "runtime", event: { type: "item.started", threadId: "lane1" } }, () => view), null);
});

test("a guest hears nothing of the workspace; an admin also hears who is asking to join", () => {
  const none = () => null;
  const people = { kind: "workspace.people", members: [] };
  const request = { kind: "workspace.request", request: { name: "Leo" } };
  assert.equal(memberFrame(people, none, "guest"), null);
  assert.deepEqual(memberFrame(people, none, "member"), people);
  assert.equal(memberFrame(request, none, "member"), null);
  assert.deepEqual(memberFrame(request, none, "admin"), request);
  assert.deepEqual(memberFrame({ kind: "workspace.privacy", privateReadable: true }, none, "member"), { kind: "workspace.privacy", privateReadable: true });
  assert.equal(memberFrame({ kind: "workspace.privacy", privateReadable: true }, none, "guest"), null);
});
