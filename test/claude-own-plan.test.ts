// Claude Code runs on the person's own Claude plan or key, never on Bloks
// AI, through the real server: an agent an earlier version saved on Claude
// Code with Bloks AI paying moves onto the Bloks engine at start and is
// told so once, an agent already on Bloks AI or on its own sign-in is left
// as it was, the CLI is never handed Bloks AI's base or token even on a
// host that has both, and a service that turns a Claude Code call away is
// said in its own sentence rather than as the CLI printed it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CLAUDE_MOVED_NOTICE } from "../server/bloks-ai.ts";
import { startHarness, type Harness } from "./helpers/server.ts";
import { messagesOf, waitFor } from "./helpers/turns.ts";
import { startFakeCredits, type FakeCredits } from "./helpers/fake-credits.ts";

const LICENCE = `blok_live_${"e".repeat(32)}`;
/** What a service says when it will not take a Claude Code call. */
const REFUSED = "This route no longer runs Claude Code. Claude Code runs on your own Claude plan or key.";

/** A Claude Code that writes down how it was started, then answers, or
 * is turned away with a 403 the way the CLI says one: a newer CLI with the
 * service's sentence after its own line, an older one with the JSON. */
const FAKE = `#!${process.execPath}
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("2.1.299 (Claude Code)"); process.exit(0); }
if (args[0] === "auth") { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
const out = (frame) => console.log(JSON.stringify(frame));
let line = "";
let started = false;
process.stdin.on("data", (c) => {
  line += c;
  let at;
  while ((at = line.indexOf(String.fromCharCode(10))) !== -1) {
    const next = line.slice(0, at);
    line = line.slice(at + 1);
    if (!started && next.trim() && JSON.parse(next).type === "user") {
      started = true;
      answer(JSON.stringify(JSON.parse(next).message.content));
    }
  }
});
function answer(text) {
  const env = process.env;
  appendFileSync("__HOME__/starts.jsonl", JSON.stringify({
    base: env.ANTHROPIC_BASE_URL ?? null,
    token: env.ANTHROPIC_AUTH_TOKEN ?? null,
    key: "ANTHROPIC_API_KEY" in env ? env.ANTHROPIC_API_KEY : null,
    model: args.includes("--model") ? args[args.indexOf("--model") + 1] : null,
    envModel: env.ANTHROPIC_MODEL ?? null,
    headers: env.ANTHROPIC_CUSTOM_HEADERS ?? null,
  }) + String.fromCharCode(10));
  out({ type: "system", subtype: "init", session_id: "sess-own", model: "claude-sonnet-5" });
  const refused = __REFUSED__;
  const said = text.includes("[t-new]")
    ? "Gateway refused the request · signing in again won't change this · API Error: 403 " + refused
    : text.includes("[t-old]")
      ? "Failed to authenticate. API Error: 403 " + JSON.stringify({ type: "error", error: { type: "permission_error", message: refused }, request_id: "req_x" })
      : null;
  if (said) {
    out({ type: "assistant", error: "authentication_failed", message: { model: "<synthetic>", content: [{ type: "text", text: said }] } });
    out({ type: "result", subtype: "success", is_error: true, num_turns: 1, session_id: "sess-own", result: said });
    return;
  }
  out({ type: "assistant", message: { model: "claude-sonnet-5", content: [{ type: "text", text: "Answered on your own plan." }] } });
  out({ type: "result", subtype: "success", is_error: false, num_turns: 1, duration_api_ms: 10, total_cost_usd: 0.01, session_id: "sess-own", result: "Answered on your own plan." });
}
`;

function workspace() {
  const home = mkdtempSync(join(tmpdir(), "bloks-claude-own-"));
  mkdirSync(join(home, ".bloks"), { recursive: true });
  writeFileSync(
    join(home, ".bloks", "config.json"),
    JSON.stringify({ brief: { enabled: false }, instances: { claude: { driver: "claudeAgent", config: { cli: join(home, "fake-claude.mjs") } } } }),
  );
  writeFileSync(join(home, "fake-claude.mjs"), FAKE.replaceAll("__HOME__", home).replace("__REFUSED__", JSON.stringify(REFUSED)), { mode: 0o755 });
  return home;
}

