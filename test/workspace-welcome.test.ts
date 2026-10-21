// The welcome a workspace made beside Personal opens on (src/lib/
// workspaceWelcome.ts): shaped by what the New workspace dialog was told,
// short, and picked up where it was left.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { resumeAt, welcomeKind, welcomeSteps } from "../src/lib/workspaceWelcome.ts";

const ids = (shape: Parameters<typeof welcomeSteps>[0]) => welcomeSteps(shape).map((s) => s.id);

test("each choice gets its own welcome: Business names itself first, a Team ends on its people, just me never meets them", () => {
  assert.deepEqual(ids({ kind: "business", team: false, enginesReady: true }), ["business", "agents"]);
  assert.deepEqual(ids({ kind: "business", team: true, enginesReady: true }), ["business", "agents", "invite"]);
  assert.deepEqual(ids({ kind: "custom", team: true, enginesReady: true }), ["agents", "invite"]);
  assert.deepEqual(ids({ kind: "custom", team: false, enginesReady: true }), ["agents"]);
  // the engines only when none can reply here, and not before anyone knows
  assert.deepEqual(ids({ kind: "custom", team: false, enginesReady: false }), ["engines", "agents"]);
  assert.deepEqual(ids({ kind: "business", team: false, enginesReady: false }), ["business", "engines", "agents"]);
  assert.deepEqual(ids({ kind: "custom", team: false, enginesReady: null }), ["agents"]);
  for (const shape of [{ kind: "custom", team: false, enginesReady: true }, { kind: "business", team: false, enginesReady: false }] as const) {
    assert.ok(!ids(shape).includes("invite"), "just me is never asked about people");
  }
});

test("only a workspace made beside Personal gets the short welcome", () => {
  assert.equal(welcomeKind({ kind: "business" }), "workspace");
  assert.equal(welcomeKind({ kind: "custom" }), "workspace");
  assert.equal(welcomeKind({ kind: "personal" }), "first-run");
  assert.equal(welcomeKind({ kind: "hosted" }), "first-run");
  assert.equal(welcomeKind(null), "first-run", "outside the app: the first run");
});

test("coming back picks up where it was left, or just after a step that is gone", () => {
  const steps = welcomeSteps({ kind: "business", team: true, enginesReady: true });
  assert.equal(resumeAt(steps, null), "business");
  assert.equal(resumeAt(steps, "agents"), "agents");
  assert.equal(resumeAt(steps, "invite"), "invite");
  // the engines step went (one came ready meanwhile): the one after it
  assert.equal(resumeAt(steps, "engines"), "agents");
  assert.equal(resumeAt(steps, "nonsense"), "business");
  // a Team step kept from before the workspace became just me
  assert.equal(resumeAt(welcomeSteps({ kind: "custom", team: false, enginesReady: true }), "invite"), "agents");
});

test("the window opens a made workspace on the short welcome, and the first run stays for Personal", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /welcomeKind\(window\.bloks\?\.workspace\) === "workspace" \?/);
  const welcome = readFileSync(new URL("../src/components/WorkspaceWelcome.tsx", import.meta.url), "utf8");
  // skippable as a whole, and every move is kept for coming back
  assert.match(welcome, /finish\("skipped"\)/);
  assert.match(welcome, /keepWelcomeStep\(step\)/);
  assert.match(welcome, /keepWelcomeStep\(null\)/);
});
