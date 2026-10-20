// A member's side of the workspace against the real server: the team
// conversation everyone on its list shares, each person's private one that
// nobody else reads (the owner included, by default), solo agents, and
// the member's own limit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startHarness } from "./helpers/server.ts";
import { JoinClient } from "../server/join-client.ts";

test("team, private and solo conversations reach exactly who they should", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "bloks-member-surface-"));
  mkdirSync(join(home, ".bloks"), { recursive: true });
  // the network surface on, so a member's device can be one
  writeFileSync(join(home, ".bloks", "config.json"), JSON.stringify({ remote: { enabled: true }, profile: { name: "Hamed" } }));
  const h = await startHarness({ HOME: home });
  t.after(() => h.stop());
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const lan = new URL(h.url).host;

  const { bot: chief } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Chief" }) });

  // two people join through the door, as a Mac would
  async function joinAs(name: string) {
    const made = await h.json("/api/workspace/invites", { method: "POST", body: JSON.stringify({ role: "member", name }) });
    const client = new JoinClient(() => "http://127.0.0.1:9");
    const found = (await client.lookup(`${made.invite.link}~${lan}`)) as any;
    assert.ok(found.ok, JSON.stringify(found));
    const asked = (await client.claim(found.session, { name })) as any;
    assert.equal(asked.status, "waiting");
    const ok = await h.fetch(`/api/workspace/requests/${made.invite.id}/approve`, { method: "POST" });
    assert.equal(ok.status, 200);
    const done = (await client.status(found.session)) as any;
    assert.equal(done.status, "approved");
    return done.credentials as { deviceToken: string; personId: string };
  }
  const sam = await joinAs("Sam");
  const ana = await joinAs("Ana");
  const as = (who: { deviceToken: string }, path: string, init: { method?: string; body?: unknown } = {}) =>
    h.fetchRemote(path, { method: init.method ?? "GET", token: who.deviceToken, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) });

  // both see Chief, with a team conversation and a private one
  const list = await as(sam, "/api/member/agents");
  assert.equal(list.status, 200);
  const listed = list.body.agents.find((a: any) => a.id === chief.id);
  assert.ok(listed.team && listed.private);

  // Sam's private words reach nobody else
  const said = await as(sam, `/api/member/agents/${chief.id}/private/messages`, { method: "POST", body: { text: "my secret plan" } });
  assert.equal(said.status, 202, JSON.stringify(said.body));
  const samLane = (await as(sam, `/api/member/agents/${chief.id}/private/messages`)).body;
  assert.ok(samLane.messages.some((m: any) => m.text === "my secret plan"));
  assert.match(samLane.privacy, /nobody else reads them, Hamed included/);
  const anaLane = (await as(ana, `/api/member/agents/${chief.id}/private/messages`)).body;
  assert.notEqual(anaLane.threadId, samLane.threadId);
  assert.ok(!anaLane.messages.some((m: any) => m.text === "my secret plan"));
  const owners = await h.json("/api/bots");
  const ownerChief = owners.bots.find((b: any) => b.id === chief.id);
  assert.ok(!ownerChief.tasks.some((task: any) => task.id === samLane.threadId), "not in the owner's lane list");
  const ownerRead = await h.fetch(`/api/bots/${chief.id}/messages?thread=${samLane.threadId}`);
  assert.equal(ownerRead.status, 404, "and not readable by the owner by default");
  // unless the owner turns that on, which members are told
  await h.fetch("/api/workspace/joining", { method: "PATCH", body: JSON.stringify({ privateReadable: true }) });
  assert.equal((await h.fetch(`/api/bots/${chief.id}/messages?thread=${samLane.threadId}`)).status, 200);
  await h.fetch("/api/workspace/joining", { method: "PATCH", body: JSON.stringify({ privateReadable: false }) });

  // the team conversation: everyone's words, each under its own name
  assert.equal((await as(sam, `/api/member/agents/${chief.id}/team/messages`, { method: "POST", body: { text: "hello team" } })).status, 202);
  const team = (await as(ana, `/api/member/agents/${chief.id}/team/messages`)).body;
  const line = team.messages.find((m: any) => m.text === "hello team");
  assert.equal(line.author, sam.personId);
  assert.equal(team.people[sam.personId], "Sam");
  assert.equal(team.kind, "team");
  // the owner sees the team conversation as one of the agent's lanes
  const ownerAfter = (await h.json("/api/bots")).bots.find((b: any) => b.id === chief.id);
  assert.ok(ownerAfter.tasks.some((task: any) => task.id === team.threadId));

  // Chief's team conversation narrowed to Ana: Sam loses it, and with no
  // room to meet Chief in, the agent too
  await h.fetch(`/api/workspace/agents/${chief.id}/access`, { method: "PATCH", body: JSON.stringify({ mode: "only", people: [ana.personId] }) });
  assert.equal((await as(sam, `/api/member/agents/${chief.id}/team/messages`)).status, 404);
  assert.ok(!(await as(sam, "/api/member/agents")).body.agents.some((a: any) => a.id === chief.id));
  assert.equal((await as(ana, `/api/member/agents/${chief.id}/team/messages`)).status, 200);

  // a solo agent of Sam's own: listed for Sam alone
  const solo = await as(sam, "/api/member/agents", { method: "POST", body: { name: "Helper" } });
  assert.equal(solo.status, 201, JSON.stringify(solo.body));
  assert.equal(solo.body.agent.mine, true);
  assert.ok(!(await as(ana, "/api/member/agents")).body.agents.some((a: any) => a.id === solo.body.agent.id));
  assert.ok(!(await h.json("/api/bots")).bots.some((b: any) => b.id === solo.body.agent.id), "the owner does not list it");
  assert.equal((await h.fetch(`/api/bots/${solo.body.agent.id}/messages`)).status, 404);

  // the member's own limit stops them, and only them
  await h.fetch(`/api/workspace/members/${sam.personId}`, { method: "PATCH", body: JSON.stringify({ limits: { monthlyUsd: 0, maxSolo: 1 } }) });
  const stopped = await as(sam, `/api/member/agents/${solo.body.agent.id}/private/messages`, { method: "POST", body: { text: "go" } });
  assert.equal(stopped.status, 402);
  assert.match(stopped.body.error, /monthly limit/);
  assert.equal((await as(ana, `/api/member/agents/${chief.id}/team/messages`, { method: "POST", body: { text: "still me" } })).status, 202);
  const usage = await as(sam, "/api/member/usage");
  assert.equal(usage.body.limits.monthlyUsd, 0);
  assert.match(usage.body.stopped, /monthly limit/);
  const second = await as(sam, "/api/member/agents", { method: "POST", body: { name: "Another" } });
  assert.equal(second.status, 403);
  assert.equal(second.body.code, "solo_limit");

  // and the owner's routes stay closed to a member's device
  assert.equal((await as(sam, "/api/bots")).status, 403);
  assert.equal((await as(sam, "/api/workspace/invites", { method: "POST", body: {} })).status, 403);
});