const starts = (home: string) => {
  try {
    return readFileSync(join(home, "starts.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
};

/** The agents as saved, without `busy`, which a start always sets to
 * false (no turn survives one) whatever else it does or does not do. */
const savedBots = (home: string): any[] =>
  (JSON.parse(readFileSync(join(home, ".bloks", "bots.json"), "utf8")) as any[]).map(({ busy: _busy, tasks, ...bot }) => ({
    ...bot,
    tasks: tasks.map(({ busy: _taskBusy, ...task }: any) => task),
  }));

/** A host that has Bloks AI, with a token of its own for it: everything
 * an older version needed to run Claude Code on it. */
async function host(home: string, fake: FakeCredits, token: string): Promise<Harness> {
  return startHarness({ HOME: home, BLOKS_CREDITS_URL: fake.base, BLOKS_CREDITS_TOKEN: token });
}

async function hire(h: Harness, name: string, patch: Record<string, unknown>) {
  const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name }) });
  const res = await h.fetch(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify(patch) });
  assert.equal(res.status, 200, name);
  return bot as { id: string; threadId: string };
}

const agentOf = async (h: Harness, id: string) => (await h.json("/api/bots")).bots.find((b: any) => b.id === id);
const said = (messages: any[], text: string) => messages.filter((m) => m.kind === "notice" && m.text === text);

