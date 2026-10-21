// One plan for every workspace on this computer (electron/account-plan.mjs,
// and each server's side in server/owner-plan.ts): upgrading in Personal
// is upgrading in a workspace made a minute later, whose own folder has
// never asked anybody, and whose empty "no plan" must not overrule it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cleanPlan, keepPlan, planFromReport, readKeptPlan } from "../electron/account-plan.mjs";
import { OwnerPlan, type OwnerPlanSources } from "../server/owner-plan.ts";
import { planKey } from "../src/lib/plan.ts";

const quiet = (over: Partial<OwnerPlanSources> = {}): OwnerPlanSources => ({
  online: () => false,
  relay: async () => null,
  licence: () => undefined,
  team: async () => null,
  ...over,
});

test("the app keeps the plan under the licence's fingerprint, and another licence starts with none", () => {
  const dir = mkdtempSync(join(tmpdir(), "bloks-account-plan-"));
  try {
    const file = join(dir, "account-plan.json");
    assert.equal(readKeptPlan(file, "print-a"), undefined, "nothing kept yet");
    keepPlan(file, "print-a", "team");
    assert.equal(readKeptPlan(file, "print-a"), "team");
    assert.equal(readKeptPlan(file, "print-b"), undefined, "a different licence is not on this one's plan");
    assert.equal(readKeptPlan(file, null), undefined);
    // the key itself is never on disk, only what tells two keys apart
    assert.doesNotMatch(readFileSync(file, "utf8"), /blok_live_/);
    keepPlan(file, "print-a", "nonsense");
    assert.equal(readKeptPlan(file, "print-a"), null);
    // no licence: nothing is kept at all
    keepPlan(file, null, null);
    assert.equal(existsSync(file), false);
    writeFileSync(file, "{ not json");
    assert.equal(readKeptPlan(file, "print-a"), undefined, "a broken file is nothing kept, never a crash");
    assert.equal(cleanPlan("team"), "team");
    assert.equal(cleanPlan("ai"), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a server's report counts only when it was about the app's licence, and an empty no plan never does", () => {
  assert.equal(planFromReport({ plan: "team", shared: true }, { hasLicence: true }), "team");
  assert.equal(planFromReport({ plan: "cloud", shared: true }, { hasLicence: true }), "cloud");
  // a workspace that kept a different key of its own speaks for itself
  assert.equal(planFromReport({ plan: "cloud", shared: false }, { hasLicence: true }), undefined);
  // a server with no licence cannot speak for the app's
  assert.equal(planFromReport({ plan: null, shared: true }, { hasLicence: true }), undefined);
  // with no licence anywhere, no plan is the truth
  assert.equal(planFromReport({ plan: null, shared: true }, { hasLicence: false }), null);
  // a server from before `shared` is taken at its word
  assert.equal(planFromReport({ plan: "team" }, { hasLicence: true }), "team");
  assert.equal(planFromReport(null, { hasLicence: true }), undefined);
});

test("a fresh workspace has no answer to tell, and takes the app's plan as a real one", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bloks-owner-plan-"));
  try {
    const file = join(dir, "owner-plan.json");
    const changes: unknown[] = [];
    const fresh = new OwnerPlan(file, quiet(), (plan) => changes.push(plan));
    assert.equal(fresh.answered(), false, "an empty folder's null is not an answer");
    assert.equal(fresh.current(), null);
    // nothing to ask yet: still nothing to tell
    assert.equal(await fresh.get(true), null);
    assert.equal(fresh.answered(), false);
    // the app hands over what Personal heard
    fresh.adopt("team");
    assert.equal(fresh.current(), "team");
    assert.equal(fresh.answered(), true);
    assert.deepEqual(changes, ["team"]);
    assert.equal(JSON.parse(readFileSync(file, "utf8")).plan, "team", "kept on disk, like any answer");
    // the same again is not news; something that is not a plan is ignored
    fresh.adopt("team");
    fresh.adopt("platinum");
    assert.deepEqual(changes, ["team"]);
    // and a folder that has an answer on disk has one to tell at once
    assert.equal(new OwnerPlan(file, quiet()).answered(), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the first real answer is news even when it matches the empty start", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bloks-owner-plan-"));
  try {
    const changes: unknown[] = [];
    const plan = new OwnerPlan(join(dir, "owner-plan.json"), quiet({ licence: () => null }), (p) => changes.push(p));
    assert.equal(await plan.get(true), null);
    assert.equal(plan.answered(), true);
    assert.deepEqual(changes, [null], "no licence at all, said for certain, is told once");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the Plan page names the app's plan before guessing Bloks Cloud", () => {
  const licence = { present: true, masked: "blok_live_••••aaaa", kept: true };
  assert.equal(planKey({ licence, account: null, ownerPlan: null }, "team"), "team");
  assert.equal(planKey({ licence, account: null, ownerPlan: "cloud" }, "team"), "cloud", "this workspace's own gates win");
  assert.equal(planKey({ licence, account: null, ownerPlan: null }), "cloud", "only a last guess");
  assert.equal(planKey({ licence: { present: false, masked: null, kept: false }, account: null, ownerPlan: null }, "team"), "free");
});

test("the app hands its plan to every server and takes a server's word only about its own licence", () => {
  const main = readFileSync(new URL("../electron/main.mjs", import.meta.url), "utf8");
  assert.match(main, /if \(said\?\.kind === "desktop\.plan"\) return notePlan\(said\);/);
  assert.match(main, /run\.child\.postMessage\(\{ kind: "plan", plan \}\)/);
  const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
  // the server says whether its answer is about the app's licence
  assert.match(server, /shared: licenceKey\(\) === sharedLicence/);
  // and an empty folder says nothing as it starts
  assert.match(server, /if \(ownerPlan\.answered\(\)\) tellDesktopPlan\(ownerPlan\.current\(\)\);/);
});
