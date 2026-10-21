// The rules of Bloks AI, held one at a time (server/bloks-ai.ts): which
// work tag a turn carries, what a member tag is made of and never made
// of, the headers the engine sends, Claude Code never given anything of
// Bloks AI's, the move at start that takes an agent off Claude Code on
// Bloks AI, the scrub that keeps what ran underneath and what it cost with
// the service, and the usage notice the balance carries, read as warily as
// the rest of it.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CLAUDE_MOVED_NOTICE,
  IDENTITY_LINE,
  TEAM_SIGN_IN_WARNING,
  capValue,
  claudeBackupNotice,
  claudeOffBloksAi,
  codingRole,
  memberTag,
  onPersonalSignIn,
  originOf,
  readAiBalance,
  readAiNotice,
  readTeam,
  scrubEvent,
  tagHeaders,
  teamSignInWarning,
  workTag,
} from "../server/bloks-ai.ts";
import { turnEnvironment } from "../server/drivers/claude.ts";
import type { RuntimeEvent } from "../server/contracts.ts";

test("standing work is automation, whoever does it", () => {
  for (const origin of ["routine", "watcher", "workflow", "intent", "incident", "webhook", "background"] as const) {
    assert.equal(workTag({ origin, role: "Backend engineer" }), "automation", origin);
  }
});