test("an agent on Claude Code with Bloks AI paying moves onto Bloks AI's own engine at start, is told once, and Claude Code is never handed Bloks AI", async (t) => {
  const fake = await startFakeCredits();
  const token = ((await (await fetch(`${fake.base}/token`, { method: "POST", headers: { authorization: `Bearer ${LICENCE}` } })).json()) as { token: string }).token;
  const home = workspace();
  t.after(async () => {
    await fake.close();
    rmSync(home, { recursive: true, force: true });
  });

  // The workspace as an earlier version left it: Clio on Claude Code with
  // Bloks AI paying, Penny on Bloks AI's own engine (with an old access
  // that never meant anything there), and Otto on his own sign-in.
  let h = await host(home, fake, token);
  const clio = await hire(h, "Clio", {
    modelSelection: { instanceId: "claude", model: "claude-sonnet-5" },
    title: "Engineer",
    description: "Builds the web app",
    skills: ["Refactor Python that matches the project"],
  });
  const penny = await hire(h, "Penny", { modelSelection: { instanceId: "bloks", model: "bloks-ai" } });
  const otto = await hire(h, "Otto", { modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } });
  await h.stop();
  const before = savedBots(home);
  for (const b of before) if (b.id === clio.id || b.id === penny.id) b.engineAccess = "credits";
  writeFileSync(join(home, ".bloks", "bots.json"), JSON.stringify(before, null, 2));
  const pennyBefore = before.find((b) => b.id === penny.id);
  const ottoBefore = before.find((b) => b.id === otto.id);
  const clioBefore = before.find((b) => b.id === clio.id);

  h = await host(home, fake, token);
  try {
    // Clio is on Bloks AI's own engine, with everything else as it was
    const moved = await agentOf(h, clio.id);
    assert.deepEqual(moved.modelSelection, { instanceId: "bloks", model: "bloks-ai" });
    assert.equal("engineAccess" in moved, false);
    assert.equal(moved.name, "Clio");
    assert.equal(moved.title, "Engineer");
    assert.equal(moved.description, "Builds the web app");
    assert.deepEqual(moved.skills, ["Refactor Python that matches the project"]);
    const clioAfter = savedBots(home).find((b) => b.id === clio.id);
    assert.equal("engineAccess" in clioAfter, false, "the access goes with the move");
    const { modelSelection: _was, engineAccess: _access, ...kept } = clioBefore;
    const { modelSelection: _now, ...still } = clioAfter;
    assert.deepEqual(still, kept, "nothing else about the agent changed");
    // and its conversation says so, once
    assert.equal(said(await messagesOf(h, clio), CLAUDE_MOVED_NOTICE).length, 1);

    // Penny, already on Bloks AI, and Otto, on his own sign-in, are untouched
    assert.deepEqual(savedBots(home).find((b) => b.id === penny.id), pennyBefore);
    assert.deepEqual(savedBots(home).find((b) => b.id === otto.id), ottoBefore);
    for (const other of [penny, otto]) {
      assert.ok(!(await messagesOf(h, other)).some((m) => /Claude Code runs on your own/.test(m.text ?? "")), "nothing said to an agent that did not move");
    }
    assert.deepEqual((await agentOf(h, otto.id)).modelSelection, { instanceId: "claude", model: "claude-sonnet-5" });

    // Clio now answers on Bloks AI's own engine, and Claude Code is not started
    await h.fetch(`/api/bots/${clio.id}/messages`, { method: "POST", body: JSON.stringify({ text: "hello" }) });
    assert.ok(await waitFor(async () => (await messagesOf(h, clio)).find((m) => m.role === "bot" && /bloks ai says/.test(m.text ?? "")), 20_000));
    assert.deepEqual(starts(home), []);

    // Picked for Claude Code again, it runs on the person's own plan: no
    // Bloks AI base, no token, no model alias, no Bloks AI headers, even
    // on a host that has a Bloks AI token to hand
    await waitFor(async () => !(await agentOf(h, clio.id)).busy);
    await h.fetch(`/api/bots/${clio.id}`, { method: "PATCH", body: JSON.stringify({ modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } }) });
    await h.fetch(`/api/bots/${clio.id}/messages`, { method: "POST", body: JSON.stringify({ text: "again" }) });
    assert.ok(await waitFor(async () => (await messagesOf(h, clio)).find((m) => m.text === "Answered on your own plan."), 20_000));
    const [own, ...more] = starts(home);
    assert.equal(more.length, 0);
    // whatever this machine's own environment says, never the service's
    assert.ok(!String(own.base ?? "").startsWith(fake.root), own.base);
    assert.notEqual(own.token, token);
    assert.equal(own.key, null, "the key is dropped, as it always was");
    assert.equal(own.model, "claude-sonnet-5");
    assert.notEqual(own.envModel, "bloks-ai");
    assert.ok(!/x-bloks/.test(own.headers ?? ""));
    assert.ok(!fake.bearers.some((b) => b !== token), "nothing but the Bloks engine reached the service");
    assert.ok(!h.logs().includes(token));
  } finally {
    await h.stop();
  }

  // said once, never again: another start finds nothing to move
  h = await host(home, fake, token);
  try {
    assert.equal(said(await messagesOf(h, clio), CLAUDE_MOVED_NOTICE).length, 1);
    assert.deepEqual((await agentOf(h, clio.id)).modelSelection, { instanceId: "claude", model: "claude-sonnet-5" }, "the person's own choice since stands");
    assert.deepEqual(savedBots(home).find((b) => b.id === penny.id), pennyBefore);
  } finally {
    await h.stop();
  }
});

test("a service turning a Claude Code call away is said in its own sentence, never as the CLI printed it", async (t) => {
  const home = workspace();
  const h = await startHarness({ HOME: home });
  t.after(async () => {
    await h.stop();
    rmSync(home, { recursive: true, force: true });
  });
  for (const tag of ["t-new", "t-old"]) {
    const bot = await hire(h, tag === "t-new" ? "Nell" : "Olga", { modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } });
    await h.fetch(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text: `[${tag}] hello` }) });
    // asked again once, then stopped with no backup: every notice on the way
    const stopped = await waitFor(async () => {
      const notices = (await messagesOf(h, bot)).filter((m) => m.kind === "notice");
      return notices.some((m) => /has stopped here/.test(m.text ?? "")) ? notices : null;
    }, 20_000);
    assert.ok(stopped, tag);
    const sentence = REFUSED.replace(/\.$/, "");
    assert.ok(stopped.some((m) => (m.text ?? "").includes(sentence)), `${tag}: the service's sentence`);
    for (const m of stopped) {
      assert.ok(!/API Error|\{|permission_error|Gateway refused/.test(m.text ?? ""), `${tag}: ${m.text}`);
      assert.ok(!/not signed in/.test(m.text ?? ""), `${tag}: a refusal is not a sign-in to fix: ${m.text}`);
    }
  }
});
