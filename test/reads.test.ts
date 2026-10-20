// How far people have read (server/reads.ts), and who may be shown it
// (server/access.ts readsShown, server/member-access.ts memberFrame).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Reads } from "../server/reads.ts";
import { readsShown } from "../server/access.ts";
import { memberFrame, memberCan, type MemberView } from "../server/member-access.ts";

const order = ["m1", "m2", "m3", "m4"];

test("a position moves forward only, survives a restart, and goes with the person", () => {
  const dir = mkdtempSync(join(tmpdir(), "bloks-reads-"));
  try {
    const file = join(dir, "reads.json");
    let now = 100;
    const reads = new Reads(file, () => now);
    assert.deepEqual(reads.mark("t1", "p_sam", "m2", order), { threadId: "t1", personId: "p_sam", messageId: "m2", at: 100 });
    now = 200;
    assert.equal(reads.mark("t1", "p_sam", "m1", order), null, "an older word arriving late takes nothing back");
    assert.equal(reads.mark("t1", "p_sam", "m2", order), null, "the same place is no news");
    assert.equal(reads.mark("t1", "p_sam", "ghost", order), null, "a message that is not there");
    assert.equal(reads.mark("t1", "p_sam", "m4", order)?.messageId, "m4");
    assert.ok(reads.mark("t1", "owner", "m3", order));
    assert.ok(reads.mark("t2", "p_sam", "m1", order));

    const again = new Reads(file);
    assert.deepEqual(
      again.of("t1").map((r) => [r.personId, r.messageId]).sort(),
      [["owner", "m3"], ["p_sam", "m4"]],
    );
    again.forgetPerson("p_sam");
    assert.deepEqual(new Reads(file).of("t1").map((r) => r.personId), ["owner"]);
    assert.deepEqual(new Reads(file).of("t2"), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("who is shown whose position: everyone's in a room or a team conversation, a private one's only to its person", () => {
  const off = { privateReadable: false };
  const on = { privateReadable: true };
  for (const where of ["room", "team"] as const) {
    assert.equal(readsShown(where, "p_ana", "p_sam", off), true);
    assert.equal(readsShown(where, "owner", "p_sam", off), true);
  }
  const lane = { laneOwner: "p_sam" };
  assert.equal(readsShown("private", "p_sam", "p_sam", { ...lane, ...off }), true, "your own");
  assert.equal(readsShown("private", "owner", "p_sam", { ...lane, ...off }), false, "not the owner, by default");
  assert.equal(readsShown("private", "owner", "p_sam", { ...lane, ...on }), true, "the owner, while the setting is on");
  assert.equal(readsShown("private", "p_admin", "p_sam", { ...lane, ...on }), false, "never an admin");
  assert.equal(readsShown("private", "p_sam", "owner", { ...lane, ...on }), false, "nobody else's position lives there");
  assert.equal(readsShown("solo", "p_sam", "p_sam", { laneOwner: "p_sam", ...off }), true);
  assert.equal(readsShown("solo", "owner", "p_sam", { laneOwner: "p_sam", ...on }), false);
  assert.equal(readsShown("owner", "owner", "owner", { laneOwner: "owner", ...off }), true);
});

test("the read frame reaches a member only where they may see it", () => {
  const room: MemberView = { joinedAt: 0, history: "all", activityDetail: false, personId: "p_ana", role: "collaborator", thread: "room" };
  const team: MemberView = { ...room, thread: "team" };
  const privateOwn: MemberView = { ...room, personId: "p_sam", thread: "private" };
  const privateAdmin: MemberView = { ...room, personId: "p_admin", role: "viewer", thread: "private", admin: true };
  const frame = (threadId: string, personId: string) => ({ kind: "read", threadId, personId, messageId: "m1", at: 1 });
  const views: Record<string, MemberView | null> = { r1: room, t1: team, p1: privateOwn, p2: privateAdmin };
  const viewOf = (id: string) => views[id] ?? null;
  assert.ok(memberFrame(frame("r1", "p_sam"), viewOf));
  assert.ok(memberFrame(frame("t1", "owner"), viewOf));
  assert.ok(memberFrame(frame("p1", "p_sam"), viewOf), "their own, back to their other devices");
  assert.equal(memberFrame(frame("p2", "p_sam"), viewOf), null, "an admin reading a private conversation is not told who read it");
  assert.equal(memberFrame(frame("nowhere", "p_sam"), viewOf), null);
  assert.equal(memberFrame(frame("r1", "p_sam"), viewOf, "guest") !== null, true, "a guest of the room hears about the room");
});

test("the member route for read positions is a member's and a guest's", () => {
  const verdict = memberCan("POST", "/api/member/threads/t_123/read", () => null, () => false, "member");
  assert.deepEqual(verdict, { ok: true, action: { kind: "read", threadId: "t_123" } });
  assert.equal(memberCan("POST", "/api/member/threads/t_123/read", () => null, () => false, null).ok, true);
  assert.equal(memberCan("GET", "/api/member/threads/t_123/read", () => null, () => false, "member").ok, false);
});
