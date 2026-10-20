// The owner's name (server/owner-name.ts): asked for once and optional,
// until somebody else is about to see it. Sharing a room, a room's invite
// and a workspace's invite are refused without one, with a code the window
// answers by asking, so nothing anybody is sent says "The owner". Once
// people see it, it can change but not go; when it changes, members hear.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startHarness } from "./helpers/server.ts";
import { teamPlan } from "./helpers/team-plan.ts";
import { nameFromGecos, nameFromLogin, pickAccountName } from "../server/owner-name.ts";
import { memberFrame } from "../server/member-access.ts";

test("the account's own full name is the suggestion; a login name only when it reads as one", () => {
  assert.equal(pickAccountName({ full: "Hamed Rahimi", login: "hamed" }), "Hamed Rahimi");
  // an account made without a full name says its login name back
  assert.equal(pickAccountName({ full: "hamed", login: "hamed" }), "Hamed");
  assert.equal(pickAccountName({ full: null, login: "ana.lima" }), "Ana Lima");
  // a handle is not a name, and an empty field asks better than a guess
  assert.equal(pickAccountName({ full: "", login: "jdoe2" }), null);
  assert.equal(nameFromLogin("_spotlight"), null);
  assert.equal(nameFromLogin("zoë"), "Zoë");
  assert.equal(nameFromGecos("ana:x:1000:1000:Ana Lima,,,:/home/ana:/bin/bash"), "Ana Lima");
  assert.equal(nameFromGecos("ana:x:1000:1000::/home/ana:/bin/bash"), null);
  // a name never carries what could restyle the line it sits on
  assert.equal(pickAccountName({ full: "Ana‮ Lima", login: "ana" }), "Ana Lima");
});

test("members hear the owner's new name; a guest of one room hears it through that room", () => {
  const frame = { kind: "workspace.owner", name: "Hamed" };
  assert.deepEqual(memberFrame(frame, () => null, "member"), frame);
  assert.deepEqual(memberFrame(frame, () => null, "admin"), frame);
  assert.equal(memberFrame(frame, () => null, "guest"), null);
});

test("a workspace's invite waits for the owner's name, and the name then stays", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "bloks-name-"));
  mkdirSync(join(home, ".bloks"), { recursive: true });
  const licence = await teamPlan();
  t.after(() => licence.close());
  writeFileSync(join(home, ".bloks", "config.json"), JSON.stringify({ remote: { enabled: true }, ...licence.config }));
  const h = await startHarness({ HOME: home, ...licence.env });
  t.after(() => h.stop());
  t.after(() => rmSync(home, { recursive: true, force: true }));

  // nothing asked yet: no name, and the window is offered a suggestion
  assert.equal((await h.json("/api/config")).profile.name, "");
  const asked = await h.json("/api/profile/name");
  assert.equal(asked.name, "");
  assert.ok(asked.suggested === null || typeof asked.suggested === "string");

  const refused = await h.fetch("/api/workspace/invites", { method: "POST", body: JSON.stringify({ role: "member" }) });
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).code, "name_required");

  // said, cleaned the way every person's name is
  const saved = await h.fetch("/api/config", { method: "PUT", body: JSON.stringify({ profile: { name: "  Hamed‮   Rahimi " } }) });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).profile.name, "Hamed Rahimi");
  assert.equal((await h.json("/api/profile/name")).name, "Hamed Rahimi");
  // "about" is its own field, and saving it leaves the name alone
  await h.fetch("/api/config", { method: "PUT", body: JSON.stringify({ profile: { about: "Runs a studio" } }) });
  assert.equal((await h.json("/api/config")).profile.name, "Hamed Rahimi");

  const made = await h.fetch("/api/workspace/invites", { method: "POST", body: JSON.stringify({ role: "member" }) });
  assert.equal(made.status, 201, await made.clone().text());

  // with an invite out, the name can change but not go
  const cleared = await h.fetch("/api/config", { method: "PUT", body: JSON.stringify({ profile: { name: " " } }) });
  assert.equal(cleared.status, 409);
  assert.equal((await cleared.json()).code, "name_required");
  assert.equal((await h.json("/api/config")).profile.name, "Hamed Rahimi");
  const renamed = await h.fetch("/api/config", { method: "PUT", body: JSON.stringify({ profile: { name: "Hamed R." } }) });
  assert.equal(renamed.status, 200);
  assert.equal((await h.json("/api/workspace/members")).owner.name, "Hamed R.");
  assert.equal((await h.fetch("/api/config", { method: "PUT", body: JSON.stringify({ profile: { name: 7 } }) })).status, 400);
});

test("with nobody to see it, the name can be cleared again", async () => {
  const h = await startHarness();
  try {
    assert.equal((await h.fetch("/api/config", { method: "PUT", body: JSON.stringify({ profile: { name: "Ana" } }) })).status, 200);
    assert.equal((await h.fetch("/api/config", { method: "PUT", body: JSON.stringify({ profile: { name: "" } }) })).status, 200);
    assert.equal((await h.json("/api/config")).profile.name, "");
  } finally {
    await h.stop();
  }
});

/** A relay that holds a Team licence's space, enough for a room to be
 * shared; minting a pass for a guest works too. */
async function fakeRelay() {
  let minted = 0;
  const server = createServer((req: IncomingMessage, res) => {
    req.resume();
    req.on("end", () => {
      const answer = (status: number, said: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(said));
      };
      if (req.url === "/spaces") return answer(201, { spaceId: "sp_1", agentToken: "agent-tok", clientToken: "client-tok", plan: "team" });
      if (req.url === "/space/agent/plan") return answer(200, { plan: "team", workspaceId: "personal", spaces: { online: 1, limit: 3 } });
      if (req.url === "/space/agent/clients" && req.method === "POST") return answer(201, { clientToken: `ct_${++minted}_${"x".repeat(24)}` });
      return answer(404, {});
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}

test("a room is shared, and invited to, only once the owner has a name", async (t) => {
  const relay = await fakeRelay();
  t.after(() => relay.close());
  const h = await startHarness({ BLOKS_RELAY_URL: relay.url });
  t.after(() => h.stop());
  assert.equal((await h.fetch("/api/relay/activate", { method: "POST", body: JSON.stringify({ key: `blok_live_${"c".repeat(32)}` }) })).status, 200);
  const { bot: a } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Ada" }) });
  const { bot: b } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Ben" }) });
  const { blok } = await h.json("/api/bloks", { method: "POST", body: JSON.stringify({ name: "Launch", memberIds: [a.id, b.id] }) });

  for (const [path, body] of [
    [`/api/bloks/${blok.id}/share`, {}],
    [`/api/bloks/${blok.id}/invites`, { role: "collaborator" }],
  ] as const) {
    const refused = await h.fetch(path, { method: "POST", body: JSON.stringify(body) });
    assert.equal(refused.status, 409, path);
    assert.equal((await refused.json()).code, "name_required", path);
  }
  assert.equal((await h.json(`/api/bloks/${blok.id}/people`)).sharing, null, "nothing was shared on the way to the refusal");

  // the share panel says the name with the share
  const shared = await h.fetch(`/api/bloks/${blok.id}/share`, { method: "POST", body: JSON.stringify({ hostName: "Hamed" }) });
  assert.equal(shared.status, 200, await shared.clone().text());
  assert.equal((await h.json(`/api/bloks/${blok.id}/people`)).hostName, "Hamed");
  assert.equal((await h.json("/api/config")).profile.name, "Hamed");
});
