// What a member may spend, and on what (server/member-limits.ts), and
// people from before workspaces becoming members of one (people.ts).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "bloks-limits-"));
let limits: typeof import("../server/member-limits.ts");
let people: typeof import("../server/people.ts");

before(async () => {
  process.env.HOME = home;
  mkdirSync(join(home, ".bloks"), { recursive: true });
  limits = await import("../server/member-limits.ts");
  people = await import("../server/people.ts");
});
after(() => rmSync(home, { recursive: true, force: true }));

const ws = { workspace: "Rahimi Enterprises", owner: "Hamed" };

test("a member starts with no spending limit, three solo agents and any engine", () => {
  const store = new limits.MemberLimits(join(home, "l1.json"));
  assert.deepEqual(store.limitOf("p1"), { monthlyUsd: null, aiPercent: null, maxSolo: 3, engines: null });
  assert.equal(store.refusal("p1", ws), null);
  assert.equal(store.soloRefusal("p1", 2), null);
  assert.match(store.soloRefusal("p1", 3)!, /3 solo agents/);
  assert.ok(store.engineAllowed("p1", "claude"));
});

test("at the monthly limit their own requests stop, with who can raise it; next month they start again", () => {
  const store = new limits.MemberLimits(join(home, "l2.json"));
  assert.ok(!("error" in store.setLimit("p1", { monthlyUsd: 5 })));
  const october = new Date(2026, 9, 10);
  store.recordSpend("p1", 3, october);
  assert.equal(store.refusal("p1", ws, october), null);
  store.recordSpend("p1", 2.5, october);
  assert.match(store.refusal("p1", ws, october)!, /monthly limit of \$5 in Rahimi Enterprises.*Hamed or an admin/);
  // somebody else is not touched
  assert.equal(store.refusal("p2", ws, october), null);
  assert.equal(store.refusal("p1", ws, new Date(2026, 10, 1)), null);
  assert.equal(store.spentThisMonth("p1", new Date(2026, 10, 1)), 0);
});

test("the Bloks AI share is held to its percent, as the service reports it", () => {
  const store = new limits.MemberLimits(join(home, "l3.json"));
  store.setLimit("p1", { aiPercent: 20 });
  assert.equal(store.refusal("p1", { ...ws, aiUsedPercent: 19 }), null);
  assert.match(store.refusal("p1", { ...ws, aiUsedPercent: 20 })!, /20% share of Bloks AI/);
  assert.equal(store.refusal("p1", { ...ws, aiUsedPercent: null }), null, "an unknown share stops nobody");
});

test("limits are checked whole: one bad field refuses the change", () => {
  const store = new limits.MemberLimits(join(home, "l4.json"));
  for (const bad of [{ monthlyUsd: -1 }, { aiPercent: 0 }, { aiPercent: 101 }, { maxSolo: 1.5 }, { maxSolo: 99 }, { engines: "claude" }]) {
    assert.ok("error" in store.setLimit("p1", bad), JSON.stringify(bad));
  }
  assert.ok("error" in store.setLimit("p1", { maxSolo: 1, engines: ["ghost"] }, ["claude", "codex"]));
  assert.equal(store.limitOf("p1").maxSolo, 3, "nothing half applied");
  const set = store.setLimit("p1", { maxSolo: 0, engines: ["claude"] }, ["claude", "codex"]);
  assert.ok(!("error" in set));
  assert.ok(store.engineAllowed("p1", "claude"));
  assert.ok(!store.engineAllowed("p1", "codex"));
  assert.match(store.soloRefusal("p1", 0)!, /not on for you/);
  // and they survive a restart
  const again = new limits.MemberLimits(join(home, "l4.json"));
  assert.deepEqual(again.limitOf("p1").engines, ["claude"]);
  again.forget("p1");
  assert.deepEqual(again.limitOf("p1"), limits.DEFAULT_LIMIT);
});

test("people from before workspaces become members, guests from a channel stay guests", () => {
  const data: import("../server/people.ts").PeopleFile = {
    people: [
      { id: "p_old", name: "Leila", createdAt: 100 },
      { id: "p_two", name: "Daniel", createdAt: 300 },
      { id: "p_chat", name: "Zed", createdAt: 50, via: { platform: "slack", userId: "U1" } },
    ],
    memberships: [
      { personId: "p_old", roomId: "r2", role: "viewer", joinedAt: 500, invitedBy: "p_two" },
      { personId: "p_old", roomId: "r1", role: "collaborator", joinedAt: 200, invitedBy: "owner" },
      { personId: "p_chat", roomId: "r1", role: "collaborator", joinedAt: 60, invitedBy: "owner" },
    ],
    invites: [],
    knocks: [],
  };
  assert.equal(people.migrate(data), true);
  const [leila, daniel, zed] = data.people;
  assert.equal(leila.role, "member");
  assert.equal(leila.joinedAt, 200, "joined the day of their first room");
  assert.equal(leila.invitedBy, "owner");
  assert.equal(daniel.role, "member");
  assert.equal(daniel.joinedAt, 300, "no room: the day they were made");
  assert.equal(zed.role, undefined);
  // room roles are untouched
  assert.equal(data.memberships.find((m) => m.roomId === "r2")!.role, "viewer");
  assert.equal(data.version, 2);
  // and it happens once
  assert.equal(people.migrate(data), false);
});

test("a migrated person reaches rooms open to everyone, and only their own in rooms of some", () => {
  const p = people.admitToWorkspace({ name: "Sam", role: "member", invitedBy: "owner" });
  assert.deepEqual(people.reachOf(p.id, "open-room", "everyone")?.role, "collaborator");
  assert.equal(people.reachOf(p.id, "closed-room", "some"), null);
  const changed = people.setRoomPeople("closed-room", [p.id]);
  assert.deepEqual(changed.added, [p.id]);
  assert.equal(people.reachOf(p.id, "closed-room", "some")?.role, "collaborator");
  assert.deepEqual(people.setRoomPeople("closed-room", []).removed, [p.id]);
  assert.equal(people.reachOf(p.id, "closed-room", "some"), null);
  assert.equal(people.setWorkspaceRole(p.id, "admin")?.role, "admin");
  assert.equal(people.workspaceRole(p.id), "admin");
});
