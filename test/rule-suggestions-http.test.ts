// Rule suggestions over HTTP: what the desktop, the phone and the brief
// read, and taking or turning one down (server/rule-suggestions.ts).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { startHarness } from "./helpers/server.ts";

test("a habit is offered, taken as an ordinary rule, and a turned down one stays quiet", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "bloks-habits-http-"));
  mkdirSync(join(home, ".bloks"), { recursive: true });
  t.after(() => rmSync(home, { recursive: true, force: true }));

  // an agent to have the habit
  let h = await startHarness({ HOME: home });
  const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Research Analyst" }) });
  await h.stop();

  const now = Date.now();
  const yes = (over: Record<string, unknown>, n: number) =>
    Array.from({ length: n }, (_, i) => ({ at: now - 60_000 * (i + 1), botId: bot.id, tool: "Bash", answer: "allow", ...over }));
  writeFileSync(
    join(home, ".bloks", "approval-habits.json"),
    JSON.stringify({
      decisions: [
        ...yes({ command: "pnpm test" }, 7),
        ...yes({ tool: "WebFetch", url: "https://docs.python.org/3/x" }, 5),
        ...yes({ command: "rm -rf dist" }, 9),
      ],
      quiet: {},
    }),
  );

  h = await startHarness({ HOME: home });
  t.after(() => h.stop());

  const { suggestions } = await h.json("/api/rules/suggestions");
  assert.equal(suggestions.length, 2, "the deletion is never offered");
  const tests = suggestions.find((s: any) => s.rule.value === "pnpm test");
  assert.equal(tests.title, "You approved this 7 times. Always allow it for Research Analyst?");
  assert.equal(tests.forAgent.botId, bot.id);
  assert.equal(tests.forEveryone, false);

  // every agent is broader than what was approved
  const wide = await h.fetch(`/api/rules/suggestions/${tests.id}/accept`, { method: "POST", body: JSON.stringify({ scope: "everyone" }) });
  assert.equal(wide.status, 400);

  const taken = await h.fetch(`/api/rules/suggestions/${tests.id}/accept`, { method: "POST", body: JSON.stringify({ scope: "agent" }) });
  assert.equal(taken.status, 201);
  const { rules } = await h.json("/api/rules");
  assert.equal(rules.length, 1);
  assert.deepEqual(
    [rules[0].effect, rules[0].field, rules[0].op, rules[0].value, rules[0].tool, rules[0].botId],
    ["allow", "command", "equals", "pnpm test", "Bash", bot.id],
  );

  // covered now, so no longer offered; the other one is turned down
  const after = (await h.json("/api/rules/suggestions")).suggestions;
  assert.equal(after.length, 1);
  const site = after[0];
  assert.equal(site.what, "open pages on docs.python.org");
  const quiet = await h.json(`/api/rules/suggestions/${site.id}/dismiss`, { method: "POST" });
  assert.ok(quiet.quietUntil > now + 29 * 24 * 60 * 60 * 1000);
  assert.equal((await h.json("/api/rules/suggestions")).suggestions.length, 0);
  assert.equal((await h.fetch(`/api/rules/suggestions/${site.id}/accept`, { method: "POST", body: JSON.stringify({ scope: "agent" }) })).status, 404);

  // removing the rule offers the habit again, and the brief counts it
  const removed = await h.fetch(`/api/rules/${rules[0].id}`, { method: "DELETE" });
  assert.equal(removed.status, 200);
  const { brief } = await h.json("/api/briefs", { method: "POST" });
  assert.deepEqual(brief.ready.find((r: any) => r.label === "rule suggestion"), { label: "rule suggestion", count: 1 });

  // and the record says where the rule came from
  const ledger = await h.json("/api/ledger?limit=20");
  const entries = ledger.entries ?? ledger;
  assert.ok(entries.some((e: any) => /Added a rule you kept approving/.test(e.summary)));
});
