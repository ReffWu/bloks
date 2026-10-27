// An admin's app watchers, through the member surface. The apps watched
// are the owner's connections, so an admin may set one up only for an
// agent whose team conversation they are on, its turns go there as the
// admin's own, and a member who is not an admin may not set one up at all.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { JoinClient } from "../server/join-client.ts";
import { fakeComposio, PROJECT_KEY, v3Event } from "./helpers/fake-composio.ts";
import { startHarness } from "./helpers/server.ts";
import { teamPlan } from "./helpers/team-plan.ts";
import { waitFor } from "./helpers/turns.ts";

test("admins set them up for a team conversation they are on; members may not", { timeout: 120_000 }, async (t) => {
  const fake = await fakeComposio();
  t.after(() => fake.close());
  const home = mkdtempSync(join(tmpdir(), "bloks-app-admin-"));
  mkdirSync(join(home, ".bloks"), { recursive: true });
  const licence = await teamPlan();
  t.after(() => licence.close());
  writeFileSync(
    join(home, ".bloks", "config.json"),
    JSON.stringify({ remote: { enabled: true }, profile: { name: "Hamed" }, composio: { key: "ck_test", apiKey: PROJECT_KEY, url: `${fake.url}/mcp` }, ...licence.config }),
  );
  const h = await startHarness({ HOME: home, ...licence.env, BLOKS_COMPOSIO_BACKEND: fake.url, BLOKS_COMPOSIO_REALTIME: fake.wsUrl });
  t.after(() => h.stop());
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const lan = new URL(h.url).host;
  const joinAs = async (name: string, role: "member" | "admin") => {
    const made = await h.json("/api/workspace/invites", { method: "POST", body: JSON.stringify({ role, name }) });
    const client = new JoinClient(() => "http://127.0.0.1:9");
    const found = (await client.lookup(`${made.invite.link}~${lan}`)) as any;
    await client.claim(found.session, { name });
    assert.equal((await h.fetch(`/api/workspace/requests/${made.invite.id}/approve`, { method: "POST" })).status, 200);
    return ((await client.status(found.session)) as any).credentials as { deviceToken: string; personId: string };
  };
  const as = (who: { deviceToken: string }, path: string, init: { method?: string; body?: unknown } = {}) =>
    h.fetchRemote(path, { method: init.method ?? "GET", token: who.deviceToken, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) });

  const { bot: chief } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Chief" }) });
  const sam = await joinAs("Sam", "admin");
  const ana = await joinAs("Ana", "member");
  const body = { botId: chief.id, toolkit: "gmail", trigger: "GMAIL_NEW_GMAIL_MESSAGE", filter: "Acme", instruction: "Summarise it for the team.", thread: "Elsewhere", mode: "rehearse" };

  assert.equal((await as(ana, "/api/member/app-watchers", { method: "POST", body })).status, 403, "a member does not");
  assert.equal((await as(ana, "/api/member/app-triggers/gmail")).status, 403);
  assert.equal((await as(sam, "/api/member/app-triggers/gmail")).status, 200, "an admin sees what an app can say");
  assert.equal((await as(sam, "/api/member/app-watchers", { method: "POST", body: { ...body, botId: "nobody" } })).status, 404);

  const made = await as(sam, "/api/member/app-watchers", { method: "POST", body });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const w = made.body.watcher;
  assert.deepEqual(w.app.madeBy, { personId: sam.personId, name: "Sam" });
  assert.equal(w.mode, "act", "never a rehearsal on the owner's folders");
  assert.equal(w.thread, undefined, "its turns go to the team conversation, not one it names");

  // the owner sees it with everything else, and the team conversation was told
  const ownerList = (await h.json("/api/watchers")).watchers;
  assert.ok(ownerList.some((x: any) => x.id === w.id && x.app.madeBy.name === "Sam"));
  const team = (await as(sam, `/api/member/agents/${chief.id}/team/messages`)).body;
  assert.ok(team.messages.some((m: any) => m.kind === "notice" && /^Sam set Chief to act here when Gmail says “New Gmail message”, only when it mentions “Acme”\.$/.test(m.text)));

  // an event lands in the team conversation, where Sam reads it
  assert.ok(await waitFor(() => fake.subscribed() > 0, 15_000));
  fake.push(v3Event(w.app.triggerId, "team_1", { from: "bob@acme.com", subject: "Order" }));
  const heard = await waitFor(async () => {
    const lane = (await as(sam, `/api/member/agents/${chief.id}/team/messages`)).body;
    return lane.messages.find((m: any) => m.role === "user" && /heard from Gmail/.test(m.text ?? "")) ?? null;
  }, 15_000);
  assert.ok(heard, "the event's turn is in the team conversation");
  const run = (await h.json("/api/watchers")).watchers.find((x: any) => x.id === w.id).app.runs[0];
  assert.equal(run.laneId, team.threadId);

  // Sam's own to change, within bounds, and to remove; Ana sees none of it
  const changed = await as(sam, `/api/member/app-watchers/${w.id}`, { method: "PATCH", body: { filter: "Acme, Globex", thread: "Mine", botId: "x" } });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.deepEqual(changed.body.watcher.app.filter, ["Acme", "Globex"]);
  assert.equal(changed.body.watcher.thread, undefined);
  assert.equal(changed.body.watcher.botId, chief.id);
  assert.deepEqual((await as(sam, "/api/member/app-watchers")).body.watchers.map((x: any) => x.id), [w.id]);
  assert.equal((await as(ana, `/api/member/app-watchers/${w.id}`, { method: "DELETE" })).status, 403);
  assert.equal((await as(sam, `/api/member/app-watchers/${w.id}`, { method: "DELETE" })).status, 200);
  assert.ok(fake.calls.some((c) => c.method === "DELETE" && c.path.endsWith(`/manage/${w.app.triggerId}`)));
  assert.equal((await h.json("/api/watchers")).watchers.some((x: any) => x.id === w.id), false);
});
