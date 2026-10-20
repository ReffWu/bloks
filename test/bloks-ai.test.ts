// The rules of Bloks AI, held one at a time (server/bloks-ai.ts): which
// work tag a turn carries, what a member tag is made of and never made
// of, the headers in both the shapes the engines take them, Claude Code's
// environment on Bloks AI, and the scrubs that keep what ran underneath
// and what it cost with the service.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CLAUDE_MODEL_ENV,
  IDENTITY_LINE,
  TEAM_SIGN_IN_WARNING,
  capValue,
  codingRole,
  customHeaders,
  memberTag,
  onPersonalSignIn,
  originOf,
  readTeam,
  scrubEvent,
  scrubFrame,
  tagHeaders,
  teamSignInWarning,
  workTag,
} from "../server/bloks-ai.ts";
import { turnEnvironment } from "../server/drivers/claude.ts";
import type { RuntimeEvent } from "../server/contracts.ts";

test("standing work is automation, whoever does it", () => {
  for (const origin of ["routine", "watcher", "workflow", "intent", "incident", "webhook", "background"] as const) {
    assert.equal(workTag({ origin, engine: "claudeAgent", role: "Backend engineer" }), "automation", origin);
  }
});

test("a coding turn is one on Claude Code, or one whose agent's role or skills say engineering", () => {
  assert.equal(workTag({ engine: "claudeAgent", role: "Travel planner" }), "coding");
  assert.equal(workTag({ engine: "bloks", role: "Frontend engineer Builds the web app" }), "coding");
  assert.equal(workTag({ engine: "bloks", role: "Assistant", skills: ["Refactor Python that matches the project"] }), "coding");
  assert.equal(workTag({ engine: "bloks", role: "Tech lead" }), "coding");
  assert.equal(workTag({ engine: "bloks", role: "Docs writer", skills: ["Keep the calendar tidy"] }), "general");
  assert.equal(workTag({ engine: "bloks" }), "general");
});

test("engineering is read from whole words, so a near miss stays general", () => {
  assert.equal(codingRole("Decoding letters from grandma", []), false);
  assert.equal(codingRole("Chef", ["Engineered timber floors"]), false);
  assert.equal(codingRole("Chef", ["Review pull requests"]), true);
  assert.equal(codingRole(null, null), false);
});

test("a message's via is an origin only when it is standing work", () => {
  assert.equal(originOf("watcher"), "watcher");
  assert.equal(originOf("intent"), "intent");
  assert.equal(originOf("goal"), null, "a goal's nudge carries the person's work on");
  assert.equal(originOf("slack"), null);
  assert.equal(originOf(undefined), null);
});

test("a member tag is stable, opaque and never their name or email", () => {
  const a = memberTag("p_ada");
  assert.equal(a, memberTag("p_ada"), "the same person is the same tag every time, so a cap holds");
  assert.notEqual(a, memberTag("p_bob"));
  assert.match(a, /^m_[0-9a-f]{24}$/);
  assert.ok(!a.includes("ada"));
});

test("the headers: work always, a member only when well formed", () => {
  assert.deepEqual(tagHeaders({ work: "coding" }), { "x-bloks-work": "coding" });
  assert.deepEqual(tagHeaders({ work: "general", member: memberTag("p1") }), { "x-bloks-work": "general", "x-bloks-member": memberTag("p1") });
  assert.deepEqual(tagHeaders({ work: "general", member: "Ada Lovelace <ada@example.com>" }), { "x-bloks-work": "general" }, "never a name");
  assert.deepEqual(tagHeaders(null), {});
});

test("Claude Code takes them as lines, keeping the person's own and replacing ours", () => {
  const member = memberTag("p2");
  assert.equal(customHeaders({ work: "coding", member }), `x-bloks-work: coding\nx-bloks-member: ${member}`);
  assert.equal(customHeaders({ work: "automation" }, "X-Team: blue\nx-bloks-work: general"), "X-Team: blue\nx-bloks-work: automation");
});