test("a coding turn is one whose agent's role or skills say engineering", () => {
  assert.equal(workTag({ role: "Frontend engineer Builds the web app" }), "coding");
  assert.equal(workTag({ role: "Assistant", skills: ["Refactor Python that matches the project"] }), "coding");
  assert.equal(workTag({ role: "Tech lead" }), "coding");
  assert.equal(workTag({ role: "Travel planner" }), "general");
  assert.equal(workTag({ role: "Docs writer", skills: ["Keep the calendar tidy"] }), "general");
  assert.equal(workTag({}), "general");
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

test("Claude Code is never given a base, a token, a model alias or Bloks AI's headers", () => {
  // whatever a turn carries, the CLI starts on what this machine and its
  // own settings say, which is the person's own plan or key
  const env = turnEnvironment(
    { PATH: "/bin", ANTHROPIC_API_KEY: "sk-ant-person", CLAUDECODE: "1" },
    { env: { BLOKS_TOKEN: "t" }, credits: { baseUrl: "https://ai.example/api/ai", token: "cred_1" }, tags: { work: "general" } } as never,
  );
  assert.equal(env.ANTHROPIC_BASE_URL, undefined);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(env.ANTHROPIC_MODEL, undefined);
  assert.equal(env.ANTHROPIC_SMALL_FAST_MODEL, undefined);
  assert.equal(env.ANTHROPIC_CUSTOM_HEADERS, undefined);
  assert.equal("ANTHROPIC_API_KEY" in env, false, "the key is dropped, as it always was");
  assert.equal(env.CLAUDECODE, undefined);
  assert.equal(env.BLOKS_TOKEN, "t");
  assert.ok(!Object.values(env).some((v) => typeof v === "string" && /ai\.example|cred_1|bloks-ai/.test(v)));
});

// ── Claude Code off Bloks AI ───────────────────────────────────────────

const KINDS: Record<string, string> = { claude: "claudeAgent", claude2: "claudeAgent", codex: "codex", bloks: "bloks" };
const kindOf = (id: string) => KINDS[id] ?? null;
const ON_AI = { instanceId: "bloks", model: "bloks-ai" };

test("an agent on Claude Code with Bloks AI paying moves onto the Bloks engine, and is told once", () => {
  const move = claudeOffBloksAi({ modelSelection: { instanceId: "claude", model: "claude-sonnet-5" }, engineAccess: "credits" }, kindOf, "bloks");
  assert.deepEqual(move, { patch: { engineAccess: undefined, modelSelection: ON_AI }, notice: CLAUDE_MOVED_NOTICE });
  assert.equal(
    CLAUDE_MOVED_NOTICE,
    "Claude Code runs on your own Claude plan or key. This agent now runs on Bloks AI's own engine; to keep Claude Code, sign it in from Settings, Engines and keys and pick Claude Code for it again.",
  );
  // the move drops the access, so the agent as it is afterwards matches nothing
  assert.equal(claudeOffBloksAi({ modelSelection: ON_AI, engineAccess: undefined }, kindOf, "bloks"), null);
});

test("a backup on Claude Code moves with it, or goes when the agent is on the Bloks engine itself", () => {
  // two Claude Code engines: the backup would be the same service the agent now runs on
  const both = claudeOffBloksAi(
    { modelSelection: { instanceId: "claude", model: "claude-sonnet-5" }, backupSelection: { instanceId: "claude2", model: "claude-opus-5" }, engineAccess: "credits" },
    kindOf,
    "bloks",
  );
  assert.deepEqual(both?.patch, { engineAccess: undefined, modelSelection: ON_AI, backupSelection: null });
  assert.equal(both?.notice, CLAUDE_MOVED_NOTICE);
  // a backup on Claude Code behind another engine becomes Bloks AI
  const behindCodex = claudeOffBloksAi(
    { modelSelection: { instanceId: "codex", model: "gpt-5.5" }, backupSelection: { instanceId: "claude", model: "claude-sonnet-5" }, engineAccess: "credits" },
    kindOf,
    "bloks",
  );
  assert.deepEqual(behindCodex?.patch, { engineAccess: undefined, backupSelection: ON_AI });
  assert.equal(behindCodex?.notice, claudeBackupNotice(true));
  // and behind the Bloks engine it goes, since it would cover nothing
  const behindAi = claudeOffBloksAi({ modelSelection: ON_AI, backupSelection: { instanceId: "claude", model: "claude-sonnet-5" }, engineAccess: "credits" }, kindOf, "bloks");
  assert.deepEqual(behindAi?.patch, { engineAccess: undefined, backupSelection: null });
  assert.equal(behindAi?.notice, claudeBackupNotice(false));
  for (const notice of [claudeBackupNotice(true), claudeBackupNotice(false)]) assert.match(notice, /^Claude Code runs on your own Claude plan or key/);
});

test("any other agent is left exactly as it is", () => {
  // on Bloks AI already, whatever an old access says
  assert.equal(claudeOffBloksAi({ modelSelection: ON_AI }, kindOf, "bloks"), null);
  assert.equal(claudeOffBloksAi({ modelSelection: ON_AI, engineAccess: "credits" }, kindOf, "bloks"), null);
  // Claude Code on its own sign-in
  assert.equal(claudeOffBloksAi({ modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } }, kindOf, "bloks"), null);
  assert.equal(claudeOffBloksAi({ modelSelection: { instanceId: "claude", model: "claude-sonnet-5" }, engineAccess: null }, kindOf, "bloks"), null);
  // an access only Claude Code ever read, on an engine that never did
  assert.equal(claudeOffBloksAi({ modelSelection: { instanceId: "codex", model: "gpt-5.5" }, engineAccess: "credits" }, kindOf, "bloks"), null);
  // an engine this workspace no longer has is not guessed at
  assert.equal(claudeOffBloksAi({ modelSelection: { instanceId: "gone", model: "x" }, engineAccess: "credits" }, kindOf, "bloks"), null);
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
  assert.equal(onPersonalSignIn("claudeAgent"), true, "Claude Code is always on the person's own plan or key");
  assert.equal(onPersonalSignIn("codex"), true);
  assert.equal(onPersonalSignIn("openrouter"), false);
  assert.equal(onPersonalSignIn("bloks"), false);
  assert.equal(teamSignInWarning({ hosted: true, team: true, personalAgents: 1 }), TEAM_SIGN_IN_WARNING);
  assert.equal(teamSignInWarning({ hosted: false, team: true, personalAgents: 1 }), null);
  assert.equal(teamSignInWarning({ hosted: true, team: false, personalAgents: 3 }), null);
  assert.equal(teamSignInWarning({ hosted: true, team: null, personalAgents: 3 }), null);
  assert.equal(teamSignInWarning({ hosted: true, team: true, personalAgents: 0 }), null);
});

// ── the usage notice ───────────────────────────────────────────────────

const NOTICE = {
  id: "month-2026-10:warn",
  level: "warn",
  title: "Almost out of Bloks AI for this month",
  usedPercent: 91.6,
  resetsAt: "2026-11-01T00:00:00Z",
};

test("the balance's usage notice is read whole, with the next daily reset beside it", () => {
  const balance = readAiBalance(JSON.stringify({ leftPercent: 8.4, dailyResetsAt: 1_792_800_000, notice: NOTICE }), 7);
  assert.deepEqual(balance.notice, {
    id: "month-2026-10:warn",
    level: "warn",
    title: "Almost out of Bloks AI for this month",
    usedPercent: 92,
    resetsAt: Date.parse("2026-11-01T00:00:00Z"),
  });
  assert.equal(balance.dailyResetsAt, 1_792_800_000_000);
  // no reset is a notice still; nothing at all is none
  assert.equal(readAiNotice({ ...NOTICE, resetsAt: null })?.resetsAt, null);
  assert.equal(readAiNotice({ ...NOTICE, resetsAt: undefined })?.resetsAt, null);
  assert.equal(readAiBalance('{"leftPercent":50}').notice, null);
  assert.equal(readAiBalance('{"leftPercent":50,"notice":null}').notice, null);
  // a share past the ends is a share
  assert.equal(readAiNotice({ ...NOTICE, usedPercent: 140 })?.usedPercent, 100);
  assert.equal(readAiNotice({ ...NOTICE, usedPercent: -3 })?.usedPercent, 0);
  for (const level of ["info", "warn", "stop"]) assert.equal(readAiNotice({ ...NOTICE, level })?.level, level);
});

test("a usage notice short of a whole one is no notice, and the balance is still read", () => {
  const broken: unknown[] = [
    "Almost out",
    ["a"],
    42,
    { ...NOTICE, id: undefined },
    { ...NOTICE, id: "" },
    { ...NOTICE, id: "has spaces" },
    { ...NOTICE, id: "<script>" },
    { ...NOTICE, id: "x".repeat(121) },
    { ...NOTICE, level: "danger" },
    { ...NOTICE, level: "WARN" },
    { ...NOTICE, title: 7 },
    { ...NOTICE, title: "   " },
    { ...NOTICE, title: "\u0000\u202e\u200b" },
    { ...NOTICE, usedPercent: "91" },
    { ...NOTICE, usedPercent: Number.NaN },
    { ...NOTICE, usedPercent: undefined },
    { ...NOTICE, resetsAt: "soon" },
    { ...NOTICE, resetsAt: -5 },
    { ...NOTICE, resetsAt: {} },
  ];
  for (const notice of broken) {
    assert.equal(readAiNotice(notice), null, JSON.stringify(notice));
    const balance = readAiBalance(JSON.stringify({ leftPercent: 50, notice }));
    assert.equal(balance.notice, null);
    assert.equal(balance.leftPercent, 50, "a bad notice does not cost the balance");
  }
  assert.equal(readAiBalance('{"leftPercent":50,"dailyResetsAt":"tomorrow"}').dailyResetsAt, null);
});

test("today's share is a share, and a day's limit is any positive share within reason", () => {
  const read = (fields: Record<string, unknown>) => readAiBalance(JSON.stringify({ leftPercent: 50, ...fields }));
  assert.equal(read({ usedTodayPercent: 12.5 }).usedTodayPercent, 12.5);
  assert.equal(read({ usedTodayPercent: 140 }).usedTodayPercent, 100);
  assert.equal(read({ usedTodayPercent: -1 }).usedTodayPercent, 0);
  assert.equal(read({ usedTodayPercent: "12" }).usedTodayPercent, null);
  assert.equal(read({}).usedTodayPercent, null);
  // a day's limit may be set above the whole month
  assert.equal(read({ dailyLimitPercent: 150 }).dailyLimitPercent, 150);
  assert.equal(read({ dailyLimitPercent: 1e12 }).dailyLimitPercent, 100_000);
  for (const bad of [0, -5, "20", null, Number.NaN, {}]) assert.equal(read({ dailyLimitPercent: bad }).dailyLimitPercent, null, String(bad));
});

test("a notice's title is plain text, cut to a line, and never about money", () => {
  // control and direction characters go, so nothing reorders or hides part of the line
  assert.equal(
    readAiNotice({ ...NOTICE, title: "Close to\ntoday's \u202eBloks AI\u202c limit\u0007" })?.title,
    "Close to today's Bloks AI limit",
  );
  assert.equal(readAiNotice({ ...NOTICE, title: "  On pace\u200b to use\t\tthis month early  " })?.title, "On pace to use this month early");
  const long = readAiNotice({ ...NOTICE, title: "a".repeat(119) + "\u{1F600}" + "b".repeat(50) })!.title;
  assert.equal(Array.from(long).length, 120, "cut at 120 characters");
  assert.ok(long.endsWith("\u{1F600}"), "and never through the middle of one");
  // markup is words to React; it is kept as written and shown as text
  assert.equal(readAiNotice({ ...NOTICE, title: "<b>Almost</b> out" })?.title, "<b>Almost</b> out");
  for (const title of ["You have $4.20 left", "Under 3 \u20ac left this month", "\u00a312 of Bloks AI used"]) {
    assert.equal(readAiNotice({ ...NOTICE, title }), null, title);
  }
});
