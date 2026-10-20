// What each plan allows (server/plan-limits.ts), and how the owner's plan
// is known for members (server/owner-plan.ts): the relay's word, else the
// licence's, and never a lapse made up from a network that did not answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PLAN_LIMITS, membersActive, pausedWords, roomSharingAllowed, workspaceMemberLimit } from "../server/plan-limits.ts";
import { OwnerPlan, type OwnerPlanSources } from "../server/owner-plan.ts";
import { memberLimitFor } from "../server/members.ts";

test("workspace members are Team's: Cloud holds none, Team ten, no plan none", () => {
  assert.equal(PLAN_LIMITS.cloud.workspaceMembers, 0);
  assert.equal(PLAN_LIMITS.team.workspaceMembers, 10);
  assert.equal(workspaceMemberLimit("cloud"), 0);
  assert.equal(workspaceMemberLimit("team"), 10);
  assert.equal(workspaceMemberLimit(null), 0);
  assert.equal(memberLimitFor(null), 0, "a workspace with no licence holds nobody either");
  assert.equal(membersActive("team"), true);
  assert.equal(membersActive("cloud"), false);
  assert.equal(membersActive(null), false);
  assert.equal(pausedWords("Hamed"), "Hamed's workspace needs Bloks Team for members right now.");
});

test("a shared room with its own guests is kept as Cloud had it", () => {
  // the old share flow: one room, two people
  assert.equal(PLAN_LIMITS.cloud.rooms, 1);
  assert.equal(PLAN_LIMITS.cloud.members, 2);
  assert.equal(PLAN_LIMITS.team.members, 10);
});

test("sharing a room: Team always; Cloud when its licence holds a shared room, or the relay is too old to say", () => {
  assert.equal(roomSharingAllowed("team", false), true);
  assert.equal(roomSharingAllowed("team", null), true);
  assert.equal(roomSharingAllowed("cloud", true), true, "bought before rooms became Team's");
  assert.equal(roomSharingAllowed("cloud", false), false, "a Cloud licence bought since");
  assert.equal(roomSharingAllowed("cloud", null), true, "an older relay that does not say keeps today's behaviour");
  assert.equal(roomSharingAllowed("cloud", undefined), true);
  assert.equal(roomSharingAllowed(null, true), false, "no plan, no sharing");
});

function sources(over: Partial<OwnerPlanSources> = {}): OwnerPlanSources & { asked: { relay: number; team: number } } {
  const asked = { relay: 0, team: 0 };
  return {
    asked,
    online: () => false,
    relay: async () => {
      asked.relay++;
      return null;
    },
    licence: () => null,
    team: async () => {
      asked.team++;
      return null;
    },
    ...over,
  };
}

test("the owner's plan: the relay first when online, else the licence, and a real answer is kept on disk", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bloks-owner-plan-"));
  try {
    const file = join(dir, "owner-plan.json");
    const changes: Array<[unknown, unknown]> = [];
    let now = 1_000;
    const said = sources({ online: () => true, relay: async () => "team" });
    const plan = new OwnerPlan(file, said, (p, was) => changes.push([p, was]), () => now);
    assert.equal(plan.current(), null);
    assert.equal(await plan.get(), "team");
    assert.deepEqual(changes, [["team", null]]);
    assert.equal(JSON.parse(readFileSync(file, "utf8")).plan, "team");
    // a second server reading the same folder starts from it
    assert.equal(new OwnerPlan(file, sources()).current(), "team");

    // offline, the licence is asked about
    let team: boolean | null = false;
    const viaLicence = new OwnerPlan(join(dir, "b.json"), sources({ licence: () => "blok_live_x", team: async () => team }), () => {}, () => now);
    assert.equal(await viaLicence.get(), "cloud");
    team = true;
    assert.equal(await viaLicence.get(), "cloud", "kept for ten minutes");
    now += 10 * 60_000 + 1;
    assert.equal(await viaLicence.get(), "team");
    team = false;
    assert.equal(await viaLicence.get(true), "cloud", "asked again at once when fresh");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the owner's plan: nothing to ask keeps what was known; no licence at all is no plan", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bloks-owner-plan-"));
  try {
    const file = join(dir, "owner-plan.json");
    const changes: unknown[] = [];
    let licence: string | null | undefined = "blok_live_x";
    let team: boolean | null = true;
    const plan = new OwnerPlan(file, sources({ licence: () => licence, team: async () => team }), (p) => changes.push(p));
    assert.equal(await plan.get(true), "team");
    // bloks.dev did not answer: a blip, not a lapse
    team = null;
    assert.equal(await plan.get(true), "team");
    // the app has not handed its licence over yet: nothing is known
    licence = undefined;
    assert.equal(await plan.get(true), "team");
    // no licence at all, said for certain: no plan, and members pause
    licence = null;
    assert.equal(await plan.get(true), null);
    assert.deepEqual(changes, ["team", null]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