test("on Bloks AI the CLI is told every model is the alias, and gets the turn's tags", () => {
  const member = memberTag("p3");
  const env = turnEnvironment(
    { PATH: "/bin", ANTHROPIC_MODEL: "claude-opus-5.5" },
    { credits: { baseUrl: "https://ai.example/api/ai", token: "cred_1" }, tags: { work: "general", member } },
  );
  for (const [name, value] of Object.entries(CLAUDE_MODEL_ENV)) assert.equal(env[name], value, name);
  assert.equal(env.ANTHROPIC_MODEL, "bloks-ai");
  assert.equal(env.ANTHROPIC_SMALL_FAST_MODEL, "bloks-ai");
  assert.equal(env.ANTHROPIC_CUSTOM_HEADERS, `x-bloks-work: general\nx-bloks-member: ${member}`);
  // without tags it still says what it is: Claude Code is a coding engine
  const plain = turnEnvironment({ PATH: "/bin" }, { credits: { baseUrl: "https://ai.example/api/ai", token: "cred_1" } });
  assert.equal(plain.ANTHROPIC_CUSTOM_HEADERS, "x-bloks-work: coding");
  // and off Bloks AI nothing of it is set, whatever tags a turn carries
  const own = turnEnvironment({ PATH: "/bin" }, { tags: { work: "coding" } });
  assert.equal(own.ANTHROPIC_MODEL, undefined);
  assert.equal(own.ANTHROPIC_CUSTOM_HEADERS, undefined);
});

test("a Claude Code frame on Bloks AI names no model and no price", () => {
  const frame = scrubFrame({
    type: "result",
    total_cost_usd: 0.42,
    modelUsage: {
      "claude-opus-5.5": { inputTokens: 10, costUSD: 0.4, contextWindow: 200000 },
      "upstream-model-b": { inputTokens: 2, costUSD: 0.02, contextWindow: 100000 },
    },
    message: { model: "claude-opus-5.5", content: [{ type: "text", text: "hi" }] },
  });
  const said = JSON.stringify(frame);
  assert.ok(!/claude-|cost|0\.42/i.test(said), said);
  assert.deepEqual(frame.modelUsage, { "bloks-ai": { inputTokens: 10, contextWindow: 200000 } }, "the window is still read from it");
  assert.equal(frame.message.model, "bloks-ai");
  assert.equal(scrubFrame({ type: "system", subtype: "init", model: "claude-sonnet-5" }).model, "bloks-ai");
});

test("an event from a Bloks AI turn has no cost, no model of its own and no raw frame", () => {
  const base = { eventId: "e", provider: "claudeAgent", threadId: "t", createdAt: "now" };
  const done = scrubEvent({ ...base, type: "turn.completed", ok: true, cost: 0.31, raw: { source: "x", payload: { model: "m" } } } as RuntimeEvent);
  assert.equal("cost" in done ? done.cost : undefined, null);
  assert.equal(done.raw, undefined);
  const started = scrubEvent({ ...base, type: "session.started", sessionId: "s", model: "claude-opus-5.5" });
  assert.equal("model" in started ? started.model : undefined, "bloks-ai");
});

test("the identity line says Bloks AI and asks not to guess", () => {
  assert.match(IDENTITY_LINE, /Bloks AI/);
  assert.match(IDENTITY_LINE, /do not guess/);
});

test("the hosting status says team in either of its words", () => {
  assert.equal(readTeam('{"team":true}'), true);
  assert.equal(readTeam('{"plan":"Team"}'), true);
  assert.equal(readTeam('{"plan":"solo"}'), false);
  assert.equal(readTeam("{}"), null);
  assert.equal(readTeam("<html>"), null);
});

test("a member's daily cap is a share of the month, or none", () => {
  assert.equal(capValue(25), 25);
  assert.equal(capValue(2.55), 2.6);
  assert.equal(capValue(null), null);
  for (const bad of [0, -1, 101, "10", Number.NaN]) assert.equal(capValue(bad), undefined, String(bad));
});

test("the warning: a hosted team with an agent on a personal sign-in, and nothing else", () => {
  assert.equal(onPersonalSignIn("claudeAgent", null), true);
  assert.equal(onPersonalSignIn("claudeAgent", "credits"), false);
  assert.equal(onPersonalSignIn("codex", null), true);
  assert.equal(onPersonalSignIn("openrouter", null), false);
  assert.equal(teamSignInWarning({ hosted: true, team: true, personalAgents: 1 }), TEAM_SIGN_IN_WARNING);
  assert.equal(teamSignInWarning({ hosted: false, team: true, personalAgents: 1 }), null);
  assert.equal(teamSignInWarning({ hosted: true, team: false, personalAgents: 3 }), null);
  assert.equal(teamSignInWarning({ hosted: true, team: null, personalAgents: 3 }), null);
  assert.equal(teamSignInWarning({ hosted: true, team: true, personalAgents: 0 }), null);
});
