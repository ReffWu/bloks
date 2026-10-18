// The desktop keeps its own copy of the Codex speed rules it shows
// (src/lib/codexSpeed.ts), so the interface never imports the server.
// These hold the copy to the server's answers, and the status line to
// what it should and should not say.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as server from "../server/codex-speed.ts";
import * as desktop from "../src/lib/codexSpeed.ts";

const speeds = [undefined, null, "standard", "fast", "priority"] as const;

test("the desktop resolves every workspace and agent pair as the server does", () => {
  for (const workspace of speeds) {
    for (const own of speeds) {
      const config = { codex: { speed: workspace } };
      const bot = { codexSpeed: own };
      assert.deepEqual(desktop.resolveCodexSpeed(config, bot), server.resolveCodexSpeed(config, bot), `${workspace}/${own}`);
    }
  }
  assert.deepEqual(desktop.resolveCodexSpeed({}), server.resolveCodexSpeed({}));
});

test("the desktop tells Codex engines apart as the server does", () => {
  for (const driver of ["codex", "boxAgent", "acp", "claudeAgent", undefined]) {
    for (const model of ["gpt-6", "sonnet", ""]) {
      assert.equal(desktop.codexSpeedRoute(driver, model), server.codexSpeedRoute(driver, model));
    }
  }
});

test("the running turn's speed is said only for Fast or an agent's own choice", () => {
  const status = (workspace: "standard" | "fast", own: "standard" | "fast" | null, configuredTier: string | null = null) => ({
    choice: desktop.resolveCodexSpeed({ codex: { speed: workspace } }, { codexSpeed: own }),
    configuredTier,
    actualTier: null,
  });
  assert.equal(desktop.speedStatusLine(undefined), null);
  assert.equal(desktop.speedStatusLine(status("standard", null)), null, "Standard by default is how Codex always ran");
  assert.equal(desktop.speedStatusLine(status("fast", null, "priority")), "Codex: Fast, by the workspace default. Codex configured the priority tier.");
  assert.equal(desktop.speedStatusLine(status("fast", "standard")), "Codex: Standard, by this agent's choice.");
  assert.equal(desktop.speedStatusLine(status("standard", "fast", "priority")), "Codex: Fast, by this agent's choice. Codex configured the priority tier.");
});
