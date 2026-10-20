// Guests and members, against the real server. Somebody invited to one
// room in the owner's Personal workspace stays a guest of that room: no
// team agents, no other rooms, no members list, not counted. Only
// somebody who came in through a workspace invite is a member.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startHarness } from "./helpers/server.ts";
import { teamPlan } from "./helpers/team-plan.ts";
import { JoinClient } from "../server/join-client.ts";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

test("a person made a member by the old migration is a guest of their room again, and reaches nothing else", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "bloks-guests-"));
  const dir = join(home, ".bloks");
  mkdirSync(dir, { recursive: true });
  // members are Bloks Team's (server/plan-limits.ts)
  const team = await teamPlan();
  t.after(() => team.close());
  const guestToken = randomBytes(32).toString("base64url");
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify({
      remote: {
        enabled: true,
        memberDevices: [{ id: "d_leila", name: "Leila", hash: sha(guestToken), pairedAt: 1, personId: "p_room" }],
      },
      profile: { name: "Hamed" },
      ...team.config,
    }),
  );
  // as version 2 left it: Leila, invited to one shared room, made a member
  writeFileSync(
    join(dir, "people.json"),
    JSON.stringify({
      version: 2,
      people: [{ id: "p_room", name: "Leila", createdAt: 100, role: "member", joinedAt: 200, invitedBy: "owner" }],
      memberships: [{ personId: "p_room", roomId: "r_shared", role: "collaborator", joinedAt: 200, invitedBy: "owner" }],
      invites: [],
      knocks: [],
    }),
  );
  const sharing = { since: 1, history: "join", collaboratorsInvite: false, activityDetail: false, tools: "conversation", spendCap: 5 };
  writeFileSync(
    join(dir, "bloks.json"),
    JSON.stringify([
      { id: "r_shared", name: "Launch", memberIds: [], audience: "some", sharing, createdAt: 1, pinned: true },
      { id: "r_open", name: "Everyone's room", memberIds: [], audience: "everyone", createdAt: 2, pinned: true },
    ]),
  );
  const h = await startHarness({ HOME: home, ...team.env });
  t.after(() => h.stop());
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const lan = new URL(h.url).host;
  await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Chief" }) });

  const asGuest = (path: string) => h.fetchRemote(path, { token: guestToken });

  // the room she was let into, and nothing else
  const me = await asGuest("/api/member/me");
  assert.equal(me.status, 200, JSON.stringify(me.body));
  assert.equal(me.body.person.role, undefined);
  assert.equal(me.body.workspace, undefined, "a guest is not told about the workspace");
  assert.deepEqual(me.body.rooms.map((r: any) => r.id), ["r_shared"]);
  assert.equal((await asGuest("/api/member/rooms/r_shared")).status, 200);
  assert.equal((await asGuest("/api/member/rooms/r_open")).status, 404, "a room open to everyone is the workspace's, not hers");
  assert.equal((await asGuest("/api/member/agents")).status, 403, "no team agents");
  assert.equal((await asGuest("/api/member/workspace")).status, 403, "and no workspace at all");
  assert.equal((await asGuest("/api/workspace/members")).status, 403, "nor its members list");

  // not counted among the workspace's members, and the file says so now
  const owner = await h.json("/api/workspace/members");
  assert.ok(!owner.members.some((m: any) => m.id === "p_room"));

  // somebody who comes in by a workspace invite is a member, and does
  // reach the team agents and the room open to everyone
  const made = await h.json("/api/workspace/invites", { method: "POST", body: JSON.stringify({ role: "member", name: "Ana" }) });
  const client = new JoinClient(() => "http://127.0.0.1:9");
  const found = (await client.lookup(`${made.invite.link}~${lan}`)) as any;
  assert.ok(found.ok, JSON.stringify(found));
  assert.equal(((await client.claim(found.session, { name: "Ana" })) as any).status, "waiting");
  assert.equal((await h.fetch(`/api/workspace/requests/${made.invite.id}/approve`, { method: "POST" })).status, 200);
  const ana = ((await client.status(found.session)) as any).credentials as { deviceToken: string; personId: string };
  const asAna = (path: string) => h.fetchRemote(path, { token: ana.deviceToken });
  assert.equal((await asAna("/api/member/agents")).status, 200);
  assert.equal((await asAna("/api/member/workspace")).status, 200);
  assert.equal((await asAna("/api/member/rooms/r_open")).status, 200);
  assert.equal((await asAna("/api/member/rooms/r_shared")).status, 404, "a room of some people is theirs alone");
  const after = await h.json("/api/workspace/members");
  assert.deepEqual(after.members.map((m: any) => m.name), ["Ana"]);
  // the room's people still name its guest, marked as one
  const room = (await asGuest("/api/member/rooms/r_shared")).body.room;
  assert.ok(room.people.some((p: any) => p.id === "p_room" && p.guest === true));
  // and the next change wrote her back as a guest
  const saved = JSON.parse(readFileSync(join(dir, "people.json"), "utf8"));
  assert.equal(saved.version, 3);
  assert.equal(saved.people.find((p: any) => p.id === "p_room").role, undefined);
});
