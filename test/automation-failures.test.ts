// Routines and watchers that keep failing stop running on their own
// (server/routines.ts, server/watchers.ts), the brief says what failed,
// and the command line a lead acts through reaches the incident routes
// and nothing past them. The routine store writes a file, so it runs
// against a throwaway home: HOME is set before it is loaded.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { allows } from "../server/agent-cli.ts";
import { composeBrief } from "../server/brief.ts";
import { countLook, FAILS_TO_PAUSE as WATCH_FAILS } from "../server/watchers.ts";

const home = mkdtempSync(join(tmpdir(), "bloks-failing-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
after(() => rmSync(home, { recursive: true, force: true }));

const { FAILS_TO_PAUSE, RoutineStore, isDue } = await import("../server/routines.ts");

const input = { targetId: "agent", targetKind: "agent" as const, prompt: "Check the inbox", time: "09:00", days: [], enabled: true };

test("three failed runs in a row stop a routine's automatic runs, and say which failure did", () => {
  assert.equal(FAILS_TO_PAUSE, 3);
  const store = new RoutineStore();
  const routine = store.create(input)!;
  routine.scheduledAt = 0;
  const fail = (error: string) => {
    const run = store.beginRun(routine.id, "lane")!;
    return store.endRun(routine.id, run.id, { state: "failed", error });
  };
  assert.equal(fail("one"), false);
  assert.equal(fail("two"), false);
  assert.equal(fail("three"), true, "the third failure is the one that stops it");
  assert.equal(routine.failures, 3);
  assert.equal(routine.failing?.error, "three");
  // still on, still on the books: only its schedule waits
  assert.equal(routine.enabled, true);
  const slot = new Date(2030, 0, 8, 9, 1);
  assert.equal(isDue(routine, slot), false);
  // a fourth failure (by hand, say) does not say it again
  assert.equal(fail("four"), false);
  // kept on disk
  assert.equal(new RoutineStore().get(routine.id)?.failing?.error, "three");
});

test("a run that goes fine starts the count over and lets a stopped routine run again", () => {
  const store = new RoutineStore();
  const routine = store.create(input)!;
  routine.scheduledAt = 0;
  for (const error of ["a", "b", "c"]) {
    const run = store.beginRun(routine.id, "lane")!;
    store.endRun(routine.id, run.id, { state: "failed", error });
  }
  assert.ok(routine.failing);
  const ok = store.beginRun(routine.id, "lane")!;
  assert.equal(store.endRun(routine.id, ok.id, { state: "ok", summary: "fine" }), false);
  assert.equal(routine.failures, undefined);
  assert.equal(routine.failing, undefined);
  assert.equal(isDue(routine, new Date(2030, 0, 8, 9, 1)), true);
  // a failure between two good runs is one, not three
  const once = store.beginRun(routine.id, "lane")!;
  store.endRun(routine.id, once.id, { state: "failed", error: "x" });
  assert.equal(routine.failures, 1);
});

test("the person changing a routine clears its failing, and a held slot is never counted", () => {
  const store = new RoutineStore();
  const routine = store.create(input)!;
  for (const error of ["a", "b", "c"]) {
    const run = store.beginRun(routine.id, "lane")!;
    store.endRun(routine.id, run.id, { state: "failed", error });
  }
  store.patch(routine.id, { failing: undefined, failures: undefined });
  assert.equal(routine.failing, undefined);
  assert.equal(routine.failures, undefined);
  // a hold is a record of a slot it could not start, not a run that failed
  store.holdRun(routine.id, 1, "lane", "held at the limit");
  store.holdRun(routine.id, 2, "lane", "held at the limit");
  store.holdRun(routine.id, 3, "lane", "held at the limit");
  assert.equal(routine.failures, undefined);
});

test("a watcher stops looking after three failed looks, and one good look starts it again", () => {
  assert.equal(WATCH_FAILS, 3);
  const w: { failures?: number; failing?: { at: number; error: string } } = {};
  assert.equal(countLook(w, false, "the address answered 404", 1), false);
  assert.equal(countLook(w, false, "the address answered 404", 2), false);
  assert.equal(countLook(w, false, "the address answered 500", 3), true);
  assert.deepEqual(w.failing, { at: 3, error: "the address answered 500" });
  assert.equal(countLook(w, false, "again", 4), false, "said once");
  assert.equal(countLook(w, true, "", 5), false);
  assert.deepEqual(w, {});
});

test("the brief says what failed, and a night with a failure in it is not a quiet one", () => {
  const now = new Date(2026, 9, 19, 8, 0).getTime();
  const base = { since: now - 12 * 3_600_000, now, agents: [], waiting: [], spend: { turns: 0, cost: 0, costKnown: false } };
  const calm = composeBrief(base, "b0");
  assert.equal(calm.quiet, true);
  assert.equal(calm.incidents, undefined);
  const brief = composeBrief(
    {
      ...base,
      incidents: [{ id: "i1", title: "Sage's turn", why: "the engine was out of credit", state: "needs-you", threadId: "t1", needs: "Top up the key." }],
      failing: [{ kind: "routine", id: "r1", name: "Morning sweep", error: "the inbox would not open", since: now - 3_600_000 }],
    },
    "b1",
  );
  assert.equal(brief.quiet, false);
  assert.match(brief.headline, /1 open incident/);
  assert.match(brief.headline, /1 automation paused for failing/);
  const closing = brief.parts.at(-1)!.script;
  assert.match(closing, /Sage's turn failed: the engine was out of credit\. It needs you: Top up the key\./);
  assert.match(closing, /The routine Morning sweep kept failing, so it is paused/);
  assert.equal(brief.incidents?.length, 1);
  assert.equal(brief.failing?.length, 1);
  assert.doesNotMatch(JSON.stringify(brief), /[\u2013\u2014]/);
});

test("a lead reaches its incident and its three choices, and nothing the person keeps", () => {
  const me = "lead";
  assert.equal(allows(me, "GET", "/api/incidents/abc").ok, true);
  assert.equal(allows(me, "POST", "/api/incidents/abc/retry").ok, true);
  assert.equal(allows(me, "POST", "/api/incidents/abc/hand").ok, true);
  assert.equal(allows(me, "POST", "/api/incidents/abc/tell").ok, true);
  // the whole list, settling one, and the desk's settings are the person's
  assert.equal(allows(me, "GET", "/api/incidents").ok, false);
  assert.equal(allows(me, "POST", "/api/incidents/abc/resolve").ok, false);
  assert.equal(allows(me, "PUT", "/api/config").ok, false);
});
